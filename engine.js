/* ============================================================
   Motor de atribucion cliente-side: rotacion x pais x KPI en vivo.
   Puerto 1:1 de scripts/build_rotation_weights.py +
   build_performance_crossref_spotfire.py + build_creative_metrics_v7.py
   (proyecto anterior), adaptado para leer los 4 JSON de
   etl/export/*.json en vivo en vez de Descarga Spotfire.csv.
   Validado contra la referencia Python: mismos numeros exactos
   (96.3% cobertura, mismo top-10 por adcost).
   ============================================================ */
var SPECIFIC_TAG_COUNTRY = { 'Rotacion Mexico': 'Mexico', 'Rotacion Argentina': 'Argentina', 'Rotacion Colombia': 'Colombia' };
var MKTORG_MARCA = { 'OE': 'Open English', 'Open English Junior': 'Open English Junior' };
var DECK_INFO = {
  'OE-LATAM': { region: 'Latam', customerOrg: 'Open English' },
  'JR-LATAM': { region: 'Latam', customerOrg: 'Open English Junior' },
  'OE-BR': { region: 'Brazil', customerOrg: 'Open English' },
  'JR-BR': { region: 'Brazil', customerOrg: 'Open English Junior' },
};
var RAW_FIELDS = ['adcost', 'adcost_real', 'leads', 'core_enrollments', 'new_cash_core'];

function metricsFromSumsEngine(s) {
  var adcost = s.adcost || 0, leads = s.leads || 0, core = s.core_enrollments || 0, newCash = s.new_cash_core || 0;
  return {
    leads_per_1k: adcost ? leads / adcost * 1000 : null,
    cpl: leads ? adcost / leads : null,
    cvr: leads ? core / leads : null,
    mncc_core_pct: newCash ? (newCash - adcost) / newCash : null,
  };
}
function sumRawEngine(dicts) {
  var out = { adcost: 0, adcost_real: 0, leads: 0, core_enrollments: 0, new_cash_core: 0 };
  dicts.forEach(function (d) { RAW_FIELDS.forEach(function (f) { out[f] += d[f] || 0; }); });
  return out;
}

/* Paso 1: totales diarios en vivo (Brand TV Channels), por (region,
   Organization -- el archivo de deck, OE-*.json = clientes que terminaron
   comprando Open English, JR-*.json = clientes Junior --, fecha, pais).
   CORREGIDO 2026-08-19 (tercera vuelta): confirmado con el usuario, con la
   columna F ("Brand") del Excel de rotacion como prueba, que la columna que
   fija un creativo a una sola marca (nunca a las dos) es Organization, no
   MarketingOrganization -- por eso rotation.pesos (parts[3] de su key) y
   este `totals` deben quedar keyed por Organization, no por
   marketing_organization como antes. Dentro de cada (Organization,fecha,
   pais), se guarda ademas un desglose por MarketingOrganization
   (`byMktOrg`) SOLO para leads/ventas/New Cash Core -- el spend real
   siempre es el de la fila cuyo marketing_organization coincide con el
   Organization del deck, la fila "ajena" (ej. dentro de OE-BR.json una fila
   con marketing_organization=Open English Junior) trae spend=0 pero puede
   traer leads reales (alguien vio un anuncio/campana de Junior pero termino
   siendo cliente de Open English) -- eso es lo unico que MarketingOrganization
   (filtro) debe sumar o no.
   CORREGIDO 2026-08-19 (cuarta vuelta) -- mediaSpendReal (para "Excluir
   SEM-Brand Spend" y el gate de dia-activo) YA NO usa el campo
   offlineSpendReal del KPI: viene pre-agregado desde el sistema de origen
   bajo un "pais" contenedor ("TV LATAM Excl Arg Mex") para el resto de
   LATAM que NO calza pais por pais con el resto de la data, e infla el
   gasto de forma inconsistente. Ahora se calcula directamente, verificable,
   desde `brandedTypeRows` (desglose real de "Brand TV Channels" por type,
   incluyendo "SEM-Brand", pais por pais): total de todos los types MENOS el
   type "SEM-Brand". brandedTypeRows no trae marketing_organization (viene
   ya filtrado por Organization/deck), pero como el spend de la fila "ajena"
   siempre es $0, sumar sin ese filtro da el mismo resultado que sumar solo
   el propio. */
