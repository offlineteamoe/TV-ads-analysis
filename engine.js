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
var MARCA_TO_MKTORG = { 'Open English': 'OE', 'Open English Junior': 'Open English Junior' };
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

/* Paso 1: totales diarios en vivo (Brand TV Channels), sumados a traves de
   los 4 archivos de deck por (region, mktorg, fecha, pais) -- el spend NO se
   duplica entre archivos: para un mktorg dado, el archivo "propio" trae el
   spend real y el archivo "ajeno" (cross-sell) trae 0 de spend con leads/
   ventas reales -- sumar los 4 da el total correcto sin doble conteo
   (verificado empiricamente con datos reales). */
function buildLiveTotals(deckJsons) {
  var totals = new Map();
  var allCountries = new Set();
  var specs = [['OE-LATAM', 'Latam'], ['JR-LATAM', 'Latam'], ['OE-BR', 'Brazil'], ['JR-BR', 'Brazil']];
  specs.forEach(function (spec) {
    var d = deckJsons[spec[0]], region = spec[1];
    if (!d) return;
    d.dailyRows.forEach(function (r) {
      if (r.channel_grouping !== 'Brand TV Channels') return;
      var mktorg = r.marketing_organization;
      if (mktorg !== 'OE' && mktorg !== 'Open English Junior') return; // NextU/Open Mundo: fuera del universo de rotacion
      var country = region === 'Brazil' ? null : r.country;
      if (country) allCountries.add(country);
      var k = region + '|' + mktorg + '|' + r.date + '|' + (country || '');
      var t = totals.get(k);
      if (!t) { t = { spend: 0, leads: 0, core_enrollments: 0, new_cash_core: 0 }; totals.set(k, t); }
      t.spend += r.spend || 0;
      t.leads += r.leadsEligible || 0;
      t.core_enrollments += r.coreEnrollmentsTotal || 0;
      t.new_cash_core += r.newCashCore || 0;
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
   con companions (otros creativos del mismo feed|fecha|tag|marca ese dia). */
function buildRawCreativeDays(rotation, liveTotals) {
  var allCountriesArr = Array.from(liveTotals.allCountries);
  var totals = liveTotals.totals;
  var byCreative = new Map(); // creativo -> {marca, region, diasByKey: Map((fecha,tc)->accum)}
  var stats = { inversionAtribuida: 0, tagsNoReconocidos: 0, combosSinDato: 0 };

  Object.keys(rotation.pesos).forEach(function (key) {
    var parts = key.split('|');
    var feed = parts[0], dateIso = parts[1], tag = parts[2], marca = parts[3];
    var mktorg = MARCA_TO_MKTORG[marca];
    if (!mktorg) return;
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
        var tKey = feed + '|' + mktorg + '|' + dateIso + '|' + (tc || '');
        var t = totals.get(tKey);
        if (!t) { stats.combosSinDato++; return; }
        var adcost = peso * t.spend;
        stats.inversionAtribuida += adcost;

        if (!byCreative.has(creativo)) byCreative.set(creativo, { marca: marca, region: feed, diasByKey: new Map() });
        var rec = byCreative.get(creativo);
        var dayKey = dateIso + '|' + (tc || '');
        var accum = rec.diasByKey.get(dayKey);
        if (!accum) {
          accum = { fecha: dateIso, topcountry: tc, adcost: 0, leads: 0, core_enrollments: 0, new_cash_core: 0, peso_propio: peso, companions: companions };
          rec.diasByKey.set(dayKey, accum);
        }
        accum.adcost += adcost;
        accum.leads += peso * t.leads;
        accum.core_enrollments += peso * t.core_enrollments;
        accum.new_cash_core += peso * t.new_cash_core;
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
      var totals = sumRawEngine(diasDelAnio);
      if (!totals.leads) return; // sin actividad real ese anio
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
