"use strict";
/* ============================================================
   App layer: i18n (EN/ES/PT), filtros (sidebar vertical), tabs,
   render de ranking/rollups/explorador, modales. Gran parte de la
   logica de calculo/rollup/modal esta portada 1:1 del dashboard
   anterior (dashboard_v7_tetsu_template.html) -- lo que cambia es
   el layout (sidebar), el idioma (+PT), la fuente de datos (motor
   en vivo via engine.js) y la lista de tabs (columnas del Excel
   STANDARD nuevo en vez de la taxonomia OE/TETSU vieja).
   ============================================================ */

function esc(s){ return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;'); }
function escAttr(s){ return esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function fmt$(v,d){ if(v==null) return '—'; d=d==null?0:d; return '$'+v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function fmtPct(v,d){ if(v==null) return '—'; d=d==null?1:d; return (v*100).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d})+'%'; }
function fmtNum(v,d){ if(v==null) return '—'; d=d==null?1:d; return v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}); }
function sumField(arr,f){ return arr.reduce(function(s,d){ return s+(d[f]||0); },0); }
function videoLinkHTML(link, labeled){
  if(!link) return '';
  var label = T('ver_video');
  if(labeled) return '<a class="video-link-pill" href="'+escAttr(link)+'" target="_blank" rel="noopener">▶ '+label+'</a>';
  return '<a class="video-link" href="'+escAttr(link)+'" target="_blank" rel="noopener" title="'+label+'">▶</a>';
}

/* ============================ metricas de exito ============================ */
var METRIC_DEFS = {
  leads_per_1k: { en:'Leads per $1,000', es:'Leads x $1,000', pt:'Leads por US$1.000', short:'Leads/$1k', higherIsBetter:true, isMargin:false, icon:'🎯', fmt:function(v){ return v==null?'—':fmtNum(v,1); } },
  cpl: { en:'CPL (cost per lead)', es:'CPL (costo por lead)', pt:'CPL (custo por lead)', short:'CPL', higherIsBetter:false, isMargin:false, icon:'💵', fmt:function(v){ return fmt$(v,2); } },
  cvr: { en:'Conversion (sales / leads)', es:'Conversión (ventas / leads)', pt:'Conversão (vendas / leads)', short:'CVR', higherIsBetter:true, isMargin:false, icon:'📈', fmt:function(v){ return fmtPct(v,1); } },
  mncc_core_pct: { en:'Margin', es:'Margen', pt:'Margem', short:'Margin', higherIsBetter:true, isMargin:true, icon:'💰', fmt:function(v){ return fmtPct(v,1); } },
};
var METRIC_ORDER = ['leads_per_1k','cpl','cvr','mncc_core_pct'];
function metricLabel(key){ return METRIC_DEFS[key][LANG]; }
function metricShort(key){ return METRIC_DEFS[key].short; }
function metricFmt(key,v){ return METRIC_DEFS[key].fmt(v); }
function metricsFromSums(sums){
  var adcost=sums.adcost||0, leads=sums.leads||0, core=sums.core_enrollments||0, newCash=sums.new_cash_core||0;
  return { leads_per_1k: adcost?leads/adcost*1000:null, cpl: leads?adcost/leads:null, cvr: leads?core/leads:null, mncc_core_pct: newCash?(newCash-adcost)/newCash:null };
}

