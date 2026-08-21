/* ============================================================
   TBD Dolo -- motor de datos ejecutivo (Ene-Jul 2025 vs Ene-Jul 2026).
   NO toca STATE ni ninguna funcion de app.js/engine.js -- lee los mismos
   YEARS_DATA/MKTORG_MARCA/DECK_INFO ya construidos y corregidos, y agrega
   su propia capa de agregacion (equivalente a agg()/dagg()/wearout()/
   launch_week() del proyecto de referencia en Python), mas el indice de
   estacionalidad de Ahrefs (reemplaza Google Trends) y el JR Halo.
   Organization es seleccionable (Open English / Open English Junior, ver
   TBD_STATE.org y tbdOrgName()) -- toda la matematica de abajo es identica
   para ambas marcas, solo cambia que slice de YEARS_DATA se lee.
   MarketingOrganization = solo la propia (igual a Organization) porque
   SEM-Brand y "gasto ajeno" no aplican a un reporte ejecutivo de inversion
   propia. ============================================================ */
var TBD_PERIODS = {
  '2025': { from: '2025-01-01', to: '2025-07-31' },
  '2026': { from: '2026-01-01', to: '2026-07-31' },
};
function tbdOrgName(){ return TBD_STATE.org === 'Open English Junior' ? 'Open English Junior' : 'Open English'; }

/* ---------- estacionalidad (Ahrefs, precomputado en seasonality_ahrefs.json embebido) ---------- */
var TBD_SEASONALITY = window.__TBD_SEASONALITY__ || {};
function tbdDemandIndex(territory, fecha){
  var t = TBD_SEASONALITY[territory];
  if(!t) return 100;
  var v = t.index_by_month[fecha.slice(0,7)];
  return v==null ? 100 : v;
}

/* ---------- filtro de dias: rango de fecha explicito + pais ---------- */
function tbdDayInRange(fecha, from, to){ return fecha>=from && fecha<=to; }
function tbdDayPassesPais(topcountry, pais){
  if(topcountry==null) return true; // Brasil: sin desglose de pais
  return pais==null || topcountry===pais;
}

/* ---------- JR Halo: leads de clientes reales Junior atribuidos a marketing_organization='OE',
   re-derivado directo de dailyRows del deck de Junior (JR-BR.json / JR-LATAM.json) -- no toca
   engine.js. Se prorratea con el MISMO peso de rotacion del dia para el creativo OE (mismo
   mecanismo que ya usa engine.js para todo lo demas). ---------- */
var TBD_JR_HALO_RAW = null; // Map: 'region|fecha|pais' -> leads JR atribuidos a marketing_organization OE
function tbdBuildJrHaloRaw(deckJsons){
  var m = new Map();
  ['JR-LATAM','JR-BR'].forEach(function(deckKey){
    var info = DECK_INFO[deckKey];
    var d = deckJsons[deckKey];
    if(!d) return;
    d.dailyRows.forEach(function(r){
      if(r.channel_grouping!=='Brand TV Channels') return;
      if(r.marketing_organization!=='OE') return; // solo lo que se le atribuye a inversion de OE adulto
      var country = info.region==='Brazil' ? null : r.country;
      var k = info.region+'|'+r.date+'|'+(country||'');
      m.set(k, (m.get(k)||0) + (r.leadsEligible||0));
    });
  });
  return m;
}
function tbdJrHaloLeadsForDay(region, fecha, topcountry, peso){
  if(!TBD_JR_HALO_RAW) return 0;
  var k = region+'|'+fecha+'|'+(topcountry||'');
  return (TBD_JR_HALO_RAW.get(k)||0) * peso;
}

/* ---------- construir los "dias" de un creativo para un periodo+pais, con demand index ---------- */
function tbdDailyItemFromRaw(d, territory, region){
  return {
    date: d.fecha,
    l: d.leads||0,            // home: MarketingOrganization===Organization (mismo criterio que el resto del dashboard)
    s: d.adcost_real||0,      // SIEMPRE neto de SEM-Brand (regla permanente del reporte ejecutivo)
    e: d.core_enrollments||0,
    c: d.new_cash_core||0,
    jr_l: tbdJrHaloLeadsForDay(region, d.fecha, d.topcountry, d.peso_propio),
    dem: tbdDemandIndex(territory, d.fecha),
  };
}

/* ---------- agg(): puerto directo de la funcion Python, misma forma de retorno ---------- */
function tbdAgg(dl){
  if(!dl || !dl.length) return null;
  var tl=0, ts=0, te=0, tc=0, jr=0;
  dl.forEach(function(d){ tl+=d.l; ts+=d.s; te+=d.e; tc+=d.c; jr+=d.jr_l; });
  if(tl<=0 || ts<=0) return null;
  var n = dl.length;
  var dw=0; dl.forEach(function(d){ dw += d.dem*d.s; });
  var di = ts>0 ? dw/ts : 100; // demand index spend-weighted
  return {
    l: tl, s: ts, e: te, c: tc, jr_l: jr, n: n,
    l1k: tl/ts*1000,
    l1k_adj: tl/ts*1000/(di/100),
    cpl: ts/tl,
    cpl_adj: ts/tl*(di/100),
    cvr: tl>0 ? te/tl : 0,
    mncc: tc>0 ? (tc-ts)/tc : 0,
    lpd: tl/n,
    jr_lpd: jr/n,
    jr_l1k_adj: ts>0 ? (jr/ts*1000)/(di/100) : 0,
    dem: di,
  };
}

/* ---------- lista de creativos de un territorio/periodo, agrupados por Ad Name ----------
   CORREGIDO 2026-08-21: el Video Name (columna A, `row.nombre`) puede tener
   variantes V2/V3/etc. del MISMO anuncio (cambios minimos, ej. una nota
   legal) -- agruparlos como si fueran creativos distintos infla la lista y
   descuadra los dias/porcentajes de rotacion. Se agrupa por Ad Name (columna
   B, `row.ad_name`) exactamente como ya hace `groupCreativesByAdName()` en
   el dashboard principal (app.js) -- misma regla, portada aqui porque TBD
   Dolo arma su propia lista de dias (`_dailyItems`) en vez de usar
   `recomputeCreative()`. */
function tbdCreativesForPeriod(territory, region, yearKey, pais, adTypeFilter){
  var yd = YEARS_DATA[yearKey];
  if(!yd) return [];
  var slice = yd.slices[tbdOrgName()+'|'+region+'|Total'];
  var rows = slice ? slice.ranking_creativos : [];
  var per = TBD_PERIODS[yearKey];

  var byAdName = {}; // ad_name -> [{row, rawDays, dailyItems}, ...] (uno por Video Name)
  rows.forEach(function(row){
    if(adTypeFilter && adTypeFilter!=='Todos' && row.ad_type!==adTypeFilter) return;
    var rawDays = (row.detalle_diario||[]).filter(function(d){
      return tbdDayInRange(d.fecha, per.from, per.to) && tbdDayPassesPais(d.topcountry, pais);
    });
    if(!rawDays.length) return;
    var dailyItems = rawDays.map(function(d){ return tbdDailyItemFromRaw(d, territory, region); });
    var adName = row.ad_name || row.nombre;
    (byAdName[adName] = byAdName[adName] || []).push({ row: row, rawDays: rawDays, dailyItems: dailyItems });
  });

  var out = [];
  Object.keys(byAdName).forEach(function(adName){
    var videos = byAdName[adName];
    var mergedItems = [], mergedRawDays = [], allDates = new Set();
    videos.forEach(function(v){
      mergedItems = mergedItems.concat(v.dailyItems);
      v.rawDays.forEach(function(d){ mergedRawDays.push(Object.assign({video_name:v.row.nombre}, d)); allDates.add(d.fecha); });
    });
    var a = tbdAgg(mergedItems);
    if(!a) return;
    // dias activos = FECHAS UNICAS (no filas) -- si dos versiones rotaron el
    // mismo dia, cuenta como un solo dia activo, igual que en el dashboard
    // principal (`allDates.size` en groupCreativesByAdName).
    a.n = allDates.size;
    a.lpd = a.n ? a.l/a.n : null;
    a.jr_lpd = a.n ? a.jr_l/a.n : null;
    var primary = videos.slice().sort(function(x,y){ return y.rawDays.length - x.rawDays.length; })[0].row;
    mergedRawDays.sort(function(x,y){ return x.fecha<y.fecha ? -1 : (x.fecha>y.fecha?1:0); });
    out.push(Object.assign({
      nombre: adName, ad_name: adName, ad_type: primary.ad_type, campaign_name: primary.campaign_name,
      theme: primary.theme, theme_mechanism_code: primary.theme_mechanism_code, pain_point: primary.pain_point, tone_category: primary.tone_category,
      hook_audio_type_code: primary.hook_audio_type_code, hook_visual_type_code: primary.hook_visual_type_code,
      cta_type_code: primary.cta_type_code, type_of_production: primary.type_of_production, version: primary.version,
      link_video: primary.link_video, launch_dates: primary.launch_dates,
      theme_explanation: primary.theme_explanation, hook_audio: primary.hook_audio, hook_visual: primary.hook_visual,
      is_grouped: videos.length > 1,
      versions: videos.map(function(v){ return { video_name: v.row.nombre, link_video: v.row.link_video, version: v.row.version, num_dias: new Set(v.rawDays.map(function(d){return d.fecha;})).size }; }),
      _dailyItems: mergedItems, _rawDays: mergedRawDays,
    }, a));
  });
  return out.sort(function(a,b){ return b.l1k_adj - a.l1k_adj; });
}

/* ---------- SOLO para la pestana "Versions": V1 vs V2/V3 necesita cada Video
   Name como fila propia (si se agrupara por Ad Name, V1 y V2 quedarian
   fundidos en la MISMA fila y la comparacion dejaria de existir). El resto
   del dashboard (Portfolio, Promo, Generic, JR Halo, Launch, Wearout, y las
   demas dimensiones) usa `tbdCreativesForPeriod()` (agrupado por Ad Name)
   arriba -- esta funcion es la unica excepcion, a proposito. ---------- */
function tbdVideoRowsForPeriod(territory, region, yearKey, pais, adTypeFilter){
  var yd = YEARS_DATA[yearKey];
  if(!yd) return [];
  var slice = yd.slices[tbdOrgName()+'|'+region+'|Total'];
  var rows = slice ? slice.ranking_creativos : [];
  var per = TBD_PERIODS[yearKey];
  var out = [];
  rows.forEach(function(row){
    if(adTypeFilter && adTypeFilter!=='Todos' && row.ad_type!==adTypeFilter) return;
    var rawDays = (row.detalle_diario||[]).filter(function(d){
      return tbdDayInRange(d.fecha, per.from, per.to) && tbdDayPassesPais(d.topcountry, pais);
    });
    if(!rawDays.length) return;
    var dailyItems = rawDays.map(function(d){ return tbdDailyItemFromRaw(d, territory, region); });
    var a = tbdAgg(dailyItems);
    if(!a) return;
    a.n = new Set(rawDays.map(function(d){return d.fecha;})).size;
    a.lpd = a.n ? a.l/a.n : null;
    out.push(Object.assign({ nombre: row.nombre, ad_name: row.ad_name||row.nombre, version: row.version, ad_type: row.ad_type }, a));
  });
  return out;
}

/* ---------- launch week: primeros 7 dias calendario desde la primera fecha de aire ---------- */
function tbdLaunchWeek(item){
  var dl = item._dailyItems;
  if(!dl || !dl.length) return null;
  var asc = dl.slice().sort(function(a,b){ return a.date<b.date?-1:1; });
  var firstT = Date.parse(asc[0].date+'T00:00:00Z');
  var lw = asc.filter(function(d){ return (Date.parse(d.date+'T00:00:00Z')-firstT)/86400000 <= 6; });
  return tbdAgg(lw);
}

/* ---------- wearout: mitad por conteo de dias, no por semana calendario ---------- */
function tbdWearout(item){
  var dl = item._dailyItems;
  if(!dl || dl.length<6) return {h1:null, h2:null, pct:null};
  var asc = dl.slice().sort(function(a,b){ return a.date<b.date?-1:1; });
  var mid = Math.floor(asc.length/2);
  var h1 = tbdAgg(asc.slice(0,mid)), h2 = tbdAgg(asc.slice(mid));
  if(!h1 || !h2 || h1.l1k_adj<=0) return {h1:h1, h2:h2, pct:null};
  return {h1:h1, h2:h2, pct:(h2.l1k_adj-h1.l1k_adj)/h1.l1k_adj*100};
}

/* ---------- dimension rollup: puerto de dagg() ---------- */
function tbdDimensionRollup(items, keyFn){
  var buckets = {};
  items.forEach(function(r){
    var k = keyFn(r);
    if(k==null) return;
    if(!buckets[k]) buckets[k] = {tl:0, ts:0, te:0, jr:0, n:0, days:0, dw:0, dws:0};
    var b = buckets[k];
    b.tl += r.l; b.ts += r.s; b.te += r.e; b.jr += r.jr_l; b.n++; b.days += r.n; b.dw += r.dem*r.s; b.dws += r.s;
  });
  var out = [];
  Object.keys(buckets).forEach(function(k){
    var b = buckets[k];
    if(b.ts<=0) return;
    var l1k = b.tl/b.ts*1000;
    var di = b.dws>0 ? b.dw/b.dws : 100;
    out.push({ label:k, l1k:l1k, l1k_adj:l1k/(di/100), cpl:b.ts/b.tl, cpl_adj:(b.ts/b.tl)*(di/100),
      cvr: b.tl>0? b.te/b.tl:0, n:b.n, s:b.ts, jr_l1k_adj: b.ts>0?(b.jr/b.ts*1000)/(di/100):0, dem:di });
  });
  return out.sort(function(a,b){ return b.l1k_adj-a.l1k_adj; });
}

/* ---------- portfolio: agregado de TODOS los creativos de un periodo (no por creativo) ---------- */
function tbdPortfolio(items){
  var dl = [];
  items.forEach(function(r){ dl = dl.concat(r._dailyItems); });
  var a = tbdAgg(dl);
  var uniqueCreatives = items.length;
  return Object.assign({ num_creatives: uniqueCreatives }, a || {l:0,s:0,l1k_adj:null,cpl_adj:null,cvr:null,mncc:null});
}

/* ============================================================
   UI: shell, filtros (region+pais), navegacion por pestanas con URL
   propia (location.hash), y render de cada vista. Todo bajo TBD_STATE,
   completamente separado de STATE (el del dashboard original). Nunca
   escroleable: cada click de pestana reemplaza #tbd-page por completo.
   ============================================================ */
var TBD_STATE = { territory:'Brazil', tab:'portfolio', org:'Open English' };
var TBD_ORGS = ['Open English', 'Open English Junior'];
var TBD_TERRITORIES = null; // se llena en tbdBoot() con COUNTRIES (menos el contenedor no-pais)
var TBD_NAV = [
  { group:{en:'Overview',es:'Resumen',pt:'Resumo'}, items:[
    {id:'adjkpi', label:{en:'★ Adj. KPI',es:'★ KPI Ajustado',pt:'★ KPI Ajustado'}},
    {id:'portfolio', label:{en:'Portfolio',es:'Portfolio',pt:'Portfólio'}},
  ]},
  { group:{en:'Creatives',es:'Creativos',pt:'Criativos'}, items:[
    {id:'promo', label:{en:'Promo',es:'Promo',pt:'Promo'}},
    {id:'generic', label:{en:'Generic',es:'Genérico',pt:'Genérico'}},
    {id:'pvg', label:{en:'Promo vs Generic',es:'Promo vs Genérico',pt:'Promo vs Genérico'}},
  ]},
  { group:{en:'Dimensions',es:'Dimensiones',pt:'Dimensões'}, items:[
    {id:'tone', label:{en:'Tone',es:'Tono',pt:'Tom'}},
    {id:'hooks', label:{en:'Hooks',es:'Hooks',pt:'Hooks'}},
    {id:'versions', label:{en:'Versions',es:'Versiones',pt:'Versões'}},
    {id:'campaigns', label:{en:'Campaigns',es:'Campañas',pt:'Campanhas'}},
    {id:'promo_type', label:{en:'Promo Type',es:'Tipo de Promo',pt:'Tipo de Promo'}},
    {id:'theme', label:{en:'Theme',es:'Tema',pt:'Tema'}},
    {id:'ai_vs_real', label:{en:'AI vs Real',es:'IA vs Real',pt:'IA vs Real'}},
  ]},
  { group:{en:'Cross-brand',es:'Cruce de marca',pt:'Cruzamento de marca'}, oeOnly:true, items:[
    {id:'jrhalo', label:{en:'JR Halo',es:'JR Halo',pt:'JR Halo'}},
  ]},
  { group:{en:'Lifecycle',es:'Ciclo de vida',pt:'Ciclo de vida'}, items:[
    {id:'launch', label:{en:'Launch Week',es:'Semana de Lanzamiento',pt:'Semana de Lançamento'}},
    {id:'wearout', label:{en:'Wear-Out',es:'Desgaste',pt:'Desgaste'}},
  ]},
  { group:{en:'Demand',es:'Demanda',pt:'Demanda'}, items:[
    {id:'seasonality', label:{en:'Seasonality Index',es:'Índice de Estacionalidad',pt:'Índice de Estacionalidade'}},
  ]},
  { group:{en:'Conclusions',es:'Conclusiones',pt:'Conclusões'}, items:[
    {id:'insights', label:{en:'Insights',es:'Insights',pt:'Insights'}},
    {id:'tests', label:{en:'Recommended Tests',es:'Tests Recomendados',pt:'Testes Recomendados'}},
  ]},
  { group:{en:'Reference',es:'Referencia',pt:'Referência'}, items:[
    {id:'methodology', label:{en:'How it was built',es:'Cómo se construyó',pt:'Como foi construído'}},
  ]},
];
function tbdT(obj){ return obj[LANG] || obj.es || obj.en; }
function tbdRegionOf(territory){ return territory==='Brazil' ? 'Brazil' : 'Latam'; }
function tbdPaisOf(territory){ return territory==='Brazil' ? null : territory; }

/* ---------- textos trilingues de la interfaz (chrome/labels/headers) ----------
   Las oraciones narrativas de insights/takeaways/tests (compuestas dinamicamente
   con nombres de creativos y numeros) quedan en espanol por ahora -- traducir esa
   prosa generada palabra por palabra es una fase aparte; lo que este selector
   cubre es exactamente lo que "igualar funcionalidad" pide: toda la navegacion,
   etiquetas, encabezados de tabla y titulos de seccion. */
