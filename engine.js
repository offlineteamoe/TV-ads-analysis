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
var RAW_FIELDS = ['adcost', 'leads', 'core_enrollments', 'new_cash_core'];

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
  var out = { adcost: 0, leads: 0, core_enrollments: 0, new_cash_core: 0 };
  dicts.forEach(function (d) { RAW_FIELDS.forEach(function (f) { out[f] += d[f] || 0; }); });
  return out;
}

/* Paso 1: totales diarios en vivo (Brand TV Channels), por (region, marca
   que compro el anuncio [MarketingOrganization], fecha, pais) -- pero SIN
   colapsar el cliente que realmente convirtio (Organization). Cada archivo
   de deck ya viene filtrado por Organization real (OE-*.json = clientes que
   terminaron comprando Open English, JR-*.json = clientes Junior); el spend
   real SOLO aparece en el archivo cuyo Organization coincide con quien puso
   el dinero (customerOrg===marca -> "home"), y en el archivo "ajeno" ese
   mismo anuncio aparece con spend=0 pero leads/ventas reales si hubo
   cross-sell. Se preserva el desglose por_org completo (no se suma a ciegas)
   para que Organization (filtro) pueda elegir CUALQUIERA de los dos lados,
   no solo el propio -- eso es lo que le da efecto real a MarketingOrganization
   cuando se marca una marca ademas de la de Organization. */
function buildLiveTotals(deckJsons) {
  var totals = new Map(); // key: region|marca|fecha|pais -> { byOrg: { customerOrg: {spend,leads,core_enrollments,new_cash_core} } }
  var allCountries = new Set();
  Object.keys(DECK_INFO).forEach(function (deckKey) {
    var info = DECK_INFO[deckKey];
    var d = deckJsons[deckKey];
    if (!d) return;
    d.dailyRows.forEach(function (r) {
      if (r.channel_grouping !== 'Brand TV Channels') return;
      var marca = MKTORG_MARCA[r.marketing_organization];
      if (!marca) return; // NextU/Open Mundo: fuera del universo de rotacion
      var country = info.region === 'Brazil' ? null : r.country;
      if (country) allCountries.add(country);
      var k = info.region + '|' + marca + '|' + r.date + '|' + (country || '');
      var t = totals.get(k);
      if (!t) { t = { byOrg: {} }; totals.set(k, t); }
      var b = t.byOrg[info.customerOrg];
      if (!b) { b = { spend: 0, leads: 0, core_enrollments: 0, new_cash_core: 0 }; t.byOrg[info.customerOrg] = b; }
      b.spend += r.spend || 0;
      b.leads += r.leadsEligible || 0;
      b.core_enrollments += r.coreEnrollmentsTotal || 0;
      b.new_cash_core += r.newCashCore || 0;
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
   con companions (otros creativos del mismo feed|fecha|tag|marca ese dia).
   Cada dia guarda DOS cosas: los campos planos (adcost/leads/etc, siempre el
   lado "propio" -- customerOrg===marca del creativo, identico a como
   funcionaba antes) para no romper nada que ya lea esos campos, MAS un
   "by_org" con el desglose completo por Organization real (incluye cross-
   sell hacia la OTRA marca, con adcost=0 porque el dinero no se puso ahi). */
function buildRawCreativeDays(rotation, liveTotals) {
  var allCountriesArr = Array.from(liveTotals.allCountries);
  var totals = liveTotals.totals;
  var byCreative = new Map(); // creativo -> {marca, region, diasByKey: Map((fecha,tc)->accum)}
  var stats = { inversionAtribuida: 0, tagsNoReconocidos: 0, combosSinDato: 0 };

  Object.keys(rotation.pesos).forEach(function (key) {
    var parts = key.split('|');
    var feed = parts[0], dateIso = parts[1], tag = parts[2], marca = parts[3];
    if (marca !== 'Open English' && marca !== 'Open English Junior') return;
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
        var tKey = feed + '|' + marca + '|' + dateIso + '|' + (tc || '');
        var t = totals.get(tKey);
        if (!t) { stats.combosSinDato++; return; }

        if (!byCreative.has(creativo)) byCreative.set(creativo, { marca: marca, region: feed, diasByKey: new Map() });
        var rec = byCreative.get(creativo);
        var dayKey = dateIso + '|' + (tc || '');
        var accum = rec.diasByKey.get(dayKey);
        if (!accum) {
          accum = { fecha: dateIso, topcountry: tc, peso_propio: peso, companions: companions,
            adcost: 0, leads: 0, core_enrollments: 0, new_cash_core: 0, by_org: {} };
          rec.diasByKey.set(dayKey, accum);
        }
        Object.keys(t.byOrg).forEach(function (customerOrg) {
          var b = t.byOrg[customerOrg];
          var dAdcost = peso * (b.spend || 0), dLeads = peso * (b.leads || 0),
            dCore = peso * (b.core_enrollments || 0), dNewCash = peso * (b.new_cash_core || 0);
          var bucket = accum.by_org[customerOrg] || (accum.by_org[customerOrg] = { adcost: 0, leads: 0, core_enrollments: 0, new_cash_core: 0 });
          bucket.adcost += dAdcost; bucket.leads += dLeads; bucket.core_enrollments += dCore; bucket.new_cash_core += dNewCash;
          if (customerOrg === marca) {
            accum.adcost += dAdcost; accum.leads += dLeads; accum.core_enrollments += dCore; accum.new_cash_core += dNewCash;
            stats.inversionAtribuida += dAdcost;
          }
        });
      });
    });
  });
  return { byCreative: byCreative, stats: stats };
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
      var totals = sumRawEngine(diasDelAnio); // "home" (propio) -- por compatibilidad con el resto del pipeline
      // No descartar por leads=0 en "home": puede tener leads reales solo en
      // cross-sell (by_org de la OTRA Organization), que Organization (filtro)
      // puede llegar a pedir mas adelante en el cliente.
      var anyLeads = totals.leads > 0 || diasDelAnio.some(function (d) {
        return Object.keys(d.by_org || {}).some(function (o) { return (d.by_org[o].leads || 0) > 0; });
      });
      if (!anyLeads) return;
      var metrics = metricsFromSumsEngine(totals);
      var tax = taxonomyByName[creativo] || {};
      var sliceKey = rec.marca + '|' + rec.region + '|Total';

      var row = Object.assign({
        nombre: creativo, marca: rec.marca, region: rec.region,
        num_dias_activos: new Set(diasDelAnio.map(function (d) { return d.fecha; })).size,
        meses_activos: Array.from(new Set(diasDelAnio.map(function (d) { return d.fecha.slice(0, 7); }))).sort(),
        fecha_lanzamiento: diasDelAnio.reduce(function (m, d) { return (!m || d.fecha < m) ? d.fecha : m; }, null),
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