function buildLiveTotals(deckJsons) {
  var totals = new Map(); // key: region|Organization|fecha|pais -> { spend, mediaSpendReal, byMktOrg: { mktOrg: {leads,core_enrollments,new_cash_core} } }
  var allCountries = new Set();
  Object.keys(DECK_INFO).forEach(function (deckKey) {
    var info = DECK_INFO[deckKey]; // info.customerOrg = Organization (identidad del deck)
    var d = deckJsons[deckKey];
    if (!d) return;
    d.dailyRows.forEach(function (r) {
      if (r.channel_grouping !== 'Brand TV Channels') return;
      var mktOrg = MKTORG_MARCA[r.marketing_organization];
      if (!mktOrg) return; // NextU/Open Mundo: fuera del universo de rotacion
      var country = info.region === 'Brazil' ? null : r.country;
      if (country) allCountries.add(country);
      var k = info.region + '|' + info.customerOrg + '|' + r.date + '|' + (country || '');
      var t = totals.get(k);
      if (!t) { t = { spend: 0, mediaSpendReal: 0, byMktOrg: {} }; totals.set(k, t); }
      /* spend SOLO es real en la fila cuyo marketing_organization coincide
         con el Organization de este deck (la fila "ajena" siempre trae
         spend=0) -- por eso el gasto de un creativo nunca cambia segun
         MarketingOrganization (filtro). */
      if (mktOrg === info.customerOrg) t.spend += r.spend || 0;
      var b = t.byMktOrg[mktOrg];
      if (!b) { b = { leads: 0, core_enrollments: 0, new_cash_core: 0 }; t.byMktOrg[mktOrg] = b; }
      b.leads += r.leadsEligible || 0;
      b.core_enrollments += r.coreEnrollmentsTotal || 0;
      b.new_cash_core += r.newCashCore || 0;
    });
    (d.brandedTypeRows || []).forEach(function (r) {
      if (r.type === 'SEM-Brand') return;
      var country = info.region === 'Brazil' ? null : r.country;
      var k = info.region + '|' + info.customerOrg + '|' + r.date + '|' + (country || '');
      var t = totals.get(k);
      if (!t) { t = { spend: 0, mediaSpendReal: 0, byMktOrg: {} }; totals.set(k, t); }
      t.mediaSpendReal += r.spend || 0;
    });
  });
  return { totals: totals, allCountries: allCountries };
}

/* Resolucion tag->paises: identica a resolve_country_keys() del proyecto anterior. */
function resolveCountryKeys(feed, tag, tagsActivos, allCountriesArr) {
  if (feed === 'Brazil') return [null];
  if (SPECIFIC_TAG_COUNTRY[tag]) return [SPECIFIC_TAG_COUNTRY[tag]];
  if (tag === 'Rotacion Latam') {
    var specific = Object.keys(SPECIFIC_TAG_COUNTRY).map(function (k) { return SPECIFIC_TAG_COUNTRY[k]; });
    var libres = allCountriesArr.filter(function (c) { return specific.indexOf(c) === -1; });
    Object.keys(SPECIFIC_TAG_COUNTRY).forEach(function (t) {
      if (tagsActivos.indexOf(t) === -1) libres.push(SPECIFIC_TAG_COUNTRY[t]);
    });
    return libres;
  }
  return [];
}

/* Paso 2: cruce peso de rotacion x total del dia/pais -> dias crudos por creativo,
   con companions (otros creativos del mismo feed|fecha|tag|Organization ese
   dia). Cada dia guarda: adcost/adcost_real (el gasto REAL de ese Organization
   ese dia, prorrateado por peso -- SIEMPRE el mismo sin importar
   MarketingOrganization), leads/core/new_cash_core "home" (solo lo que trajo
   el propio MarketingOrganization===Organization, por compatibilidad), MAS
   un "by_mktorg" con el desglose completo por MarketingOrganization (incluye
   lo que trajo la OTRA marca hacia este mismo Organization) -- eso es lo
   unico que MarketingOrganization (filtro) suma o no en app.js, sin tocar
   nunca el gasto ni la lista de creativos. */