var TBD_STR = {
  period_label: {en:'Jan–Jul 2025 vs Jan–Jul 2026', es:'Ene–Jul 2025 vs Ene–Jul 2026', pt:'Jan–Jul 2025 vs Jan–Jul 2026'},
  kpi_l1k_adj: {en:'L/$1k adj. ★', es:'L/$1k adj. ★', pt:'L/$1k adj. ★'},
  kpi_cpl_adj: {en:'CPL adj.', es:'CPL adj.', pt:'CPL adj.'},
  kpi_cvr: {en:'CVR', es:'CVR', pt:'CVR'},
  kpi_mncc: {en:'% MNCC', es:'% MNCC', pt:'% MNCC'},
  kpi_creatives: {en:'Active creatives', es:'Creativos activos', pt:'Criativos ativos'},
  col_hash: {en:'#', es:'#', pt:'#'},
  col_creative: {en:'Creative', es:'Creativo', pt:'Criativo'},
  col_type: {en:'Type', es:'Tipo', pt:'Tipo'},
  col_leads: {en:'Leads', es:'Leads', pt:'Leads'},
  col_l1k: {en:'L/$1k', es:'L/$1k', pt:'L/$1k'},
  col_l1k_adj: {en:'L/$1k adj ★', es:'L/$1k adj ★', pt:'L/$1k adj ★'},
  col_cpl_adj: {en:'CPL adj', es:'CPL adj', pt:'CPL adj'},
  col_days: {en:'Days', es:'Días', pt:'Dias'},
  col_spend: {en:'Spend', es:'Gasto', pt:'Gasto'},
  col_cvr: {en:'CVR', es:'CVR', pt:'CVR'},
  col_creatives_n: {en:'Creatives', es:'Creativos', pt:'Criativos'},
  top10: {en:'Top 10', es:'Top 10', pt:'Top 10'},
  creatives_word: {en:'creatives', es:'creativos', pt:'criativos'},
  title_portfolio: {en:'Portfolio', es:'Portfolio', pt:'Portfólio'},
  title_promo: {en:'Top Promo Creatives', es:'Top Creativos Promo', pt:'Top Criativos Promo'},
  title_generic: {en:'Top Generic Creatives', es:'Top Creativos Genéricos', pt:'Top Criativos Genéricos'},
  title_pvg: {en:'Promo vs Generic', es:'Promo vs Genérico', pt:'Promo vs Genérico'},
  sub_pvg: {en:'Performance comparison between creatives with an explicit offer and creatives without one.', es:'Comparación de performance entre creativos con oferta explícita y creativos sin oferta.', pt:'Comparação de performance entre criativos com oferta explícita e criativos sem oferta.'},
  title_tone: {en:'Tone', es:'Tono', pt:'Tom'},
  sub_tone: {en:'Humor, Motivational, Corporative, Commemorative.', es:'Humor, Motivational, Corporative, Commemorative.', pt:'Humor, Motivational, Corporative, Commemorative.'},
  title_hooks: {en:'Hooks', es:'Hooks', pt:'Hooks'},
  title_hook_audio: {en:'Audio Hook Type', es:'Tipo de Hook de Audio', pt:'Tipo de Hook de Áudio'},
  sub_hook_audio: {en:'How the creative opens its audio.', es:'Cómo se abre el audio del creativo.', pt:'Como se abre o áudio do criativo.'},
  title_hook_visual: {en:'Visual Hook Type', es:'Tipo de Hook Visual', pt:'Tipo de Hook Visual'},
  sub_hook_visual: {en:'How the creative opens visually.', es:'Cómo se abre visualmente el creativo.', pt:'Como se abre visualmente o criativo.'},
  title_versions: {en:'Versions', es:'Versiones', pt:'Versões'},
  sub_versions: {en:'V1 vs later versions (V2/V3) of the same concept.', es:'V1 vs versiones posteriores (V2/V3) del mismo concepto.', pt:'V1 vs versões posteriores (V2/V3) do mesmo conceito.'},
  title_campaigns: {en:'Campaigns', es:'Campañas', pt:'Campanhas'},
  sub_campaigns: {en:'Performance grouped by campaign.', es:'Performance agrupado por campaña.', pt:'Performance agrupado por campanha.'},
  title_promo_type: {en:'Promo Type', es:'Tipo de Promo', pt:'Tipo de Promo'},
  sub_promo_type: {en:'Promo creatives only, grouped by offer.', es:'Solo creativos Promo, agrupados por oferta.', pt:'Apenas criativos Promo, agrupados por oferta.'},
  title_theme: {en:'Theme', es:'Tema', pt:'Tema'},
  sub_theme: {en:"Creative's thematic mechanism.", es:'Mecanismo temático del creativo.', pt:'Mecanismo temático do criativo.'},
  title_ai_vs_real: {en:'AI vs Real', es:'IA vs Real', pt:'IA vs Real'},
  sub_ai_vs_real: {en:'Generative-AI production vs. real filming/B-roll.', es:'Producción con IA generativa vs. filmación/B-roll real.', pt:'Produção com IA generativa vs. filmagem/B-roll real.'},
  title_jrhalo: {en:'JR Halo — Open English Junior leads generated by Open English’s own spend', es:'JR Halo — leads de Open English Junior generados por la inversión de Open English', pt:'JR Halo — leads de Open English Junior gerados pelo investimento da Open English'},
  sub_jrhalo: {en:'JR L/$1k adj. = real Open English Junior leads tagged marketing_organization=OE, prorated by the same creative rotation %, ÷ Open English spend, demand-adjusted. OE L/$1k adj. is the reference (the same creative’s own performance).', es:'JR L/$1k adj. = leads reales de Open English Junior atribuidos a marketing_organization=OE, prorrateados por el mismo % de rotación del creativo, ÷ el gasto de Open English, ajustado por demanda. OE L/$1k adj. es la referencia (performance propio del mismo creativo).', pt:'JR L/$1k adj. = leads reais de Open English Junior atribuídos a marketing_organization=OE, prorrateados pelo mesmo % de rotação do criativo, ÷ o gasto de Open English, ajustado por demanda. OE L/$1k adj. é a referência (performance própria do mesmo criativo).'},
  col_jr_leads: {en:'JR Leads', es:'Leads JR', pt:'Leads JR'},
  col_jr_l1k_adj: {en:'JR L/$1k adj ★', es:'JR L/$1k adj ★', pt:'JR L/$1k adj ★'},
  col_oe_ref: {en:'OE L/$1k adj (ref)', es:'OE L/$1k adj (ref)', pt:'OE L/$1k adj (ref)'},
  title_launch: {en:'Launch Week — first 7 calendar days from launch', es:'Semana de Lanzamiento — primeros 7 días calendario desde el lanzamiento', pt:'Semana de Lançamento — primeiros 7 dias corridos desde o lançamento'},
  col_tvon_days: {en:'TV-on days', es:'Días TV-on', pt:'Dias TV-on'},
  title_wearout: {en:'Wear-Out — first half (H1) vs second half (H2) of the flight, by day count', es:'Desgaste — primera mitad (H1) vs segunda mitad (H2) del flight, por conteo de días', pt:'Desgaste — primeira metade (H1) vs segunda metade (H2) do flight, por contagem de dias'},
  sub_wearout: {en:'A drop >20% in demand-adjusted L/$1k from H1 to H2 = real wear-out signal (already seasonality-adjusted).', es:'Caída >20% en L/$1k adj. de H1 a H2 = señal de desgaste real (ya ajustado por estacionalidad).', pt:'Queda >20% em L/$1k adj. de H1 para H2 = sinal real de desgaste (já ajustado por estacionalidade).'},
  col_h1: {en:'H1 adj', es:'H1 adj', pt:'H1 adj'},
  col_h2: {en:'H2 adj', es:'H2 adj', pt:'H2 adj'},
  col_delta: {en:'Δ%', es:'Δ%', pt:'Δ%'},
  title_seasonality: {en:'Seasonality Index (Ahrefs)', es:'Índice de Estacionalidad (Ahrefs)', pt:'Índice de Estacionalidade (Ahrefs)'},
  sub_seasonality: {en:'100 = average monthly search volume for "open english" + "cursos de ingles" since January 2023. A month with index 130 has 30% more natural demand than average, regardless of TV spend.', es:'100 = promedio del volumen de búsqueda mensual de "open english" + "cursos de ingles" desde enero 2023. Un mes con índice 130 tiene 30% más demanda natural que el promedio, independiente de cuánto se invierta en TV.', pt:'100 = média do volume de busca mensal de "open english" + "cursos de ingles" desde janeiro de 2023. Um mês com índice 130 tem 30% mais demanda natural que a média, independente de quanto se invista em TV.'},
  col_month: {en:'Month', es:'Mes', pt:'Mês'},
  title_insights: {en:'Insights', es:'Insights', pt:'Insights'},
  title_tests: {en:'Recommended Tests (2026)', es:'Tests Recomendados (2026)', pt:'Testes Recomendados (2026)'},
  tests_col_a: {en:'A · With existing creatives (no production)', es:'A · Con creativos existentes (sin producción)', pt:'A · Com criativos existentes (sem produção)'},
  tests_col_b: {en:'B · Requires new production', es:'B · Requiere producción nueva', pt:'B · Requer nova produção'},
  title_methodology: {en:'How TBD Dolo was built', es:'Cómo se construyó TBD Dolo', pt:'Como o TBD Dolo foi construído'},
  title_adjkpi: {en:'★ What are L/$1k adj. and CPL adj.?', es:'★ ¿Qué son L/$1k adj. y CPL adj.?', pt:'★ O que são L/$1k adj. e CPL adj.?'},
  no_data: {en:'Not enough days with real TV spend in both periods to compare.', es:'No hay suficientes días con inversión real de TV en ambos períodos para comparar.', pt:'Não há dias suficientes com investimento real de TV em ambos os períodos para comparar.'},
  y25_label: {en:'Jan–Jul 2025', es:'Ene–Jul 2025', pt:'Jan–Jul 2025'},
  y26_label: {en:'Jan–Jul 2026', es:'Ene–Jul 2026', pt:'Jan–Jul 2026'},
};
function tbdS(key){ return tbdT(TBD_STR[key] || {en:key,es:key,pt:key}); }

function tbdApplyBrandTheme(){
  document.getElementById('tbdShell').classList.toggle('brand-jr', TBD_STATE.org==='Open English Junior');
}
function tbdBoot(){
  TBD_TERRITORIES = ['Brazil'].concat((COUNTRIES||[]).filter(function(c){ return c!=='TV LATAM Excl Arg Mex'; }).sort());
  if(TBD_TERRITORIES.indexOf(TBD_STATE.territory)===-1) TBD_STATE.territory = TBD_TERRITORIES[0];
  var h = tbdParseHash();
  if(h.tab) TBD_STATE.tab = h.tab;
  if(h.territory && TBD_TERRITORIES.indexOf(h.territory)!==-1) TBD_STATE.territory = h.territory;
  if(h.org && TBD_ORGS.indexOf(h.org)!==-1) TBD_STATE.org = h.org;
  if(TBD_STATE.org==='Open English Junior' && TBD_NAV.filter(function(g){return g.oeOnly;}).some(function(g){return g.items.some(function(it){return it.id===TBD_STATE.tab;});})) TBD_STATE.tab = 'portfolio';
  if(!window.__TBD_HASHCHANGE_WIRED__){ window.__TBD_HASHCHANGE_WIRED__ = true; window.addEventListener('hashchange', tbdOnHashChange); }
  tbdApplyBrandTheme();
  tbdRenderShell();
  tbdRenderLangBtns();
  tbdRenderNav();
  tbdRenderTab();
  if(!window.__TBD_PPT_WIRED__){ window.__TBD_PPT_WIRED__ = true; document.getElementById('tbd-btn-ppt').addEventListener('click', tbdDownloadPPT); tbdWireCreativeClicks(); tbdWireModalCleanup(); tbdWireTour(); }
  if(!window.__TBD_APP_TOUR_DONE__){ window.__TBD_APP_TOUR_DONE__ = true; setTimeout(tbdMaybeAutoStartTour, 300); }
}
function tbdParseHash(){
  var m = /^#\/tbd\/([^/]+)(?:\/([^/]+))?(?:\/(.+))?$/.exec(location.hash);
  if(!m) return {};
  return { tab: m[1], territory: m[2] ? decodeURIComponent(m[2]) : null, org: m[3] ? decodeURIComponent(m[3]) : null };
}
function tbdSetHash(){
  location.hash = '#/tbd/'+TBD_STATE.tab+'/'+encodeURIComponent(TBD_STATE.territory)+'/'+encodeURIComponent(TBD_STATE.org);
}
function tbdOnHashChange(){
  if(!document.getElementById('tbdShell').classList.contains('ready')) return;
  var h = tbdParseHash();
  if(!h.tab) return;
  TBD_STATE.tab = h.tab;
  if(h.territory && TBD_TERRITORIES.indexOf(h.territory)!==-1) TBD_STATE.territory = h.territory;
  if(h.org && TBD_ORGS.indexOf(h.org)!==-1) TBD_STATE.org = h.org;
  tbdApplyBrandTheme();
  tbdRenderNav();
  tbdRenderFilters();
  tbdRenderTab();
}
function tbdRenderShell(){
  tbdRenderFilters();
}
function tbdRenderFilters(){
  var el = document.getElementById('tbd-filters');
  el.innerHTML = '<div class="tbd-seg" id="tbd-sel-org">'+TBD_ORGS.map(function(o){
    var short = o==='Open English Junior' ? 'Open English Junior' : 'Open English';
    return '<button data-o="'+escAttr(o)+'" class="'+(o===TBD_STATE.org?'active':'')+'">'+esc(short)+'</button>';
  }).join('')+'</div>'+
    '<div class="tbd-seg" id="tbd-sel-territory">'+TBD_TERRITORIES.map(function(t){
    return '<button data-t="'+escAttr(t)+'" class="'+(t===TBD_STATE.territory?'active':'')+'">'+esc(t)+'</button>';
  }).join('')+'</div><div style="font-size:11px;color:var(--ink-faint);margin-left:6px;">'+esc(tbdS('period_label'))+'</div>';
  Array.from(el.querySelectorAll('#tbd-sel-org button')).forEach(function(b){
    b.addEventListener('click', function(){
      TBD_STATE.org = b.dataset.o;
      if(TBD_STATE.org==='Open English Junior' && TBD_NAV.filter(function(g){return g.oeOnly;}).some(function(g){return g.items.some(function(it){return it.id===TBD_STATE.tab;});})) TBD_STATE.tab = 'portfolio';
      tbdSetHash();
    });
  });
  Array.from(el.querySelectorAll('#tbd-sel-territory button')).forEach(function(b){
    b.addEventListener('click', function(){ TBD_STATE.territory = b.dataset.t; tbdSetHash(); });
  });
}
function tbdRenderLangBtns(){
  var el = document.getElementById('tbd-lang-btns');
  if(!el) return;
  el.innerHTML = ['en','es','pt'].map(function(l){ return '<button class="iconbtn'+(LANG===l?' active':'')+'" data-lang="'+l+'">'+l.toUpperCase()+'</button>'; }).join('');
  Array.from(el.querySelectorAll('button')).forEach(function(b){
    b.addEventListener('click', function(){ LANG=b.dataset.lang; localStorage.setItem('tvads_lang',LANG); tbdRenderNav(); tbdRenderFilters(); tbdRenderTab(); });
  });
}
function tbdRenderNav(){
  var el = document.getElementById('tbd-nav');
  var groups = TBD_NAV.filter(function(g){ return !g.oeOnly || TBD_STATE.org!=='Open English Junior'; });
  el.innerHTML = groups.map(function(g){
    return '<div class="tbd-nav-group">'+esc(tbdT(g.group))+'</div>'+g.items.map(function(it){
      return '<a class="tbd-nav-link'+(it.id===TBD_STATE.tab?' active':'')+'" data-tab="'+it.id+'">'+esc(tbdT(it.label))+'</a>';
    }).join('');
  }).join('');
  Array.from(el.querySelectorAll('.tbd-nav-link')).forEach(function(a){
    a.addEventListener('click', function(){ TBD_STATE.tab = a.dataset.tab; tbdSetHash(); });
  });
}
function tbdCurrentData(){
  var territory = TBD_STATE.territory, region = tbdRegionOf(territory), pais = tbdPaisOf(territory);
  var d25 = tbdCreativesForPeriod(territory, region, '2025', pais, null);
  var d26 = tbdCreativesForPeriod(territory, region, '2026', pais, null);
  var v25 = tbdVideoRowsForPeriod(territory, region, '2025', pais, null);
  var v26 = tbdVideoRowsForPeriod(territory, region, '2026', pais, null);
  return { territory:territory, region:region, pais:pais, y25:d25, y26:d26, v25:v25, v26:v26, p25: tbdPortfolio(d25), p26: tbdPortfolio(d26) };
}
var TBD_LAST_DATA = null;
function tbdRenderTab(){
  document.getElementById('tbd-page').scrollTop = 0;
  var data = tbdCurrentData();
  TBD_LAST_DATA = data;
  var fn = TBD_RENDERERS[TBD_STATE.tab] || TBD_RENDERERS.portfolio;
  document.getElementById('tbd-page').innerHTML = fn(data);
  Array.from(document.querySelectorAll('[data-tbd-jump]')).forEach(function(a){
    a.addEventListener('click', function(){ TBD_STATE.tab = a.dataset.tbdJump; tbdSetHash(); });
  });
}
/* Delegacion de click para nombres de creativo (nunca cambian de referencia
   en el DOM porque #tbd-page se reemplaza entero en cada render -- por eso
   un solo listener delegado alcanza, sin importar cuantas veces se re-dibuje). */
function tbdWireCreativeClicks(){
  document.getElementById('tbd-page').addEventListener('click', function(e){
    var a = e.target.closest('[data-tbd-creative]');
    if(!a) return;
    tbdOpenCreativeModal(a.dataset.tbdCreative, a.dataset.tbdYear);
  });
}