/* ============================ color por ranking ============================ */
function cv(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function computeMinMax(rows, metric){
  var vals = rows.map(function(r){ return r[metric]; }).filter(function(v){ return v!=null; });
  if(METRIC_DEFS[metric].isMargin) vals = vals.filter(function(v){ return v>=0; });
  if(!vals.length) return {min:0,max:0};
  return {min:Math.min.apply(null,vals), max:Math.max.apply(null,vals)};
}
function rankColorCSS(metric, value, minMax){
  if(value==null) return cv('--border');
  if(METRIC_DEFS[metric].isMargin && value<0) return cv('--bad');
  var min=minMax.min, max=minMax.max;
  var frac = (max===min)?0:(value-min)/(max-min);
  if(!METRIC_DEFS[metric].higherIsBetter) frac = 1-frac;
  frac = 1-frac;
  var pct = Math.round(Math.max(0,Math.min(1,frac))*100);
  return 'color-mix(in srgb, '+cv('--rank-blue-weak')+' '+pct+'%, '+cv('--rank-blue-strong')+' '+(100-pct)+'%)';
}
function colorLegendHTML(metric){
  var html = '<div class="color-legend"><span>'+T('mejor')+'</span><div class="legend-gradient"></div><span>'+T('peor')+'</span>';
  if(METRIC_DEFS[metric].isMargin) html += '<span class="legend-red-chip"><span class="legend-swatch" style="background:'+cv('--bad')+'"></span>'+T('margen_negativo')+'</span>';
  html += '</div>';
  return html;
}

/* ============================ i18n ============================ */
var STR = {
  metrica_exito:{en:'Success metric',es:'Medir éxito por',pt:'Medir sucesso por'},
  ventana:{en:'Window',es:'Ventana',pt:'Janela'},
  historico_completo:{en:'Full history',es:'Histórico completo',pt:'Histórico completo'},
  primera_semana:{en:'First week',es:'Primera semana',pt:'Primeira semana'},
  ad_type:{en:'Ad Type',es:'Ad Type',pt:'Ad Type'},
  todos:{en:'All',es:'Todos',pt:'Todos'},
  fecha:{en:'Date',es:'Fecha',pt:'Data'},
  anio:{en:'Year',es:'Año',pt:'Ano'},
  trimestre:{en:'Quarter',es:'Trimestre',pt:'Trimestre'},
  marca:{en:'Brand',es:'Marca',pt:'Marca'},
  organizacion:{en:'Organization',es:'Organization',pt:'Organization'},
  mktorg:{en:'MarketingOrganization',es:'MarketingOrganization',pt:'MarketingOrganization'},
  lugar:{en:'Place',es:'Lugar',pt:'Local'},
  region:{en:'Region',es:'Región',pt:'Região'},
  pais:{en:'Country',es:'País',pt:'País'},
  latam:{en:'LATAM',es:'LATAM',pt:'LATAM'}, brazil:{en:'Brazil',es:'Brasil',pt:'Brasil'},
  v_ranking:{en:'Ranking',es:'Ranking',pt:'Ranking'}, v_explorador:{en:'Explorer',es:'Explorador',pt:'Explorador'},
  v_theme:{en:'Theme',es:'Theme',pt:'Theme'}, v_pain_point:{en:'Pain Point',es:'Pain Point',pt:'Pain Point'},
  v_type_of_production:{en:'Type of Production',es:'Type of Production',pt:'Type of Production'},
  v_tone_category:{en:'Tone',es:'Tono',pt:'Tom'}, v_campaign_name:{en:'Campaign',es:'Campaña',pt:'Campanha'},
  v_theme_mechanism:{en:'Creative Mechanism',es:'Mecanismo Creativo',pt:'Mecanismo Criativo'},
  v_hook_audio_type:{en:'Audio Hook Type',es:'Tipo de Hook de Audio',pt:'Tipo de Hook de Áudio'},
  v_hook_visual_type:{en:'Visual Hook Type',es:'Tipo de Hook Visual',pt:'Tipo de Hook Visual'},
  v_cta_type:{en:'CTA Type',es:'Tipo de CTA',pt:'Tipo de CTA'},
  new_chip:{en:'NEW',es:'NUEVA',pt:'NOVA'},
  creativos_activos_en:{en:'active creatives in',es:'creativos activos en',pt:'criativos ativos em'},
  buscar:{en:'Search by name or dimension…',es:'Buscar por nombre o dimensión…',pt:'Buscar por nome ou dimensão…'},
  de:{en:'of',es:'de',pt:'de'}, creativos:{en:'creatives',es:'creativos',pt:'criativos'},
  click_ordenar:{en:'Click a header to sort',es:'Click en un encabezado para ordenar',pt:'Clique num cabeçalho para ordenar'},
  dias_activos:{en:'active days',es:'días activos',pt:'dias ativos'},
  ver_definicion:{en:'See detail',es:'Ver detalle',pt:'Ver detalhe'}, ver_video:{en:'Watch video',es:'Ver video',pt:'Ver vídeo'},
  nombre:{en:'Creative',es:'Creativo',pt:'Criativo'}, dias:{en:'Days',es:'Días',pt:'Dias'},
  trazabilidad:{en:'Day-by-day traceability',es:'Trazabilidad día por día',pt:'Rastreabilidade dia a dia'},
  acompanado_por:{en:'Ran alongside',es:'Acompañado por',pt:'Rodou junto com'},
  leads:{en:'leads',es:'leads',pt:'leads'},
  lanzamiento:{en:'Launch',es:'Lanzamiento',pt:'Lançamento'},
  pais_hint:{en:'Click: only that country · Ctrl+click: add/remove · Click and drag: select the range',es:'Clic: solo ese país · Ctrl+clic: agrega/quita · Clic y arrastra: selecciona el rango',pt:'Clique: só esse país · Ctrl+clique: adiciona/remove · Clique e arraste: seleciona o intervalo'},
  mejor:{en:'Best',es:'Mejor',pt:'Melhor'}, peor:{en:'Worst',es:'Peor',pt:'Pior'},
  margen_negativo:{en:'Negative margin',es:'Margen negativo',pt:'Margem negativa'},
  sin_datos_filtro:{en:'No creative has data under this filter combination.',es:'Ningún creativo tiene datos con esta combinación de filtros.',pt:'Nenhum criativo tem dados com esta combinação de filtros.'},
  spend_total:{en:'Total spend',es:'Gasto total',pt:'Gasto total'}, leads_total:{en:'Total leads',es:'Leads totales',pt:'Leads totais'},
  ventas_total:{en:'Total sales',es:'Ventas totales',pt:'Vendas totais'}, margen_total:{en:'Margin',es:'Margen',pt:'Margem'},
  footer_note:{en:'Every metric is the SUM of all active days under the active filters, never an average. Brand, region and country are never mixed.',
    es:'Cada métrica es la SUMA de todos los días activos bajo los filtros activos, nunca un promedio. Marca, región y país nunca se mezclan.',
    pt:'Cada métrica é a SOMA de todos os dias ativos sob os filtros ativos, nunca uma média. Marca, região e país nunca se misturam.'},
  footer_src:{en:'Source: live daily KPI export + rotation × Standard creative-analysis Excel, joined client-side on every filter change.',
    es:'Fuente: export diario de KPIs en vivo + rotación × Excel STANDARD de análisis de creativos, cruzados en el cliente en cada cambio de filtro.',
    pt:'Fonte: export diário de KPIs ao vivo + rotação × Excel STANDARD de análise de criativos, cruzados no cliente a cada mudança de filtro.'},
};
var LANG = 'en';
function T(key){ var e = STR[key]; return e ? (e[LANG]||e.en) : key; }

/* Traduccion de dimensiones/etiquetas de taxonomia: lookup por CODIGO (no por
   el texto en un idioma especifico, mas robusto que el esquema anterior). */
var TAX_LOOKUP = {}; // dim -> code -> {en,es,pt,def_en,def_es,def_pt}
function TAX(dim, code){ if(code==null) return '—'; var d=TAX_LOOKUP[dim]; var e=d&&d[code]; return (e&&e[LANG]) || code; }
function DEF(dim, code){ var d=TAX_LOOKUP[dim]; var e=d&&d[code]; return e && e['def_'+LANG]; }

/* ============================ state ============================ */
var STATE = {
  year:'2026', metric:'leads_per_1k',
  semana1:false, adType:'Todos', quarter:'Todos',
  organization:'Open English', marketingOrg:['Open English'],
  region:'Latam', paisSel:[],
  view:'ranking',
};
var MARKETING_ORGS = ['Open English','Open English Junior'];
var ORGANIZATIONS = ['Open English','Open English Junior'];
var QUARTERS = ['Todos','Q1','Q2','Q3','Q4'];
var AD_TYPES = ['Todos','PROMO','GENERIC'];
var COUNTRIES = [];
var YEAR_OPTIONS = [];
var YEARS_DATA = {};

function organizationColor(org){ if(org==='Open English Junior') return cv('--oejr'); if(org==='Open English') return cv('--oe'); return cv('--neutral-bar'); }
function updateAccent(){ document.documentElement.style.setProperty('--accent', organizationColor(STATE.organization)); }
function currentYearData(){ return YEARS_DATA[STATE.year] || {slices:{}}; }

/* ============================ filtros: recalculo 100% client-side ============================ */
function quarterOf(fecha){ return 'Q'+(Math.floor((+fecha.slice(5,7)-1)/3)+1); }
function dayPassesQuarter(fecha){ return STATE.quarter==='Todos' || quarterOf(fecha)===STATE.quarter; }
function dayPassesSemana1(fecha, fechaLanzamiento){
  if(!STATE.semana1 || !fechaLanzamiento) return true;
  var diff = Math.round((Date.parse(fecha+'T00:00:00Z') - Date.parse(fechaLanzamiento+'T00:00:00Z'))/86400000);
  return diff>=0 && diff<=6;
}
function dayPassesPais(topcountry){ if(topcountry==null) return true; return STATE.paisSel.indexOf(topcountry)!==-1; }
function recomputeCreative(row){
  var days = (row.detalle_diario||[]).filter(function(d){ return dayPassesQuarter(d.fecha) && dayPassesSemana1(d.fecha,row.fecha_lanzamiento) && dayPassesPais(d.topcountry); });
  var sums = { adcost:sumField(days,'adcost'), leads:sumField(days,'leads'), core_enrollments:sumField(days,'core_enrollments'), new_cash_core:sumField(days,'new_cash_core') };
  var out = Object.assign({}, row, sums, metricsFromSums(sums));
  out.num_dias_activos = new Set(days.map(function(d){ return d.fecha; })).size;
  out.detalle_diario = days;
  return out;
}
function getWorkingCreatives(){
  var yearData = currentYearData();
  var all = [];
  STATE.marketingOrg.forEach(function(marca){
    var slice = yearData.slices[marca+'|'+STATE.region+'|Total'];
    if(slice) (slice.ranking_creativos||[]).forEach(function(r){ all.push(r); });
  });
  all = all.filter(function(r){ return r.marca === STATE.organization; });
  if(STATE.adType !== 'Todos') all = all.filter(function(r){ return r.ad_type === STATE.adType; });
  return all.map(recomputeCreative).filter(function(r){ return r.num_dias_activos>0; });
}
function computeRollup(creatives, dim){
  var groups = {};
  creatives.forEach(function(r){
    var val = r[dim];
    if(val==null || val==='' || val==='-') return;
    (groups[val] = groups[val] || []).push(r);
  });
  var out = {};
  Object.keys(groups).forEach(function(key){
    var mem = groups[key];
    var sums = { adcost:sumField(mem,'adcost'), leads:sumField(mem,'leads'), core_enrollments:sumField(mem,'core_enrollments'), new_cash_core:sumField(mem,'new_cash_core') };
    var agg = Object.assign({}, sums, metricsFromSums(sums));
    agg.num_creativos = mem.length; agg._members = mem;
    out[key] = agg;
  });
  return out;
}

/* ============================ dimension tabs: se auto-detectan segun lo que exista en los datos ============================
   Esto hace que el dashboard funcione HOY con el stub de taxonomia (solo ad_type/campaign)
   y automaticamente muestre mas tabs cuando se despliegue tvads-creative-taxonomy.json
   completo (theme, pain_point, type_of_production, tone_category, y las 4 categorias nuevas). */
var CANDIDATE_DIMS = [
  {key:'theme', field:'theme', isNew:false},
  {key:'pain_point', field:'pain_point_code', isNew:false},
  {key:'type_of_production', field:'type_of_production', isNew:false},
  {key:'tone_category', field:'tone_category', isNew:false},
  {key:'campaign_name', field:'campaign_name', isNew:false},
  {key:'theme_mechanism', field:'theme_mechanism_code', isNew:true},
  {key:'hook_audio_type', field:'hook_audio_type_code', isNew:true},
  {key:'hook_visual_type', field:'hook_visual_type_code', isNew:true},
  {key:'cta_type', field:'cta_type_code', isNew:true},
];
function availableDimTabs(creatives){
  return CANDIDATE_DIMS.filter(function(d){ return creatives.some(function(r){ return r[d.field]!=null && r[d.field]!=='' && r[d.field]!=='-'; }); });
}

/* ============================ metrics grid (usado en modales) ============================ */
function formulaText(key,item){
  var leads=fmtNum(item.leads,0), adcost=fmt$(item.adcost,0), core=fmtNum(item.core_enrollments,0), newCash=fmt$(item.new_cash_core,0);
  if(key==='leads_per_1k') return leads+' leads ÷ '+adcost+' × 1,000';
  if(key==='cpl') return adcost+' ÷ '+leads+' leads';
  if(key==='cvr') return core+' '+T('ventas_total')+' ÷ '+leads+' leads';
  if(key==='mncc_core_pct') return '('+newCash+' − '+adcost+') ÷ '+newCash;
  return '';
}
function metricsGridHTML(item){
  if(!item) return '';
  return '<div class="metrics-grid">'+METRIC_ORDER.map(function(key){
    var val=item[key], active=key===STATE.metric, negative=METRIC_DEFS[key].isMargin && val!=null && val<0;
    return '<div class="metric-card'+(active?' active':'')+(negative?' negative':'')+'">'+
      '<div class="metric-card-head"><span>'+METRIC_DEFS[key].icon+'</span><span>'+metricLabel(key)+'</span></div>'+
      '<div class="metric-card-val">'+metricFmt(key,val)+'</div>'+
      '<div class="metric-card-formula">'+formulaText(key,item)+'</div>'+
    '</div>';
  }).join('')+'</div>';
}

/* ============================ modal: definicion de dimension ============================ */
window.__creativeRowLookup = {}; window.__defMetricsLookup = {};
function openModal(dim, code, metrics){
  var members = (metrics && metrics._members) || [];
  var hasMembers = members.length>0;
  document.getElementById('modal-card').classList.toggle('wide', hasMembers);
  var def = DEF(dim, code);
  document.getElementById('modal-eyebrow').textContent = T('v_'+dim) || dim;
  document.getElementById('modal-title').textContent = TAX(dim, code);
  var html = metricsGridHTML(metrics);
  if(def) html += '<p style="margin-top:4px;">'+esc(def)+'</p>';
  if(hasMembers){
    var activeMetric = STATE.metric;
    members = members.slice().sort(function(a,b){ var av=a[activeMetric],bv=b[activeMetric]; if(av==null) return 1; if(bv==null) return -1; return METRIC_DEFS[activeMetric].higherIsBetter?(bv-av):(av-bv); });
    html += '<p style="margin-top:12px; font-size:12.5px; color:var(--ink-faint);">'+colorLegendHTML(activeMetric)+'</p>';
    var minMax = computeMinMax(members, activeMetric);
    html += '<div class="table-wrap"><table class="data-table"><thead><tr><th></th><th>'+T('nombre')+'</th><th class="num">'+T('dias')+'</th>'+
      METRIC_ORDER.map(function(k){ return '<th class="num">'+METRIC_DEFS[k].icon+' '+metricShort(k)+'</th>'; }).join('')+'</tr></thead><tbody>'+
      members.map(function(m){
        var color = rankColorCSS(activeMetric, m[activeMetric], minMax);
        return '<tr><td><span class="legend-swatch" style="background:'+color+'"></span></td><td><button class="link-btn" data-daily-detail="'+escAttr(m.nombre)+'">'+esc(m.nombre)+'</button> '+videoLinkHTML(m.link_video)+'</td>'+
          '<td class="num">'+m.num_dias_activos+'</td>'+METRIC_ORDER.map(function(k){ return '<td class="num">'+metricFmt(k,m[k])+'</td>'; }).join('')+'</tr>';
      }).join('')+'</tbody></table></div>';
    members.forEach(function(m){ window.__creativeRowLookup[m.nombre]=m; });
  }
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-backdrop').classList.add('open');
}
function closeModal(){ document.getElementById('modal-backdrop').classList.remove('open'); }
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-backdrop').addEventListener('click', function(e){ if(e.target.id==='modal-backdrop') closeModal(); });
document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeModal(); });

