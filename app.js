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
  avg_leads_dia: { en:'Avg. Leads/day', es:'Prom. Leads/día', pt:'Méd. Leads/dia', short:'Leads/día', higherIsBetter:true, isMargin:false, icon:'📆', fmt:function(v){ return v==null?'—':fmtNum(v,1); } },
  cpl: { en:'CPL (cost per lead)', es:'CPL (costo por lead)', pt:'CPL (custo por lead)', short:'CPL', higherIsBetter:false, isMargin:false, icon:'💵', fmt:function(v){ return fmt$(v,2); } },
  cvr: { en:'Conversion (sales / leads)', es:'Conversión (ventas / leads)', pt:'Conversão (vendas / leads)', short:'CVR', higherIsBetter:true, isMargin:false, icon:'📈', fmt:function(v){ return fmtPct(v,1); } },
  mncc_core_pct: { en:'% MNCC', es:'% MNCC', pt:'% MNCC', short:'% MNCC', higherIsBetter:true, isMargin:true, icon:'💰', fmt:function(v){ return fmtPct(v,1); } },
};
var METRIC_ORDER = ['leads_per_1k','avg_leads_dia','cpl','cvr','mncc_core_pct'];
function metricLabel(key){ return METRIC_DEFS[key][LANG]; }
function metricShort(key){ return METRIC_DEFS[key].short; }
function metricFmt(key,v){ return METRIC_DEFS[key].fmt(v); }
/* activeAdcost: cual "gasto" alimenta Leads/$1k, CPL y %MNCC depende del
   interruptor "Excluir SEM-Brand Spend" -- item.adcost es el gasto crudo del
   channel_grouping "Brand TV Channels" (incluye SEM-Brand, que no se puede
   controlar por pujas de competencia); item.adcost_real es ese mismo gasto
   neto de SEM-Brand (offlineSpendReal, calculado en engine.js). Por defecto
   (interruptor apagado) se usa el crudo, igual que siempre. */
function activeAdcost(sumsOrItem){ return (STATE.excludeSemBrand ? sumsOrItem.adcost_real : sumsOrItem.adcost) || 0; }
function metricsFromSums(sums){
  var adcost=activeAdcost(sums), leads=sums.leads||0, core=sums.core_enrollments||0, newCash=sums.new_cash_core||0;
  return { leads_per_1k: adcost?leads/adcost*1000:null, cpl: leads?adcost/leads:null, cvr: leads?core/leads:null, mncc_core_pct: newCash?(newCash-adcost)/newCash:null };
}
/* Caso de gasto=$0 (ej. una fila de cruce de marca -- Organization distinto a
   la marca propia del creativo -- o un hueco de datos puntual): CPL y
   %MNCC calculan un numero MATEMATICAMENTE valido pero enganoso ($0.00 de
   CPL, o 100% de MNCC) porque el gasto no esta atribuido a esta vista, no
   porque sea gratis o perfecto. Se detecta y se reemplaza la lectura en vez
   de mostrar el numero confuso. Leads/$1k no necesita reemplazo -- ya existe
   "Prom. Leads/día" (avg_leads_dia) como metrica propia, seleccionable, para
   exactamente este caso. CVR tampoco necesita nada especial: no depende del
   gasto en absoluto. */
function isZeroSpendCase(item){ return !!item && activeAdcost(item) === 0; }
function cplDisplayHTML(item){
  if(isZeroSpendCase(item) && (item.leads||0) > 0) return '<span title="'+escAttr(T('sin_gasto_nota'))+'">'+esc(T('sin_gasto_corto'))+'</span>';
  return esc(metricFmt('cpl', item.cpl));
}
function marginDisplayHTML(item){
  if(isZeroSpendCase(item) && (item.new_cash_core||0) > 0){
    var days = item.num_dias_activos || item.num_dias || 1;
    return esc(fmt$(item.new_cash_core/days, 0) + '/' + T('dia')) + ' <span class="chip" title="'+escAttr(T('margen_sin_gasto_nota'))+'">'+esc(T('avg_ncc_dia'))+'</span>';
  }
  return esc(metricFmt('mncc_core_pct', item.mncc_core_pct));
}
function metricDisplayHTML(key, item){
  if(key==='cpl') return cplDisplayHTML(item);
  if(key==='mncc_core_pct') return marginDisplayHTML(item);
  return esc(metricFmt(key, item[key]));
}