function buildRawCreativeDays(rotation, liveTotals) {
  var allCountriesArr = Array.from(liveTotals.allCountries);
  var totals = liveTotals.totals;
  var byCreative = new Map(); // creativo -> {organization, region, diasByKey: Map((fecha,tc)->accum)}
  var stats = { inversionAtribuida: 0, tagsNoReconocidos: 0, combosSinDato: 0, diasSinMediaSpend: 0 };

  Object.keys(rotation.pesos).forEach(function (key) {
    var parts = key.split('|');
    var feed = parts[0], dateIso = parts[1], tag = parts[2], organization = parts[3];
    if (organization !== 'Open English' && organization !== 'Open English Junior') return;
    var tagsActivos = rotation.tags_por_fecha[feed + '|' + dateIso] || [];
    var countryKeys = resolveCountryKeys(feed, tag, tagsActivos, allCountriesArr);
    var entries = rotation.pesos[key];
    if (!countryKeys.length) { stats.tagsNoReconocidos += entries.length; return; }

    entries.forEach(function (entry, i) {
      var creativo = entry.creativo;
      var peso = entry.peso;
      var companions = entries.filter(function (_, j) { return j !== i; })
        .map(function (e) { return { nombre: e.creativo, peso: e.peso }; });

      countryKeys.forEach(function (tc) {
        var tKey = feed + '|' + organization + '|' + dateIso + '|' + (tc || '');
        var t = totals.get(tKey);
        if (!t) { stats.combosSinDato++; return; }
        /* Sin media spend real (TV realmente apagada ese dia/pais, aunque el
           bucket "Brand TV Channels" siga trayendo un monto de SEM-Brand
           digital) -- el dia NO cuenta como activo para NINGUN creativo de
           este slot de rotacion: se descarta por completo (ni leads, ni
           gasto, ni ventas), no solo se excluye de un contador aparte. */
        if ((t.mediaSpendReal || 0) <= 0) { stats.diasSinMediaSpend++; return; }

        if (!byCreative.has(creativo)) byCreative.set(creativo, { marca: organization, region: feed, diasByKey: new Map() });
        var rec = byCreative.get(creativo);
        var dayKey = dateIso + '|' + (tc || '');
        var accum = rec.diasByKey.get(dayKey);
        if (!accum) {
          accum = { fecha: dateIso, topcountry: tc, peso_propio: peso, companions: companions,
            adcost: peso * (t.spend || 0), adcost_real: peso * (t.mediaSpendReal || 0),
            leads: 0, core_enrollments: 0, new_cash_core: 0, by_mktorg: {} };
          rec.diasByKey.set(dayKey, accum);
          stats.inversionAtribuida += accum.adcost;
        }
        Object.keys(t.byMktOrg).forEach(function (mktOrg) {
          var b = t.byMktOrg[mktOrg];
          var dLeads = peso * (b.leads || 0), dCore = peso * (b.core_enrollments || 0), dNewCash = peso * (b.new_cash_core || 0);
          var bucket = accum.by_mktorg[mktOrg] || (accum.by_mktorg[mktOrg] = { leads: 0, core_enrollments: 0, new_cash_core: 0 });
          bucket.leads += dLeads; bucket.core_enrollments += dCore; bucket.new_cash_core += dNewCash;
          if (mktOrg === organization) {
            accum.leads += dLeads; accum.core_enrollments += dCore; accum.new_cash_core += dNewCash;
          }
        });
      });
    });
  });
  return { byCreative: byCreative, stats: stats };
}

/* Un creativo puede tener MAS de un "lanzamiento" real en el mismo ano: sale
   al aire, se apaga por completo varias semanas o meses, y vuelve a salir
   (relanzamiento) -- cada uno de esos arranques tiene su propia "primera
   semana", independiente del anterior. Lo que NO cuenta como un lanzamiento
   nuevo es que cambie el creativo ACOMPANANTE de una semana a la otra (eso es
   normal en la rotacion, no significa que ESTE creativo se haya relanzado).
   Por eso la deteccion se hace SOLO sobre las fechas propias del creativo
   (nunca sobre companions/splits): se ordenan las fechas unicas en las que
   estuvo activo y se corta un lanzamiento nuevo cuando hay un hueco de mas
   de 7 dias completos sin actividad -- un hueco corto (unos pocos dias sin
   aparecer por como cayo la rotacion esa semana) sigue siendo el MISMO
   lanzamiento. */