/* ============================ modal: trazabilidad diaria (agrupada por tanda continua) ============================ */
function meanArr(arr){ var v=arr.filter(function(x){return x!=null;}); return v.length? v.reduce(function(s,x){return s+x;},0)/v.length : null; }
function daySignature(d){ return (d.companions||[]).map(function(c){return c.nombre;}).sort().join('|'); }
/* Un creativo bajo el tag generico "Rotacion Latam" tiene UNA fila de
   detalle_diario por cada pais libre ese dia (topcountry granular) -- antes
   de agrupar por tanda continua hay que consolidar esas filas en UNA sola
   por fecha calendario (sumando metricas, promediando companions), o el
   mismo dia aparece repetido una vez por pais en la trazabilidad. */
function consolidateByDate(days){
  var byFecha = {};
  days.forEach(function(d){
    var acc = byFecha[d.fecha];
    if(!acc){ acc = { fecha:d.fecha, adcost:0, leads:0, core_enrollments:0, new_cash_core:0, pesos:[], compAgg:{} }; byFecha[d.fecha]=acc; }
    acc.adcost += d.adcost||0; acc.leads += d.leads||0; acc.core_enrollments += d.core_enrollments||0; acc.new_cash_core += d.new_cash_core||0;
    if(d.peso_propio!=null) acc.pesos.push(d.peso_propio);
    (d.companions||[]).forEach(function(c){ if(!acc.compAgg[c.nombre]) acc.compAgg[c.nombre]={sum:0,count:0}; acc.compAgg[c.nombre].sum+=c.peso; acc.compAgg[c.nombre].count+=1; });
  });
  return Object.keys(byFecha).map(function(fecha){
    var acc = byFecha[fecha];
    var companions = Object.keys(acc.compAgg).map(function(name){ return {nombre:name, peso:acc.compAgg[name].sum/acc.compAgg[name].count}; }).sort(function(a,b){return b.peso-a.peso;});
    return { fecha:fecha, adcost:acc.adcost, leads:acc.leads, core_enrollments:acc.core_enrollments, new_cash_core:acc.new_cash_core, peso_propio:meanArr(acc.pesos), companions:companions };
  });
}
function groupContinuousDays(daysRaw){
  var days = consolidateByDate(daysRaw);
  var asc = days.slice().sort(function(a,b){ return a.fecha<b.fecha?-1:(a.fecha>b.fecha?1:0); });
  var groups=[], current=null, lastTime=null, lastSig=null;
  asc.forEach(function(d){
    var t=Date.parse(d.fecha+'T00:00:00Z'), sig=daySignature(d);
    if(current && lastTime!=null && (t-lastTime)===86400000 && sig===lastSig){ current.push(d); }
    else { current=[d]; groups.push(current); }
    lastTime=t; lastSig=sig;
  });
  return groups.map(function(ds){
    var n=ds.length, compAgg={};
    ds.forEach(function(d){ (d.companions||[]).forEach(function(c){ if(!compAgg[c.nombre]) compAgg[c.nombre]={sum:0,count:0}; compAgg[c.nombre].sum+=c.peso; compAgg[c.nombre].count+=1; }); });
    var companions = Object.keys(compAgg).map(function(name){ return {nombre:name, peso:compAgg[name].sum/compAgg[name].count}; }).sort(function(a,b){return b.peso-a.peso;});
    var sums = { adcost:sumField(ds,'adcost'), leads:sumField(ds,'leads'), core_enrollments:sumField(ds,'core_enrollments'), new_cash_core:sumField(ds,'new_cash_core') };
    var g = { fecha_inicio:ds[0].fecha, fecha_fin:ds[n-1].fecha, num_dias:n, peso_propio:meanArr(ds.map(function(d){return d.peso_propio;})), companions:companions };
    Object.assign(g, sums, metricsFromSums(sums));
    return g;
  }).sort(function(a,b){ return a.fecha_fin<b.fecha_fin?1:-1; });
}
function taxonomyFullHTML(row){
  var items = availableDimTabs([row]).map(function(d){
    var code = row[d.field]; if(!code) return '';
    var def = DEF(d.key, code);
    return '<div class="taxo-item" style="border:1px solid var(--border-soft); border-radius:10px; padding:10px 13px; background:var(--surface-2); margin-bottom:6px;">'+
      '<button class="link-btn" data-def-dim="'+escAttr(d.key)+'" data-def-code="'+escAttr(code)+'" style="font-weight:600;"><b>'+esc(T('v_'+d.key))+':</b> '+esc(TAX(d.key,code))+'</button>'+
      (def? '<div style="font-size:11.8px; color:var(--ink-faint); margin-top:4px;">'+esc(def)+'</div>' : '')+
    '</div>';
  }).join('');
  return '<div class="foot-note" style="margin-top:14px; font-weight:700; text-transform:uppercase; font-size:10.5px;">'+(LANG==='en'?'Creative information':LANG==='pt'?'Informação do criativo':'Información del creativo')+'</div>'+items;
}
function openDailyDetailModal(row){
  document.getElementById('modal-card').classList.add('wide');
  document.getElementById('modal-eyebrow').textContent = row.ad_type || '';
  document.getElementById('modal-title').innerHTML = esc(row.nombre) + videoLinkHTML(row.link_video, true);
  var html = metricsGridHTML(row);
  html += taxonomyFullHTML(row);
  if(row.fecha_lanzamiento) html += '<p class="foot-note">'+T('lanzamiento')+': <b>'+esc(row.fecha_lanzamiento)+'</b></p>';
  var ranges = groupContinuousDays(row.detalle_diario);
  if(!ranges.length){ html += '<p class="foot-note" style="margin-top:14px;">'+T('sin_datos_filtro')+'</p>'; document.getElementById('modal-body').innerHTML=html; document.getElementById('modal-backdrop').classList.add('open'); return; }
  html += '<div class="foot-note" style="margin-top:14px; font-weight:700; text-transform:uppercase; font-size:10.5px;">'+T('trazabilidad')+' ('+STATE.year+' · '+row.num_dias_activos+' '+T('dias_activos')+')</div>';
  html += '<div class="day-list">'+ranges.map(function(g){
    var pesoPct = g.peso_propio!=null? fmtPct(g.peso_propio,0) : '—';
    var dateLabel = g.fecha_inicio===g.fecha_fin? g.fecha_inicio : (g.fecha_inicio+' → '+g.fecha_fin);
    var companionsHtml = g.companions && g.companions.length ? (T('acompanado_por')+': '+g.companions.map(function(c){return esc(c.nombre)+' ('+fmtPct(c.peso,0)+')';}).join(', ')) : '—';
    var metricsLine = METRIC_ORDER.map(function(k){ return METRIC_DEFS[k].icon+' '+metricFmt(k,g[k]); }).join(' · ');
    return '<div class="day-entry"><div class="day-head"><span class="day-date">'+esc(dateLabel)+' <span class="chip">'+g.num_dias+'d</span></span><span>'+pesoPct+'</span></div>'+
      '<div class="day-metrics">'+Math.round(g.leads)+' '+T('leads')+' · '+metricsLine+'</div>'+
      '<div class="day-companions">'+companionsHtml+'</div></div>';
  }).join('')+'</div>';
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-backdrop').classList.add('open');
}
document.addEventListener('click', function(e){
  var btn = e.target.closest('[data-daily-detail]');
  if(btn){ var row = window.__creativeRowLookup[btn.dataset.dailyDetail]; if(row) openDailyDetailModal(row); return; }
  var defBtn = e.target.closest('[data-def-dim]');
  if(defBtn){ openModal(defBtn.dataset.defDim, defBtn.dataset.defCode, window.__defMetricsLookup[defBtn.dataset.defDim+'|'+defBtn.dataset.defCode]); }
});