/* ============================ color por ranking ============================ */
function cv(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function computeMinMax(rows, metric){
  var vals = rows.map(function(r){ return r[metric]; }).filter(function(v){ return v!=null; });
  if(METRIC_DEFS[metric].isMargin) vals = vals.filter(function(v){ return v>=0; });
  if(!vals.length) return {min:0,max:0};
  return {min:Math.min.apply(null,vals), max:Math.max.apply(null,vals)};
}
/* Fraccion de "que tan bueno es este valor" (1=el mejor del grupo visible,
   hacia 0 mientras peor) -- a proposito NO es un estiramiento min-max
   ((valor-min)/(max-min)), porque eso exagera diferencias reales minimas:
   con solo 2 items casi empatados (ej. 27.8 vs 27.6), estirar entre el min y
   el max de ESE grupo hace que el peor se vea con una barra casi vacia,
   como si fuera muchisimo peor, cuando en realidad la diferencia real es de
   menos del 1%. Aca se usa una RAZON contra el mejor valor del grupo (o
   contra el mas barato, para CPL) -- una diferencia real chica da una barra
   casi del mismo largo, coherente sin importar cuantos items haya ni que
   tan juntos esten sus valores. */
function metricBarFrac(metric, value, minMax){
  if(value==null) return 0;
  if(METRIC_DEFS[metric].isMargin && value<0) return 0; // ya tiene su propio color --bad
  if(METRIC_DEFS[metric].higherIsBetter){
    return minMax.max>0 ? Math.max(0, Math.min(1, value/minMax.max)) : 0;
  }
  // unica metrica lowerIsBetter hoy: CPL (siempre > 0)
  return value>0 ? Math.max(0, Math.min(1, minMax.min/value)) : 0;
}
function rankColorCSS(metric, value, minMax){
  if(value==null) return cv('--border');
  if(METRIC_DEFS[metric].isMargin && value<0) return cv('--bad');
  var pct = Math.round((1 - metricBarFrac(metric, value, minMax))*100);
  return 'color-mix(in srgb, '+cv('--rank-weak')+' '+pct+'%, '+cv('--rank-strong')+' '+(100-pct)+'%)';
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
  mes:{en:'Month',es:'Mes',pt:'Mês'},
  media_spend:{en:'Media Spend',es:'Gasto en Medios',pt:'Gasto em Mídia'},
  excluir_sem_brand:{en:'Exclude SEM-Brand Spend',es:'Excluir SEM-Brand Spend',pt:'Excluir Gasto SEM-Brand'},
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
  creativos_activos_en:{en:'active creatives in',es:'creativos activos en',pt:'criativos ativos em'},
  versiones:{en:'versions',es:'versiones',pt:'versões'},
  incluye_versiones:{en:'This ad groups the following versions',es:'Este ad agrupa las siguientes versiones',pt:'Este ad agrupa as seguintes versões'},
  rotacion_mixta:{en:'Mixed rotation split by country this period',es:'Rotación mixta por país en este período',pt:'Rotação mista por país neste período'},
  resto_latam:{en:'Rest of LATAM',es:'Resto de LATAM',pt:'Resto da LATAM'},
  paises:{en:'countries',es:'países',pt:'países'},
  sin_gasto_corto:{en:'No spend attributed',es:'Sin gasto atribuido',pt:'Sem gasto atribuído'},
  sin_gasto_nota:{en:'This view has leads but $0 spend attributed here, so CPL is not meaningful.',es:'Esta vista tiene leads pero $0 de gasto atribuido, así que el CPL no tiene sentido aquí.',pt:'Esta visão tem leads mas $0 de gasto atribuído aqui, então o CPL não faz sentido.'},
  avg_ncc_dia:{en:'Avg. New Cash Core/day',es:'Prom. New Cash Core/día',pt:'Méd. New Cash Core/dia'},
  margen_sin_gasto_nota:{en:'$0 spend attributed here, so % MNCC would show a meaningless 100%. Showing average daily New Cash Core generated instead.',es:'$0 de gasto atribuido aquí, así que %MNCC mostraría un 100% sin sentido. Se muestra en su lugar el promedio diario de New Cash Core generado.',pt:'$0 de gasto atribuído aqui, então %MNCC mostraria um 100% sem sentido. Mostrando em vez disso a média diária de New Cash Core gerado.'},
  dia:{en:'day',es:'día',pt:'dia'},
  descargar_html:{en:'⬇ Download HTML',es:'⬇ Descargar HTML',pt:'⬇ Baixar HTML'},
  tour_next:{en:'Next',es:'Siguiente',pt:'Próximo'},
  tour_back:{en:'← Back',es:'← Atrás',pt:'← Voltar'},
  tour_finish:{en:'Finish',es:'Finalizar',pt:'Concluir'},
  tour_skip:{en:'Skip tour',es:'Saltar recorrido',pt:'Pular tour'},
  toast_auto_switch:{
    en:'Metric switched to "Avg. Leads/day": Organization and MarketingOrganization are opposite brands here, so spend is $0 and Leads/$1,000, CPL and % MNCC can’t be calculated.',
    es:'La métrica cambió a "Prom. Leads/día": Organization y MarketingOrganization son marcas opuestas aquí, así que el gasto es $0 y no se pueden calcular Leads/$1,000, CPL ni % MNCC.',
    pt:'A métrica mudou para "Méd. Leads/dia": Organization e MarketingOrganization são marcas opostas aqui, então o gasto é $0 e não é possível calcular Leads/$1.000, CPL nem % MNCC.'},
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
  mes_hint:{en:'Click: only that month · Ctrl+click: add/remove · Click and drag: select the range',es:'Clic: solo ese mes · Ctrl+clic: agrega/quita · Clic y arrastra: selecciona el rango',pt:'Clique: só esse mês · Ctrl+clique: adiciona/remove · Clique e arraste: seleciona o intervalo'},
  mejor:{en:'Best',es:'Mejor',pt:'Melhor'}, peor:{en:'Worst',es:'Peor',pt:'Pior'},
  margen_negativo:{en:'Negative % MNCC',es:'% MNCC negativo',pt:'% MNCC negativo'},
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
  semana1:false, adType:'Todos', quarter:'Todos', mesSel:[],
  excludeSemBrand:false,
  organization:'Open English', marketingOrg:['Open English'],
  region:'Latam', paisSel:[],
  view:'ranking',
};
var MARKETING_ORGS = ['Open English','Open English Junior'];
var ORGANIZATIONS = ['Open English','Open English Junior'];
var QUARTERS = ['Todos','Q1','Q2','Q3','Q4'];
var MESES = ['01','02','03','04','05','06','07','08','09','10','11','12'];
var MES_LABELS = {
  en:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  es:['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],
  pt:['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],
};
function mesLabel(code){ return MES_LABELS[LANG][MESES.indexOf(code)]; }
var AD_TYPES = ['Todos','PROMO','GENERIC'];
var COUNTRIES = [];
var YEAR_OPTIONS = [];
var YEARS_DATA = {};

function organizationColor(org){ if(org==='Open English Junior') return cv('--oejr'); if(org==='Open English') return cv('--oe'); return cv('--neutral-bar'); }
function updateAccent(){
  document.documentElement.style.setProperty('--accent', organizationColor(STATE.organization));
  var isJr = STATE.organization === 'Open English Junior';
  document.documentElement.style.setProperty('--rank-strong', cv(isJr ? '--rank-orange-strong' : '--rank-blue-strong'));
  document.documentElement.style.setProperty('--rank-weak', cv(isJr ? '--rank-orange-weak' : '--rank-blue-weak'));
}
function currentYearData(){ return YEARS_DATA[STATE.year] || {slices:{}}; }

/* ============================ filtros: recalculo 100% client-side ============================ */
function quarterOf(fecha){ return 'Q'+(Math.floor((+fecha.slice(5,7)-1)/3)+1); }
function dayPassesQuarter(fecha){ return STATE.quarter==='Todos' || quarterOf(fecha)===STATE.quarter; }
function dayPassesMes(fecha){ return !STATE.mesSel.length || STATE.mesSel.indexOf(fecha.slice(5,7))!==-1; }
/* launchDates: uno o mas arranques reales del creativo ese ano (ver
   computeLaunchDates en engine.js -- un hueco de mas de 7 dias sin
   actividad separa un relanzamiento del anterior; que cambie el
   acompanante de rotacion NO cuenta como relanzamiento). Una fecha pasa el
   filtro "Primera semana" si cae en los primeros 7 dias de CUALQUIERA de
   esos lanzamientos. */
function dayPassesSemana1(fecha, launchDates){
  if(!STATE.semana1 || !launchDates || !launchDates.length) return true;
  var t = Date.parse(fecha+'T00:00:00Z');
  return launchDates.some(function(l){
    var diff = Math.round((t - Date.parse(l+'T00:00:00Z'))/86400000);
    return diff>=0 && diff<=6;
  });
}
function dayPassesPais(topcountry){ if(topcountry==null) return true; return STATE.paisSel.indexOf(topcountry)!==-1; }
/* CORREGIDO 2026-08-19 (tercera vuelta) -- confirmado con el usuario, con la
   columna F ("Brand") del Excel de rotacion y con casos concretos, como
   deben comportarse las dos columnas:
     - Organization fija LA LISTA de creativos, sola, siempre -- nunca cambia
       segun MarketingOrganization. Es una simple busqueda de UNA slice:
       yearData.slices[Organization|region|Total].
     - MarketingOrganization NUNCA agrega ni quita creativos de esa lista, y
       NUNCA cambia el gasto (adcost/adcost_real, siempre el real y completo
       de Organization) -- solo decide, dentro de CADA creativo ya listado,
       que MarketingOrganization(es) cuentan para leads/core_enrollments/
       New Cash Core (via by_mktorg, dia por dia). Marcar mas de una suma
       mas leads/ventas/NCC (nunca menos), pero nunca mas creativos ni mas
       gasto. */
function mktOrgDayFields(d){
  var leads=0, core=0, newCash=0;
  STATE.marketingOrg.forEach(function(mo){
    var b = d.by_mktorg && d.by_mktorg[mo];
    if(b){ leads+=b.leads||0; core+=b.core_enrollments||0; newCash+=b.new_cash_core||0; }
  });
  /* adcost/adcost_real solo son reales cuando marketing_organization===
     Organization (asi vienen ya desde engine.js -- la fila "ajena" siempre
     trae spend=0), asi que basta con verificar si la propia Organization
     esta marcada en MarketingOrganization: si no lo esta, este creativo no
     tiene NADA de gasto propio bajo el filtro actual. */
  var ownChecked = STATE.marketingOrg.indexOf(STATE.organization) !== -1;
  return Object.assign({}, d, { leads:leads, core_enrollments:core, new_cash_core:newCash,
    adcost: ownChecked ? (d.adcost||0) : 0, adcost_real: ownChecked ? (d.adcost_real||0) : 0 });
}
function recomputeCreative(row){
  var dateDays = (row.detalle_diario||[]).filter(function(d){ return dayPassesQuarter(d.fecha) && dayPassesMes(d.fecha) && dayPassesSemana1(d.fecha,row.launch_dates) && dayPassesPais(d.topcountry); });
  var effDays = dateDays.map(mktOrgDayFields);
  var sums = { adcost:sumField(effDays,'adcost'), adcost_real:sumField(effDays,'adcost_real'), leads:sumField(effDays,'leads'), core_enrollments:sumField(effDays,'core_enrollments'), new_cash_core:sumField(effDays,'new_cash_core') };
  var out = Object.assign({}, row, sums, metricsFromSums(sums));
  var activeDates = new Set();
  effDays.forEach(function(d){ if((d.leads||0) > 0) activeDates.add(d.fecha); });
  out.num_dias_activos = activeDates.size;
  out.avg_leads_dia = out.num_dias_activos ? out.leads/out.num_dias_activos : null;
  out.detalle_diario = dateDays;
  out.has_date_activity = dateDays.some(function(d){ return (d.leads||0) > 0 || Object.keys(d.by_mktorg||{}).some(function(mo){ return (d.by_mktorg[mo].leads||0) > 0; }); });
  return out;
}
function getWorkingCreatives(){
  var yearData = currentYearData();
  var slice = yearData.slices[STATE.organization+'|'+STATE.region+'|Total'];
  var all = slice ? (slice.ranking_creativos||[]).slice() : [];
  if(STATE.adType !== 'Todos') all = all.filter(function(r){ return r.ad_type === STATE.adType; });
  return all.map(recomputeCreative).filter(function(r){ return r.has_date_activity; });
}
/* ============================ agrupar por Ad Name (columna B del Excel STANDARD) ============================
   Video Name (columna A) puede tener variantes V2/V3/V4/V5 del MISMO ad --
   el Ranking debe sumar esas versiones bajo un solo Ad Name (columna B).
   Al hacer click, el detalle si distingue cada Video Name (cada version
   conserva su propio link/fecha de lanzamiento, y cada dia de detalle queda
   etiquetado con que Video Name lo genero). */
function groupCreativesByAdName(creatives){
  var groups = {};
  creatives.forEach(function(r){
    var adName = r.ad_name || r.nombre;
    (groups[adName] = groups[adName] || []).push(r);
  });
  return Object.keys(groups).map(function(adName){
    var versions = groups[adName];
    var sums = { adcost:sumField(versions,'adcost'), adcost_real:sumField(versions,'adcost_real'), leads:sumField(versions,'leads'), core_enrollments:sumField(versions,'core_enrollments'), new_cash_core:sumField(versions,'new_cash_core') };
    var primary = versions.slice().sort(function(a,b){ return b.num_dias_activos - a.num_dias_activos; })[0];
    var mergedDetalle = [];
    var allDates = new Set();
    versions.forEach(function(v){
      (v.detalle_diario||[]).forEach(function(d){
        mergedDetalle.push(Object.assign({video_name:v.nombre}, d));
        allDates.add(d.fecha);
      });
    });
    var out = Object.assign({}, primary, sums, metricsFromSums(sums));
    out.nombre = adName;
    out.ad_name = adName;
    out.is_grouped = versions.length > 1;
    out.versions = versions.map(function(v){ return {video_name:v.nombre, link_video:v.link_video, fecha_lanzamiento:v.fecha_lanzamiento, num_dias_activos:v.num_dias_activos}; });
    out.num_dias_activos = allDates.size;
    out.avg_leads_dia = out.num_dias_activos ? sums.leads/out.num_dias_activos : null;
    out.detalle_diario = mergedDetalle;
    out.fecha_lanzamiento = versions.reduce(function(m,v){ return (v.fecha_lanzamiento && (!m || v.fecha_lanzamiento<m)) ? v.fecha_lanzamiento : m; }, null);
    return out;
  });
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
    var sums = { adcost:sumField(mem,'adcost'), adcost_real:sumField(mem,'adcost_real'), leads:sumField(mem,'leads'), core_enrollments:sumField(mem,'core_enrollments'), new_cash_core:sumField(mem,'new_cash_core') };
    var agg = Object.assign({}, sums, metricsFromSums(sums));
    var sumDays = mem.reduce(function(s,r){ return s+(r.num_dias_activos||0); },0);
    agg.avg_leads_dia = sumDays ? sums.leads/sumDays : null;
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
  {key:'campaign_name', field:'campaign_name', group:'strategy'},
  {key:'theme', field:'theme', group:'strategy'},
  {key:'theme_mechanism', field:'theme_mechanism_code', group:'strategy'},
  {key:'pain_point', field:'pain_point_code', group:'strategy'},
  {key:'hook_audio_type', field:'hook_audio_type_code', group:'execution'},
  {key:'hook_visual_type', field:'hook_visual_type_code', group:'execution'},
  {key:'cta_type', field:'cta_type_code', group:'execution'},
  {key:'type_of_production', field:'type_of_production', group:'production'},
  {key:'tone_category', field:'tone_category', group:'production'},
];
function availableDimTabs(creatives){
  return CANDIDATE_DIMS.filter(function(d){ return creatives.some(function(r){ return r[d.field]!=null && r[d.field]!=='' && r[d.field]!=='-'; }); });
}

/* ============================ metrics grid (usado en modales) ============================ */
function formulaText(key,item){
  var leads=fmtNum(item.leads,0), adcost=fmt$(activeAdcost(item),0), core=fmtNum(item.core_enrollments,0), newCash=fmt$(item.new_cash_core,0);
  var days=fmtNum(item.num_dias_activos||item.num_dias||0,0);
  if(key==='leads_per_1k') return leads+' leads ÷ '+adcost+' × 1,000';
  if(key==='avg_leads_dia') return leads+' leads ÷ '+days+' '+T('dias_activos');
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
      '<div class="metric-card-val">'+metricDisplayHTML(key,item)+'</div>'+
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
          '<td class="num">'+m.num_dias_activos+'</td>'+METRIC_ORDER.map(function(k){ return '<td class="num">'+metricDisplayHTML(k,m)+'</td>'; }).join('')+'</tr>';
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
function splitKey(d){
  return (d.video_name?d.video_name+'::':'') + (d.peso_propio==null?'x':d.peso_propio.toFixed(4)) + '||' +
    (d.companions||[]).map(function(c){ return c.nombre+'@'+c.peso.toFixed(4); }).sort().join(',');
}
/* Un creativo bajo el tag generico "Rotacion Latam" tiene UNA fila de
   detalle_diario por cada pais libre ese dia (topcountry granular). Antes se
   promediaba peso_propio a traves de esas filas para mostrar UN solo % por
   dia -- pero si un pais tiene su propio override de rotacion (ej. Colombia
   40/60 mientras el resto de LATAM esta 50/50 el mismo dia), promediar da un
   numero que no corresponde a NINGUN split real (bug reportado por el
   usuario). Ahora se subagrupa por split EXACTO (peso propio + companions +
   version) dentro de cada fecha: si todos los paises comparten el mismo
   split ese dia, se colapsa en una sola entrada (caso comun, sin cambios de
   comportamiento); si difieren, se preservan como splits separados con la
   lista real de paises de cada uno, en vez de inventar un promedio. */
function consolidateByDate(days){
  var byFecha = {};
  days.forEach(function(d){ (byFecha[d.fecha] = byFecha[d.fecha] || []).push(d); });
  return Object.keys(byFecha).map(function(fecha){
    var rows = byFecha[fecha];
    var bySplit = {};
    rows.forEach(function(d){
      var key = splitKey(d);
      if(!bySplit[key]) bySplit[key] = { peso_propio:d.peso_propio, companions:d.companions||[], video_name:d.video_name, countries:[], adcost:0, adcost_real:0, leads:0, core_enrollments:0, new_cash_core:0 };
      var g = bySplit[key];
      if(d.topcountry) g.countries.push(d.topcountry);
      g.adcost += d.adcost||0; g.adcost_real += d.adcost_real||0; g.leads += d.leads||0; g.core_enrollments += d.core_enrollments||0; g.new_cash_core += d.new_cash_core||0;
    });
    var splits = Object.keys(bySplit).map(function(k){ return bySplit[k]; });
    var totals = { adcost:0, adcost_real:0, leads:0, core_enrollments:0, new_cash_core:0 };
    splits.forEach(function(s){ totals.adcost+=s.adcost; totals.adcost_real+=s.adcost_real; totals.leads+=s.leads; totals.core_enrollments+=s.core_enrollments; totals.new_cash_core+=s.new_cash_core; });
    return Object.assign({ fecha:fecha, splits:splits, mixed:splits.length>1 }, totals);
  });
}
function consolidatedSignature(cd){
  return cd.splits.map(function(s){ return (s.video_name?s.video_name+'::':'')+(s.peso_propio==null?'x':s.peso_propio.toFixed(4))+':'+(s.companions||[]).map(function(c){return c.nombre+'@'+c.peso.toFixed(4);}).sort().join(',')+':'+s.countries.slice().sort().join(','); }).sort().join('|');
}
function mergeSplitsAcrossDays(dayList){
  // dayList: consolidated-by-date entries that share the identical signature (mismo split exacto) -- se suman metricas por split, preservando la lista de paises/companions (idéntica en todos).
  var bySplit = {};
  dayList.forEach(function(cd){
    cd.splits.forEach(function(s){
      var key = (s.video_name?s.video_name+'::':'')+(s.peso_propio==null?'x':s.peso_propio.toFixed(4))+':'+(s.companions||[]).map(function(c){return c.nombre;}).sort().join(',');
      if(!bySplit[key]) bySplit[key] = { peso_propio:s.peso_propio, companions:s.companions, video_name:s.video_name, countries:s.countries, adcost:0, adcost_real:0, leads:0, core_enrollments:0, new_cash_core:0 };
      var g = bySplit[key];
      g.adcost += s.adcost; g.adcost_real += s.adcost_real||0; g.leads += s.leads; g.core_enrollments += s.core_enrollments; g.new_cash_core += s.new_cash_core;
    });
  });
  return Object.keys(bySplit).map(function(k){ var s=bySplit[k]; return Object.assign({}, s, metricsFromSums(s)); });
}
function groupContinuousDays(daysRaw){
  var days = consolidateByDate(daysRaw);
  var asc = days.slice().sort(function(a,b){ return a.fecha<b.fecha?-1:(a.fecha>b.fecha?1:0); });
  var groups=[], current=null, lastTime=null, lastSig=null;
  asc.forEach(function(d){
    var t=Date.parse(d.fecha+'T00:00:00Z'), sig=consolidatedSignature(d);
    if(current && lastTime!=null && (t-lastTime)===86400000 && sig===lastSig){ current.push(d); }
    else { current=[d]; groups.push(current); }
    lastTime=t; lastSig=sig;
  });
  return groups.map(function(ds){
    var n=ds.length;
    var splits = mergeSplitsAcrossDays(ds);
    var sums = { adcost:sumField(ds,'adcost'), adcost_real:sumField(ds,'adcost_real'), leads:sumField(ds,'leads'), core_enrollments:sumField(ds,'core_enrollments'), new_cash_core:sumField(ds,'new_cash_core') };
    var g = { fecha_inicio:ds[0].fecha, fecha_fin:ds[n-1].fecha, num_dias:n, mixed:splits.length>1, splits:splits };
    Object.assign(g, sums, metricsFromSums(sums));
    g.avg_leads_dia = n ? sums.leads/n : null;
    return g;
  }).sort(function(a,b){ return a.fecha_fin<b.fecha_fin?1:-1; });
}
function countryLabel(countries){
  if(!countries || !countries.length) return '';
  if(countries.length<=3) return countries.join(', ');
  return countries.length+' '+T('paises');
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
function splitLineHTML(s, showCountry, videoLinkByName){
  var pesoPct = s.peso_propio!=null? fmtPct(s.peso_propio,0) : '—';
  var companionsHtml = s.companions && s.companions.length ? (T('acompanado_por')+': '+s.companions.map(function(c){return esc(c.nombre)+' ('+fmtPct(c.peso,0)+')';}).join(', ')) : '—';
  var countryLbl = '';
  if(showCountry){
    countryLbl = (s.countries && s.countries.length) ? esc(countryLabel(s.countries)) : T('resto_latam');
  }
  var link = s.video_name && videoLinkByName && videoLinkByName[s.video_name];
  var versionLbl = s.video_name ? '<span class="version-pill">'+esc(s.video_name)+'</span>'+(link?videoLinkHTML(link):'') : '';
  return '<div class="day-split"><div class="day-split-head">'+versionLbl+(countryLbl?'<b>'+countryLbl+'</b>: ':'')+pesoPct+'</div>'+
    '<div class="day-companions">'+companionsHtml+'</div></div>';
}
function openDailyDetailModal(row){
  document.getElementById('modal-card').classList.add('wide');
  document.getElementById('modal-eyebrow').textContent = (row.ad_type || '') + (row.marca ? ' · '+row.marca : '');
  document.getElementById('modal-title').innerHTML = esc(row.nombre) + (row.is_grouped ? '' : videoLinkHTML(row.link_video, true));
  var html = '';
  html += metricsGridHTML(row);
  if(row.is_grouped && row.versions && row.versions.length>1){
    html += '<div class="foot-note" style="margin-top:10px; font-weight:700; text-transform:uppercase; font-size:10.5px;">'+T('incluye_versiones')+' ('+row.versions.length+' '+T('versiones')+')</div>';
    html += '<div class="versions-list">'+row.versions.map(function(v){
      return '<span class="version-pill">'+esc(v.video_name)+(v.fecha_lanzamiento?' · '+esc(v.fecha_lanzamiento):'')+'</span>'+videoLinkHTML(v.link_video);
    }).join('')+'</div>';
  }
  html += taxonomyFullHTML(row);
  if(row.fecha_lanzamiento) html += '<p class="foot-note">'+T('lanzamiento')+': <b>'+esc(row.fecha_lanzamiento)+'</b></p>';
  var effectiveDays = row.detalle_diario.map(mktOrgDayFields);
  var ranges = groupContinuousDays(effectiveDays);
  if(!ranges.length){ html += '<p class="foot-note" style="margin-top:14px;">'+T('sin_datos_filtro')+'</p>'; document.getElementById('modal-body').innerHTML=html; document.getElementById('modal-backdrop').classList.add('open'); return; }
  var videoLinkByName = {};
  (row.versions || [{video_name:row.nombre, link_video:row.link_video}]).forEach(function(v){ videoLinkByName[v.video_name] = v.link_video; });
  html += '<div class="foot-note" style="margin-top:14px; font-weight:700; text-transform:uppercase; font-size:10.5px;">'+T('trazabilidad')+' ('+STATE.year+' · '+row.num_dias_activos+' '+T('dias_activos')+')</div>';
  html += '<div class="day-list">'+ranges.map(function(g){
    var dateLabel = g.fecha_inicio===g.fecha_fin? g.fecha_inicio : (g.fecha_inicio+' → '+g.fecha_fin);
    var metricsLine = METRIC_ORDER.map(function(k){ return METRIC_DEFS[k].icon+' '+metricDisplayHTML(k,g); }).join(' · ');
    var splitsHtml = g.mixed
      ? '<div class="foot-note" style="margin:2px 0 0; font-weight:700;">'+T('rotacion_mixta')+'</div>'+g.splits.map(function(s){ return splitLineHTML(s, true, videoLinkByName); }).join('')
      : splitLineHTML(g.splits[0], false, videoLinkByName);
    return '<div class="day-entry"><div class="day-head"><span class="day-date">'+esc(dateLabel)+' <span class="chip">'+g.num_dias+'d</span></span></div>'+
      '<div class="day-metrics">'+Math.round(g.leads)+' '+T('leads')+' · '+metricsLine+'</div>'+
      splitsHtml+'</div>';
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
    '<li>'+METRIC_DEFS.avg_leads_dia.icon+' '+metricLabel('avg_leads_dia')+' = SUM(leads) ÷ '+T('dias_activos')+'</li>'+
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

  var gSem = '<div class="sb-seg" id="sel-sembrand"><button data-sembrand="toggle" class="'+(STATE.excludeSemBrand?'active':'')+'">'+esc(T('excluir_sem_brand'))+'</button></div>';

  var g2 = '<div class="sb-row-label">'+T('ventana')+'</div><div class="sb-seg" id="sel-semana1">'+
    ['false','true'].map(function(v){ var on=v==='true'; return '<button data-semana1="'+v+'" class="'+(STATE.semana1===on?'active':'')+'">'+(on?T('primera_semana'):T('historico_completo'))+'</button>'; }).join('')+'</div>'+
    '<div class="sb-row-label" style="margin-top:8px;">'+T('ad_type')+'</div><div class="sb-seg" id="sel-adtype">'+
    AD_TYPES.map(function(a){ return '<button data-adtype="'+a+'" class="'+(STATE.adType===a?'active':'')+'">'+(a==='Todos'?T('todos'):a)+'</button>'; }).join('')+'</div>';

  var g3 = '<div class="sb-row-label">'+T('anio')+'</div><div class="sb-seg" id="sel-year">'+
    YEAR_OPTIONS.map(function(y){ return '<button data-year="'+y+'" class="'+(STATE.year===y?'active':'')+'">'+y+'</button>'; }).join('')+'</div>'+
    '<div class="sb-row-label" style="margin-top:8px;">'+T('trimestre')+'</div><div class="sb-seg" id="sel-quarter">'+
    QUARTERS.map(function(q){ return '<button data-quarter="'+q+'" class="'+(STATE.quarter===q?'active':'')+'">'+(q==='Todos'?T('todos'):q)+'</button>'; }).join('')+'</div>'+
    '<div class="sb-row-label" style="margin-top:8px;">'+T('mes')+'</div><div class="sb-seg" id="sel-mes" title="'+escAttr(T('mes_hint'))+'">'+
    MESES.map(function(m){ return '<button data-mes="'+m+'" class="'+(STATE.mesSel.indexOf(m)!==-1?'active':'')+'">'+mesLabel(m)+'</button>'; }).join('')+'</div>'+
    '<div class="sb-hint">'+T('mes_hint')+'</div>';

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
    sbGroup('semBrand', T('media_spend'), gSem) +
    sbGroup('window', T('ventana')+' · '+T('ad_type'), g2) +
    sbGroup('date', T('fecha'), g3) +
    sbGroup('brand', T('marca'), g4) +
    sbGroup('place', T('lugar'), g5);

  Array.from(el.querySelectorAll('[data-sbtoggle]')).forEach(function(h){
    h.addEventListener('click', function(){ var k=h.dataset.sbtoggle; SB_COLLAPSED[k]=!SB_COLLAPSED[k]; renderSidebar(); });
  });
  Array.from(el.querySelectorAll('#sel-metric button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.metric=b.dataset.metric; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-sembrand button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.excludeSemBrand = !STATE.excludeSemBrand; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-semana1 button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.semana1=b.dataset.semana1==='true'; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-adtype button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.adType=b.dataset.adtype; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-year button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.year=b.dataset.year; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-quarter button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.quarter=b.dataset.quarter; renderAll(); }); });
  wireDragMultiSelect('sel-mes', 'mesSel', MESES, 'mes', false);
  Array.from(el.querySelectorAll('#sel-organization button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.organization=b.dataset.organization; STATE.marketingOrg=[STATE.organization]; renderAll(); }); });
  Array.from(el.querySelectorAll('#sel-mktorg button')).forEach(function(b){
    b.addEventListener('click', function(){ var o=b.dataset.org, idx=STATE.marketingOrg.indexOf(o); if(idx===-1) STATE.marketingOrg.push(o); else if(STATE.marketingOrg.length>1) STATE.marketingOrg.splice(idx,1); renderAll(); });
  });
  Array.from(el.querySelectorAll('#sel-region button')).forEach(function(b){ b.addEventListener('click', function(){ STATE.region=b.dataset.region; renderAll(); }); });
  wireDragMultiSelect('sel-pais', 'paisSel', COUNTRIES, 'pais', true);
}

/* ============================ pais multi-select: clic / ctrl+clic / arrastre ============================ */
/* Multi-select reusable con clic / ctrl+clic / clic-y-arrastre -- usado por
   el selector de pais (#sel-pais, dentro de Lugar) y el de mes (#sel-mes,
   dentro de Fecha). requireMinOne=true impide que ctrl+clic deje la
   seleccion en 0 (pais siempre necesita al menos uno activo); mes en cambio
   SI puede quedar vacio (vacio = sin filtro, ver dayPassesMes). */
var dragMultiSel = {active:false, startIdx:null, liveSet:null, containerId:null, dataAttr:null};
function applyDragButtonClasses(containerId, dataAttr, set){
  Array.from(document.querySelectorAll('#'+containerId+' button')).forEach(function(btn){
    btn.classList.toggle('active', set.indexOf(btn.dataset[dataAttr])!==-1);
  });
}
function wireDragMultiSelect(containerId, stateKey, fullList, dataAttr, requireMinOne){
  var container = document.getElementById(containerId); if(!container) return;
  Array.from(container.querySelectorAll('button')).forEach(function(btn, idx){
    btn.addEventListener('mousedown', function(e){
      e.preventDefault();
      var val = btn.dataset[dataAttr];
      if(e.ctrlKey || e.metaKey){
        var cur=STATE[stateKey].slice(), i=cur.indexOf(val);
        if(i===-1) cur.push(val); else if(!requireMinOne || cur.length>1) cur.splice(i,1);
        STATE[stateKey]=cur; dragMultiSel.active=false; renderAll(); return;
      }
      dragMultiSel = {active:true, startIdx:idx, liveSet:[val], containerId:containerId, dataAttr:dataAttr, stateKey:stateKey};
      applyDragButtonClasses(containerId, dataAttr, dragMultiSel.liveSet);
    });
    btn.addEventListener('mouseenter', function(){
      if(!dragMultiSel.active || dragMultiSel.containerId!==containerId) return;
      var lo=Math.min(dragMultiSel.startIdx,idx), hi=Math.max(dragMultiSel.startIdx,idx);
      dragMultiSel.liveSet = fullList.slice(lo,hi+1);
      applyDragButtonClasses(containerId, dataAttr, dragMultiSel.liveSet);
    });
  });
}
document.addEventListener('mouseup', function(){
  if(!dragMultiSel.active) return;
  dragMultiSel.active=false;
  STATE[dragMultiSel.stateKey] = dragMultiSel.liveSet || STATE[dragMultiSel.stateKey];
  renderAll();
});

document.getElementById('sidebar-toggle').addEventListener('click', function(){
  document.getElementById('sidebar').classList.toggle('collapsed');
  // Colapsar/expandir el sidebar cambia el ancho disponible de #viewtabs (20/80 del layout) --
  // hay que re-evaluar si las flechas de scroll de las pestanas deben mostrarse.
  setTimeout(tabScrollUpdate, 0);
});

/* ============================ tabs (scrollable, con flechas) ============================
   IMPORTANTE: la primera vez que renderViewTabs()/wireTabScroll() corren es
   DENTRO de renderAll() (via startApp()), que a su vez corre ANTES de que
   boot() (en dashboard.html) le agregue la clase 'ready' a #appShell -- hasta
   ese momento #appShell tiene display:none, asi que #viewtabs mide
   scrollWidth/clientWidth = 0 y las dos flechas (izq/der) quedan escondidas
   para siempre (nunca se vuelven a recalcular solas: el listener de resize
   no dispara solo porque el panel se hizo visible). Por eso boot() llama a
   tabScrollUpdate() de nuevo, explicitamente, justo despues de agregar
   'ready'. tabScrollUpdate queda como funcion global (no anidada) para poder
   invocarla desde ahi y desde el toggle del sidebar completo. */
function tabScrollUpdate(){
  var el = document.getElementById('viewtabs');
  var leftBtn = document.getElementById('tabscroll-left'), rightBtn = document.getElementById('tabscroll-right');
  if(!el || !leftBtn || !rightBtn) return;
  leftBtn.classList.toggle('hidden', el.scrollLeft<=2);
  rightBtn.classList.toggle('hidden', el.scrollLeft>=(el.scrollWidth-el.clientWidth-2));
}
function wireTabScroll(el){
  var leftBtn=document.getElementById('tabscroll-left'), rightBtn=document.getElementById('tabscroll-right');
  leftBtn.onclick=function(){ el.scrollBy({left:-160}); }; rightBtn.onclick=function(){ el.scrollBy({left:160}); };
  el.onscroll=tabScrollUpdate; window.addEventListener('resize', tabScrollUpdate); tabScrollUpdate();
}
function renderViewTabs(creatives){
  var dims = availableDimTabs(creatives);
  var el = document.getElementById('viewtabs');
  var allViews = ['ranking'].concat(dims.map(function(d){return d.key;})).concat(['explorador']);
  if(allViews.indexOf(STATE.view)===-1) STATE.view='ranking';

  var html = '<button data-view="ranking" class="'+(STATE.view==='ranking'?'active':'')+'">'+esc(T('v_ranking'))+'</button>';
  var lastGroup = null;
  dims.forEach(function(d){
    if(lastGroup!==null && d.group!==lastGroup) html += '<span class="tab-group-gap"></span>';
    lastGroup = d.group;
    html += '<button data-view="'+d.key+'" class="'+(STATE.view===d.key?'active':'')+'">'+esc(T('v_'+d.key))+'</button>';
  });
  html += '<span class="tab-group-gap"></span><button data-view="explorador" class="'+(STATE.view==='explorador'?'active':'')+'">'+esc(T('v_explorador'))+'</button>';
  el.innerHTML = html;
  Array.from(el.querySelectorAll('button')).forEach(function(btn){ btn.addEventListener('click', function(){ STATE.view=btn.dataset.view; renderAll(); }); });
  wireTabScroll(el);
}

/* ============================ language + theme buttons ============================ */
function renderLangBtns(){
  var el = document.getElementById('lang-btns');
  el.innerHTML = ['en','es','pt'].map(function(l){ return '<button class="iconbtn'+(LANG===l?' active':'')+'" data-lang="'+l+'">'+l.toUpperCase()+'</button>'; }).join('');
  Array.from(el.querySelectorAll('button')).forEach(function(b){ b.addEventListener('click', function(){ LANG=b.dataset.lang; localStorage.setItem('tvads_lang',LANG); renderAll(); }); });
}
function renderDownloadBtn(){
  var el = document.getElementById('btn-download-standalone');
  if(el) el.textContent = T('descargar_html');
}
document.getElementById('btn-theme').addEventListener('click', function(){
  var root=document.documentElement;
  var cur = root.getAttribute('data-theme');
  var next = cur==='dark' ? 'light' : (cur==='light' ? null : 'dark');
  if(next) root.setAttribute('data-theme', next); else root.removeAttribute('data-theme');
});

/* ============================ titulo ejecutivo dinamico ============================
   Resume en una linea lo que se esta viendo segun los filtros activos (marca,
   lugar, fecha, y filtros secundarios si difieren del default) -- reemplaza
   las tarjetas de resumen (KPI strip) que se quitaron a pedido del usuario. */
function contextTitleHTML(creatives){
  var parts = [STATE.organization];
  if(STATE.region === 'Latam'){
    parts.push(T('latam'));
    if(STATE.paisSel.length < COUNTRIES.length) parts.push(countryLabel(STATE.paisSel));
  } else {
    parts.push(T('brazil'));
  }
  parts.push(STATE.year);
  var viewLabel = T('v_'+STATE.view) || STATE.view;
  parts.push(viewLabel);

  var sub = [];
  if(STATE.marketingOrg.length>1 || STATE.marketingOrg[0]!==STATE.organization) sub.push(T('mktorg')+': '+STATE.marketingOrg.join(' + '));
  if(STATE.excludeSemBrand) sub.push(T('excluir_sem_brand'));
  if(STATE.quarter !== 'Todos') sub.push(T('trimestre')+': '+STATE.quarter);
  if(STATE.mesSel.length) sub.push(T('mes')+': '+STATE.mesSel.map(mesLabel).join(', '));
  if(STATE.semana1) sub.push(T('primera_semana'));
  if(STATE.adType !== 'Todos') sub.push(T('ad_type')+': '+STATE.adType);
  sub.push(creatives.length+' '+T('creativos_activos_en')+' '+STATE.year);

  var metricChip = '<span class="context-metric-chip">'+METRIC_DEFS[STATE.metric].icon+' '+esc(metricLabel(STATE.metric))+'</span>';
  return '<h1>'+metricChip+' '+parts.map(esc).join(' · ')+'</h1><div class="context-sub">'+sub.map(esc).join(' · ')+'</div>';
}
function renderContextTitle(creatives){
  document.getElementById('context-title').innerHTML = contextTitleHTML(creatives);
}

/* ============================ rank list (reusado para ranking y para cada dimension) ============================ */
function rankListHTML(rows, opts){
  opts = opts || {};
  var activeMetric = STATE.metric;
  var minMax = computeMinMax(rows, activeMetric);
  return colorLegendHTML(activeMetric) + '<div class="rank-list">' + rows.map(function(r, i){
    var val = r[activeMetric];
    var color = rankColorCSS(activeMetric, val, minMax);
    var widthPct = Math.max(4, Math.round(metricBarFrac(activeMetric, val, minMax)*100));
    var nameHtml = opts.isCreative
      ? '<button class="rank-name-btn" data-daily-detail="'+escAttr(r.nombre)+'"><span>'+esc(r.nombre)+'</span></button>'+videoLinkHTML(r.link_video)
      : '<button class="rank-name-btn" data-def-dim="'+escAttr(opts.dim)+'" data-def-code="'+escAttr(r._code)+'"><span>'+esc(TAX(opts.dim, r._code))+'</span><span class="info-dot">i</span></button>';
    var subLabel = opts.isCreative
      ? (r.num_dias_activos+' '+T('dias_activos')+(r.marca?(' · '+r.marca):'')+(r.is_grouped?(' · '+r.versions.length+' '+T('versiones')):''))
      : ((r.num_creativos||0)+' '+T('creativos'));
    return '<div class="rank-item"><div class="rank-row">'+
      '<div class="rank-pos">'+(i+1)+'</div>'+
      '<div class="rank-name-wrap">'+nameHtml+'</div>'+
      '<div class="rank-val"><span class="rank-val-label">'+METRIC_DEFS[activeMetric].icon+' '+metricShort(activeMetric)+'</span><span class="rank-val-num">'+metricDisplayHTML(activeMetric,r)+'</span></div>'+
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
    var grouped = groupCreativesByAdName(creatives);
    grouped.forEach(function(r){ window.__creativeRowLookup[r.nombre]=r; });
    var ranked = grouped.slice().sort(function(a,b){ var av=a[STATE.metric],bv=b[STATE.metric]; if(av==null) return 1; if(bv==null) return -1; return METRIC_DEFS[STATE.metric].higherIsBetter?(bv-av):(av-bv); });
    page.innerHTML = '<div class="card"><div class="panel-title"><span>'+T('v_ranking')+' — '+grouped.length+' '+T('creativos_activos_en')+' '+STATE.year+'</span></div>'+rankListHTML(ranked,{isCreative:true})+'</div>';
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
    page.innerHTML = '<div class="card"><div class="panel-title"><span>'+T('v_'+dim.key)+'</span></div>'+rankListHTML(rows,{dim:dim.key})+'</div>';
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
        METRIC_ORDER.map(function(k){ return '<td class="num'+(k===STATE.metric?' active-metric':'')+'">'+metricDisplayHTML(k,r)+'</td>'; }).join('')+
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
function showToast(message){
  var container = document.getElementById('toast-container');
  if(!container) return;
  var el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = esc(message)+'<button class="toast-close" aria-label="Cerrar">✕</button>';
  container.appendChild(el);
  var timer = setTimeout(function(){ el.remove(); }, 5000);
  el.querySelector('.toast-close').addEventListener('click', function(){ clearTimeout(timer); el.remove(); });
}
/* Si MarketingOrganization queda en UNA sola marca (no varias) y esa marca es
   DISTINTA a Organization, el gasto de TODOS los creativos de la vista pasa
   a $0 (mktOrgDayFields lo fuerza asi) mientras los leads/ventas/New Cash
   Core siguen siendo reales (lo que esa otra marca le genero a Organization)
   -- comparar leads reales contra $0 de gasto da numeros invalidos en
   Leads/$1k, CPL o %MNCC. En ese caso, cambiar la metrica activa
   automaticamente a "Prom. Leads/dia" al ENTRAR a ese estado (no la vuelve a
   forzar si el usuario elige otra a mano despues, ni la revierte al salir). */
var PREV_CROSS_BRAND_ONLY = false;
function renderAll(){
  var crossBrandOnly = STATE.marketingOrg.length===1 && STATE.marketingOrg[0]!==STATE.organization;
  if(crossBrandOnly && !PREV_CROSS_BRAND_ONLY && (STATE.metric==='leads_per_1k' || STATE.metric==='cpl' || STATE.metric==='mncc_core_pct')){
    STATE.metric = 'avg_leads_dia';
    showToast(T('toast_auto_switch'));
  }
  PREV_CROSS_BRAND_ONLY = crossBrandOnly;
  updateAccent();
  document.documentElement.lang = LANG;
  var creatives = getWorkingCreatives();
  renderLangBtns();
  renderDownloadBtn();
  renderSidebar();
  renderViewTabs(creatives);
  renderContextTitle(creatives);
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

/* ============================ recorrido guiado ============================
   Se dispara solo una vez (localStorage) apenas termina de cargar la data,
   tanto en la version web (tras login) como en la version Standalone (sin
   login) -- ver `maybeAutoStartTour()` llamado desde boot() en dashboard.html.
   Tambien se puede repetir en cualquier momento desde el icono 🎓. */
var TOUR_STEPS = [
  { title:{en:'Welcome to TV Ads Performance',es:'Bienvenido a TV Ads Performance',pt:'Bem-vindo ao TV Ads Performance'},
    body:{en:'A quick tour of every filter, tab and button before you dive in. Replay it anytime from the 🎓 icon.',
      es:'Un recorrido rápido por cada filtro, pestaña y botón antes de empezar. Puedes repetirlo cuando quieras desde el ícono 🎓.',
      pt:'Um passeio rápido por cada filtro, aba e botão antes de começar. Repita quando quiser pelo ícone 🎓.'} },
  { group:'metric', selector:'#sel-metric', title:{en:'Success metric',es:'Métrica de éxito',pt:'Métrica de sucesso'},
    body:{en:'Choose how success is measured: Leads per $1,000, Avg. Leads/day, CPL, Conversion or % MNCC. The whole dashboard (ranking, colors, tabs) recalculates around whichever you pick.',
      es:'Elige con qué métrica medir el éxito: Leads x $1,000, Prom. Leads/día, CPL, Conversión o % MNCC. Todo el dashboard (ranking, colores, tabs) se recalcula según la que elijas.',
      pt:'Escolha como medir o sucesso: Leads por US$1.000, Méd. Leads/dia, CPL, Conversão ou % MNCC. Todo o dashboard (ranking, cores, abas) se recalcula de acordo com a escolhida.'} },
  { group:'semBrand', selector:'#sel-sembrand', title:{en:'Exclude SEM-Brand Spend',es:'Excluir SEM-Brand Spend',pt:'Excluir Gasto SEM-Brand'},
    body:{en:'The "Brand TV Channels" spend always mixes in some SEM-Brand digital spend, which you can’t control (it moves with competitor bidding, not your own strategy). Turn this on to net it out of Leads/$1,000, CPL and % MNCC.',
      es:'El gasto de "Brand TV Channels" siempre trae mezclado algo de gasto digital SEM-Brand, que no podemos controlar (varía por pujas de la competencia, no por nuestra estrategia). Actívalo para descontarlo de Leads/$1,000, CPL y % MNCC.',
      pt:'O gasto de "Brand TV Channels" sempre traz misturado um pouco de gasto digital SEM-Brand, que não podemos controlar (varia por lances da concorrência, não pela nossa estratégia). Ative para descontá-lo de Leads/$1.000, CPL e % MNCC.'} },
  { group:'window', selector:'[data-sbtoggle="window"]', title:{en:'Collapse any section',es:'Colapsa cualquier sección',pt:'Recolha qualquer seção'},
    body:{en:'Click a section title (with the ▾ arrow) to collapse or expand it and keep the sidebar tidy — every section works this way.',
      es:'Haz clic en el título de cualquier sección (con la flecha ▾) para colapsarla o expandirla y mantener el panel ordenado — todas las secciones funcionan así.',
      pt:'Clique no título de qualquer seção (com a seta ▾) para recolhê-la ou expandi-la e manter o painel organizado — todas as seções funcionam assim.'} },
  { selector:'#sidebar-toggle', title:{en:'Collapse the whole panel',es:'Colapsa todo el panel',pt:'Recolha o painel inteiro'},
    body:{en:'Click the ☰ icon to collapse or expand the ENTIRE filters panel (the left 0–20% of the screen) and get more room for the data.',
      es:'Haz clic en el ícono ☰ para colapsar o expandir TODO el panel de filtros (el 0–20% izquierdo de la pantalla) y ganar más espacio para la data.',
      pt:'Clique no ícone ☰ para recolher ou expandir TODO o painel de filtros (os 0–20% esquerdos da tela) e ganhar mais espaço para os dados.'} },
  { group:'window', selector:'#sel-semana1', title:{en:'Window & Ad Type',es:'Ventana y tipo de anuncio',pt:'Janela e tipo de anúncio'},
    body:{en:'Compare full history against just the first week of each launch, and filter by ad type (Promo or Generic).',
      es:'Compara el histórico completo contra solo la primera semana de cada lanzamiento, y filtra por tipo de anuncio (Promo o Genérico).',
      pt:'Compare o histórico completo com apenas a primeira semana de cada lançamento, e filtre por tipo de anúncio (Promo ou Genérico).'} },
  { group:'date', selector:'#sel-year', title:{en:'Date',es:'Fecha',pt:'Data'},
    body:{en:'Pick year, quarter and month (multi-select) to narrow down the exact dates being analyzed — e.g. "how did creatives perform in July 2026".',
      es:'Elige año, trimestre y mes (selección múltiple) para acotar las fechas exactas que se analizan — por ejemplo, "cómo funcionaron los creativos en julio de 2026".',
      pt:'Escolha ano, trimestre e mês (seleção múltipla) para restringir as datas exatas analisadas — por exemplo, "como os criativos performaram em julho de 2026".'} },
  { group:'brand', selector:'#sel-organization', title:{en:'Brand',es:'Marca',pt:'Marca'},
    body:{en:'Organization decides which creatives you see. MarketingOrganization decides which brands get pooled into those same creatives’ metrics (spend, leads, sales, New Cash Core).',
      es:'Organization define qué creativos ves. MarketingOrganization decide qué marcas se suman en las métricas (gasto, leads, ventas, New Cash Core) de esos mismos creativos.',
      pt:'Organization define quais criativos você vê. MarketingOrganization decide quais marcas são somadas nas métricas (gasto, leads, vendas, New Cash Core) desses mesmos criativos.'} },
  { group:'place', selector:'#sel-region', title:{en:'Place',es:'Lugar',pt:'Local'},
    body:{en:'Filter by region and country. In the country list you can click, Ctrl+click to add/remove, or click-and-drag to select a range.',
      es:'Filtra por región y país. En la lista de países puedes hacer clic, Ctrl+clic para sumar/quitar, o arrastrar para seleccionar un rango.',
      pt:'Filtre por região e país. Na lista de países você pode clicar, Ctrl+clique para adicionar/remover, ou clicar e arrastar para selecionar um intervalo.'} },
  { selector:'#viewtabs', title:{en:'Tabs',es:'Pestañas',pt:'Abas'},
    body:{en:'Each tab regroups the same creatives by a different dimension: Ranking, Campaign, Theme, Creative Mechanism, Pain Point, Hooks, CTA, Production, Tone — plus the Explorer, with everything in one table.',
      es:'Cada pestaña reagrupa los mismos creativos por una dimensión distinta: Ranking, Campaña, Theme, Mecanismo Creativo, Pain Point, Hooks, CTA, Producción, Tono — más el Explorador, con todo en una sola tabla.',
      pt:'Cada aba reagrupa os mesmos criativos por uma dimensão diferente: Ranking, Campanha, Theme, Mecanismo Criativo, Pain Point, Hooks, CTA, Produção, Tom — mais o Explorador, com tudo em uma única tabela.'} },
  { selector:'#lang-btns', title:{en:'Language',es:'Idioma',pt:'Idioma'},
    body:{en:'Switch the dashboard between English, Spanish and Portuguese anytime.',
      es:'Cambia el idioma del dashboard entre inglés, español y portugués en cualquier momento.',
      pt:'Mude o idioma do dashboard entre inglês, espanhol e português a qualquer momento.'} },
  { selector:'#btn-theme', title:{en:'Light / dark mode',es:'Modo claro / oscuro',pt:'Modo claro / escuro'},
    body:{en:'Toggle between light and dark mode.', es:'Alterna entre modo claro y oscuro.', pt:'Alterne entre modo claro e escuro.'} },
  { selector:'#btn-methodology', title:{en:'Methodology',es:'Metodología',pt:'Metodologia'},
    body:{en:'See the exact formula behind every metric.', es:'Aquí puedes ver la fórmula exacta detrás de cada métrica.', pt:'Veja a fórmula exata por trás de cada métrica.'} },
  { selector:'#btn-download-standalone', emphasis:true, title:{en:'⬇ Download the local version',es:'⬇ Descarga la versión local',pt:'⬇ Baixe a versão local'},
    body:{en:'Important: this downloads a fully self-contained copy of this dashboard, with all the data already included — no internet and no login needed to open it. Perfect for a presentation or to share without depending on a connection.',
      es:'Importante: esto descarga una copia 100% autocontenida de este dashboard, con todos los datos ya incluidos — no necesita internet ni inicio de sesión para abrirla. Ideal para una presentación o para compartirla sin depender de la conexión.',
      pt:'Importante: isso baixa uma cópia 100% autocontida deste dashboard, com todos os dados já incluídos — não precisa de internet nem de login para abri-la. Ideal para uma apresentação ou para compartilhar sem depender da conexão.'} },
];
var TOUR_IDX = 0;
function tourStepTarget(step){ return step.selector ? document.querySelector(step.selector) : null; }
/* El "spotlight" es el truco de box-shadow:0 0 0 9999px sobre este mismo
   elemento -- por eso SIEMPRE debe quedar visible mientras el tour esta
   activo, incluso en pasos sin elemento propio (ej. bienvenida): si se
   ocultaba (display:none) en esos pasos, el fondo dejaba de oscurecerse por
   completo y el tooltip quedaba flotando sin contraste sobre la pagina. Sin
   elemento, se centra una caja de tamaño 0 (sigue oscureciendo TODA la
   pantalla via el box-shadow) y se le quita el borde de acento. */
function positionTourHighlight(el){
  var hi = document.getElementById('tour-highlight');
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
function positionTourTooltip(el){
  var tip = document.getElementById('tour-tooltip');
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
function renderTourStep(){
  var step = TOUR_STEPS[TOUR_IDX];
  if(step.group && SB_COLLAPSED[step.group]){ SB_COLLAPSED[step.group]=false; renderSidebar(); }
  var el = tourStepTarget(step);
  if(el && el.scrollIntoView) el.scrollIntoView({block:'center'});
  document.getElementById('tour-progress').textContent = (TOUR_IDX+1)+' / '+TOUR_STEPS.length;
  document.getElementById('tour-title').textContent = step.title[LANG] || step.title.en;
  document.getElementById('tour-body').textContent = step.body[LANG] || step.body.en;
  document.getElementById('tour-skip').textContent = T('tour_skip');
  document.getElementById('tour-prev').textContent = T('tour_back');
  document.getElementById('tour-prev').style.visibility = TOUR_IDX===0 ? 'hidden' : 'visible';
  document.getElementById('tour-next').textContent = (TOUR_IDX===TOUR_STEPS.length-1) ? T('tour_finish') : T('tour_next');
  document.getElementById('tour-highlight').classList.toggle('tour-emphasis', !!step.emphasis);
  positionTourHighlight(el);
  positionTourTooltip(el);
}
function startTour(){
  TOUR_IDX = 0;
  document.getElementById('tour-blocker').style.display='block';
  document.getElementById('tour-tooltip').style.display='block';
  renderTourStep();
}
function endTour(){
  document.getElementById('tour-blocker').style.display='none';
  document.getElementById('tour-tooltip').style.display='none';
  document.getElementById('tour-highlight').style.display='none';
  localStorage.setItem('tvads_tour_seen','1');
}
function maybeAutoStartTour(){
  if(!localStorage.getItem('tvads_tour_seen')) startTour();
}
document.getElementById('tour-next').addEventListener('click', function(){
  if(TOUR_IDX >= TOUR_STEPS.length-1) endTour(); else { TOUR_IDX++; renderTourStep(); }
});
document.getElementById('tour-prev').addEventListener('click', function(){ if(TOUR_IDX>0){ TOUR_IDX--; renderTourStep(); } });
document.getElementById('tour-skip').addEventListener('click', endTour);
document.getElementById('btn-tour').addEventListener('click', startTour);
window.addEventListener('resize', function(){ if(document.getElementById('tour-tooltip').style.display==='block') renderTourStep(); });
