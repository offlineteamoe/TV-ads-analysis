/* ============================================================
   TBD Dolo -- motor de datos ejecutivo (Ene-Jul 2025 vs Ene-Jul 2026).
   NO toca STATE ni ninguna funcion de app.js/engine.js -- lee los mismos
   YEARS_DATA/MKTORG_MARCA/DECK_INFO ya construidos y corregidos, y agrega
   su propia capa de agregacion (equivalente a agg()/dagg()/wearout()/
   launch_week() del proyecto de referencia en Python), mas el indice de
   estacionalidad de Ahrefs (reemplaza Google Trends) y el JR Halo.
   Organization queda fija en 'Open English' (adulto) -- igual que el
   reporte de referencia; MarketingOrganization = solo la propia ('Open
   English') porque SEM-Brand y "gasto ajeno" no aplican a un reporte
   ejecutivo de inversion propia. ============================================================ */
var TBD_PERIODS = {
  '2025': { from: '2025-01-01', to: '2025-07-31' },
  '2026': { from: '2026-01-01', to: '2026-07-31' },
};
var TBD_ORG = 'Open English';

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
function tbdCreativeDailyItems(row, territory, region, from, to, pais){
  var out = [];
  (row.detalle_diario||[]).forEach(function(d){
    if(!tbdDayInRange(d.fecha, from, to)) return;
    if(!tbdDayPassesPais(d.topcountry, pais)) return;
    out.push({
      date: d.fecha,
      l: d.leads||0,            // home: MarketingOrganization===Organization (mismo criterio que el resto del dashboard)
      s: d.adcost_real||0,      // SIEMPRE neto de SEM-Brand (regla permanente del reporte ejecutivo)
      e: d.core_enrollments||0,
      c: d.new_cash_core||0,
      jr_l: tbdJrHaloLeadsForDay(region, d.fecha, d.topcountry, d.peso_propio),
      dem: tbdDemandIndex(territory, d.fecha),
    });
  });
  return out;
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

/* ---------- lista de creativos de un territorio/periodo, ya agregados ---------- */
function tbdCreativesForPeriod(territory, region, yearKey, pais, adTypeFilter){
  var yd = YEARS_DATA[yearKey];
  if(!yd) return [];
  var slice = yd.slices[TBD_ORG+'|'+region+'|Total'];
  var rows = slice ? slice.ranking_creativos : [];
  var per = TBD_PERIODS[yearKey];
  var out = [];
  rows.forEach(function(row){
    if(adTypeFilter && adTypeFilter!=='Todos' && row.ad_type!==adTypeFilter) return;
    var dl = tbdCreativeDailyItems(row, territory, region, per.from, per.to, pais);
    var a = tbdAgg(dl);
    if(!a) return;
    out.push(Object.assign({ nombre: row.nombre, ad_type: row.ad_type, campaign_name: row.campaign_name,
      theme: row.theme, pain_point: row.pain_point, tone_category: row.tone_category,
      hook_audio_type_code: row.hook_audio_type_code, hook_visual_type_code: row.hook_visual_type_code,
      cta_type_code: row.cta_type_code, type_of_production: row.type_of_production, version: row.version,
      link_video: row.link_video, launch_dates: row.launch_dates, _dailyItems: dl }, a));
  });
  return out.sort(function(a,b){ return b.l1k_adj - a.l1k_adj; });
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
var TBD_STATE = { territory:'Brazil', tab:'portfolio' };
var TBD_TERRITORIES = null; // se llena en tbdBoot() con COUNTRIES (menos el contenedor no-pais)
var TBD_NAV = [
  { group:{en:'Overview',es:'Resumen',pt:'Resumo'}, items:[
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
  { group:{en:'Cross-brand',es:'Cruce de marca',pt:'Cruzamento de marca'}, items:[
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

function tbdBoot(){
  TBD_TERRITORIES = ['Brazil'].concat((COUNTRIES||[]).filter(function(c){ return c!=='TV LATAM Excl Arg Mex'; }).sort());
  if(TBD_TERRITORIES.indexOf(TBD_STATE.territory)===-1) TBD_STATE.territory = TBD_TERRITORIES[0];
  var h = tbdParseHash();
  if(h.tab) TBD_STATE.tab = h.tab;
  if(h.territory && TBD_TERRITORIES.indexOf(h.territory)!==-1) TBD_STATE.territory = h.territory;
  window.addEventListener('hashchange', tbdOnHashChange);
  tbdRenderShell();
  tbdRenderNav();
  tbdRenderTab();
  document.getElementById('tbd-btn-ppt').addEventListener('click', tbdDownloadPPT);
}
function tbdParseHash(){
  var m = /^#\/tbd\/([^/]+)(?:\/(.+))?$/.exec(location.hash);
  if(!m) return {};
  return { tab: m[1], territory: m[2] ? decodeURIComponent(m[2]) : null };
}
function tbdSetHash(){
  location.hash = '#/tbd/'+TBD_STATE.tab+'/'+encodeURIComponent(TBD_STATE.territory);
}
function tbdOnHashChange(){
  if(!document.getElementById('tbdShell').classList.contains('ready')) return;
  var h = tbdParseHash();
  if(!h.tab) return;
  TBD_STATE.tab = h.tab;
  if(h.territory && TBD_TERRITORIES.indexOf(h.territory)!==-1) TBD_STATE.territory = h.territory;
  tbdRenderNav();
  tbdRenderFilters();
  tbdRenderTab();
}
function tbdRenderShell(){
  tbdRenderFilters();
}
function tbdRenderFilters(){
  var el = document.getElementById('tbd-filters');
  el.innerHTML = '<div class="tbd-seg" id="tbd-sel-territory">'+TBD_TERRITORIES.map(function(t){
    return '<button data-t="'+escAttr(t)+'" class="'+(t===TBD_STATE.territory?'active':'')+'">'+esc(t)+'</button>';
  }).join('')+'</div><div style="font-size:11px;color:var(--ink-faint);margin-left:6px;">Ene–Jul 2025 vs Ene–Jul 2026</div>';
  Array.from(el.querySelectorAll('#tbd-sel-territory button')).forEach(function(b){
    b.addEventListener('click', function(){ TBD_STATE.territory = b.dataset.t; tbdSetHash(); });
  });
}
function tbdRenderNav(){
  var el = document.getElementById('tbd-nav');
  el.innerHTML = TBD_NAV.map(function(g){
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
  return { territory:territory, region:region, pais:pais, y25:d25, y26:d26, p25: tbdPortfolio(d25), p26: tbdPortfolio(d26) };
}
function tbdRenderTab(){
  document.getElementById('tbd-page').scrollTop = 0;
  var data = tbdCurrentData();
  var fn = TBD_RENDERERS[TBD_STATE.tab] || TBD_RENDERERS.portfolio;
  document.getElementById('tbd-page').innerHTML = fn(data);
  Array.from(document.querySelectorAll('[data-tbd-jump]')).forEach(function(a){
    a.addEventListener('click', function(){ TBD_STATE.tab = a.dataset.tbdJump; tbdSetHash(); });
  });
}

/* ============================ helpers de formato/HTML ============================ */
function tbdArrow(v25, v26, higherBetter){
  if(v25==null || v26==null) return '';
  var delta = v26-v25, good = higherBetter ? delta>=0 : delta<=0;
  return ' <span style="font-size:10px;font-weight:800;color:'+(good?'#0E7C66':'#B83030')+'">'+(delta>=0?'▲':'▼')+'</span>';
}
function tbdKpiCard(label, v25, v26, fmtFn, higherBetter){
  return '<div class="tbd-kpi-card"><div class="tbd-kpi-label">'+esc(label)+'</div>'+
    '<div class="tbd-kpi-value">'+fmtFn(v25)+' → '+fmtFn(v26)+tbdArrow(v25,v26,higherBetter)+'</div>'+
    '<div class="tbd-kpi-sub">2025 → 2026</div></div>';
}
function tbdCreativeRowsHTML(items, watchLabel){
  return items.map(function(r, i){
    return '<tr><td>'+(i+1)+'</td><td>'+(r.link_video?('<a href="'+escAttr(r.link_video)+'" target="_blank" rel="noopener" style="color:var(--oe);font-weight:700;">▶</a> '):'')+esc(r.nombre)+
      '</td><td><span class="tbd-badge">'+esc(r.ad_type||'—')+'</span></td><td>'+fmtNum(r.l,0)+'</td><td class="tbd-adj">'+fmtNum(r.l1k,1)+'</td>'+
      '<td class="tbd-adj"><b>'+fmtNum(r.l1k_adj,1)+'</b></td><td class="tbd-adj">'+fmt$(r.cpl_adj,2)+'</td><td>'+r.n+'</td><td>'+fmt$(r.s,0)+'</td><td>'+fmtPct(r.cvr,1)+'</td></tr>';
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--ink-faint);padding:16px;">'+T('sin_datos_filtro')+'</td></tr>';
}
function tbdCreativeTableHTML(items, yearLabel){
  return '<div><div style="font-size:11px;font-weight:800;text-transform:uppercase;color:var(--ink-faint);margin-bottom:6px;">'+esc(yearLabel)+' · '+items.length+' creativos</div>'+
    '<div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>#</th><th>Creative</th><th>Type</th><th>Leads</th><th>L/$1k</th><th>L/$1k adj ★</th><th>CPL adj</th><th>Days</th><th>Spend</th><th>CVR</th></tr></thead>'+
    '<tbody>'+tbdCreativeRowsHTML(items)+'</tbody></table></div></div>';
}
function tbdDimTableHTML(rollup, title){
  var rows = rollup.map(function(r){
    return '<tr><td>'+esc(r.label)+'</td><td>'+r.n+'</td><td class="tbd-adj"><b>'+fmtNum(r.l1k_adj,1)+'</b></td><td class="tbd-adj">'+fmt$(r.cpl_adj,2)+'</td><td>'+fmtPct(r.cvr,1)+'</td><td>'+fmt$(r.s,0)+'</td></tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--ink-faint);padding:16px;">'+T('sin_datos_filtro')+'</td></tr>';
  return '<div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>'+esc(title)+'</th><th>Creatives</th><th>L/$1k adj ★</th><th>CPL adj</th><th>CVR</th><th>Spend</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function tbdDimensionPage(data, keyFn, title, subtitle){
  var r25 = tbdDimensionRollup(data.y25, keyFn), r26 = tbdDimensionRollup(data.y26, keyFn);
  return '<h2 class="tbd-section-title">'+esc(title)+'</h2><p style="font-size:12px;color:var(--ink-faint);margin-top:-8px;">'+esc(subtitle)+'</p>'+
    '<div class="tbd-two-col"><div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">Ene–Jul 2025</div>'+tbdDimTableHTML(r25,title)+'</div>'+
    '<div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">Ene–Jul 2026</div>'+tbdDimTableHTML(r26,title)+'</div></div>';
}

/* ============================ render por pestana ============================ */
var TBD_RENDERERS = {
  portfolio: function(data){
    var p25=data.p25, p26=data.p26;
    return '<h2 class="tbd-section-title">'+esc(data.territory)+' · Portfolio · Ene–Jul 2025 vs Ene–Jul 2026</h2>'+
      '<div class="tbd-kpi-grid">'+
      tbdKpiCard('L/$1k adj. ★', p25.l1k_adj, p26.l1k_adj, function(v){return fmtNum(v,1);}, true)+
      tbdKpiCard('CPL adj.', p25.cpl_adj, p26.cpl_adj, function(v){return fmt$(v,2);}, false)+
      tbdKpiCard('CVR', p25.cvr, p26.cvr, function(v){return fmtPct(v,1);}, true)+
      tbdKpiCard('% MNCC', p25.mncc, p26.mncc, function(v){return fmtPct(v,1);}, true)+
      tbdKpiCard('Creativos activos', p25.num_creatives, p26.num_creatives, function(v){return fmtNum(v,0);}, true)+
      '</div>'+
      '<div class="tbd-takeaway">'+tbdPortfolioTakeaway(data)+'</div>'+
      '<div class="tbd-two-col"><div>'+tbdCreativeTableHTML(data.y25.slice(0,10), 'Top 10 · 2025')+'</div><div>'+tbdCreativeTableHTML(data.y26.slice(0,10), 'Top 10 · 2026')+'</div></div>';
  },
  promo: function(data){
    var f = function(items){ return items.filter(function(r){ return r.ad_type==='PROMO'; }); };
    return '<h2 class="tbd-section-title">Top Promo Creatives</h2>'+
      '<div class="tbd-two-col"><div>'+tbdCreativeTableHTML(f(data.y25), 'Promo · 2025')+'</div><div>'+tbdCreativeTableHTML(f(data.y26), 'Promo · 2026')+'</div></div>';
  },
  generic: function(data){
    var f = function(items){ return items.filter(function(r){ return r.ad_type==='GENERIC'; }); };
    return '<h2 class="tbd-section-title">Top Generic Creatives</h2>'+
      '<div class="tbd-two-col"><div>'+tbdCreativeTableHTML(f(data.y25), 'Generic · 2025')+'</div><div>'+tbdCreativeTableHTML(f(data.y26), 'Generic · 2026')+'</div></div>';
  },
  pvg: function(data){ return tbdDimensionPage(data, function(r){ return r.ad_type==='PROMO'?'Promo Ads':'Generic Ads'; }, 'Promo vs Generic', 'Comparación de performance entre creativos con oferta explícita y creativos sin oferta.'); },
  tone: function(data){ return tbdDimensionPage(data, function(r){ return r.tone_category||'—'; }, 'Tone', 'Humor, Motivational, Corporative, Commemorative.'); },
  hooks: function(data){
    return '<h2 class="tbd-section-title">Hooks</h2>'+
      tbdDimensionPage(data, function(r){ return r.hook_audio_type_code||'—'; }, 'Audio Hook Type', 'Cómo se abre el audio del creativo.')+
      '<div style="height:18px;"></div>'+
      tbdDimensionPage(data, function(r){ return r.hook_visual_type_code||'—'; }, 'Visual Hook Type', 'Cómo se abre visualmente el creativo.');
  },
  versions: function(data){ return tbdDimensionPage(data, function(r){ return r.version ? ('V'+r.version) : 'V1'; }, 'Versions', 'V1 vs versiones posteriores (V2/V3) del mismo concepto.'); },
  campaigns: function(data){ return tbdDimensionPage(data, function(r){ return r.campaign_name||'—'; }, 'Campaigns', 'Performance agrupado por campaña.'); },
  promo_type: function(data){ return tbdDimensionPage(data, function(r){ return r.ad_type==='PROMO' ? (r.pain_point||'—') : null; }, 'Promo Type', 'Solo creativos Promo, agrupados por oferta.'); },
  theme: function(data){ return tbdDimensionPage(data, function(r){ return r.theme||'—'; }, 'Theme', 'Mecanismo temático del creativo.'); },
  ai_vs_real: function(data){ return tbdDimensionPage(data, function(r){ return r.type_of_production||'—'; }, 'AI vs Real', 'Producción con IA generativa vs. filmación/B-roll real.'); },
  jrhalo: function(data){
    var r25 = data.y25.slice().sort(function(a,b){return b.jr_l1k_adj-a.jr_l1k_adj;});
    var r26 = data.y26.slice().sort(function(a,b){return b.jr_l1k_adj-a.jr_l1k_adj;});
    var rows = function(items){ return items.map(function(r){
      return '<tr><td>'+esc(r.nombre)+'</td><td>'+fmtNum(r.jr_l,1)+'</td><td class="tbd-adj"><b>'+fmtNum(r.jr_l1k_adj,1)+'</b></td><td>'+fmtNum(r.l1k_adj,1)+'</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint);padding:16px;">'+T('sin_datos_filtro')+'</td></tr>'; };
    return '<h2 class="tbd-section-title">JR Halo — leads de Open English Junior generados por la inversión de Open English</h2>'+
      '<p style="font-size:12px;color:var(--ink-faint);margin-top:-8px;">JR L/$1k adj. = leads reales de Open English Junior atribuidos a marketing_organization=OE, prorrateados por el mismo % de rotación del creativo, ÷ el gasto de Open English, ajustado por demanda. OE L/$1k adj. es la referencia (performance propio del mismo creativo).</p>'+
      '<div class="tbd-two-col"><div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">Ene–Jul 2025</div><div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>Creative</th><th>JR Leads</th><th>JR L/$1k adj ★</th><th>OE L/$1k adj (ref)</th></tr></thead><tbody>'+rows(r25)+'</tbody></table></div></div>'+
      '<div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">Ene–Jul 2026</div><div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>Creative</th><th>JR Leads</th><th>JR L/$1k adj ★</th><th>OE L/$1k adj (ref)</th></tr></thead><tbody>'+rows(r26)+'</tbody></table></div></div></div>';
  },
  launch: function(data){
    var build = function(items){ return items.map(function(r){ var lw = tbdLaunchWeek(r); return {nombre:r.nombre, lw:lw}; }).filter(function(x){return x.lw;}).sort(function(a,b){return b.lw.l1k_adj-a.lw.l1k_adj;}); };
    var rows = function(list){ return list.map(function(x){
      return '<tr><td>'+esc(x.nombre)+'</td><td>'+x.lw.n+'</td><td class="tbd-adj"><b>'+fmtNum(x.lw.l1k_adj,1)+'</b></td><td>'+fmt$(x.lw.cpl_adj,2)+'</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint);padding:16px;">'+T('sin_datos_filtro')+'</td></tr>'; };
    return '<h2 class="tbd-section-title">Launch Week — primeros 7 días calendario desde el lanzamiento</h2>'+
      '<div class="tbd-two-col"><div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">2025</div><div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>Creative</th><th>TV-on days</th><th>L/$1k adj ★</th><th>CPL adj</th></tr></thead><tbody>'+rows(build(data.y25))+'</tbody></table></div></div>'+
      '<div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">2026</div><div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>Creative</th><th>TV-on days</th><th>L/$1k adj ★</th><th>CPL adj</th></tr></thead><tbody>'+rows(build(data.y26))+'</tbody></table></div></div></div>';
  },
  wearout: function(data){
    var build = function(items){ return items.map(function(r){ var w = tbdWearout(r); return {nombre:r.nombre, w:w}; }).filter(function(x){return x.w.pct!=null;}).sort(function(a,b){return a.w.pct-b.w.pct;}); };
    var rows = function(list){ return list.map(function(x){
      var flag = x.w.pct<-20 ? ' <span style="color:#B83030;font-weight:800;">⚠ pull</span>' : '';
      return '<tr><td>'+esc(x.nombre)+'</td><td>'+fmtNum(x.w.h1.l1k_adj,1)+'</td><td>'+fmtNum(x.w.h2.l1k_adj,1)+'</td><td class="tbd-adj"><b>'+fmtPct(x.w.pct/100,1)+'</b>'+flag+'</td></tr>';
    }).join('') || '<tr><td colspan="4" style="text-align:center;color:var(--ink-faint);padding:16px;">'+T('sin_datos_filtro')+'</td></tr>'; };
    return '<h2 class="tbd-section-title">Wear-Out — primera mitad (H1) vs segunda mitad (H2) del flight, por conteo de días</h2>'+
      '<p style="font-size:12px;color:var(--ink-faint);margin-top:-8px;">Caída &gt;20% en L/$1k adj. de H1 a H2 = señal de desgaste real (ya ajustado por estacionalidad).</p>'+
      '<div class="tbd-two-col"><div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">2025</div><div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>Creative</th><th>H1 adj</th><th>H2 adj</th><th>Δ%</th></tr></thead><tbody>'+rows(build(data.y25))+'</tbody></table></div></div>'+
      '<div><div style="font-weight:700;font-size:12px;margin-bottom:6px;">2026</div><div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>Creative</th><th>H1 adj</th><th>H2 adj</th><th>Δ%</th></tr></thead><tbody>'+rows(build(data.y26))+'</tbody></table></div></div></div>';
  },
  seasonality: function(data){
    var s = TBD_SEASONALITY[data.territory];
    if(!s) return '<p>Sin datos de estacionalidad para '+esc(data.territory)+'.</p>';
    var months = ['Ene','Feb','Mar','Abr','May','Jun','Jul'];
    var rows25 = s.jan_jul_2025, rows26 = s.jan_jul_2026;
    var maxv = Math.max.apply(null, rows25.concat(rows26));
    function bar(v){ return '<div style="display:flex;align-items:center;gap:8px;"><div style="width:34px;font-size:11px;color:var(--ink-faint);">'+fmtNum(v,0)+'</div><div style="flex:1;background:var(--border-soft);border-radius:4px;height:14px;"><div style="height:100%;border-radius:4px;background:#0E7C66;width:'+Math.max(2,v/maxv*100)+'%;"></div></div></div>'; }
    var body = months.map(function(m,i){ return '<tr><td>'+m+'</td><td>'+bar(rows25[i])+'</td><td>'+bar(rows26[i])+'</td></tr>'; }).join('');
    return '<h2 class="tbd-section-title">Índice de Estacionalidad (Ahrefs) — '+esc(data.territory)+'</h2>'+
      '<p style="font-size:12px;color:var(--ink-faint);margin-top:-8px;">100 = promedio del volumen de búsqueda mensual de "open english" + "cursos de ingles" desde enero 2023. Un mes con índice 130 tiene 30% más demanda natural que el promedio, independiente de cuánto se invierta en TV.</p>'+
      '<div style="overflow-x:auto;"><table class="tbd-table"><thead><tr><th>Mes</th><th>2025</th><th>2026</th></tr></thead><tbody>'+body+'</tbody></table></div>'+
      '<div class="tbd-takeaway">'+tbdSeasonalityTakeaway(data.territory, rows25, rows26)+'</div>';
  },
  insights: function(data){ return tbdInsightsHTML(data); },
  tests: function(data){ return tbdTestsHTML(data); },
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
function tbdBestOf(items){ return items.length ? items[0] : null; } // ya viene sorted por l1k_adj desc
function tbdInsightsHTML(data){
  var cards = [];
  var best25 = tbdBestOf(data.y25), best26 = tbdBestOf(data.y26);
  if(best26) cards.push({icon:'★', title:'Mejor creativo 2026', body:'"'+best26.nombre+'" lidera '+data.territory+' en 2026 con L/$1k ajustado de '+fmtNum(best26.l1k_adj,1)+' ('+best26.n+' días activos).'});
  if(best25) cards.push({icon:'✓', title:'Mejor creativo 2025', body:'"'+best25.nombre+'" fue el mejor de 2025 (L/$1k adj. '+fmtNum(best25.l1k_adj,1)+').'});
  var tone26 = tbdDimensionRollup(data.y26, function(r){return r.tone_category||null;});
  if(tone26.length>1){
    var bestTone = tone26[0], worstTone = tone26[tone26.length-1];
    var gap = worstTone.l1k_adj>0 ? (bestTone.l1k_adj-worstTone.l1k_adj)/worstTone.l1k_adj*100 : null;
    if(gap!=null) cards.push({icon:'→', title:'Tono ganador 2026', body:'"'+bestTone.label+'" rinde '+fmtNum(gap,0)+'% mejor que "'+worstTone.label+'" (L/$1k adj. '+fmtNum(bestTone.l1k_adj,1)+' vs '+fmtNum(worstTone.l1k_adj,1)+').'});
  }
  var ver26 = tbdDimensionRollup(data.y26, function(r){return r.version? 'V'+r.version : null;});
  var v1 = ver26.filter(function(x){return x.label==='V1';})[0];
  var vN = ver26.filter(function(x){return x.label!=='V1';}).sort(function(a,b){return b.n-a.n;})[0];
  if(v1 && vN){
    var vgap = (vN.l1k_adj-v1.l1k_adj)/v1.l1k_adj*100;
    cards.push({icon: vgap<0?'✗':'✓', title:'Versiones (V2/V3) vs original', body:'Las versiones posteriores rinden '+fmtNum(Math.abs(vgap),0)+'% '+(vgap<0?'peor':'mejor')+' que el V1 original (L/$1k adj. '+fmtNum(vN.l1k_adj,1)+' vs '+fmtNum(v1.l1k_adj,1)+').'});
  }
  var wo26 = data.y26.map(function(r){ return {nombre:r.nombre, w:tbdWearout(r)}; }).filter(function(x){return x.w.pct!=null && x.w.pct<-20;}).sort(function(a,b){return a.w.pct-b.w.pct;});
  if(wo26.length) cards.push({icon:'⚠', title:'Desgaste detectado en 2026', body:'"'+wo26[0].nombre+'" cayó '+fmtNum(Math.abs(wo26[0].w.pct),0)+'% de la primera a la segunda mitad de su flight (ya ajustado por estacionalidad) — candidato a pausa o refresh.'});
  var jrSorted = data.y26.slice().sort(function(a,b){return b.jr_l-a.jr_l;});
  if(jrSorted.length && jrSorted[0].jr_l>0) cards.push({icon:'♦', title:'JR Halo', body:'"'+jrSorted[0].nombre+'" (creativo de Open English adulto) generó '+fmtNum(jrSorted[0].jr_l,0)+' leads reales de Open English Junior en 2026 — el mayor halo cruzado del portafolio.'});
  if(!cards.length) return '<p style="color:var(--ink-faint);">No hay suficientes datos en '+esc(data.territory)+' para generar insights confiables en este período.</p>';
  return '<h2 class="tbd-section-title">Insights — '+esc(data.territory)+'</h2><div class="tbd-two-col">'+cards.map(function(c){
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
  return '<h2 class="tbd-section-title">Tests Recomendados — '+esc(data.territory)+' (2026)</h2>'+
    '<div class="tbd-two-col">'+col(testsA,'A · Con creativos existentes (sin producción)')+col(testsB,'B · Requiere producción nueva')+'</div>';
}
function tbdMethodologyHTML(){
  return '<h2 class="tbd-section-title">Cómo se construyó TBD Dolo</h2>'+
    '<div class="card" style="font-size:12.5px; line-height:1.7;">'+
    '<p><b>Fuente de datos:</b> los mismos 4 JSON en vivo (OE-LATAM, OE-BR, JR-LATAM, JR-BR) + rotación + taxonomía que usa el dashboard "TV Ads Performance" — misma matemática ya validada, sin recalcular nada distinto. Ver <code>Documentacion/03_ESTADO_ACTUAL_Y_MATEMATICA.md</code>.</p>'+
    '<p><b>Organization:</b> fija en Open English (adulto) — igual alcance que el reporte de referencia.</p>'+
    '<p><b>Período:</b> siempre Enero 1 – Julio 31, comparando 2025 vs 2026, filtrado por región/país.</p>'+
    '<p><b>SEM-Brand:</b> siempre excluido del gasto (regla permanente, no es un interruptor aquí).</p>'+
    '<p><b>Ajuste por demanda (adj.):</b> L/$1k adj. = L/$1k crudo ÷ (Índice de Estacionalidad/100). El índice sale de Ahrefs (volumen de búsqueda mensual real de "open english" + "cursos de ingles" por país, normalizado a 100 = promedio desde enero 2023) — reemplaza a Google Trends que usaba el reporte de referencia.</p>'+
    '<p><b>JR Halo:</b> leads reales de Open English Junior (su propio archivo de deck) etiquetados con marketing_organization="OE", prorrateados con el mismo % de rotación del creativo de Open English adulto ese día.</p>'+
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
function tbdDownloadPPT(){
  tbdEnsurePptxLib(function(){
    var data = tbdCurrentData();
    var pres = new PptxGenJS();
    pres.defineLayout({ name:'WIDE', width:13.3, height:7.5 });
    pres.layout = 'WIDE';
    var s1 = pres.addSlide();
    s1.background = { color:'12234F' };
    s1.addText('TBD Dolo — '+data.territory, { x:0.5,y:0.4,w:12.3,h:0.6, fontSize:24, bold:true, color:'FFFFFF' });
    s1.addText('Enero–Julio 2025 vs Enero–Julio 2026 · Open English · Brand TV Channels', { x:0.5,y:1.0,w:12.3,h:0.4, fontSize:13, color:'C9D6EC' });
    var kpis = [
      ['L/$1k adj.', fmtNum(data.p25.l1k_adj,1)+' → '+fmtNum(data.p26.l1k_adj,1)],
      ['CPL adj.', fmt$(data.p25.cpl_adj,2)+' → '+fmt$(data.p26.cpl_adj,2)],
      ['CVR', fmtPct(data.p25.cvr,1)+' → '+fmtPct(data.p26.cvr,1)],
      ['% MNCC', fmtPct(data.p25.mncc,1)+' → '+fmtPct(data.p26.mncc,1)],
      ['Creativos', data.p25.num_creatives+' → '+data.p26.num_creatives],
    ];
    kpis.forEach(function(k,i){
      var x = 0.5 + i*2.5;
      s1.addShape(pres.ShapeType.rect, { x:x, y:1.7, w:2.3, h:1.3, fill:{color:'1A3566'}, line:{color:'1A3566'} });
      s1.addText(k[0], { x:x+0.1,y:1.8,w:2.1,h:0.3, fontSize:9, color:'8FA6D6', bold:true });
      s1.addText(k[1], { x:x+0.1,y:2.15,w:2.1,h:0.6, fontSize:15, color:'FFFFFF', bold:true });
    });
    var takeawayTxt = tbdPortfolioTakeaway(data).replace(/<[^>]+>/g,'');
    s1.addText(takeawayTxt, { x:0.5,y:3.3,w:12.3,h:1.4, fontSize:12, color:'FFFFFF', fill:{color:'0E7C66'}, align:'left', valign:'top', margin:10 });

    var s2 = pres.addSlide();
    s2.addText('Top Creatives — 2026', { x:0.5,y:0.3,w:12.3,h:0.5, fontSize:18, bold:true, color:'12234F' });
    var top = data.y26.slice(0,10).map(function(r,i){ return [String(i+1), r.nombre, r.ad_type||'—', fmtNum(r.l1k_adj,1), fmt$(r.cpl_adj,2), fmtPct(r.cvr,1)]; });
    s2.addTable([['#','Creative','Type','L/$1k adj','CPL adj','CVR']].concat(top), { x:0.5,y:0.9,w:12.3,h:5.5, fontSize:10, border:{type:'solid',color:'DDDDDD',pt:0.5}, autoPage:false });

    var s3 = pres.addSlide();
    s3.addText('Insights', { x:0.5,y:0.3,w:12.3,h:0.5, fontSize:18, bold:true, color:'12234F' });
    var insightsTxt = tbdInsightsHTML(data).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
    s3.addText(insightsTxt.slice(0, 1400), { x:0.5,y:1.0,w:12.3,h:5.8, fontSize:12, color:'333333', valign:'top' });

    pres.writeFile({ fileName: 'TBD_Dolo_'+data.territory.replace(/\s+/g,'_')+'_2025_vs_2026.pptx' });
  });
}