/* ============================ methodology modal ============================ */
function openMethodologyModal(){
  document.getElementById('modal-card').classList.add('wide');
  document.getElementById('modal-eyebrow').textContent = '';
  document.getElementById('modal-title').textContent = LANG==='en'?'How each metric is calculated':LANG==='pt'?'Como cada métrica é calculada':'Cómo se calcula cada métrica';
  var body = '<div class="step"><b>'+T('footer_note')+'</b></div><ul style="margin-top:10px; padding-left:18px;">'+
    '<li>'+METRIC_DEFS.leads_per_1k.icon+' '+metricLabel('leads_per_1k')+' = SUM(leads) ÷ SUM(spend) × 1,000</li>'+
    '<li>'+METRIC_DEFS.cpl.icon+' '+metricLabel('cpl')+' = SUM(spend) ÷ SUM(leads)</li>'+
    '<li>'+METRIC_DEFS.cvr.icon+' '+metricLabel('cvr')+' = SUM(sales) ÷ SUM(leads)</li>'+
    '<li>'+METRIC_DEFS.mncc_core_pct.icon+' '+metricLabel('mncc_core_pct')+' = (SUM(new cash) − SUM(spend)) ÷ SUM(new cash)</li>'+
  '</ul><p class="foot-note" style="margin-top:12px;">'+T('footer_src')+'</p>';
  document.getElementById('modal-body').innerHTML = body;
  document.getElementById('modal-backdrop').classList.add('open');
}
document.getElementById('btn-methodology').addEventListener('click', openMethodologyModal);