/* ============================ helpers de formato/HTML ============================ */
function tbdArrow(v25, v26, higherBetter){
  if(v25==null || v26==null) return '';
  var delta = v26-v25, good = higherBetter ? delta>=0 : delta<=0;
  return ' <span style="font-size:10px;font-weight:800;color:'+(good?'var(--good)':'var(--bad)')+'">'+(delta>=0?'▲':'▼')+'</span>';
}
function tbdKpiCard(label, v25, v26, fmtFn, higherBetter){
  return '<div class="tbd-kpi-card"><div class="tbd-kpi-label">'+esc(label)+'</div>'+
    '<div class="tbd-kpi-value">'+fmtFn(v25)+' → '+fmtFn(v26)+tbdArrow(v25,v26,higherBetter)+'</div>'+
    '<div class="tbd-kpi-sub">2025 → 2026</div></div>';
}
function tbdCreativeNameLinkHTML(r, year){
  return '<a class="tbd-name-link" data-tbd-creative="'+escAttr(r.nombre)+'" data-tbd-year="'+year+'">'+esc(r.nombre)+(r.is_grouped?' <span class="tbd-badge">'+r.versions.length+'v</span>':'')+'</a>';
}
function tbdCreativeRowsHTML(items, year){
  return items.map(function(r, i){
    return '<tr><td>'+(i+1)+'</td><td>'+tbdCreativeNameLinkHTML(r, year)+
      '</td><td><span class="tbd-badge">'+esc(r.ad_type||'—')+'</span></td><td>'+fmtNum(r.l,0)+'</td><td class="tbd-adj">'+fmtNum(r.l1k,1)+'</td>'+
      '<td class="tbd-adj"><b>'+fmtNum(r.l1k_adj,1)+'</b></td><td class="tbd-adj">'+fmt$(r.cpl_adj,2)+'</td><td>'+r.n+'</td><td>'+fmt$(r.s,0)+'</td><td>'+fmtPct(r.cvr,1)+'</td></tr>';
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--ink-faint);padding:16px;">'+T('sin_datos_filtro')+'</td></tr>';
}
function tbdCreativeTableHTML(items, yearLabel, year){
  return '<div><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--ink-faint);margin-bottom:6px;">'+esc(yearLabel)+' · '+items.length+' '+esc(tbdS('creatives_word'))+'</div>'+
    '<div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>'+esc(tbdS('col_hash'))+'</th><th>'+esc(tbdS('col_creative'))+'</th><th>'+esc(tbdS('col_type'))+'</th><th>'+esc(tbdS('col_leads'))+'</th><th>'+esc(tbdS('col_l1k'))+'</th><th>'+esc(tbdS('col_l1k_adj'))+'</th><th>'+esc(tbdS('col_cpl_adj'))+'</th><th>'+esc(tbdS('col_days'))+'</th><th>'+esc(tbdS('col_spend'))+'</th><th>'+esc(tbdS('col_cvr'))+'</th></tr></thead>'+
    '<tbody>'+tbdCreativeRowsHTML(items, year)+'</tbody></table></div></div>';
}
function tbdDimTableHTML(rollup, title){
  var rows = rollup.map(function(r){
    return '<tr><td>'+esc(r.label)+'</td><td>'+r.n+'</td><td class="tbd-adj"><b>'+fmtNum(r.l1k_adj,1)+'</b></td><td class="tbd-adj">'+fmt$(r.cpl_adj,2)+'</td><td>'+fmtPct(r.cvr,1)+'</td><td>'+fmt$(r.s,0)+'</td></tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);padding:16px;">'+T('sin_datos_filtro')+'</td></tr>';
  return '<div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>'+esc(title)+'</th><th>'+esc(tbdS('col_creatives_n'))+'</th><th>'+esc(tbdS('col_l1k_adj'))+'</th><th>'+esc(tbdS('col_cpl_adj'))+'</th><th>'+esc(tbdS('col_cvr'))+'</th><th>'+esc(tbdS('col_spend'))+'</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
/* ============================ tarjetas "cómo se lee" + "insight experto" por pestana ============================
   Cada pestana del nav (19 en total) debe traer AMBAS tarjetas: una que explica
   como leer esa vista puntual (TBD_HOWTO, texto fijo trilingue) y una con
   interpretacion real hecha sobre los datos de esa vista (nunca solo repetir
   la tabla) -- ver tbdHowToCard()/tbdTakeawayBox() y las funciones tbd*Insight
   de mas abajo, una por pestana que no tenia ya una (promo/generic/jrhalo/
   launch/wearout/adjkpi/insights/tests/methodology). */
var TBD_HOWTO = {
  adjkpi: {en:'This page explains, in words, the single most important idea in the whole app: why raw numbers alone can lie about a creative\'s quality. Read it once before trusting any ranking elsewhere.', es:'Esta página explica, en palabras, la idea más importante de toda la app: por qué los números crudos solos pueden mentir sobre la calidad de un creativo. Léela una vez antes de confiar en cualquier ranking del resto del dashboard.', pt:'Esta página explica, em palavras, a ideia mais importante de todo o app: por que os números brutos sozinhos podem enganar sobre a qualidade de um criativo. Leia uma vez antes de confiar em qualquer ranking do resto do dashboard.'},
  portfolio: {en:'The 5 cards compare the WHOLE portfolio, 2025 vs 2026 (not one creative). The two tables below show the Top 10 creatives of each year by demand-adjusted L/$1k — use them to spot which names repeat at the top across years.', es:'Las 5 tarjetas comparan el portafolio COMPLETO, 2025 vs 2026 (no un creativo puntual). Las dos tablas de abajo muestran el Top 10 de creativos de cada año por L/$1k ajustado por demanda — úsalas para ver qué nombres se repiten arriba entre años.', pt:'Os 5 cartões comparam o portfólio INTEIRO, 2025 vs 2026 (não um criativo específico). As duas tabelas abaixo mostram o Top 10 de criativos de cada ano por L/$1k ajustado por demanda — use-as para ver quais nomes se repetem no topo entre os anos.'},
  promo: {en:'Ranked by demand-adjusted L/$1k (★), highest first — this is the fair ranking across months. Raw L/$1k next to it is only useful for planning actual volume in a specific flight window, not for comparing creative quality.', es:'Ordenado por L/$1k ajustado por demanda (★), de mayor a menor — ese es el ranking justo entre meses. El L/$1k crudo al lado solo sirve para planear volumen real en una ventana de flight específica, no para comparar calidad creativa.', pt:'Ordenado por L/$1k ajustado por demanda (★), do maior para o menor — esse é o ranking justo entre meses. O L/$1k bruto ao lado só serve para planejar volume real numa janela de flight específica, não para comparar qualidade criativa.'},
  generic: {en:'Same ranking logic as Promo, but only for creatives with no explicit offer — compare this list against Promo\'s to see whether an explicit offer is actually needed to perform well in this territory.', es:'Misma lógica de ranking que Promo, pero solo para creativos sin oferta explícita — compara esta lista contra la de Promo para ver si de verdad hace falta una oferta explícita para rendir bien en este territorio.', pt:'Mesma lógica de ranking que Promo, mas só para criativos sem oferta explícita — compare esta lista com a de Promo para ver se realmente é preciso uma oferta explícita para performar bem neste território.'},
  pvg: {en:'Two one-row rollups (all Promo creatives combined vs. all Generic combined), not individual creatives — this answers "does having an offer help on average", separate from which specific creative wins.', es:'Dos rollups de una fila (todos los Promo combinados vs. todos los Generic combinados), no creativos individuales — esto responde "¿ayuda tener oferta en promedio?", aparte de cuál creativo puntual gana.', pt:'Dois rollups de uma linha (todos os Promo combinados vs. todos os Generic combinados), não criativos individuais — isso responde "ter oferta ajuda em média?", à parte de qual criativo específico vence.'},
  tone: {en:'Creatives grouped by tone (Humor, Motivational, Corporative, Commemorative) and rolled up — a tone with few creatives (small n) can look artificially strong, always check n before trusting the top row.', es:'Creativos agrupados por tono (Humor, Motivational, Corporative, Commemorative) y sumados — un tono con pocos creativos (n chico) puede verse artificialmente fuerte, siempre revisa n antes de confiar en la fila de arriba.', pt:'Criativos agrupados por tom (Humor, Motivational, Corporative, Commemorative) e somados — um tom com poucos criativos (n pequeno) pode parecer artificialmente forte, sempre confira o n antes de confiar na linha do topo.'},
  hooks: {en:'Two separate rollups stacked: how the creative opens its AUDIO, then how it opens VISUALLY — a hook type can win on audio and lose on visual (or vice versa), read both before recommending one.', es:'Dos rollups separados, uno debajo del otro: cómo abre el AUDIO del creativo, y cómo abre VISUALMENTE — un tipo de hook puede ganar en audio y perder en visual (o al revés), lee ambos antes de recomendar uno.', pt:'Dois rollups separados, um embaixo do outro: como o ÁUDIO do criativo abre, e como ele abre VISUALMENTE — um tipo de hook pode vencer no áudio e perder no visual (ou o contrário), leia os dois antes de recomendar um.'},
  versions: {en:'Uses raw Video Names (V1/V2/V3), unlike every other tab which groups by Ad Name — this is the one place designed specifically to see whether a "V2" revision actually improved on its "V1".', es:'Usa los Video Names crudos (V1/V2/V3), a diferencia de cualquier otra pestaña que agrupa por Ad Name — este es el único lugar diseñado específicamente para ver si una revisión "V2" de verdad mejoró sobre su "V1".', pt:'Usa os Video Names brutos (V1/V2/V3), diferente de qualquer outra aba que agrupa por Ad Name — este é o único lugar desenhado especificamente para ver se uma revisão "V2" realmente melhorou sobre sua "V1".'},
  campaigns: {en:'Rolled up by campaign_name — useful to see if a campaign\'s strength comes from one hero creative or is consistent across everything tagged under it.', es:'Sumado por campaign_name — útil para ver si la fuerza de una campaña viene de un solo creativo estrella o es pareja entre todo lo etiquetado bajo ella.', pt:'Somado por campaign_name — útil para ver se a força de uma campanha vem de um único criativo âncora ou é consistente entre tudo o que está marcado sob ela.'},
  promo_type: {en:'Promo creatives only, split by the specific offer/pain point they lead with — this is the closest thing to "which discount or angle actually converts" in this dashboard.', es:'Solo creativos Promo, divididos por la oferta/pain point específico con el que abren — esto es lo más cercano a "qué descuento o ángulo realmente convierte" en este dashboard.', pt:'Apenas criativos Promo, divididos pela oferta/pain point específico com que abrem — isso é o mais próximo de "qual desconto ou ângulo realmente converte" neste dashboard.'},
  theme: {en:'Rolled up by the creative\'s thematic mechanism (the underlying story device, not just Promo/Generic) — use it to see which storytelling angle actually pulls its weight.', es:'Sumado por el mecanismo temático del creativo (el recurso narrativo de fondo, no solo Promo/Generic) — úsalo para ver qué ángulo narrativo realmente rinde.', pt:'Somado pelo mecanismo temático do criativo (o recurso narrativo de fundo, não só Promo/Generic) — use para ver qual ângulo narrativo realmente rende.'},
  ai_vs_real: {en:'Splits creatives by production method (generative-AI vs. real filming/B-roll) — a real read on whether cheaper AI production is winning, losing, or roughly tied with traditional production.', es:'Divide los creativos por método de producción (IA generativa vs. filmación/B-roll real) — una lectura real de si la producción con IA, más barata, está ganando, perdiendo, o más o menos empatada con la producción tradicional.', pt:'Divide os criativos por método de produção (IA generativa vs. filmagem/B-roll real) — uma leitura real de se a produção com IA, mais barata, está ganhando, perdendo, ou mais ou menos empatada com a produção tradicional.'},
  jrhalo: {en:'"JR Leads" are REAL Open English Junior leads (from Junior\'s own deck) tagged as generated by Open English\'s spend, prorated per creative-day. Compare "JR L/$1k adj" against "OE L/$1k adj (ref)" on the same row to see which creatives punch above their own weight once you count their cross-brand halo too.', es:'"Leads JR" son leads REALES de Open English Junior (de su propio deck) etiquetados como generados por la inversión de Open English, prorrateados por día de creativo. Compara "JR L/$1k adj" contra "OE L/$1k adj (ref)" en la misma fila para ver qué creativos rinden más de lo que parecen una vez que cuentas también su halo entre marcas.', pt:'"Leads JR" são leads REAIS de Open English Junior (do próprio deck da Junior) marcados como gerados pelo investimento da Open English, prorrateados por dia de criativo. Compare "JR L/$1k adj" com "OE L/$1k adj (ref)" na mesma linha para ver quais criativos rendem mais do que parecem quando você conta também o halo entre marcas.'},
  launch: {en:'"TV-on days" here is capped at the creative\'s first 7 calendar days on air, not its whole flight — this isolates first-impression performance from how it holds up later (see Wear-Out for that).', es:'"Días TV-on" aquí queda limitado a los primeros 7 días calendario del creativo al aire, no todo su flight — esto aísla el desempeño de primera impresión de cómo se sostiene después (ver Desgaste para eso).', pt:'"Dias TV-on" aqui fica limitado aos primeiros 7 dias corridos do criativo no ar, não o flight inteiro — isso isola a performance de primeira impressão de como ele se sustenta depois (ver Desgaste para isso).'},
  wearout: {en:'H1/H2 split each creative\'s own flight in half by day count (not calendar week), each half independently demand-adjusted — a real drop >20% from H1 to H2 (flagged "⚠ pull") means the creative itself is tiring out, not that a slow month made it look worse.', es:'H1/H2 divide el flight de cada creativo por la mitad por conteo de días (no semana calendario), cada mitad ajustada por demanda de forma independiente — una caída real >20% de H1 a H2 (marcada "⚠ pull") significa que el creativo en sí se está desgastando, no que un mes flojo lo hizo ver peor.', pt:'H1/H2 divide o flight de cada criativo ao meio por contagem de dias (não semana corrida), cada metade ajustada por demanda de forma independente — uma queda real >20% de H1 para H2 (marcada "⚠ pull") significa que o criativo em si está se desgastando, não que um mês fraco o fez parecer pior.'},
  seasonality: {en:'This is NOT TV performance — it is pure organic search interest, independent of any ad spend. It is the input used to compute every "adj." metric elsewhere in the app; read it to understand WHY a given month\'s raw numbers were inflated or deflated.', es:'Esto NO es performance de TV — es puro interés de búsqueda orgánica, independiente de cualquier inversión publicitaria. Es el insumo que se usa para calcular cada métrica "adj." del resto de la app; léelo para entender POR QUÉ los números crudos de un mes dado salieron inflados o desinflados.', pt:'Isto NÃO é performance de TV — é puro interesse de busca orgânica, independente de qualquer investimento publicitário. É o insumo usado para calcular cada métrica "adj." do resto do app; leia para entender POR QUE os números brutos de um determinado mês saíram inflados ou desinflados.'},
  insights: {en:'Every card below crosses at least two signals and only appears when the effect is large enough to act on — sorted strongest-first. This is the closest thing to an automated "what should I actually do differently" page in the whole app.', es:'Cada tarjeta de abajo cruza al menos dos señales y solo aparece cuando el efecto es lo bastante grande para actuar sobre él — ordenadas de más a menos fuerte. Es lo más cercano a una página automática de "qué debería hacer distinto de verdad" en toda la app.', pt:'Cada cartão abaixo cruza pelo menos dois sinais e só aparece quando o efeito é grande o suficiente para agir — ordenados do mais forte para o mais fraco. É o mais próximo de uma página automática de "o que eu deveria realmente fazer diferente" em todo o app.'},
  tests: {en:'Column A costs nothing to try (existing creatives/rotation changes only); Column B requires new production. Both lists are generated from this territory\'s own real numbers on every load — not a fixed checklist.', es:'La columna A no cuesta nada probar (solo creativos existentes/cambios de rotación); la columna B requiere producción nueva. Ambas listas se generan desde los números reales de este territorio en cada carga — no es un checklist fijo.', pt:'A coluna A não custa nada testar (só criativos existentes/mudanças de rotação); a coluna B requer nova produção. Ambas as listas são geradas a partir dos números reais deste território a cada carregamento — não é um checklist fixo.'},
  methodology: {en:'This is the audit trail, not an analysis — cite it whenever someone asks "where does this number come from". It never changes based on territory or period.', es:'Esto es el rastro de auditoría, no un análisis — cítalo cuando alguien pregunte "¿de dónde sale este número?". No cambia según territorio o período.', pt:'Isto é a trilha de auditoria, não uma análise — cite quando alguém perguntar "de onde vem esse número?". Não muda conforme território ou período.'},
};
function tbdHowToCard(tabId){
  var h = TBD_HOWTO[tabId];
  if(!h) return '';
  var label = LANG==='en'?'How to read this tab':LANG==='pt'?'Como ler esta aba':'Cómo leer esta pestaña';
  return '<div class="card tbd-howto"><div class="tbd-howto-label">📖 '+esc(label)+'</div><div class="tbd-howto-body">'+esc(tbdT(h))+'</div></div>';
}
function tbdTakeawayBox(innerHtml){
  if(!innerHtml) return '';
  var label = LANG==='en'?'Expert insight':LANG==='pt'?'Insight de especialista':'Insight experto';
  return '<div class="tbd-takeaway"><div class="tbd-insight-label">🧠 '+esc(label)+'</div>'+innerHtml+'</div>';
}
function tbdDimensionTakeaway(r25, r26, title){
  if(r26.length<2) return '';
  var best=r26[0], worst=r26[r26.length-1];
  if(worst.l1k_adj<=0) return '';
  var gap = (best.l1k_adj-worst.l1k_adj)/worst.l1k_adj*100;
  if(gap<12) return '';
  var prior = r25.filter(function(x){return x.label===best.label;})[0];
  var consistent = prior && r25.length && r25[0].label===best.label;
  return LANG==='en'
    ? '<b>Takeaway:</b> "'+best.label+'" outperforms "'+worst.label+'" by '+fmtNum(gap,0)+'% in 2026 (L/$1k adj. '+fmtNum(best.l1k_adj,1)+' vs '+fmtNum(worst.l1k_adj,1)+', '+best.n+' vs '+worst.n+' creatives). '+(consistent?'It also led in 2025 — this is a durable pattern worth briefing as a default, not a one-off result.':(prior?'In 2025 the leader was different ("'+r25[0].label+'") — treat this as an emerging signal, not yet a proven rule.':'There is no 2025 data to confirm this is consistent, treat with caution.'))
    : LANG==='pt'
    ? '<b>Takeaway:</b> "'+best.label+'" supera "'+worst.label+'" em '+fmtNum(gap,0)+'% em 2026 (L/$1k adj. '+fmtNum(best.l1k_adj,1)+' vs '+fmtNum(worst.l1k_adj,1)+', '+best.n+' vs '+worst.n+' criativos). '+(consistent?'Também liderou em 2025 — é um padrão durável que vale a pena usar como padrão de briefing, não um resultado isolado.':(prior?'Em 2025 o líder foi outro ("'+r25[0].label+'") — trate isso como um sinal emergente, ainda não uma regra comprovada.':'Não há dados de 2025 para confirmar consistência, trate com cautela.'))
    : '<b>Takeaway:</b> "'+best.label+'" rinde '+fmtNum(gap,0)+'% mejor que "'+worst.label+'" en 2026 (L/$1k adj. '+fmtNum(best.l1k_adj,1)+' vs '+fmtNum(worst.l1k_adj,1)+', '+best.n+' vs '+worst.n+' creativos). '+(consistent?'También lideró en 2025 — es un patrón durable, vale la pena briefearlo como default, no como resultado aislado.':(prior?'En 2025 el líder fue distinto ("'+r25[0].label+'") — trata esto como una señal emergente, todavía no una regla comprobada.':'No hay datos de 2025 para confirmar que sea consistente, trátalo con cautela.'));
}
function tbdDimensionPage(data, keyFn, title, subtitle, tabId, items25, items26){
  var r25 = tbdDimensionRollup(items25||data.y25, keyFn), r26 = tbdDimensionRollup(items26||data.y26, keyFn);
  return '<h2 class="tbd-section-title">'+esc(title)+'</h2><p style="font-size:12px;color:var(--ink-faint);margin-top:-8px;">'+esc(subtitle)+'</p>'+
    tbdHowToCard(tabId)+
    '<div class="tbd-two-col"><div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">'+esc(tbdS('y25_label'))+'</div>'+tbdDimTableHTML(r25,title)+'</div>'+
    '<div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">'+esc(tbdS('y26_label'))+'</div>'+tbdDimTableHTML(r26,title)+'</div></div>'+
    tbdTakeawayBox(tbdDimensionTakeaway(r25, r26, title));
}

/* ============================ render por pestana ============================ */
var TBD_RENDERERS = {
  adjkpi: function(data){ return tbdAdjKpiHTML(data)+tbdTakeawayBox(tbdAdjKpiInsight(data)); },
  portfolio: function(data){
    var p25=data.p25, p26=data.p26;
    return '<h2 class="tbd-section-title">'+esc(data.territory)+' · '+esc(tbdS('title_portfolio'))+' · '+esc(tbdS('period_label'))+'</h2>'+
      tbdHowToCard('portfolio')+
      '<div class="tbd-kpi-grid">'+
      tbdKpiCard(tbdS('kpi_l1k_adj'), p25.l1k_adj, p26.l1k_adj, function(v){return fmtNum(v,1);}, true)+
      tbdKpiCard(tbdS('kpi_cpl_adj'), p25.cpl_adj, p26.cpl_adj, function(v){return fmt$(v,2);}, false)+
      tbdKpiCard(tbdS('kpi_cvr'), p25.cvr, p26.cvr, function(v){return fmtPct(v,1);}, true)+
      tbdKpiCard(tbdS('kpi_mncc'), p25.mncc, p26.mncc, function(v){return fmtPct(v,1);}, true)+
      tbdKpiCard(tbdS('kpi_creatives'), p25.num_creatives, p26.num_creatives, function(v){return fmtNum(v,0);}, true)+
      '</div>'+
      tbdTakeawayBox(tbdPortfolioTakeaway(data))+
      '<div class="tbd-two-col"><div>'+tbdCreativeTableHTML(data.y25.slice(0,10), tbdS('top10')+' · 2025', '2025')+'</div><div>'+tbdCreativeTableHTML(data.y26.slice(0,10), tbdS('top10')+' · 2026', '2026')+'</div></div>';
  },
  promo: function(data){
    var f = function(items){ return items.filter(function(r){ return r.ad_type==='PROMO'; }); };
    return '<h2 class="tbd-section-title">'+esc(tbdS('title_promo'))+'</h2>'+
      tbdHowToCard('promo')+
      '<div class="tbd-two-col"><div>'+tbdCreativeTableHTML(f(data.y25), 'Promo · 2025', '2025')+'</div><div>'+tbdCreativeTableHTML(f(data.y26), 'Promo · 2026', '2026')+'</div></div>'+
      tbdTakeawayBox(tbdCreativeTypeInsight(f(data.y26), f(data.y25), 'PROMO'));
  },
  generic: function(data){
    var f = function(items){ return items.filter(function(r){ return r.ad_type==='GENERIC'; }); };
    return '<h2 class="tbd-section-title">'+esc(tbdS('title_generic'))+'</h2>'+
      tbdHowToCard('generic')+
      '<div class="tbd-two-col"><div>'+tbdCreativeTableHTML(f(data.y25), 'Generic · 2025', '2025')+'</div><div>'+tbdCreativeTableHTML(f(data.y26), 'Generic · 2026', '2026')+'</div></div>'+
      tbdTakeawayBox(tbdCreativeTypeInsight(f(data.y26), f(data.y25), 'GENERIC'));
  },
  pvg: function(data){ return tbdDimensionPage(data, function(r){ return r.ad_type==='PROMO'?'Promo Ads':'Generic Ads'; }, tbdS('title_pvg'), tbdS('sub_pvg'), 'pvg'); },
  tone: function(data){ return tbdDimensionPage(data, function(r){ return r.tone_category||'—'; }, tbdS('title_tone'), tbdS('sub_tone'), 'tone'); },
  hooks: function(data){
    return '<h2 class="tbd-section-title">'+esc(tbdS('title_hooks'))+'</h2>'+
      tbdHowToCard('hooks')+
      tbdDimensionPage(data, function(r){ return r.hook_audio_type_code||'—'; }, tbdS('title_hook_audio'), tbdS('sub_hook_audio'), null)+
      '<div style="height:18px;"></div>'+
      tbdDimensionPage(data, function(r){ return r.hook_visual_type_code||'—'; }, tbdS('title_hook_visual'), tbdS('sub_hook_visual'), null);
  },
  versions: function(data){ return tbdDimensionPage(data, function(r){ return r.version ? ('V'+r.version) : 'V1'; }, tbdS('title_versions'), tbdS('sub_versions'), 'versions', data.v25, data.v26); },
  campaigns: function(data){ return tbdDimensionPage(data, function(r){ return r.campaign_name||'—'; }, tbdS('title_campaigns'), tbdS('sub_campaigns'), 'campaigns'); },
  promo_type: function(data){ return tbdDimensionPage(data, function(r){ return r.ad_type==='PROMO' ? (r.pain_point||'—') : null; }, tbdS('title_promo_type'), tbdS('sub_promo_type'), 'promo_type'); },
  theme: function(data){ return tbdDimensionPage(data, function(r){ return r.theme||'—'; }, tbdS('title_theme'), tbdS('sub_theme'), 'theme'); },
  ai_vs_real: function(data){ return tbdDimensionPage(data, function(r){ return r.type_of_production||'—'; }, tbdS('title_ai_vs_real'), tbdS('sub_ai_vs_real'), 'ai_vs_real'); },
  jrhalo: function(data){
    var r25 = data.y25.slice().sort(function(a,b){return b.jr_l1k_adj-a.jr_l1k_adj;});
    var r26 = data.y26.slice().sort(function(a,b){return b.jr_l1k_adj-a.jr_l1k_adj;});
    var rows = function(items, year){ return items.map(function(r){
      return '<tr><td>'+tbdCreativeNameLinkHTML(r,year)+'</td><td>'+fmtNum(r.jr_l,0)+'</td><td class="tbd-adj"><b>'+fmtNum(r.jr_l1k_adj,1)+'</b></td><td>'+fmtNum(r.l1k_adj,1)+'</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint);padding:16px;">'+T('sin_datos_filtro')+'</td></tr>'; };
    return '<h2 class="tbd-section-title">'+esc(tbdS('title_jrhalo'))+'</h2>'+
      '<p style="font-size:12px;color:var(--ink-faint);margin-top:-8px;">'+esc(tbdS('sub_jrhalo'))+'</p>'+
      tbdHowToCard('jrhalo')+
      '<div class="tbd-two-col"><div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">'+esc(tbdS('y25_label'))+'</div><div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>'+esc(tbdS('col_creative'))+'</th><th>'+esc(tbdS('col_jr_leads'))+'</th><th>'+esc(tbdS('col_jr_l1k_adj'))+'</th><th>'+esc(tbdS('col_oe_ref'))+'</th></tr></thead><tbody>'+rows(r25,'2025')+'</tbody></table></div></div>'+
      '<div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">'+esc(tbdS('y26_label'))+'</div><div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>'+esc(tbdS('col_creative'))+'</th><th>'+esc(tbdS('col_jr_leads'))+'</th><th>'+esc(tbdS('col_jr_l1k_adj'))+'</th><th>'+esc(tbdS('col_oe_ref'))+'</th></tr></thead><tbody>'+rows(r26,'2026')+'</tbody></table></div></div></div>'+
      tbdTakeawayBox(tbdJrHaloInsight(data));
  },
  launch: function(data){
    var build = function(items){ return items.map(function(r){ var lw = tbdLaunchWeek(r); return {row:r, nombre:r.nombre, lw:lw}; }).filter(function(x){return x.lw;}).sort(function(a,b){return b.lw.l1k_adj-a.lw.l1k_adj;}); };
    var rows = function(list, year){ return list.map(function(x){
      return '<tr><td>'+tbdCreativeNameLinkHTML(x.row,year)+'</td><td>'+x.lw.n+'</td><td class="tbd-adj"><b>'+fmtNum(x.lw.l1k_adj,1)+'</b></td><td>'+fmt$(x.lw.cpl_adj,2)+'</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint);padding:16px;">'+T('sin_datos_filtro')+'</td></tr>'; };
    var head = '<tr><th>'+esc(tbdS('col_creative'))+'</th><th>'+esc(tbdS('col_tvon_days'))+'</th><th>'+esc(tbdS('col_l1k_adj'))+'</th><th>'+esc(tbdS('col_cpl_adj'))+'</th></tr>';
    return '<h2 class="tbd-section-title">'+esc(tbdS('title_launch'))+'</h2>'+
      tbdHowToCard('launch')+
      '<div class="tbd-two-col"><div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">'+esc(tbdS('y25_label'))+'</div><div style="overflow-x:auto;"><table class="tbd-table"><thead>'+head+'</thead><tbody>'+rows(build(data.y25),'2025')+'</tbody></table></div></div>'+
      '<div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">'+esc(tbdS('y26_label'))+'</div><div style="overflow-x:auto;"><table class="tbd-table"><thead>'+head+'</thead><tbody>'+rows(build(data.y26),'2026')+'</tbody></table></div></div></div>'+
      tbdTakeawayBox(tbdLaunchInsight(data));
  },
  wearout: function(data){
    var build = function(items){ return items.map(function(r){ var w = tbdWearout(r); return {row:r, nombre:r.nombre, w:w}; }).filter(function(x){return x.w.pct!=null;}).sort(function(a,b){return a.w.pct-b.w.pct;}); };
    var rows = function(list, year){ return list.map(function(x){
      var flag = x.w.pct<-20 ? ' <span style="color:var(--bad);font-weight:800;">⚠ pull</span>' : '';
      return '<tr><td>'+tbdCreativeNameLinkHTML(x.row,year)+'</td><td>'+fmtNum(x.w.h1.l1k_adj,1)+'</td><td>'+fmtNum(x.w.h2.l1k_adj,1)+'</td><td class="tbd-adj"><b>'+fmtPct(x.w.pct/100,1)+'</b>'+flag+'</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint);padding:16px;">'+T('sin_datos_filtro')+'</td></tr>'; };
    var head = '<tr><th>'+esc(tbdS('col_creative'))+'</th><th>'+esc(tbdS('col_h1'))+'</th><th>'+esc(tbdS('col_h2'))+'</th><th>'+esc(tbdS('col_delta'))+'</th></tr>';
    return '<h2 class="tbd-section-title">'+esc(tbdS('title_wearout'))+'</h2>'+
      '<p style="font-size:12px;color:var(--ink-faint);margin-top:-8px;">'+esc(tbdS('sub_wearout'))+'</p>'+
      tbdHowToCard('wearout')+
      '<div class="tbd-two-col"><div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">'+esc(tbdS('y25_label'))+'</div><div style="overflow-x:auto;"><table class="tbd-table"><thead>'+head+'</thead><tbody>'+rows(build(data.y25),'2025')+'</tbody></table></div></div>'+
      '<div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">'+esc(tbdS('y26_label'))+'</div><div style="overflow-x:auto;"><table class="tbd-table"><thead>'+head+'</thead><tbody>'+rows(build(data.y26),'2026')+'</tbody></table></div></div></div>'+
      tbdTakeawayBox(tbdWearoutInsight(data));
  },
  seasonality: function(data){
    var s = TBD_SEASONALITY[data.territory];
    if(!s) return '<p>'+esc(tbdS('no_data'))+'</p>';
    var months = ['01','02','03','04','05','06','07'].map(mesLabel);
    var rows25 = s.jan_jul_2025, rows26 = s.jan_jul_2026;
    var maxv = Math.max.apply(null, rows25.concat(rows26));
    function bar(v){ return '<div style="display:flex;align-items:center;gap:8px;"><div style="width:34px;font-size:11px;color:var(--ink-faint);">'+fmtNum(v,0)+'</div><div style="flex:1;background:var(--border-soft);border-radius:4px;height:14px;"><div style="height:100%;border-radius:4px;background:var(--tbd-accent);width:'+Math.max(2,v/maxv*100)+'%;"></div></div></div>'; }
    var body = months.map(function(m,i){ return '<tr><td>'+esc(m)+'</td><td>'+bar(rows25[i])+'</td><td>'+bar(rows26[i])+'</td></tr>'; }).join('');
    return '<h2 class="tbd-section-title">'+esc(tbdS('title_seasonality'))+' — '+esc(data.territory)+'</h2>'+
      '<p style="font-size:12px;color:var(--ink-faint);margin-top:-8px;">100 = promedio del volumen de búsqueda mensual de "open english" + "cursos de ingles" desde enero 2023. Un mes con índice 130 tiene 30% más demanda natural que el promedio, independiente de cuánto se invierta en TV.</p>'+
      tbdHowToCard('seasonality')+
      '<div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>Mes</th><th>2025</th><th>2026</th></tr></thead><tbody>'+body+'</tbody></table></div>'+
      tbdTakeawayBox(tbdSeasonalityTakeaway(data.territory, rows25, rows26));
  },
  insights: function(data){ return tbdInsightsHTML(data)+tbdTakeawayBox(tbdInsightsMetaInsight(data)); },
  tests: function(data){ return tbdTestsHTML(data)+tbdTakeawayBox(tbdTestsInsight(data)); },
  methodology: function(data){ return tbdMethodologyHTML(); },
};

/* ============================ takeaways / insights / tests (texto generado desde datos reales) ============================ */
function tbdPortfolioTakeaway(data){
  var p25=data.p25, p26=data.p26;
  if(p25.l1k_adj==null || p26.l1k_adj==null) return 'No hay suficientes días con inversión real de TV en ambos períodos para comparar.';
  var deltaQuality = (p26.l1k_adj - p25.l1k_adj) / p25.l1k_adj * 100;
  var deltaSpend = (p26.s - p25.s) / p25.s * 100;
  var deltaLeads = (p26.l - p25.l) / p25.l * 100;
  var qualityTxt = Math.abs(deltaQuality) < 8
    ? 'la calidad de los creativos es prácticamente la misma entre años (L/$1k ajustado por demanda casi idéntico)'
    : (deltaQuality > 0 ? 'la calidad de los creativos mejoró de forma real (L/$1k ajustado subió '+fmtNum(deltaQuality,1)+'%)' : 'la calidad de los creativos empeoró de forma real (L/$1k ajustado bajó '+fmtNum(Math.abs(deltaQuality),1)+'%)');
  return '<b>Takeaway:</b> '+qualityTxt+'. La diferencia de leads totales entre años ('+fmtNum(deltaLeads,1)+'%) se explica principalmente por el cambio de inversión ('+fmtNum(deltaSpend,1)+'% de gasto) y por estacionalidad de demanda, no solo por el desempeño de los creativos.';
}
function tbdSeasonalityTakeaway(territory, r25, r26){
  var avg25 = r25.reduce(function(a,b){return a+b;},0)/r25.length;
  var avg26 = r26.reduce(function(a,b){return a+b;},0)/r26.length;
  var delta = (avg26-avg25)/avg25*100;
  var dir = delta>3 ? 'subió' : (delta<-3 ? 'cayó' : 'se mantuvo estable');
  return '<b>Takeaway:</b> en '+esc(territory)+', la demanda natural de "open english"/"cursos de inglés" en Ene–Jul '+dir+' '+fmtNum(Math.abs(delta),1)+'% de 2025 a 2026 (promedio del índice: '+fmtNum(avg25,1)+' → '+fmtNum(avg26,1)+'). '+
    (Math.abs(delta)>10 ? 'Esto es un cambio grande — cualquier comparación de leads año contra año en este territorio debe mirar la métrica ajustada, no la cruda.' : 'El impacto de la estacionalidad en la comparación año contra año es moderado aquí.');
}
/* ---------- insights nuevos por pestana (promo/generic/jrhalo/launch/wearout/adjkpi/insights-meta/tests) ----------
   Mismo criterio que los detectores de mas abajo: cruzan al menos dos senales
   reales de la vista puntual y solo devuelven texto si el patron es lo
   bastante grande para actuar sobre el -- si no, null (la pestana no muestra
   tarjeta de insight ese dia, en vez de rellenar con obviedades). */
function tbdCreativeTypeInsight(items26, items25, adType){
  if(items26.length<4) return null;
  var sorted = items26.slice().sort(function(a,b){ return b.l1k_adj-a.l1k_adj; });
  var half = Math.max(1, Math.floor(sorted.length/2));
  var top = sorted.slice(0,half), bottom = sorted.slice(sorted.length-half);
  function mode(arr, keyFn){
    var counts = {}; arr.forEach(function(r){ var k=keyFn(r)||'—'; counts[k]=(counts[k]||0)+1; });
    var best=null; Object.keys(counts).forEach(function(k){ if(!best || counts[k]>counts[best]) best=k; });
    return best;
  }
  var avgTop = top.reduce(function(s,r){return s+r.l1k_adj;},0)/top.length;
  var avgBottom = bottom.reduce(function(s,r){return s+r.l1k_adj;},0)/bottom.length;
  if(avgBottom<=0) return null;
  var gap = (avgTop-avgBottom)/avgBottom*100;
  if(gap<20) return null;
  var topTone = mode(top, function(r){return r.tone_category;});
  var bottomTone = mode(bottom, function(r){return r.tone_category;});
  var toneDiffers = topTone && bottomTone && topTone!==bottomTone;
  var countDelta = items26.length - items25.length;
  var typeLabel = adType==='PROMO' ? 'Promo' : 'Generic';
  return LANG==='en'
    ? 'The top half of '+typeLabel+' creatives outperforms the bottom half by '+fmtNum(gap,0)+'% (L/$1k adj. '+fmtNum(avgTop,1)+' vs '+fmtNum(avgBottom,1)+', '+top.length+' vs '+bottom.length+' creatives). '+(toneDiffers?'The gap tracks tone: top performers skew "'+topTone+'", the bottom skew "'+bottomTone+'" — tone, not just execution, is separating winners from losers here.':'No single tone explains the gap — the spread looks more like execution quality than a formula difference.')+(countDelta!==0?(' 2026 is running '+Math.abs(countDelta)+' '+(countDelta>0?'more':'fewer')+' '+typeLabel+' creatives than the same window in 2025.'):'')
    : LANG==='pt'
    ? 'A metade superior dos criativos '+typeLabel+' supera a metade inferior em '+fmtNum(gap,0)+'% (L/$1k adj. '+fmtNum(avgTop,1)+' vs '+fmtNum(avgBottom,1)+', '+top.length+' vs '+bottom.length+' criativos). '+(toneDiffers?'A diferença acompanha o tom: os melhores puxam para "'+topTone+'", os piores para "'+bottomTone+'" — o tom, não só a execução, está separando vencedores de perdedores aqui.':'Nenhum tom único explica a diferença — parece mais qualidade de execução do que uma fórmula diferente.')+(countDelta!==0?(' 2026 está rodando '+Math.abs(countDelta)+' criativos '+typeLabel+' '+(countDelta>0?'a mais':'a menos')+' que a mesma janela em 2025.'):'')
    : 'La mitad superior de los creativos '+typeLabel+' rinde '+fmtNum(gap,0)+'% mejor que la mitad inferior (L/$1k adj. '+fmtNum(avgTop,1)+' vs '+fmtNum(avgBottom,1)+', '+top.length+' vs '+bottom.length+' creativos). '+(toneDiffers?'La brecha coincide con el tono: los mejores se inclinan a "'+topTone+'", los peores a "'+bottomTone+'" — el tono, no solo la ejecución, está separando ganadores de perdedores acá.':'Ningún tono en particular explica la brecha — se ve más a calidad de ejecución que a una fórmula distinta.')+(countDelta!==0?(' 2026 corre con '+Math.abs(countDelta)+' creativos '+typeLabel+' '+(countDelta>0?'más':'menos')+' que la misma ventana en 2025.'):'');
}
function tbdJrHaloInsight(data){
  var jh = tbdDetectJrHaloShare(data);
  if(jh) return jh.body;
  return LANG==='en' ? 'No material Junior halo detected this period (Junior leads attributed to Open English spend are below the threshold worth acting on).'
    : LANG==='pt' ? 'Nenhum halo Junior relevante detectado neste período (leads Junior atribuídos ao investimento da Open English estão abaixo do limite que vale a pena agir).'
    : 'No se detecta un halo de Junior relevante en este período (los leads de Junior atribuidos a la inversión de Open English están por debajo del umbral que vale la pena accionar).';
}
function tbdLaunchInsight(data){
  var items = data.y26.filter(function(r){ return r.n>=10; });
  var pairs = items.map(function(r){ var lw=tbdLaunchWeek(r); return lw && lw.l1k_adj>0 ? {full:r.l1k_adj, lw:lw.l1k_adj, nombre:r.nombre} : null; }).filter(Boolean);
  if(pairs.length<4) return null;
  var hot = pairs.filter(function(p){ return (p.lw-p.full)/p.full > 0.15; });
  var slow = pairs.filter(function(p){ return (p.full-p.lw)/p.full > 0.15; });
  if(hot.length===0 && slow.length===0) return null;
  var majority = hot.length>slow.length ? 'hot' : 'slow';
  return LANG==='en'
    ? (majority==='hot'
      ? fmtNum(hot.length,0)+' of '+pairs.length+' creatives with enough runway perform BETTER in their first 7 days than over their full flight — a "hot start, cool down" pattern. Judge a new launch by week 1, but don\'t assume it will hold at that level; budget for a natural cooldown.'
      : fmtNum(slow.length,0)+' of '+pairs.length+' creatives with enough runway perform WORSE in their first 7 days than over their full flight — a "slow burn" pattern. Don\'t kill a new creative just because week 1 looks weak; give it more runway before judging.')
    : LANG==='pt'
    ? (majority==='hot'
      ? fmtNum(hot.length,0)+' de '+pairs.length+' criativos com fôlego suficiente performam MELHOR nos primeiros 7 dias do que no flight inteiro — um padrão de "início quente, depois esfria". Julgue um novo lançamento pela semana 1, mas não assuma que vai se manter nesse nível; planeje um resfriamento natural.'
      : fmtNum(slow.length,0)+' de '+pairs.length+' criativos com fôlego suficiente performam PIOR nos primeiros 7 dias do que no flight inteiro — um padrão de "queima lenta". Não mate um criativo novo só porque a semana 1 parece fraca; dê mais fôlego antes de julgar.')
    : (majority==='hot'
      ? fmtNum(hot.length,0)+' de '+pairs.length+' creativos con suficiente recorrido rinden MEJOR en sus primeros 7 días que en todo su flight — un patrón de "arranque caliente, después se enfría". Juzga un lanzamiento nuevo por la semana 1, pero no asumas que se va a sostener en ese nivel; presupuesta un enfriamiento natural.'
      : fmtNum(slow.length,0)+' de '+pairs.length+' creativos con suficiente recorrido rinden PEOR en sus primeros 7 días que en todo su flight — un patrón de "quema lenta". No mates un creativo nuevo solo porque la semana 1 se ve floja; dale más recorrido antes de juzgarlo.');
}
function tbdWearoutInsight(data){
  var list = data.y26.map(function(r){ return {row:r, w:tbdWearout(r)}; }).filter(function(x){ return x.w.pct!=null; });
  if(list.length<3) return null;
  var avg = list.reduce(function(s,x){return s+x.w.pct;},0)/list.length;
  var flagged = list.filter(function(x){ return x.w.pct<-20; });
  return LANG==='en'
    ? 'Across '+list.length+' creatives with enough days to measure, demand-adjusted L/$1k moves '+fmtNum(avg,1)+'% on average from H1 to H2 of the flight, and '+flagged.length+' ('+fmtNum(flagged.length/list.length*100,0)+'%) show a real wear-out drop (>20%). '+(flagged.length ? 'Prioritize refreshing: '+flagged.slice(0,3).map(function(x){return '"'+x.row.nombre+'"';}).join(', ')+'.' : 'No creative shows a real wear-out signal this period — current flights can keep running as-is.')
    : LANG==='pt'
    ? 'Entre '+list.length+' criativos com dias suficientes para medir, o L/$1k ajustado por demanda muda '+fmtNum(avg,1)+'% em média de H1 para H2 do flight, e '+flagged.length+' ('+fmtNum(flagged.length/list.length*100,0)+'%) mostram uma queda real de desgaste (>20%). '+(flagged.length ? 'Priorize renovar: '+flagged.slice(0,3).map(function(x){return '"'+x.row.nombre+'"';}).join(', ')+'.' : 'Nenhum criativo mostra um sinal real de desgaste neste período — os flights atuais podem continuar rodando como estão.')
    : 'Entre '+list.length+' creativos con suficientes días para medir, el L/$1k ajustado por demanda se mueve '+fmtNum(avg,1)+'% en promedio de H1 a H2 del flight, y '+flagged.length+' ('+fmtNum(flagged.length/list.length*100,0)+'%) muestran una caída real de desgaste (>20%). '+(flagged.length ? 'Prioriza renovar: '+flagged.slice(0,3).map(function(x){return '"'+x.row.nombre+'"';}).join(', ')+'.' : 'Ningún creativo muestra una señal real de desgaste este período — los flights actuales pueden seguir corriendo tal cual.');
}
function tbdAdjKpiInsight(data){
  var s = TBD_SEASONALITY[data.territory];
  if(!s) return null;
  var arr = s.jan_jul_2026;
  var max = Math.max.apply(null, arr), min = Math.min.apply(null, arr);
  if(min<=0) return null;
  var swing = (max-min)/min*100;
  if(swing<10) return null;
  var months = ['01','02','03','04','05','06','07'].map(mesLabel);
  var maxM = months[arr.indexOf(max)], minM = months[arr.indexOf(min)];
  return LANG==='en'
    ? 'In '+esc(data.territory)+', the 2026 demand index swings '+fmtNum(swing,0)+'% between its lowest ('+minM+', index '+fmtNum(min,0)+') and highest ('+maxM+', index '+fmtNum(max,0)+') month. That is how much raw L/$1k can be distorted by timing alone here — a real reason to always check the "adj." column before comparing two creatives that aired in different months.'
    : LANG==='pt'
    ? 'Em '+esc(data.territory)+', o índice de demanda de 2026 varia '+fmtNum(swing,0)+'% entre seu mês mais baixo ('+minM+', índice '+fmtNum(min,0)+') e mais alto ('+maxM+', índice '+fmtNum(max,0)+'). É o quanto o L/$1k bruto pode ser distorcido só pelo timing aqui — uma razão real para sempre checar a coluna "adj." antes de comparar dois criativos que foram ao ar em meses diferentes.'
    : 'En '+esc(data.territory)+', el índice de demanda de 2026 varía '+fmtNum(swing,0)+'% entre su mes más bajo ('+minM+', índice '+fmtNum(min,0)+') y más alto ('+maxM+', índice '+fmtNum(max,0)+'). Eso es cuánto se puede distorsionar el L/$1k crudo solo por timing acá — una razón real para siempre revisar la columna "adj." antes de comparar dos creativos que salieron al aire en meses distintos.';
}
function tbdInsightsMetaInsight(data){
  var found = tbdDeepInsights(data);
  if(!found.length) return null;
  var top = found[0];
  return LANG==='en'
    ? 'This load surfaced '+found.length+' cross-signal finding'+(found.length===1?'':'s')+' for '+esc(data.territory)+'. The strongest one: "'+top.title+'".'
    : LANG==='pt'
    ? 'Esta carga encontrou '+found.length+' achado'+(found.length===1?'':'s')+' de sinais cruzados para '+esc(data.territory)+'. O mais forte: "'+top.title+'".'
    : 'Esta carga encontró '+found.length+' hallazgo'+(found.length===1?'':'s')+' de señales cruzadas para '+esc(data.territory)+'. El más fuerte: "'+top.title+'".';
}
function tbdTestsInsight(data){
  var wo26 = data.y26.map(function(r){return {nombre:r.nombre, w:tbdWearout(r)};}).filter(function(x){return x.w.pct!=null;}).sort(function(a,b){return a.w.pct-b.w.pct;});
  if(!wo26.length || wo26[0].w.pct>=-20) return null;
  return LANG==='en'
    ? 'Test A2 has the most urgent backing: "'+wo26[0].nombre+'" already dropped '+fmtNum(Math.abs(wo26[0].w.pct),0)+'% from H1 to H2 (demand-adjusted) — this is measured decay, not a hypothesis, so it should be the first thing acted on from this list.'
    : LANG==='pt'
    ? 'O Teste A2 tem o respaldo mais urgente: "'+wo26[0].nombre+'" já caiu '+fmtNum(Math.abs(wo26[0].w.pct),0)+'% de H1 para H2 (ajustado por demanda) — isso é decaimento medido, não uma hipótese, então deveria ser a primeira coisa da lista a ser executada.'
    : 'El Test A2 tiene el respaldo más urgente: "'+wo26[0].nombre+'" ya cayó '+fmtNum(Math.abs(wo26[0].w.pct),0)+'% de H1 a H2 (ajustado por demanda) — eso es desgaste medido, no una hipótesis, así que debería ser lo primero de esta lista en accionarse.';
}
/* ============================ motor de insights por correlacion ============================
   Cada detector cruza AL MENOS dos senales (nunca "el mejor de X" solo) y solo
   emite un hallazgo si el efecto supera un umbral minimo -- si no hay patron
   real, el detector no aporta nada (no se rellena con relleno). `strength`
   ordena que tan grande/accionable es el hallazgo, para mostrar primero lo
   mas fuerte. Disenado para correr igual, automaticamente, en CUALQUIER
   territorio -- no hay nada hardcodeado por pais. */
function tbdMonthlySpendByMonth(items){
  var out = {}; // 'YYYY-MM' -> spend
  items.forEach(function(r){ r._dailyItems.forEach(function(d){ var m=d.date.slice(0,7); out[m]=(out[m]||0)+d.s; }); });
  return out;
}
function tbdDetectSpendVsDemandTiming(data, year){
  var items = year==='2025' ? data.y25 : data.y26;
  var s = TBD_SEASONALITY[data.territory];
  if(!s || !items.length) return null;
  var spendByMonth = tbdMonthlySpendByMonth(items);
  var idxArr = year==='2025' ? s.jan_jul_2025 : s.jan_jul_2026;
  var months = ['01','02','03','04','05','06','07'].map(function(m){ return year+'-'+m; });
  var totalSpend = 0; months.forEach(function(m){ totalSpend += spendByMonth[m]||0; });
  if(totalSpend<=0) return null;
  // correlacion simple: peso de gasto de cada mes vs su indice de demanda (ambos normalizados a %)
  var weightedDemand = 0;
  months.forEach(function(m,i){ weightedDemand += ((spendByMonth[m]||0)/totalSpend) * idxArr[i]; });
  var flatDemand = idxArr.reduce(function(a,b){return a+b;},0)/idxArr.length;
  var gap = (weightedDemand-flatDemand)/flatDemand*100;
  if(Math.abs(gap)<6) return null;
  var bestIdx = idxArr.indexOf(Math.max.apply(null, idxArr));
  var worstIdx = idxArr.indexOf(Math.min.apply(null, idxArr));
  var monthNames = ['01','02','03','04','05','06','07'].map(mesLabel);
  return {
    strength: Math.abs(gap),
    icon: gap<0 ? '⚠' : '✓',
    title: (LANG==='en'?'Spend timing vs. natural demand — ':LANG==='pt'?'Timing de gasto vs. demanda natural — ':'Timing de gasto vs. demanda natural — ')+year,
    body: gap<0
      ? (LANG==='en'?'Spend is concentrated in months with BELOW-average natural demand (weighted demand index '+fmtNum(weightedDemand,0)+' vs. period average '+fmtNum(flatDemand,0)+'). The portfolio is fighting the tide: shifting budget toward '+monthNames[bestIdx]+' (the highest-demand month) instead of '+monthNames[worstIdx]+' would likely raise raw leads without spending more.'
        :LANG==='pt'?'O gasto está concentrado em meses com demanda natural ABAIXO da média (índice de demanda ponderado '+fmtNum(weightedDemand,0)+' vs. média do período '+fmtNum(flatDemand,0)+'). O portfólio está remando contra a maré: mover orçamento para '+monthNames[bestIdx]+' (o mês de maior demanda) em vez de '+monthNames[worstIdx]+' provavelmente aumentaria os leads brutos sem gastar mais.'
        :'El gasto está concentrado en meses con demanda natural POR DEBAJO del promedio (índice de demanda ponderado '+fmtNum(weightedDemand,0)+' vs. promedio del período '+fmtNum(flatDemand,0)+'). El portafolio está remando contra la corriente: mover presupuesto hacia '+monthNames[bestIdx]+' (el mes de mayor demanda) en vez de '+monthNames[worstIdx]+' probablemente subiría los leads crudos sin gastar más.')
      : (LANG==='en'?'Spend is well-timed: concentrated in months with ABOVE-average natural demand (weighted demand index '+fmtNum(weightedDemand,0)+' vs. period average '+fmtNum(flatDemand,0)+'). This is a real tailwind, not just creative quality — keep timing spend around '+monthNames[bestIdx]+'.'
        :LANG==='pt'?'O gasto está bem cronometrado: concentrado em meses com demanda natural ACIMA da média (índice de demanda ponderado '+fmtNum(weightedDemand,0)+' vs. média do período '+fmtNum(flatDemand,0)+'). Isso é um vento a favor real, não apenas qualidade criativa — mantenha o timing do gasto perto de '+monthNames[bestIdx]+'.'
        :'El gasto está bien cronometrado: concentrado en meses con demanda natural POR ENCIMA del promedio (índice de demanda ponderado '+fmtNum(weightedDemand,0)+' vs. promedio del período '+fmtNum(flatDemand,0)+'). Esto es un viento a favor real, no solo calidad creativa — mantén el timing de gasto cerca de '+monthNames[bestIdx]+'.'),
  };
}
function tbdDetectToneByAdType(data){
  var promo = tbdDimensionRollup(data.y26.filter(function(r){return r.ad_type==='PROMO';}), function(r){return r.tone_category||null;});
  var generic = tbdDimensionRollup(data.y26.filter(function(r){return r.ad_type==='GENERIC';}), function(r){return r.tone_category||null;});
  if(promo.length<2 || generic.length<2) return null;
  var bestPromo = promo[0], bestGeneric = generic[0];
  if(bestPromo.label===bestGeneric.label) return null; // no hay divergencia -> no es un hallazgo
  var promoOfThatToneInGeneric = generic.filter(function(x){return x.label===bestPromo.label;})[0];
  var genericOfThatToneInPromo = promo.filter(function(x){return x.label===bestGeneric.label;})[0];
  if(!promoOfThatToneInGeneric || !genericOfThatToneInPromo) return null;
  var gapPromoTone = (bestPromo.l1k_adj-promoOfThatToneInGeneric.l1k_adj)/promoOfThatToneInGeneric.l1k_adj*100;
  if(Math.abs(gapPromoTone)<15) return null;
  return {
    strength: Math.abs(gapPromoTone),
    icon:'→',
    title: LANG==='en'?'The winning tone is not the same for Promo and Generic':LANG==='pt'?'O tom vencedor não é o mesmo para Promo e Genérico':'El tono ganador no es el mismo para Promo y Genérico',
    body: (LANG==='en'?'"'+bestPromo.label+'" is the strongest tone in Promo creatives (L/$1k adj. '+fmtNum(bestPromo.l1k_adj,1)+') but only '+fmtNum(promoOfThatToneInGeneric.l1k_adj,1)+' in Generic — a '+fmtNum(Math.abs(gapPromoTone),0)+'% gap. Meanwhile "'+bestGeneric.label+'" leads Generic. This means tone selection should be briefed differently per ad type, not applied as one blanket creative direction.'
      :LANG==='pt'?'"'+bestPromo.label+'" é o tom mais forte em criativos Promo (L/$1k adj. '+fmtNum(bestPromo.l1k_adj,1)+') mas só '+fmtNum(promoOfThatToneInGeneric.l1k_adj,1)+' em Genérico — uma diferença de '+fmtNum(Math.abs(gapPromoTone),0)+'%. Enquanto isso "'+bestGeneric.label+'" lidera em Genérico. Isso significa que a escolha de tom deve ser briefada de forma diferente por tipo de anúncio, não como uma única direção criativa.'
      :'"'+bestPromo.label+'" es el tono más fuerte en creativos Promo (L/$1k adj. '+fmtNum(bestPromo.l1k_adj,1)+') pero solo '+fmtNum(promoOfThatToneInGeneric.l1k_adj,1)+' en Genérico — una brecha de '+fmtNum(Math.abs(gapPromoTone),0)+'%. Mientras tanto "'+bestGeneric.label+'" lidera en Genérico. Esto significa que la elección de tono debería briefearse distinto por tipo de anuncio, no como una sola dirección creativa pareja.'),
  };
}
function tbdDetectHookWearout(data){
  var byHook = {};
  data.y26.forEach(function(r){
    var w = tbdWearout(r);
    if(w.pct==null) return;
    var k = r.hook_audio_type_code||'—';
    (byHook[k]=byHook[k]||[]).push(w.pct);
  });
  var rows = Object.keys(byHook).filter(function(k){ return byHook[k].length>=2; }).map(function(k){
    var arr = byHook[k]; return {label:k, avg: arr.reduce(function(a,b){return a+b;},0)/arr.length, n:arr.length};
  });
  if(rows.length<2) return null;
  rows.sort(function(a,b){ return a.avg-b.avg; });
  var worst = rows[0], best = rows[rows.length-1];
  if(worst.avg>=-10 || (best.avg-worst.avg)<15) return null;
  return {
    strength: Math.abs(worst.avg),
    icon:'⚠',
    title: LANG==='en'?'One hook type wears out structurally faster':LANG==='pt'?'Um tipo de hook desgasta estruturalmente mais rápido':'Un tipo de hook se desgasta estructuralmente más rápido',
    body: (LANG==='en'?'Creatives using "'+worst.label+'" as audio hook lose '+fmtNum(Math.abs(worst.avg),0)+'% of their demand-adjusted L/$1k on average from H1 to H2 of their flight ('+worst.n+' creatives) — vs. "'+best.label+'" which holds up ('+fmtNum(best.avg,0)+'%). This looks like fatigue built into the hook mechanic itself, not into any single creative — worth avoiding for long flights.'
      :LANG==='pt'?'Criativos que usam "'+worst.label+'" como hook de áudio perdem '+fmtNum(Math.abs(worst.avg),0)+'% do L/$1k ajustado em média de H1 para H2 do flight ('+worst.n+' criativos) — vs. "'+best.label+'" que se sustenta ('+fmtNum(best.avg,0)+'%). Isso parece ser fadiga embutida no próprio mecanismo do hook, não em um criativo específico — vale evitar em flights longos.'
      :'Los creativos que usan "'+worst.label+'" como hook de audio pierden '+fmtNum(Math.abs(worst.avg),0)+'% de su L/$1k ajustado en promedio de H1 a H2 de su flight ('+worst.n+' creativos) — vs. "'+best.label+'" que se sostiene ('+fmtNum(best.avg,0)+'%). Esto parece ser desgaste propio del mecanismo del hook, no de un creativo puntual — vale la pena evitarlo en flights largos.'),
  };
}
function tbdDetectNewVsRecurring(data){
  var names25 = {}; data.y25.forEach(function(r){ names25[r.nombre]=r; });
  var recurring = [], fresh = [];
  data.y26.forEach(function(r){ (names25[r.nombre] ? recurring : fresh).push(r); });
  if(recurring.length<2 || fresh.length<2) return null;
  var avg = function(arr){ return arr.reduce(function(s,r){return s+r.l1k_adj;},0)/arr.length; };
  var avgRec = avg(recurring), avgFresh = avg(fresh);
  var gap = (avgFresh-avgRec)/avgRec*100;
  if(Math.abs(gap)<12) return null;
  return {
    strength: Math.abs(gap),
    icon: gap>0?'✓':'✗',
    title: LANG==='en'?'New 2026 creatives vs. carried-over ones':LANG==='pt'?'Novos criativos de 2026 vs. os que continuaram':'Creativos nuevos de 2026 vs. los que se mantuvieron',
    body: gap>0
      ? (LANG==='en'?'The '+fresh.length+' creatives launched fresh in 2026 average L/$1k adj. of '+fmtNum(avgFresh,1)+', '+fmtNum(gap,0)+'% ABOVE the '+recurring.length+' carried over from 2025 ('+fmtNum(avgRec,1)+'). New creative development is paying off — worth protecting/growing that budget line.'
        :LANG==='pt'?'Os '+fresh.length+' criativos lançados em 2026 têm média de L/$1k adj. de '+fmtNum(avgFresh,1)+', '+fmtNum(gap,0)+'% ACIMA dos '+recurring.length+' que continuaram de 2025 ('+fmtNum(avgRec,1)+'). O desenvolvimento de novos criativos está valendo a pena — vale proteger/crescer essa linha de orçamento.'
        :'Los '+fresh.length+' creativos lanzados nuevos en 2026 promedian L/$1k adj. de '+fmtNum(avgFresh,1)+', '+fmtNum(gap,0)+'% POR ENCIMA de los '+recurring.length+' que se mantuvieron desde 2025 ('+fmtNum(avgRec,1)+'). La producción de creativos nuevos está rindiendo — vale la pena proteger/crecer esa línea de presupuesto.')
      : (LANG==='en'?'The '+recurring.length+' creatives carried over from 2025 still outperform the '+fresh.length+' new ones launched in 2026 by '+fmtNum(Math.abs(gap),0)+'% (L/$1k adj. '+fmtNum(avgRec,1)+' vs. '+fmtNum(avgFresh,1)+'). New production has not yet beaten the proven library — treat 2026 launches as tests, not replacements, until they catch up.'
        :LANG==='pt'?'Os '+recurring.length+' criativos que continuaram de 2025 ainda superam os '+fresh.length+' novos lançados em 2026 em '+fmtNum(Math.abs(gap),0)+'% (L/$1k adj. '+fmtNum(avgRec,1)+' vs. '+fmtNum(avgFresh,1)+'). A nova produção ainda não superou a biblioteca comprovada — trate os lançamentos de 2026 como testes, não substituições, até que alcancem.'
        :'Los '+recurring.length+' creativos que se mantuvieron desde 2025 todavía rinden '+fmtNum(Math.abs(gap),0)+'% mejor que los '+fresh.length+' nuevos lanzados en 2026 (L/$1k adj. '+fmtNum(avgRec,1)+' vs. '+fmtNum(avgFresh,1)+'). La producción nueva todavía no supera a la librería probada — trata los lanzamientos de 2026 como pruebas, no reemplazos, hasta que la alcancen.'),
  };
}
function tbdDetectRankReversal(data){
  var items = data.y26.filter(function(r){ return r.n>=3; });
  if(items.length<4) return null;
  var byRaw = items.slice().sort(function(a,b){ return b.l1k-a.l1k; });
  var byAdj = items.slice().sort(function(a,b){ return b.l1k_adj-a.l1k_adj; });
  var rawRank = {}, adjRank = {};
  byRaw.forEach(function(r,i){ rawRank[r.nombre]=i; });
  byAdj.forEach(function(r,i){ adjRank[r.nombre]=i; });
  var maxShift = null;
  items.forEach(function(r){
    var shift = rawRank[r.nombre]-adjRank[r.nombre]; // positivo = sube al ajustar por demanda
    if(!maxShift || Math.abs(shift)>Math.abs(maxShift.shift)) maxShift = {r:r, shift:shift};
  });
  if(!maxShift || Math.abs(maxShift.shift)<3) return null;
  var r = maxShift.r, up = maxShift.shift>0;
  return {
    strength: Math.abs(maxShift.shift)*4,
    icon: up?'★':'⚠',
    title: LANG==='en'?'Seasonality is hiding a creative’s true rank':LANG==='pt'?'A estacionalidade está escondendo o ranking real de um criativo':'La estacionalidad está escondiendo el ranking real de un creativo',
    body: (up
      ? (LANG==='en'?'"'+r.nombre+'" looks mid-pack on raw L/$1k (rank #'+(rawRank[r.nombre]+1)+') but jumps to #'+(adjRank[r.nombre]+1)+' once demand-adjusted — it aired during a low-demand stretch and is actually one of the strongest creatives once that’s corrected for. It is being undervalued by anyone reading raw numbers only.'
        :LANG==='pt'?'"'+r.nombre+'" parece mediano no L/$1k bruto (posição #'+(rawRank[r.nombre]+1)+') mas sobe para #'+(adjRank[r.nombre]+1)+' uma vez ajustado por demanda — foi ao ar num período de baixa demanda e na verdade é um dos criativos mais fortes já corrigido isso. Está sendo subestimado por quem olha só o número bruto.'
        :'"'+r.nombre+'" se ve mediano en L/$1k crudo (puesto #'+(rawRank[r.nombre]+1)+') pero sube a #'+(adjRank[r.nombre]+1)+' una vez ajustado por demanda — salió al aire en un tramo de baja demanda y en realidad es uno de los creativos más fuertes una vez corregido eso. Se está subestimando si solo se mira el número crudo.')
      : (LANG==='en'?'"'+r.nombre+'" looks strong on raw L/$1k (rank #'+(rawRank[r.nombre]+1)+') but drops to #'+(adjRank[r.nombre]+1)+' once demand-adjusted — most of its apparent performance is a high-demand tailwind, not creative quality. Do not use it as the creative brief template.'
        :LANG==='pt'?'"'+r.nombre+'" parece forte no L/$1k bruto (posição #'+(rawRank[r.nombre]+1)+') mas cai para #'+(adjRank[r.nombre]+1)+' uma vez ajustado por demanda — a maior parte da sua performance aparente é um vento a favor de alta demanda, não qualidade criativa. Não o use como modelo de briefing criativo.'
        :'"'+r.nombre+'" se ve fuerte en L/$1k crudo (puesto #'+(rawRank[r.nombre]+1)+') pero cae a #'+(adjRank[r.nombre]+1)+' una vez ajustado por demanda — la mayor parte de su performance aparente es viento a favor de alta demanda, no calidad creativa. No lo uses como plantilla de brief creativo.')),
  };
}
function tbdDetectJrHaloShare(data){
  var totalOe = data.p26.l, totalJr = data.y26.reduce(function(s,r){return s+r.jr_l;},0);
  if(totalOe<=0 || totalJr<=0) return null;
  var pct = totalJr/totalOe*100;
  if(pct<3) return null;
  return {
    strength: pct*2,
    icon:'♦',
    title: LANG==='en'?'Open English’s TV spend is quietly buying Junior leads too':LANG==='pt'?'O investimento em TV da Open English também está gerando leads Junior':'La inversión en TV de Open English también está generando leads de Junior',
    body: (LANG==='en'?'In 2026, Open English adult TV spend generated the equivalent of '+fmtNum(pct,1)+'% additional real Open English Junior leads ('+fmtNum(totalJr,0)+' leads) on top of its own '+fmtNum(totalOe,0)+' — at $0 incremental cost. This is real budget efficiency that would be missed by looking at OE performance alone; it should factor into any cross-brand budget conversation.'
      :LANG==='pt'?'Em 2026, o investimento em TV de Open English adulto gerou o equivalente a '+fmtNum(pct,1)+'% de leads reais adicionais de Open English Junior ('+fmtNum(totalJr,0)+' leads) além dos seus próprios '+fmtNum(totalOe,0)+' — com custo incremental $0. Essa é uma eficiência real de orçamento que passaria despercebida olhando só a performance da OE; deveria entrar em qualquer conversa de orçamento entre marcas.'
      :'En 2026, la inversión de TV de Open English adulto generó el equivalente a '+fmtNum(pct,1)+'% de leads reales adicionales de Open English Junior ('+fmtNum(totalJr,0)+' leads) encima de sus propios '+fmtNum(totalOe,0)+' — a costo incremental $0. Esto es eficiencia real de presupuesto que se perdería mirando solo el performance de OE; debería entrar en cualquier conversación de presupuesto entre marcas.'),
  };
}
function tbdDetectCvrDivergence(data){
  var items = data.y26.filter(function(r){ return r.n>=3; });
  if(items.length<4) return null;
  var avgCvr = items.reduce(function(s,r){return s+r.cvr;},0)/items.length;
  var byL1k = items.slice().sort(function(a,b){return b.l1k_adj-a.l1k_adj;});
  var topLeadGen = byL1k[0];
  if(!topLeadGen || avgCvr<=0) return null;
  var cvrGap = (topLeadGen.cvr-avgCvr)/avgCvr*100;
  if(cvrGap>-25) return null; // solo interesa si el mejor generador de leads convierte MUCHO peor que el promedio
  return {
    strength: Math.abs(cvrGap),
    icon:'⚠',
    title: LANG==='en'?'The top lead generator converts worse than average':LANG==='pt'?'O maior gerador de leads converte pior que a média':'El mayor generador de leads convierte peor que el promedio',
    body: (LANG==='en'?'"'+topLeadGen.nombre+'" is the #1 creative by L/$1k adj. ('+fmtNum(topLeadGen.l1k_adj,1)+') but its conversion rate ('+fmtPct(topLeadGen.cvr,1)+') is '+fmtNum(Math.abs(cvrGap),0)+'% below the portfolio average ('+fmtPct(avgCvr,1)+'). It is winning on lead VOLUME per dollar, not lead QUALITY — worth checking whether it is attracting less-qualified prospects before scaling it further.'
      :LANG==='pt'?'"'+topLeadGen.nombre+'" é o criativo #1 por L/$1k adj. ('+fmtNum(topLeadGen.l1k_adj,1)+') mas sua taxa de conversão ('+fmtPct(topLeadGen.cvr,1)+') está '+fmtNum(Math.abs(cvrGap),0)+'% abaixo da média do portfólio ('+fmtPct(avgCvr,1)+'). Ele está ganhando em VOLUME de leads por dólar, não em QUALIDADE — vale checar se está atraindo prospects menos qualificados antes de escalar ainda mais.'
      :'"'+topLeadGen.nombre+'" es el creativo #1 por L/$1k adj. ('+fmtNum(topLeadGen.l1k_adj,1)+') pero su tasa de conversión ('+fmtPct(topLeadGen.cvr,1)+') está '+fmtNum(Math.abs(cvrGap),0)+'% por debajo del promedio del portafolio ('+fmtPct(avgCvr,1)+'). Está ganando en VOLUMEN de leads por dólar, no en CALIDAD — vale la pena revisar si está atrayendo prospectos menos calificados antes de escalarlo más.'),
  };
}
function tbdDeepInsights(data){
  var detectors = [tbdDetectRankReversal, tbdDetectToneByAdType, tbdDetectHookWearout, tbdDetectNewVsRecurring, tbdDetectJrHaloShare, tbdDetectCvrDivergence,
    function(d){ return tbdDetectSpendVsDemandTiming(d,'2026'); }, function(d){ return tbdDetectSpendVsDemandTiming(d,'2025'); }];
  var found = [];
  detectors.forEach(function(fn){ try{ var r = fn(data); if(r) found.push(r); }catch(e){} });
  return found.sort(function(a,b){ return b.strength-a.strength; });
}
function tbdInsightsHTML(data){
  var cards = tbdDeepInsights(data);
  if(!cards.length) return '<h2 class="tbd-section-title">'+esc(tbdS('title_insights'))+' — '+esc(data.territory)+'</h2>'+tbdHowToCard('insights')+'<p style="color:var(--ink-faint);">'+esc(tbdS('no_data'))+'</p>';
  return '<h2 class="tbd-section-title">'+esc(tbdS('title_insights'))+' — '+esc(data.territory)+'</h2>'+tbdHowToCard('insights')+
    '<div class="tbd-two-col">'+cards.map(function(c){
    return '<div class="card" style="margin-bottom:12px;"><div style="font-size:20px;">'+c.icon+'</div><div style="font-weight:800;font-size:13px;margin:6px 0 4px;">'+esc(c.title)+'</div><div style="font-size:12px;color:var(--ink-faint);line-height:1.5;">'+esc(c.body)+'</div></div>';
  }).join('')+'</div>';
}
function tbdTestsHTML(data){
  var running26 = new Set(data.y26.map(function(r){return r.nombre;}));
  var best25NotIn26 = data.y25.filter(function(r){return !running26.has(r.nombre);})[0];
  var wo26 = data.y26.map(function(r){return {nombre:r.nombre, w:tbdWearout(r)};}).filter(function(x){return x.w.pct!=null;}).sort(function(a,b){return a.w.pct-b.w.pct;});
  var tone26 = tbdDimensionRollup(data.y26, function(r){return r.tone_category||null;});
  var hooks26 = tbdDimensionRollup(data.y26, function(r){return r.hook_audio_type_code||null;});
  var testsA = [];
  if(best25NotIn26) testsA.push({t:'A1', what:'Reactivar "'+best25NotIn26.nombre+'"', why:'Fue de los mejores creativos de 2025 (L/$1k adj. '+fmtNum(best25NotIn26.l1k_adj,1)+') y no está corriendo en 2026 — cero costo de producción.'});
  if(wo26.length) testsA.push({t:'A2', what:'Monitorear/pausar "'+wo26[0].nombre+'"', why:'Cayó '+fmtNum(Math.abs(wo26[0].w.pct),0)+'% de H1 a H2 en 2026 (ajustado por estacionalidad) — señal de desgaste real, no estacional.'});
  testsA.push({t:'A3', what:'Semana 100% Generic (sin Promo)', why:'Aísla si los creativos genéricos sostienen volumen de leads sin el empujón de una oferta explícita — mismo gasto, sin producción nueva.'});
  var testsB = [];
  if(tone26.length) testsB.push({t:'B1', what:'Nuevo creativo con tono "'+tone26[0].label+'"', why:'Es el tono con mejor L/$1k adj. en 2026 ('+fmtNum(tone26[0].l1k_adj,1)+') — vale la pena un segundo concepto en la misma línea.'});
  if(hooks26.length) testsB.push({t:'B2', what:'Nuevo hook de audio tipo "'+hooks26[0].label+'"', why:'El hook de audio con mejor performance ajustado en 2026 ('+fmtNum(hooks26[0].l1k_adj,1)+').'});
  testsB.push({t:'B3', what:'Creativo cruzado OE↔Junior', why:'El halo entre marcas (ver pestaña JR Halo) muestra que hay leads reales cruzándose — vale la pena un creativo diseñado a propósito para capturarlo.'});
  function col(list, title){
    return '<div><h3 style="font-size:13px;font-weight:800;margin-bottom:8px;">'+title+'</h3>'+list.map(function(x){
      return '<div class="card" style="margin-bottom:10px;"><div class="tbd-badge">'+x.t+'</div><div style="font-weight:700;font-size:12.5px;margin:6px 0 4px;">'+esc(x.what)+'</div><div style="font-size:11.5px;color:var(--ink-faint);">'+esc(x.why)+'</div></div>';
    }).join('')+'</div>';
  }
  return '<h2 class="tbd-section-title">'+esc(tbdS('title_tests'))+' — '+esc(data.territory)+'</h2>'+tbdHowToCard('tests')+
    '<div class="tbd-two-col">'+col(testsA,tbdS('tests_col_a'))+col(testsB,tbdS('tests_col_b'))+'</div>';
}
function tbdAdjKpiHTML(data){
  return '<h2 class="tbd-section-title">'+esc(tbdS('title_adjkpi'))+'</h2>'+tbdHowToCard('adjkpi')+
    '<div class="card" style="font-size:12.5px; line-height:1.75;">'+
    '<p>'+esc(LANG==='en'
      ? 'English course demand is not flat across the year — it peaks around January and falls through the middle of the year. A creative that airs in January faces far more motivated prospects than the exact same creative airing in June, regardless of how good it is. Raw L/$1k will always favor whichever months happen to have higher natural demand.'
      : LANG==='pt'
      ? 'A demanda por cursos de inglês não é constante ao longo do ano — tem pico perto de janeiro e cai no meio do ano. Um criativo que vai ao ar em janeiro enfrenta prospects muito mais motivados do que o MESMO criativo no meio do ano, independente da qualidade do criativo. O L/$1k bruto sempre favorece os meses com maior demanda natural.'
      : 'La demanda de cursos de inglés no es pareja durante el año — tiene un pico cerca de enero y cae hacia la mitad del año. Un creativo que sale al aire en enero se enfrenta a prospectos mucho más motivados que ese MISMO creativo en junio, sin importar qué tan bueno sea. El L/$1k crudo siempre va a favorecer a los meses que tengan más demanda natural, sin importar la calidad del creativo.')+'</p>'+
    '<p style="margin-top:10px;"><b>'+esc(tbdS('kpi_l1k_adj'))+'</b> = Raw L/$1k ÷ (Demand Index / 100) — '+esc(LANG==='en'?'removes the seasonal tailwind/headwind.':LANG==='pt'?'remove o vento a favor/contra sazonal.':'quita el viento a favor/en contra estacional.')+'</p>'+
    '<p><b>'+esc(tbdS('kpi_cpl_adj'))+'</b> = Raw CPL × (Demand Index / 100).</p>'+
    '<p style="margin-top:10px;">'+esc(LANG==='en'
      ? 'The Demand Index (see the Seasonality Index tab) is built from real Ahrefs monthly search-volume data for "open english" + "cursos de ingles", normalized to 100 = average since January 2023, specific to each country. Each creative\'s index is spend-weighted across its actual TV-on days.'
      : LANG==='pt'
      ? 'O Índice de Demanda (ver aba Índice de Estacionalidade) vem de dados reais de volume de busca mensal do Ahrefs para "open english" + "cursos de ingles", normalizado a 100 = média desde janeiro de 2023, específico por país. O índice de cada criativo é ponderado pelo gasto nos seus dias reais de TV-on.'
      : 'El Índice de Demanda (ver la pestaña Índice de Estacionalidad) sale de datos reales de volumen de búsqueda mensual de Ahrefs para "open english" + "cursos de ingles", normalizado a 100 = promedio desde enero 2023, específico por país. El índice de cada creativo se pondera por gasto a través de sus días reales de TV-on.')+'</p>'+
    '<p style="margin-top:10px;"><b>'+esc(LANG==='en'?'Use adj. KPIs for:':LANG==='pt'?'Use KPIs adj. para:':'Usa los KPI adj. para:')+'</b> '+esc(LANG==='en'?'comparing creatives that aired in different months, evaluating true wear-out vs. seasonal decline, go/no-go decisions.':LANG==='pt'?'comparar criativos que foram ao ar em meses diferentes, avaliar desgaste real vs. queda sazonal, decisões go/no-go.':'comparar creativos que salieron al aire en meses distintos, evaluar desgaste real vs. caída estacional, decisiones de go/no-go.')+'</p>'+
    '<p><b>'+esc(LANG==='en'?'Use raw KPIs for:':LANG==='pt'?'Use KPIs brutos para:':'Usa los KPI crudos para:')+'</b> '+esc(LANG==='en'?'planning actual lead volume and budgets for a specific flight window.':LANG==='pt'?'planejar o volume real de leads e orçamentos para uma janela de flight específica.':'planear el volumen real de leads y presupuestos para una ventana de flight específica.')+'</p>'+
    '</div>';
}
function tbdMethodologyHTML(){
  return '<h2 class="tbd-section-title">'+esc(tbdS('title_methodology'))+'</h2>'+tbdHowToCard('methodology')+
    '<div class="card" style="font-size:12.5px; line-height:1.7;">'+
    '<p><b>Fuente de datos:</b> los mismos 4 JSON en vivo (OE-LATAM, OE-BR, JR-LATAM, JR-BR) + rotación + taxonomía que usa el dashboard "TV Ads Performance" — misma matemática ya validada, sin recalcular nada distinto. Ver <code>Documentacion/03_ESTADO_ACTUAL_Y_MATEMATICA.md</code>.</p>'+
    '<p><b>Organization:</b> seleccionable con el interruptor "Open English / Open English Junior" (arriba a la izquierda, junto al país) — cambia qué creativos, KPI, insights y PPT se muestran, sin recalcular nada distinto (misma matemática para ambas marcas).</p>'+
    '<p><b>Período:</b> siempre Enero 1 – Julio 31, comparando 2025 vs 2026, filtrado por región/país.</p>'+
    '<p><b>SEM-Brand:</b> siempre excluido del gasto (regla permanente, no es un interruptor aquí).</p>'+
    '<p><b>Ajuste por demanda (adj.):</b> L/$1k adj. = L/$1k crudo ÷ (Índice de Estacionalidad/100). El índice sale de Ahrefs (volumen de búsqueda mensual real de "open english" + "cursos de ingles" por país, normalizado a 100 = promedio desde enero 2023) — reemplaza a Google Trends que usaba el reporte de referencia.</p>'+
    '<p><b>JR Halo:</b> leads reales de Open English Junior (su propio archivo de deck) etiquetados con marketing_organization="OE", prorrateados con el mismo % de rotación del creativo de Open English adulto ese día. Solo aplica (y solo se muestra la pestaña) con Open English seleccionado — es el halo de OE hacia Junior, no existe el cálculo inverso todavía.</p>'+
    '<p><b>Launch Week:</b> primeros 7 días calendario desde la primera fecha de aire de cada creativo (no 5 días consecutivos — la rotación de TV es irregular).</p>'+
    '<p><b>Wear-Out:</b> primera mitad (H1) vs segunda mitad (H2) del flight por CONTEO de días activos (no semanas calendario), cada mitad ajustada por su propio índice de demanda. Caída &gt;20% en L/$1k adj. = señal de desgaste real.</p>'+
    '<p><b>Insights y Tests:</b> generados automáticamente a partir de los números reales de cada territorio en cada carga — no son texto fijo.</p>'+
    '</div>';
}

/* ============================ descarga a PowerPoint (pptxgenjs via CDN, carga perezosa) ============================ */
function tbdEnsurePptxLib(cb){
  if(window.PptxGenJS){ cb(); return; }
  var s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  s.onload = cb;
  s.onerror = function(){ showToast('No se pudo cargar la librería de PowerPoint (revisa tu conexión a internet).'); };
  document.head.appendChild(s);
}
/* Paleta de marca para el PPT (PptxGenJS no puede leer variables CSS) --
   espejo exacto de --oe/--oejr y sus tonos oscuros de dashboard.html. */
var TBD_PPT_PALETTE = {
  'Open English': { bg:'12234F', box:'1A3566', boxLabel:'8FA6D6', accent:'2B6CE8' },
  'Open English Junior': { bg:'4A2E15', box:'6B3D1C', boxLabel:'F5C89A', accent:'E8752D' },
};
function tbdDownloadPPT(){
  tbdEnsurePptxLib(function(){
    var data = tbdCurrentData();
    var brand = TBD_STATE.org;
    var pal = TBD_PPT_PALETTE[brand] || TBD_PPT_PALETTE['Open English'];
    var pres = new PptxGenJS();
    pres.defineLayout({ name:'WIDE', width:13.3, height:7.5 });
    pres.layout = 'WIDE';
    var s1 = pres.addSlide();
    s1.background = { color:pal.bg };
    s1.addText('TBD Dolo — '+data.territory, { x:0.5,y:0.4,w:12.3,h:0.6, fontSize:24, bold:true, color:'FFFFFF' });
    s1.addText('Enero–Julio 2025 vs Enero–Julio 2026 · '+brand+' · Brand TV Channels', { x:0.5,y:1.0,w:12.3,h:0.4, fontSize:13, color:'C9D6EC' });
    var kpis = [
      ['L/$1k adj.', fmtNum(data.p25.l1k_adj,1)+' → '+fmtNum(data.p26.l1k_adj,1)],
      ['CPL adj.', fmt$(data.p25.cpl_adj,2)+' → '+fmt$(data.p26.cpl_adj,2)],
      ['CVR', fmtPct(data.p25.cvr,1)+' → '+fmtPct(data.p26.cvr,1)],
      ['% MNCC', fmtPct(data.p25.mncc,1)+' → '+fmtPct(data.p26.mncc,1)],
      ['Creativos', data.p25.num_creatives+' → '+data.p26.num_creatives],
    ];
    kpis.forEach(function(k,i){
      var x = 0.5 + i*2.5;
      s1.addShape(pres.ShapeType.rect, { x:x, y:1.7, w:2.3, h:1.3, fill:{color:pal.box}, line:{color:pal.box} });
      s1.addText(k[0], { x:x+0.1,y:1.8,w:2.1,h:0.3, fontSize:9, color:pal.boxLabel, bold:true });
      s1.addText(k[1], { x:x+0.1,y:2.15,w:2.1,h:0.6, fontSize:15, color:'FFFFFF', bold:true });
    });
    var takeawayTxt = tbdPortfolioTakeaway(data).replace(/<[^>]+>/g,'');
    s1.addText(takeawayTxt, { x:0.5,y:3.3,w:12.3,h:1.4, fontSize:12, color:'FFFFFF', fill:{color:pal.accent}, align:'left', valign:'top', margin:10 });

    var s2 = pres.addSlide();
    s2.addText('Top Creatives — 2026', { x:0.5,y:0.3,w:12.3,h:0.5, fontSize:18, bold:true, color:pal.bg });
    var top = data.y26.slice(0,10).map(function(r,i){ return [String(i+1), r.nombre, r.ad_type||'—', fmtNum(r.l1k_adj,1), fmt$(r.cpl_adj,2), fmtPct(r.cvr,1)]; });
    s2.addTable([['#','Creative','Type','L/$1k adj','CPL adj','CVR']].concat(top), { x:0.5,y:0.9,w:12.3,h:5.5, fontSize:10, border:{type:'solid',color:'DDDDDD',pt:0.5}, autoPage:false });

    var s3 = pres.addSlide();
    s3.addText('Insights', { x:0.5,y:0.3,w:12.3,h:0.5, fontSize:18, bold:true, color:pal.bg });
    var insightsTxt = tbdInsightsHTML(data).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    s3.addText(insightsTxt.slice(0, 1400), { x:0.5,y:1.0,w:12.3,h:5.8, fontSize:12, color:'333333', valign:'top' });

    var brandSuffix = brand==='Open English Junior' ? 'OEJunior' : 'OE';
    pres.writeFile({ fileName: 'TBD_Dolo_'+data.territory.replace(/\s+/g,'_')+'_'+brandSuffix+'_2025_vs_2026.pptx' });
  });
}

/* ============================================================
   Modal infografico del creativo (clic en el Ad Name) -- 3 pasos en orden
   estricto: (1) desglose de versiones (Video Name -> dias), (2) detalle de
   rotacion cronologico (con quien roto y a que %, para auditar el total de
   dias que muestra la tabla), (3) perfil cualitativo. Reusa el modal global
   (#modal-backdrop/#modal-card) que ya existe en dashboard.html para el
   dashboard principal -- nunca se duplica esa estructura, solo se le agrega
   la clase .tbd-wide (apaisado) mientras esta abierto este modal puntual.
   ============================================================ */
function tbdGroupContinuousRotation(rawDays){
  var groups = [];
  var current = null, lastTime = null, lastSig = null;
  rawDays.forEach(function(d){
    var t = Date.parse(d.fecha+'T00:00:00Z');
    var sig = d.video_name+'|'+d.peso_propio+'|'+(d.companions||[]).map(function(c){ return c.nombre+':'+c.peso; }).sort().join(',');
    if(current && lastTime!=null && (t-lastTime)===86400000 && sig===lastSig){ current.dates.push(d.fecha); }
    else { current = { dates:[d.fecha], video_name:d.video_name, peso_propio:d.peso_propio, companions:d.companions||[] }; groups.push(current); }
    lastTime = t; lastSig = sig;
  });
  return groups;
}
function tbdInfoCard(label, value, descObj){
  var desc = descObj ? tbdT(descObj) : null;
  return '<div class="tbd-info-card"><div class="tbd-info-label">'+esc(label)+'</div><div class="tbd-info-value">'+esc(value||'—')+'</div>'+(desc?'<div class="tbd-info-desc">'+esc(desc)+'</div>':'')+'</div>';
}
function tbdCreativeModalHTML(row){
  var L = { versions:{en:'Version breakdown',es:'Desglose de versiones',pt:'Detalhamento de versões'},
    rotation:{en:'Rotation detail (chronological)',es:'Detalle de rotación (cronológico)',pt:'Detalhe de rotação (cronológico)'},
    profile:{en:'Creative profile',es:'Perfil del creativo',pt:'Perfil do criativo'},
    totalDays:{en:'Total unique active days: ',es:'Total de días activos únicos: ',pt:'Total de dias ativos únicos: '},
    withTxt:{en:'with: ',es:'con: ',pt:'com: '},
    days:{en:'days',es:'días',pt:'dias'},
    campaign:{en:'Campaign',es:'Campaña',pt:'Campanha'}, theme:{en:'Theme',es:'Tema',pt:'Tema'}, mechanism:{en:'Mechanism',es:'Mecanismo',pt:'Mecanismo'},
    audioHook:{en:'Audio Hook',es:'Hook de Audio',pt:'Hook de Áudio'}, visualHook:{en:'Visual Hook',es:'Hook Visual',pt:'Hook Visual'} };
  var html = '';
  // Paso 1
  var maxDias = Math.max.apply(null, row.versions.map(function(v){return v.num_dias;}).concat([1]));
  html += '<div class="tbd-modal-step"><div class="tbd-modal-step-label">1 · '+esc(tbdT(L.versions))+'</div>'+
    row.versions.map(function(v){
      return '<div class="tbd-version-row"><div style="min-width:180px;font-weight:700;font-size:12px;">'+esc(v.video_name)+(v.link_video?(' <a href="'+escAttr(v.link_video)+'" target="_blank" rel="noopener" style="color:var(--tbd-accent);">▶</a>'):'')+'</div>'+
        '<div class="tbd-version-bar"><div class="tbd-version-bar-fill" style="width:'+(v.num_dias/maxDias*100)+'%;"></div></div>'+
        '<div style="font-size:12px;font-weight:700;min-width:70px;text-align:right;">'+v.num_dias+' '+esc(tbdT(L.days))+'</div></div>';
    }).join('')+
    '<div style="font-size:11px;color:var(--ink-faint);margin-top:4px;">'+esc(tbdT(L.totalDays))+'<b>'+row.n+'</b></div></div>';
  // Paso 2
  var groups = tbdGroupContinuousRotation(row._rawDays);
  html += '<div class="tbd-modal-step"><div class="tbd-modal-step-label">2 · '+esc(tbdT(L.rotation))+'</div>'+
    '<div style="max-height:230px;overflow-y:auto;">'+groups.map(function(g){
      var d0=g.dates[0], d1=g.dates[g.dates.length-1];
      var dateLabel = d0===d1 ? d0 : (d0+' → '+d1);
      var comp = g.companions.map(function(c){ return c.nombre+' ('+fmtPct(c.peso,0)+')'; }).join(', ') || '—';
      return '<div class="tbd-rot-row"><div class="tbd-rot-date">'+esc(dateLabel)+'</div><div class="tbd-rot-companions"><b style="color:var(--ink);">'+esc(g.video_name)+'</b> · '+esc(tbdT(L.withTxt))+esc(comp)+'</div><div style="text-align:right;font-weight:800;">'+fmtPct(g.peso_propio,0)+'</div></div>';
    }).join('')+'</div></div>';
  // Paso 3
  html += '<div class="tbd-modal-step"><div class="tbd-modal-step-label">3 · '+esc(tbdT(L.profile))+'</div><div class="tbd-info-grid">'+
    tbdInfoCard(tbdT(L.campaign), row.campaign_name)+
    tbdInfoCard(tbdT(L.theme), row.theme, row.theme_explanation)+
    tbdInfoCard(tbdT(L.mechanism), row.theme_mechanism_code)+
    tbdInfoCard('Pain Point', row.pain_point)+
    tbdInfoCard(tbdT(L.audioHook), row.hook_audio_type_code, row.hook_audio)+
    tbdInfoCard(tbdT(L.visualHook), row.hook_visual_type_code, row.hook_visual)+
    '</div></div>';
  return html;
}
function tbdOpenCreativeModal(adName, year){
  var list = TBD_LAST_DATA ? (year==='2025' ? TBD_LAST_DATA.y25 : TBD_LAST_DATA.y26) : [];
  var row = list.filter(function(r){ return r.nombre===adName; })[0];
  if(!row) return;
  document.getElementById('modal-card').classList.add('tbd-wide');
  var versionsLabel = LANG==='en'?'versions':LANG==='pt'?'versões':'versiones';
  document.getElementById('modal-eyebrow').textContent = (row.ad_type||'')+(row.is_grouped?(' · '+row.versions.length+' '+versionsLabel):'');
  document.getElementById('modal-title').innerHTML = esc(row.nombre);
  document.getElementById('modal-body').innerHTML = tbdCreativeModalHTML(row);
  document.getElementById('modal-backdrop').classList.add('open');
}
function tbdWireModalCleanup(){
  var strip = function(){ document.getElementById('modal-card').classList.remove('tbd-wide'); };
  document.getElementById('modal-close').addEventListener('click', strip);
  document.getElementById('modal-backdrop').addEventListener('click', function(e){ if(e.target.id==='modal-backdrop') strip(); });
}

/* ============================================================
   Recorrido guiado de TBD Dolo -- 100% independiente del tour del dashboard
   principal (localStorage aparte, DOM aparte, nunca se activa en el selector
   de dashboards, solo al entrar especificamente a TBD Dolo). Cubre cada
   pestana del nav, el nuevo modal de Ad Name, los controles (idioma, modo
   oscuro, selector de dashboard) y como leer los insights. ============================================================ */
var TBD_TOUR_IDX = 0;
var TBD_TOUR_STEPS = [
  { title:{en:'Welcome to TBD Dolo',es:'Bienvenido a TBD Dolo',pt:'Bem-vindo ao TBD Dolo'},
    body:{en:'An executive report comparing Jan–Jul 2025 vs Jan–Jul 2026, demand-adjusted, by country. This tour covers every tab and control. Replay it anytime from the 🎓 icon.',
      es:'Un reporte ejecutivo que compara Ene–Jul 2025 vs Ene–Jul 2026, ajustado por demanda, por país. Este recorrido cubre cada pestaña y control. Repítelo cuando quieras desde el ícono 🎓.',
      pt:'Um relatório executivo que compara Jan–Jul 2025 vs Jan–Jul 2026, ajustado por demanda, por país. Este tour cobre cada aba e controle. Repita quando quiser pelo ícone 🎓.'} },
  { selector:'#tbd-sel-org', tab:'portfolio', title:{en:'Brand switch: Open English / Open English Junior',es:'Interruptor de marca: Open English / Open English Junior',pt:'Alternador de marca: Open English / Open English Junior'},
    body:{en:'Every tab, KPI, insight and the PPT export follow this switch — pick Open English or Open English Junior to see that brand\'s own creatives. The color theme (blue vs. orange) and the "Cross-brand · JR Halo" tab change with it too (JR Halo only applies with Open English selected).',
      es:'Cada pestaña, KPI, insight y la descarga de PPT siguen este interruptor — elige Open English u Open English Junior para ver los creativos de esa marca. El tema de color (azul vs. naranja) y la pestaña "Cruce de marca · JR Halo" también cambian con él (JR Halo solo aplica con Open English seleccionado).',
      pt:'Cada aba, KPI, insight e o PPT seguem este alternador — escolha Open English ou Open English Junior para ver os criativos dessa marca. O tema de cor (azul vs. laranja) e a aba "Cruzamento de marca · JR Halo" também mudam com ele (JR Halo só se aplica com Open English selecionado).'} },
  { selector:'#tbd-sel-territory', tab:'portfolio', title:{en:'Region / Country filter',es:'Filtro de Región / País',pt:'Filtro de Região / País'},
    body:{en:'Pick Brazil or any LATAM country. The comparison window (Jan–Jul 2025 vs 2026) is always fixed.',
      es:'Elige Brasil o cualquier país de LATAM. La ventana de comparación (Ene–Jul 2025 vs 2026) siempre queda fija.',
      pt:'Escolha Brasil ou qualquer país da LATAM. A janela de comparação (Jan–Jul 2025 vs 2026) fica sempre fixa.'} },
  { selector:'.tbd-nav-link[data-tab="adjkpi"]', tab:'adjkpi', title:{en:'★ Adj. KPI',es:'★ KPI Ajustado',pt:'★ KPI Ajustado'},
    body:{en:'Read this first: explains why "adjusted" (adj.) metrics remove seasonal demand swings so you compare creatives fairly across months.',
      es:'Lee esto primero: explica por qué las métricas "ajustadas" (adj.) quitan los vaivenes de demanda estacional para comparar creativos de forma justa entre meses.',
      pt:'Leia isto primeiro: explica por que as métricas "ajustadas" (adj.) removem as variações sazonais de demanda para comparar criativos de forma justa entre meses.'} },
  { selector:'.tbd-nav-link[data-tab="portfolio"]', tab:'portfolio', title:{en:'Portfolio',es:'Portfolio',pt:'Portfólio'},
    body:{en:'Overall 2025 vs 2026 KPIs, a plain-language takeaway, and the Top 10 creatives of each year.',
      es:'Los KPI generales 2025 vs 2026, un takeaway en lenguaje simple, y el Top 10 de creativos de cada año.',
      pt:'Os KPIs gerais 2025 vs 2026, um takeaway em linguagem simples, e o Top 10 de criativos de cada ano.'} },
  { selector:'[data-tbd-creative]', tab:'portfolio', title:{en:'Click any creative name',es:'Haz clic en cualquier nombre de creativo',pt:'Clique em qualquer nome de criativo'},
    body:{en:'Every creative name (Ad Name) is clickable — it opens a wide info card with (1) which video versions ran and how many days each, (2) the exact rotation calendar with % and companions, so you can audit the day count, and (3) the full creative profile (campaign, theme, mechanism, pain point, hooks).',
      es:'Cada nombre de creativo (Ad Name) es cliqueable — abre una ficha ancha con (1) qué versiones de video corrieron y cuántos días cada una, (2) el calendario exacto de rotación con % y acompañantes, para auditar el total de días, y (3) el perfil completo del creativo (campaña, tema, mecanismo, pain point, hooks).',
      pt:'Cada nome de criativo (Ad Name) é clicável — abre uma ficha larga com (1) quais versões de vídeo rodaram e quantos dias cada uma, (2) o calendário exato de rotação com % e acompanhantes, para auditar o total de dias, e (3) o perfil completo do criativo (campanha, tema, mecanismo, pain point, hooks).'} },
  { selector:'.tbd-nav-link[data-tab="promo"]', tab:'promo', title:{en:'Promo',es:'Promo',pt:'Promo'},
    body:{en:'Only creatives with an explicit offer (discount, BOGO, etc.), same side-by-side format.', es:'Solo creativos con una oferta explícita (descuento, BOGO, etc.), mismo formato lado a lado.', pt:'Apenas criativos com uma oferta explícita (desconto, BOGO, etc.), mesmo formato lado a lado.'} },
  { selector:'.tbd-nav-link[data-tab="generic"]', tab:'generic', title:{en:'Generic',es:'Genérico',pt:'Genérico'},
    body:{en:'Creatives with no explicit offer — brand/product messaging.', es:'Creativos sin oferta explícita — mensaje de marca/producto.', pt:'Criativos sem oferta explícita — mensagem de marca/produto.'} },
  { selector:'.tbd-nav-link[data-tab="pvg"]', tab:'pvg', title:{en:'Promo vs Generic',es:'Promo vs Genérico',pt:'Promo vs Genérico'},
    body:{en:'Which style wins overall, plus a takeaway telling you if that pattern held in the prior year too.', es:'Qué estilo gana en general, más un takeaway que dice si ese patrón también se dio el año anterior.', pt:'Qual estilo vence em geral, mais um takeaway dizendo se esse padrão também ocorreu no ano anterior.'} },
  { selector:'.tbd-nav-link[data-tab="tone"]', tab:'tone', title:{en:'Tone',es:'Tono',pt:'Tom'},
    body:{en:'Humor, Motivational, Corporative, Commemorative — ranked by demand-adjusted performance.', es:'Humor, Motivational, Corporative, Commemorative — ordenados por performance ajustado por demanda.', pt:'Humor, Motivational, Corporative, Commemorative — ordenados por performance ajustado por demanda.'} },
  { selector:'.tbd-nav-link[data-tab="hooks"]', tab:'hooks', title:{en:'Hooks',es:'Hooks',pt:'Hooks'},
    body:{en:'Audio hook and visual hook, each ranked separately.', es:'Hook de audio y hook visual, cada uno rankeado por separado.', pt:'Hook de áudio e hook visual, cada um ranqueado separadamente.'} },
  { selector:'.tbd-nav-link[data-tab="versions"]', tab:'versions', title:{en:'Versions',es:'Versiones',pt:'Versões'},
    body:{en:'V1 vs later versions (V2/V3) of the same concept — the only tab that looks at individual video versions instead of the merged Ad Name, on purpose, since that is exactly what this comparison needs.', es:'V1 vs versiones posteriores (V2/V3) del mismo concepto — la única pestaña que mira cada versión de video por separado en vez del Ad Name fusionado, a propósito, porque es justo lo que esta comparación necesita.', pt:'V1 vs versões posteriores (V2/V3) do mesmo conceito — a única aba que olha cada versão de vídeo separadamente em vez do Ad Name fundido, de propósito, porque é exatamente o que essa comparação precisa.'} },
  { selector:'.tbd-nav-link[data-tab="campaigns"]', tab:'campaigns', title:{en:'Campaigns',es:'Campañas',pt:'Campanhas'},
    body:{en:'Performance grouped by campaign.', es:'Performance agrupado por campaña.', pt:'Performance agrupado por campanha.'} },
  { selector:'.tbd-nav-link[data-tab="promo_type"]', tab:'promo_type', title:{en:'Promo Type',es:'Tipo de Promo',pt:'Tipo de Promo'},
    body:{en:'Promo creatives only, grouped by the specific offer/pain point.', es:'Solo creativos Promo, agrupados por la oferta/pain point específico.', pt:'Apenas criativos Promo, agrupados pela oferta/pain point específico.'} },
  { selector:'.tbd-nav-link[data-tab="theme"]', tab:'theme', title:{en:'Theme',es:'Tema',pt:'Tema'},
    body:{en:"Creative's thematic mechanism.", es:'Mecanismo temático del creativo.', pt:'Mecanismo temático do criativo.'} },
  { selector:'.tbd-nav-link[data-tab="ai_vs_real"]', tab:'ai_vs_real', title:{en:'AI vs Real',es:'IA vs Real',pt:'IA vs Real'},
    body:{en:'Generative-AI production vs. real filming/B-roll.', es:'Producción con IA generativa vs. filmación/B-roll real.', pt:'Produção com IA generativa vs. filmagem/B-roll real.'} },
  { selector:'.tbd-nav-link[data-tab="jrhalo"]', tab:'jrhalo', title:{en:'JR Halo',es:'JR Halo',pt:'JR Halo'},
    body:{en:"Real Open English Junior leads generated by Open English adult's own TV spend — a cross-brand effect most reports miss entirely.", es:'Leads reales de Open English Junior generados por la inversión de TV propia de Open English adulto — un efecto cruzado entre marcas que la mayoría de reportes no captura.', pt:'Leads reais de Open English Junior gerados pelo próprio investimento de TV da Open English adulto — um efeito cruzado entre marcas que a maioria dos relatórios não capta.'} },
  { selector:'.tbd-nav-link[data-tab="launch"]', tab:'launch', title:{en:'Launch Week',es:'Semana de Lanzamiento',pt:'Semana de Lançamento'},
    body:{en:'How each creative performed in its first 7 calendar days on air.', es:'Cómo rindió cada creativo en sus primeros 7 días calendario al aire.', pt:'Como cada criativo performou em seus primeiros 7 dias corridos no ar.'} },
  { selector:'.tbd-nav-link[data-tab="wearout"]', tab:'wearout', title:{en:'Wear-Out',es:'Desgaste',pt:'Desgaste'},
    body:{en:'First half vs second half of each flight — a real drop (already demand-adjusted) means fatigue, not just a slow month.', es:'Primera mitad vs segunda mitad de cada flight — una caída real (ya ajustada por demanda) significa desgaste, no solo un mes flojo.', pt:'Primeira metade vs segunda metade de cada flight — uma queda real (já ajustada por demanda) significa desgaste, não só um mês fraco.'} },
  { selector:'.tbd-nav-link[data-tab="seasonality"]', tab:'seasonality', title:{en:'Seasonality Index',es:'Índice de Estacionalidad',pt:'Índice de Estacionalidade'},
    body:{en:'The real Ahrefs search-demand index behind every "adj." number in this report, month by month.', es:'El índice real de demanda de búsqueda de Ahrefs detrás de cada número "adj." de este reporte, mes a mes.', pt:'O índice real de demanda de busca do Ahrefs por trás de cada número "adj." deste relatório, mês a mês.'} },
  { selector:'.tbd-nav-link[data-tab="insights"]', tab:'insights', title:{en:'Insights',es:'Insights',pt:'Insights'},
    body:{en:'Each card here crosses at least two signals (never a single "best of") and only shows up when the effect is big enough to act on — read the body text, it explains exactly what to do about each finding.', es:'Cada tarjeta aquí cruza al menos dos señales (nunca un solo "el mejor de") y solo aparece cuando el efecto es lo bastante grande para actuar — lee el texto, explica exactamente qué hacer con cada hallazgo.', pt:'Cada cartão aqui cruza pelo menos dois sinais (nunca um único "melhor de") e só aparece quando o efeito é grande o suficiente para agir — leia o texto, ele explica exatamente o que fazer com cada achado.'} },
  { selector:'.tbd-nav-link[data-tab="tests"]', tab:'tests', title:{en:'Recommended Tests',es:'Tests Recomendados',pt:'Testes Recomendados'},
    body:{en:'Concrete next steps: column A needs zero production (reactivate/reuse), column B needs new creative.', es:'Próximos pasos concretos: la columna A no necesita producción (reactivar/reusar), la columna B necesita creativo nuevo.', pt:'Próximos passos concretos: a coluna A não precisa de produção (reativar/reusar), a coluna B precisa de criativo novo.'} },
  { selector:'.tbd-nav-link[data-tab="methodology"]', tab:'methodology', title:{en:'How it was built',es:'Cómo se construyó',pt:'Como foi construído'},
    body:{en:'The full data sources and formulas behind every number in TBD Dolo.', es:'Todas las fuentes de datos y fórmulas detrás de cada número de TBD Dolo.', pt:'Todas as fontes de dados e fórmulas por trás de cada número do TBD Dolo.'} },
  { selector:'#tbd-btn-ppt', title:{en:'Download PowerPoint',es:'Descargar PowerPoint',pt:'Baixar PowerPoint'},
    body:{en:'Generates an executive .pptx for the country currently selected.', es:'Genera un .pptx ejecutivo para el país seleccionado actualmente.', pt:'Gera um .pptx executivo para o país selecionado atualmente.'} },
  { selector:'#tbd-lang-btns', title:{en:'Language',es:'Idioma',pt:'Idioma'},
    body:{en:'Switch between English, Spanish and Portuguese at any time.', es:'Cambia entre inglés, español y portugués cuando quieras.', pt:'Alterne entre inglês, espanhol e português quando quiser.'} },
  { selector:'#tbd-btn-theme', title:{en:'Light / dark mode',es:'Modo claro / oscuro',pt:'Modo claro / escuro'},
    body:{en:'Toggle between light and dark mode.', es:'Alterna entre modo claro y oscuro.', pt:'Alterne entre modo claro e escuro.'} },
  { selector:'#app-switcher-tbd', title:{en:'Switch dashboards',es:'Cambiar de dashboard',pt:'Trocar de dashboard'},
    body:{en:'Jump back to the "TV Ads Performance" dashboard at any time — this dropdown shows which one is currently active.', es:'Vuelve al dashboard "TV Ads Performance" cuando quieras — este menú muestra cuál está activo actualmente.', pt:'Volte ao dashboard "TV Ads Performance" quando quiser — este menu mostra qual está ativo no momento.'} },
];
function tbdTourStepTarget(step){ return step.selector ? document.querySelector(step.selector) : null; }
function tbdPositionTourHighlight(el){
  var hi = document.getElementById('tbd-tour-highlight');
  hi.style.display='block';
  hi.classList.toggle('tour-no-target', !el);
  if(!el){
    hi.style.top=(window.innerHeight/2)+'px'; hi.style.left=(window.innerWidth/2)+'px';
    hi.style.width='0px'; hi.style.height='0px';
    return;
  }
  var r = el.getBoundingClientRect();
  hi.style.top=(r.top-6)+'px'; hi.style.left=(r.left-6)+'px'; hi.style.width=(r.width+12)+'px'; hi.style.height=(r.height+12)+'px';
}
function tbdPositionTourTooltip(el){
  var tip = document.getElementById('tbd-tour-tooltip');
  if(!el){ tip.style.top='50%'; tip.style.left='50%'; tip.style.transform='translate(-50%,-50%)'; return; }
  tip.style.transform='none';
  var r = el.getBoundingClientRect();
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var top;
  if(window.innerHeight - r.bottom > th + 24) top = r.bottom + 14;
  else if(r.top > th + 24) top = r.top - th - 14;
  else top = Math.max(14, (window.innerHeight - th) / 2);
  var left = Math.min(Math.max(14, r.left), window.innerWidth - tw - 14);
  tip.style.top = top+'px'; tip.style.left = left+'px';
}
function tbdRenderTourStep(){
  var step = TBD_TOUR_STEPS[TBD_TOUR_IDX];
  if(step.tab && step.tab!==TBD_STATE.tab){ TBD_STATE.tab = step.tab; tbdRenderNav(); tbdRenderTab(); }
  var el = tbdTourStepTarget(step);
  if(el && el.scrollIntoView) el.scrollIntoView({block:'center'});
  var skipT = LANG==='en'?'Skip tour':LANG==='pt'?'Pular tour':'Saltar recorrido';
  var backT = LANG==='en'?'← Back':LANG==='pt'?'← Voltar':'← Atrás';
  var nextT = LANG==='en'?'Next':LANG==='pt'?'Próximo':'Siguiente';
  var finishT = LANG==='en'?'Finish':LANG==='pt'?'Concluir':'Finalizar';
  document.getElementById('tbd-tour-progress').textContent = (TBD_TOUR_IDX+1)+' / '+TBD_TOUR_STEPS.length;
  document.getElementById('tbd-tour-title').textContent = tbdT(step.title);
  document.getElementById('tbd-tour-body').textContent = tbdT(step.body);
  document.getElementById('tbd-tour-skip').textContent = skipT;
  document.getElementById('tbd-tour-prev').textContent = backT;
  document.getElementById('tbd-tour-prev').style.visibility = TBD_TOUR_IDX===0 ? 'hidden' : 'visible';
  document.getElementById('tbd-tour-next').textContent = (TBD_TOUR_IDX===TBD_TOUR_STEPS.length-1) ? finishT : nextT;
  tbdPositionTourHighlight(el);
  tbdPositionTourTooltip(el);
}
function tbdStartTour(){
  TBD_TOUR_IDX = 0;
  document.getElementById('tbd-tour-blocker').style.display='block';
  document.getElementById('tbd-tour-tooltip').style.display='block';
  tbdRenderTourStep();
}
function tbdEndTour(){
  document.getElementById('tbd-tour-blocker').style.display='none';
  document.getElementById('tbd-tour-tooltip').style.display='none';
  document.getElementById('tbd-tour-highlight').style.display='none';
  localStorage.setItem('tbd_dolo_tour_seen','1');
}
function tbdMaybeAutoStartTour(){ if(!localStorage.getItem('tbd_dolo_tour_seen')) tbdStartTour(); }
function tbdWireTour(){
  document.getElementById('tbd-tour-next').addEventListener('click', function(){
    if(TBD_TOUR_IDX >= TBD_TOUR_STEPS.length-1) tbdEndTour(); else { TBD_TOUR_IDX++; tbdRenderTourStep(); }
  });
  document.getElementById('tbd-tour-prev').addEventListener('click', function(){ if(TBD_TOUR_IDX>0){ TBD_TOUR_IDX--; tbdRenderTourStep(); } });
  document.getElementById('tbd-tour-skip').addEventListener('click', tbdEndTour);
  document.getElementById('tbd-btn-tour').addEventListener('click', tbdStartTour);
  window.addEventListener('resize', function(){ if(document.getElementById('tbd-tour-tooltip').style.display==='block') tbdRenderTourStep(); });
}