function computeLaunchDates(fechasUnicasOrdenadas) {
  var launches = [];
  var prevTime = null;
  fechasUnicasOrdenadas.forEach(function (fecha) {
    var t = Date.parse(fecha + 'T00:00:00Z');
    if (prevTime === null || (t - prevTime) / 86400000 > 7) launches.push(fecha);
    prevTime = t;
  });
  return launches;
}

/* Paso 3: ensamblar en la MISMA estructura que consumia el dashboard anterior
   (years.{year}.slices.{marca|region|Total}.ranking_creativos[], cada uno con
   detalle_diario) para poder reusar computeRollup/renderRanking/modales tal cual. */
function buildYearsData(rotation, deckJsons, taxonomyByName, years) {
  var live = buildLiveTotals(deckJsons);
  var raw = buildRawCreativeDays(rotation, live);
  var yearsOut = {};

  years.forEach(function (year) {
    var slicesAccum = {}; // sliceKey -> [] ranking rows

    raw.byCreative.forEach(function (rec, creativo) {
      var diasDelAnio = Array.from(rec.diasByKey.values()).filter(function (d) { return d.fecha.indexOf(year) === 0; });
      if (!diasDelAnio.length) return;
      var totals = sumRawEngine(diasDelAnio); // "home" (propio, MarketingOrganization===Organization) -- por compatibilidad con el resto del pipeline
      // No descartar por leads=0 en "home": puede tener leads reales solo via
      // la OTRA MarketingOrganization (by_mktorg), que el filtro del mismo
      // nombre puede llegar a pedir mas adelante en el cliente.
      var anyLeads = totals.leads > 0 || diasDelAnio.some(function (d) {
        return Object.keys(d.by_mktorg || {}).some(function (o) { return (d.by_mktorg[o].leads || 0) > 0; });
      });
      if (!anyLeads) return;
      var metrics = metricsFromSumsEngine(totals);
      var tax = taxonomyByName[creativo] || {};
      var sliceKey = rec.marca + '|' + rec.region + '|Total';
      var fechasUnicas = Array.from(new Set(diasDelAnio.map(function (d) { return d.fecha; }))).sort();

      var row = Object.assign({
        nombre: creativo, marca: rec.marca, region: rec.region,
        num_dias_activos: fechasUnicas.length,
        meses_activos: Array.from(new Set(diasDelAnio.map(function (d) { return d.fecha.slice(0, 7); }))).sort(),
        fecha_lanzamiento: fechasUnicas[0] || null,
        launch_dates: computeLaunchDates(fechasUnicas),
        detalle_diario: diasDelAnio.slice().sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; }),
      }, totals, metrics, tax);
      // El Excel STANDARD/taxonomia llama a esta columna "Adstream Link" ->
      // adstream_link en el JSON; app.js espera link_video en todos sus sitios
      // de renderizado (boton "Ver video"). Normalizar aqui, una sola vez.
      row.link_video = tax.adstream_link || null;

      (slicesAccum[sliceKey] = slicesAccum[sliceKey] || []).push(row);
    });

    var slicesOut = {};
    Object.keys(slicesAccum).forEach(function (sk) {
      var ranking = slicesAccum[sk].slice().sort(function (a, b) {
        var av = a.mncc_core_pct, bv = b.mncc_core_pct;
        return (bv == null ? -999 : bv) - (av == null ? -999 : av);
      });
      var parts = sk.split('|');
      slicesOut[sk] = { meta: { marca: parts[0], region: parts[1], pais: parts[2] }, num_creativos_activos: ranking.length, ranking_creativos: ranking };
    });
    yearsOut[year] = { slices: slicesOut };
  });

  return { years: yearsOut, stats: raw.stats, allCountries: Array.from(live.allCountries).sort() };
}