/* ============================ sidebar: filtros verticales, colapsables ============================ */
var SB_COLLAPSED = {}; // groupKey -> bool
function sbGroup(key, title, bodyHtml){
  var collapsed = !!SB_COLLAPSED[key];
  return '<div class="sb-group'+(collapsed?' collapsed':'')+'" data-sbgroup="'+key+'">'+
    '<div class="sb-group-head" data-sbtoggle="'+key+'"><span>'+title+'</span><span class="sb-group-chevron">▾</span></div>'+
    '<div class="sb-group-body">'+bodyHtml+'</div>'+
  '</div>';
}
function renderSidebar(){
  var el = document.getElementById('filters-root');
  var g1 = '<div class="sb-seg vertical" id="sel-metric">'+METRIC_ORDER.map(function(k){ return '<button data-metric="'+k+'" class="'+(STATE.metric===k?'active':'')+'">'+METRIC_DEFS[k].icon+' '+metricShort(k)+'</button>'; }).join('')+'</div>';

  var g2 = '<div class="sb-row-label">'+T('ventana')+'</div><div class="sb-seg" id="sel-semana1">'+
    ['false','true'].map(function(v){ var on=v==='true'; return '<button data-semana1="'+v+'" class="'+(STATE.semana1===on?'active':'')+'">'+(on?T('primera_semana'):T('historico_completo'))+'</button>'; }).join('')+'</div>'+
    '<div class="sb-row-label" style="margin-top:8px;">'+T('ad_type')+'</div><div class="sb-seg" id="sel-adtype">'+
    AD_TYPES.map(function(a){ return '<button data-adtype="'+a+'" class="'+(STATE.adType===a?'active':'')+'">'+(a==='Todos'?T('todos'):a)+'</button>'; }).join('')+'</div>';

  var g3 = '<div class="sb-row-label">'+T('anio')+'</div><div class="sb-seg" id="sel-year">'+
    YEAR_OPTIONS.map(function(y){ return '<button data-year="'+y+'" class="'+(STATE.year===y?'active':'')+'">'+y+'</button>'; }).join('')+'</div>'+
    '<div class="sb-row-label" style="margin-top:8px;">'+T('trimestre')+'</div><div class="sb-seg" id="sel-quarter">'+
    QUARTERS.map(function(q){ return '<button data-quarter="'+q+'" class="'+(STATE.quarter===q?'active':'')+'">'+(q==='Todos'?T('todos'):q)+'</button>'; }).join('')+'</div>';

  var g4 = '<div class="sb-row-label">'+T('organizacion')+'</div><div class="sb-seg" id="sel-organization">'+
    ORGANIZATIONS.map(function(o){ return '<button data-organization="'+o+'" class="'+(STATE.organization===o?'active':'')+'">'+o+'</button>'; }).join('')+'</div>'+
    '<div class="sb-row-label" style="margin-top:8px;">'+T('mktorg')+'</div><div class="sb-seg" id="sel-mktorg">'+
    MARKETING_ORGS.map(function(o){ return '<button data-org="'+o+'" class="'+(STATE.marketingOrg.indexOf(o)!==-1?'active':'')+'">'+o+'</button>'; }).join('')+'</div>';

  var g5 = '<div class="sb-row-label">'+T('region')+'</div><div class="sb-seg" id="sel-region">'+
    ['Latam','Brazil'].map(function(r){ return '<button data-region="'+r+'" class="'+(STATE.region===r?'active':'')+'">'+T(r==='Latam'?'latam':'brazil')+'</button>'; }).join('')+'</div>';
  if(STATE.region==='Latam'){
    g5 += '<div class="sb-row-label" style="margin-top:8px;">'+T('pais')+'</div><div class="sb-countries" id="sel-pais" title="'+escAttr(T('pais_hint'))+'">'+
      COUNTRIES.map(function(p,i){ return '<button data-pais="'+escAttr(p)+'" data-idx="'+i+'" class="'+(STATE.paisSel.indexOf(p)!==-1?'active':'')+'">'+esc(p)+'</button>'; }).join('')+'</div>'+
      '<div class="sb-hint">'+T('pais_hint')+'</div>';
  }

  el.innerHTML =
    sbGroup('metric', T('metrica_exito'), g1) +
    sbGroup('window', T('ventana')+' · '+T('ad_type'), g2) +
    sbGroup('date', T('fecha'), g3) +
    sbGroup('brand', T('marca'), g4) +
    sbGroup('place', T('lugar'), g5);

  Array.from(el.querySelectorAll('[data-sbtoggle]')).forEach(function(h){
    h.addEventListener('click', function(){ var k=h.dataset.sbtoggle; SB_COLLAPSED[k]=!SB_COLLAPSED[k]; renderSidebar(); });
  });
  Array.from(el.querySelectorAll('#sel-metric button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.metric=b.dataset.metric; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-semana1 button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.semana1=b.dataset.semana1==='true'; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-adtype button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.adType=b.dataset.adtype; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-year button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.year=b.dataset.year; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-quarter button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.quarter=b.dataset.quarter; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-organization button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.organization=b.dataset.organization; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-mktorg button')).forEach(function(b){
    b.addEventListener('click', function(){ var o=b.dataset.org, idx=STATE.marketingOrg.indexOf(o); if(idx===-1) STATE.marketingOrg.push(o); else if(STATE.marketingOrg.length>1) STATE.marketingOrg.splice(idx,1); renderAll(); });
  });
  Array.from(el.querySelectorAll('#sel-region button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.region=b.dataset.region; renderAll(); }); });
  wirePaisMultiSelect();
}

/* ============================ pais multi-select: clic / ctrl+clic / arrastre ============================ */
var paisDrag = {active:false, startIdx:null, liveSet:null};
function applyPaisButtonClasses(set){ Array.from(document.querySelectorAll('#sel-pais button')).forEach(function(btn){ btn.classList.toggle('active', set.indexOf(btn.dataset.pais)!==-1); }); }
function wirePaisMultiSelect(){
  var container = document.getElementById('sel-pais'); if(!container) return;
  Array.from(container.querySelectorAll('button')).forEach(function(btn){
    btn.addEventListener('mousedown', function(e){
      e.preventDefault();
      var pais=btn.dataset.pais, idx=+btn.dataset.idx;
      if(e.ctrlKey || e.metaKey){
        var cur=STATE.paisSel.slice(), i=cur.indexOf(pais);
        if(i===-1) cur.push(pais); else if(cur.length>1) cur.splice(i,1);
        STATE.paisSel=cur; paisDrag.active=false; renderAll(); return;
      }
      paisDrag.active=true; paisDrag.startIdx=idx; paisDrag.liveSet=[pais];
      applyPaisButtonClasses(paisDrag.liveSet);
    });
    btn.addEventListener('mouseenter', function(){
      if(!paisDrag.active) return;
      var idx=+btn.dataset.idx, lo=Math.min(paisDrag.startIdx,idx), hi=Math.max(paisDrag.startIdx,idx);
      paisDrag.liveSet = COUNTRIES.slice(lo,hi+1);
      applyPaisButtonClasses(paisDrag.liveSet);
    });
  });
}
document.addEventListener('mouseup', function(){ if(!paisDrag.active) return; paisDrag.active=false; STATE.paisSel = paisDrag.liveSet || STATE.paisSel; renderAll(); });

document.getElementById('sidebar-toggle').addEventListener('click', function(){ document.getElementById('sidebar').classList.toggle('collapsed'); });

/* ============================ tabs (scrollable, con flechas) ============================ */
function wireTabScroll(el){
  var leftBtn=document.getElementById('tabscroll-left'), rightBtn=document.getElementById('tabscroll-right');
  function update(){ leftBtn.classList.toggle('hidden', el.scrollLeft<=2); rightBtn.classList.toggle('hidden', el.scrollLeft>=(el.scrollWidth-el.clientWidth-2)); }
  leftBtn.onclick=function(){ el.scrollBy({left:-160}); }; rightBtn.onclick=function(){ el.scrollBy({left:160}); };
  el.onscroll=update; window.addEventListener('resize', update); update();
}
function renderViewTabs(creatives){
  var dims = availableDimTabs(creatives);
  var views = ['ranking'].concat(dims.map(function(d){return d.key;})).concat(['explorador']);
  var el = document.getElementById('viewtabs');
  if(views.indexOf(STATE.view)===-1) STATE.view='ranking';
  el.innerHTML = views.map(function(v){
    var d = dims.filter(function(x){return x.key===v;})[0];
    var isNew = d && d.isNew;
    return '<button data-view="'+v+'" class="'+(STATE.view===v?'active':'')+(isNew?' newcat':'')+'">'+esc(T('v_'+v))+(isNew?'<span class="newcat-chip">'+T('new_chip')+'</span>':'')+'</button>';
  }).join('');
  Array.from(el.querySelectorAll('button')).forEach(function(btn){ btn.addEventListener('click', function(){ STATE.view=btn.dataset.view; renderAll(); }); });
  wireTabScroll(el);
}

/* ============================ language + theme buttons ============================ */
function renderLangBtns(){
  var el = document.getElementById('lang-btns');
  el.innerHTML = ['en','es','pt'].map(function(l){ return '<button class="iconbtn'+(LANG===l?' active':'')+'" data-lang="'+l+'">'+l.toUpperCase()+'</button>'; }).join('');
  Array.from(el.querySelectorAll('button')).forEach(function(b){ b.addEventListener('click', function(){ LANG=b.dataset.lang; localStorage.setItem('tvads_lang',LANG); renderAll(); }); });
}
document.getElementById('btn-theme').addEventListener('click', function(){
  var root=document.documentElement;
  var cur = root.getAttribute('data-theme');
  var next = cur==='dark' ? 'light' : (cur==='light' ? null : 'dark');
  if(next) root.setAttribute('data-theme', next); else root.removeAttribute('data-theme');
});

/* ============================ KPI strip ============================ */
function renderKpiStrip(creatives){
  var sums = { adcost:sumField(creatives,'adcost'), leads:sumField(creatives,'leads'), core_enrollments:sumField(creatives,'core_enrollments'), new_cash_core:sumField(creatives,'new_cash_core') };
  var m = metricsFromSums(sums);
  var tiles = [
    {label:T('spend_total'), val:fmt$(sums.adcost,0)},
    {label:T('leads_total'), val:fmtNum(sums.leads,0)},
    {label:T('ventas_total'), val:fmtNum(sums.core_enrollments,0)},
    {label:T('margen_total'), val:fmtPct(m.mncc_core_pct,1), hl:true},
  ];
  document.getElementById('kpi-strip').innerHTML = tiles.map(function(t){
    return '<div class="kpi-tile'+(t.hl?' hl':'')+'"><div class="kpi-tile-label">'+t.label+'</div><div class="kpi-tile-val">'+t.val+'</div></div>';
  }).join('');
}

/* ============================ rank list (reusado para ranking y para cada dimension) ============================ */
function rankListHTML(rows, opts){
  opts = opts || {};
  var activeMetric = STATE.metric;
  var minMax = computeMinMax(rows, activeMetric);
  return colorLegendHTML(activeMetric) + '<div class="rank-list">' + rows.map(function(r, i){
    var val = r[activeMetric];
    var color = rankColorCSS(activeMetric, val, minMax);
    var frac = 0;
    if(val!=null){ var mn=minMax.min, mx=minMax.max; frac = (mx===mn)?1:(val-mn)/(mx-mn); if(!METRIC_DEFS[activeMetric].higherIsBetter) frac=1-frac; }
    var widthPct = Math.max(4, Math.round(Math.max(0,Math.min(1,frac))*100));
    var nameHtml = opts.isCreative
      ? '<button class="rank-name-btn" data-daily-detail="'+escAttr(r.nombre)+'"><span>'+esc(r.nombre)+'</span></button>'+videoLinkHTML(r.link_video)
      : '<button class="rank-name-btn" data-def-dim="'+escAttr(opts.dim)+'" data-def-code="'+escAttr(r._code)+'"><span>'+esc(TAX(opts.dim, r._code))+'</span><span class="info-dot">i</span></button>';
    var subLabel = opts.isCreative
      ? (r.num_dias_activos+' '+T('dias_activos')+(r.marca?(' · '+r.marca):''))
      : ((r.num_creativos||0)+' '+T('creativos'));
    return '<div class="rank-item"><div class="rank-row">'+
      '<div class="rank-pos">'+(i+1)+'</div>'+
      '<div class="rank-name-wrap">'+nameHtml+'</div>'+
      '<div class="rank-val"><span class="rank-val-label">'+METRIC_DEFS[activeMetric].icon+' '+metricShort(activeMetric)+'</span><span class="rank-val-num">'+metricFmt(activeMetric,val)+'</span></div>'+
      '</div><div class="rank-track"><div class="rank-fill" style="width:'+widthPct+'%; background:'+color+';"></div></div>'+
      '<div class="rank-sub">'+esc(subLabel)+'</div>'+
    '</div>';
  }).join('') + '</div>';
}

/* ============================ page render ============================ */
function populateLookups(creatives){
  availableDimTabs(creatives).forEach(function(d){
    var groups = computeRollup(creatives, d.field);
    Object.keys(groups).forEach(function(code){ window.__defMetricsLookup[d.key+'|'+code] = groups[code]; });
  });
  creatives.forEach(function(r){ window.__creativeRowLookup[r.nombre]=r; });
}
function renderPage(creatives){
  var page = document.getElementById('page');
  if(!creatives.length){ page.innerHTML = '<div class="card">'+T('sin_datos_filtro')+'</div>'; return; }
  populateLookups(creatives);

  if(STATE.view==='ranking'){
    var ranked = creatives.slice().sort(function(a,b){ var av=a[STATE.metric],bv=b[STATE.metric]; if(av==null) return 1; if(bv==null) return -1; return METRIC_DEFS[STATE.metric].higherIsBetter?(bv-av):(av-bv); });
    page.innerHTML = '<div class="card"><div class="panel-title"><span>'+T('v_ranking')+' — '+creatives.length+' '+T('creativos_activos_en')+' '+STATE.year+'</span></div>'+rankListHTML(ranked,{isCreative:true})+'</div>';
    return;
  }
  if(STATE.view==='explorador'){
    renderExplorer(creatives); return;
  }
  var dim = CANDIDATE_DIMS.filter(function(d){return d.key===STATE.view;})[0];
  if(dim){
    var groups = computeRollup(creatives, dim.field);
    var rows = Object.keys(groups).map(function(code){ var g=groups[code]; g._code=code; return g; });
    rows.sort(function(a,b){ var av=a[STATE.metric],bv=b[STATE.metric]; if(av==null) return 1; if(bv==null) return -1; return METRIC_DEFS[STATE.metric].higherIsBetter?(bv-av):(av-bv); });
    page.innerHTML = '<div class="card'+(dim.isNew?' newcat':'')+'"><div class="panel-title"><span>'+T('v_'+dim.key)+(dim.isNew?' <span class="newcat-chip">'+T('new_chip')+'</span>':'')+'</span></div>'+rankListHTML(rows,{dim:dim.key})+'</div>';
  }
}
function renderExplorer(creatives){
  var page = document.getElementById('page');
  var dims = availableDimTabs(creatives);
  var sorted = creatives.slice().sort(function(a,b){ var av=a[STATE.metric],bv=b[STATE.metric]; if(av==null) return 1; if(bv==null) return -1; return METRIC_DEFS[STATE.metric].higherIsBetter?(bv-av):(av-bv); });
  var html = '<div class="card"><div class="panel-title"><span>'+T('v_explorador')+'</span></div>'+
    '<div class="controls"><input type="text" id="explorer-search" placeholder="'+escAttr(T('buscar'))+'"></div>'+
    '<div class="table-wrap"><table><thead><tr><th></th><th>'+T('nombre')+'</th>'+dims.map(function(d){return '<th>'+esc(T('v_'+d.key))+'</th>';}).join('')+'<th class="num">'+T('dias')+'</th>'+
    METRIC_ORDER.map(function(k){ return '<th class="num'+(k===STATE.metric?' active-metric':'')+'">'+METRIC_DEFS[k].icon+' '+metricShort(k)+'</th>'; }).join('')+'</tr></thead><tbody id="explorer-tbody"></tbody></table></div>'+
    '<p class="foot-note">'+T('click_ordenar')+'</p></div>';
  page.innerHTML = html;
  function renderRows(list){
    document.getElementById('explorer-tbody').innerHTML = list.map(function(r){
      var brandColor = organizationColor(r.marca);
      return '<tr><td><span class="brandbar" style="background:'+brandColor+';"></span></td>'+
        '<td><button class="link-btn" data-daily-detail="'+escAttr(r.nombre)+'">'+esc(r.nombre)+'</button> '+videoLinkHTML(r.link_video)+'</td>'+
        dims.map(function(d){ return '<td>'+esc(TAX(d.key, r[d.field]))+'</td>'; }).join('')+
        '<td class="num">'+r.num_dias_activos+'</td>'+
        METRIC_ORDER.map(function(k){ return '<td class="num'+(k===STATE.metric?' active-metric':'')+'">'+metricFmt(k,r[k])+'</td>'; }).join('')+
      '</tr>';
    }).join('');
  }
  renderRows(sorted);
  document.getElementById('explorer-search').addEventListener('input', function(e){
    var q = e.target.value.toLowerCase();
    renderRows(sorted.filter(function(r){
      if(!q) return true;
      if(r.nombre.toLowerCase().indexOf(q)!==-1) return true;
      return dims.some(function(d){ return (TAX(d.key,r[d.field])||'').toLowerCase().indexOf(q)!==-1; });
    }));
  });
}

/* ============================ footer ============================ */
function renderFooter(){
  document.getElementById('footer-src').textContent = T('footer_src');
  document.getElementById('footer-note').textContent = T('footer_note');
}

/* ============================ orquestacion ============================ */
function renderAll(){
  updateAccent();
  document.documentElement.lang = LANG;
  var creatives = getWorkingCreatives();
  renderLangBtns();
  renderSidebar();
  renderKpiStrip(creatives);
  renderViewTabs(creatives);
  renderPage(creatives);
  renderFooter();
}

function startApp(yearsDataFull){
  YEARS_DATA = yearsDataFull.years;
  YEAR_OPTIONS = Object.keys(YEARS_DATA).sort();
  COUNTRIES = yearsDataFull.allCountries || [];
  STATE.paisSel = COUNTRIES.slice();
  if(YEAR_OPTIONS.indexOf(STATE.year)===-1) STATE.year = YEAR_OPTIONS[YEAR_OPTIONS.length-1];
  LANG = localStorage.getItem('tvads_lang') || 'en';
  renderAll();
}
