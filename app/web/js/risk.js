/* ---------- portfolio dashboard: sectors, concentration alerts, open risk (2.19) ----------
   Each market is shown in its own currency (riyal, pound, dollar): nothing is converted or added across markets.
   Names start with "rk" because "PF" and "pf…" already belong to the several-portfolios and performance code. */
const RK_MK={SR:['السعودية','ريال سعودي'],CA:['مصر','جنيه مصري'],US:['أمريكا','دولار أمريكي'],GOLD:['الذهب والفضة','بعملة إدخالك'],XX:['أخرى','بعملة إدخالك']};
const RK_ORDER=['SR','CA','US','GOLD','XX'];
const RK_DEF={posMax:25,secMax:40};

/* open trades -> positions; a trade without a fetched price is valued at its cost and flagged */
function rkPositions(trades){
  return trades.filter(t=>t&&!t.exit&&t.qty>0&&t.entry>0).map(t=>{
    const priced=t.last>0,px=priced?t.last:t.entry;
    return{id:t.id,code:t.code,name:t.name||t.code,ex:t.ex||'XX',sector:t.sector||'',sectorAr:t.sectorAr||'',qty:t.qty,entry:t.entry,last:priced?t.last:null,
      stop:t.stop>0?t.stop:null,priced,value:px*t.qty,cost:t.entry*t.qty,pl:priced?(px-t.entry)*t.qty:null};});
}
function rkLimits(){const u=(typeof P!=='undefined'&&P.rk)||{};const ok=v=>v!=null&&v!==''&&isFinite(v)&&+v>0&&+v<=100;return{posMax:ok(u.posMax)?+u.posMax:RK_DEF.posMax,secMax:ok(u.secMax)?+u.secMax:RK_DEF.secMax};}
/* one summary per market: value, profit, open risk (the loss if every stop is hit from today's price), sector and position shares, alerts */
function rkSummary(positions,lim,cash){
  lim=lim||rkLimits();cash=cash||{};const by={};
  for(const p of positions)(by[p.ex]=by[p.ex]||[]).push(p);
  return RK_ORDER.concat(Object.keys(by).filter(x=>!RK_ORDER.includes(x))).filter(ex=>by[ex]).map(ex=>{
    const ps=by[ex],value=ps.reduce((s,p)=>s+p.value,0),c=+cash[ex]>0?+cash[ex]:0,equity=value+c;
    const priced=ps.filter(p=>p.priced),cost=priced.reduce((s,p)=>s+p.cost,0),pl=priced.reduce((s,p)=>s+p.pl,0);
    const noStop=ps.filter(p=>p.stop==null),withStop=ps.filter(p=>p.stop!=null);
    const riskNow=withStop.reduce((s,p)=>s+Math.max(0,((p.last||p.entry)-p.stop)*p.qty),0);
    const sec={};for(const p of ps){const k=p.sector||p.sectorAr||'';const e=sec[k]=sec[k]||{key:k,sector:p.sector,sectorAr:p.sectorAr,value:0,n:0};e.value+=p.value;e.n++;}
    const sectors=Object.values(sec).map(e=>Object.assign(e,{share:equity>0?e.value/equity*100:0})).sort((a,b)=>b.value-a.value);
    const positionsOut=ps.map(p=>Object.assign({},p,{share:equity>0?p.value/equity*100:0})).sort((a,b)=>b.value-a.value);
    const alerts=[];
    for(const p of positionsOut)if(p.share>lim.posMax)alerts.push({type:'pos',ex,name:p.name,share:p.share,limit:lim.posMax});
    for(const s of sectors)if(s.key&&s.share>lim.secMax)alerts.push({type:'sec',ex,name:s.sectorAr||s.sector,sector:s.sector,share:s.share,limit:lim.secMax});
    return{ex,n:ps.length,value,cash:c,equity,cost,pl,plPct:cost>0?pl/cost:null,unpriced:ps.length-priced.length,riskNow,riskPct:equity>0?riskNow/equity:null,
      noStop:noStop.map(p=>p.name),sectors,positions:positionsOut,alerts};});
}
/* the calculator against the real portfolio of the same market: open risk before and after the new trade */
function rkRiskAfter(sum,newLoss){
  if(!sum||!(sum.equity>0))return null;const total=sum.riskNow+newLoss;
  return{now:sum.riskNow/sum.equity,total,pct:total/sum.equity,noStop:sum.noStop.length};
}

const rkCashKey=ex=>(J.pf||'all')+'|'+ex;
function rkCash(){const c=(P.rk&&P.rk.cash)||{},o={};for(const ex of RK_ORDER)if(c[rkCashKey(ex)]>0)o[ex]=c[rkCashKey(ex)];return o;}
function rkSummaries(){return rkSummary(rkPositions(J.trades),rkLimits(),rkCash());}
const rkSecName=s=>EN?(s.sector||s.sectorAr||''):(s.sectorAr||s.sector||'');
function rkBar(share,over){return '<span class="rk-bar'+(over?' over':'')+'"><i style="width:'+Math.min(100,Math.max(0,share)).toFixed(1)+'%"></i></span>';}

/* sectors come from the company data once per trade and are kept on the trade */
async function rkLoadSectors(){
  if(!LOCAL||!J.loaded)return;let changed=false;
  for(const t of J.all.filter(t=>!t.exit&&!t.sector&&!t.sectorAr&&(t.ex==='SR'||t.ex==='CA'||t.ex==='US')&&!(t.sectorTry&&Date.now()-t.sectorTry<864e5))){
    t.sectorTry=Date.now();changed=true;
    const r=await api('/api/fundamentals',{code:t.code,ex:t.ex}).catch(()=>null);
    if(r&&r.ok&&r.f&&r.f.sector){t.sector=r.f.sector;t.sectorAr=r.sectorAr||'';}}
  if(changed){await saveJournal();renderRisk();}
}
function renderRisk(){
  const box=$('#rkBox');if(!box)return;
  const sums=rkSummaries(),lim=rkLimits();
  if(!sums.length){box.hidden=true;return;}box.hidden=false;
  const money=v=>NUM(fmtMoney.format(v)),pc=v=>NUM((v*100).toFixed(1)+'%');
  const alerts=sums.flatMap(s=>s.alerts);
  $('#rkAlerts').innerHTML=alerts.map(a=>'<li>⚠ <b>'+esc(_t(RK_MK[a.ex][0]))+'</b>: '+(a.type==='pos'?_t('سهم')+' <b>'+esc(a.name)+'</b>':_t('قطاع')+' <b>'+esc(EN?(a.sector||a.name):(a.name||a.sector))+'</b>')
    +' '+_t('يمثل')+' <b>'+NUM(a.share.toFixed(1)+'%')+'</b> '+_t('من المحفظة، والحد الذي حددته')+' '+NUM(a.limit+'%')+'</li>').join('');
  $('#rkAlerts').hidden=!alerts.length;
  const kv=(k,v,sub)=>'<div class="metric"><span class="k">'+_t(k)+'</span><span class="v">'+v+'</span>'+(sub?'<span class="s">'+sub+'</span>':'')+'</div>';
  $('#rkMarkets').innerHTML=sums.map(s=>{
    const cur=RK_MK[s.ex]||[s.ex,''];
    let h='<div class="rk-mk"><h3>'+_t(cur[0])+' <small class="muted">('+_t(cur[1])+')</small></h3><div class="kpis rk-kpis">'
      +kv('قيمة الأسهم',money(s.value),s.unpriced?_t('منها')+' '+NUM(s.unpriced)+' '+_t('بسعر التكلفة (حدّث الأسعار)'):'')
      +kv('الربح غير المحقق',s.cost>0?'<span style="color:'+(s.pl>=0?'var(--up)':'var(--down)')+'">'+money(s.pl)+'</span>':'—',s.plPct!=null?chgSpan(s.plPct,1):'')
      +kv('المخاطرة المفتوحة',money(s.riskNow),(s.riskPct!=null?pc(s.riskPct):'—')+' '+_t('من رأس المال')+(s.noStop.length?' · <span class="rk-warn">'+NUM(s.noStop.length)+' '+_t('بلا وقف: مخاطرتها غير محسوبة')+'</span>':''))
      +'</div>';
    h+='<label class="field rk-cash"><span>'+_t('نقد غير مستثمر في هذا السوق (اختياري)')+'</span><input type="number" min="0" step="100" inputmode="decimal" data-rkcash="'+s.ex+'" value="'+(s.cash||'')+'"></label>';
    h+='<div class="rk-cols"><div><h4>'+_t('التوزيع على القطاعات')+'</h4>'+s.sectors.map(e=>{const nm=e.key?esc(rkSecName(e)):'<span class="muted">'+_t('غير محدد')+'</span>';return '<div class="rk-row"><span>'+nm+'</span>'+rkBar(e.share,e.key&&e.share>lim.secMax)+'<b>'+NUM(e.share.toFixed(1)+'%')+'</b></div>';}).join('')+'</div>'
      +'<div><h4>'+_t('حصة كل سهم')+'</h4>'+s.positions.map(p=>'<div class="rk-row"><span>'+esc(p.name)+'</span>'+rkBar(p.share,p.share>lim.posMax)+'<b>'+NUM(p.share.toFixed(1)+'%')+'</b></div>').join('')+'</div></div></div>';
    return h;}).join('');
  $('#rkLimTxt').textContent=_t('حدّ السهم الواحد')+' '+lim.posMax+'% · '+_t('حدّ القطاع')+' '+lim.secMax+'%.';
}
/* calculator: capital from the portfolio of the market being analysed, and the open risk before and after this trade */
function rkCalcMarket(){try{return J.loaded?rkSummaries().find(x=>x.ex===S.ex)||null:null;}catch(e){return null;}}
function rkCalcHTML(loss){
  const m=rkCalcMarket();if(!m||!(m.equity>0))return '';const r=rkRiskAfter(m,loss);
  return '<div style="grid-column:1/-1"><span>'+_t('المخاطرة المفتوحة في محفظتك بهذا السوق')+'</span><b>'+NUM((r.now*100).toFixed(1)+'%')+'</b> → <b style="color:'+(r.pct>0.06?'var(--sell)':'inherit')+'">'+NUM((r.pct*100).toFixed(1)+'%')+'</b> '+_t('بعد هذه الصفقة')
    +(r.noStop?' <span class="rk-warn">('+NUM(r.noStop)+' '+_t('صفقات بلا وقف غير محسوبة')+')</span>':'')+'</div>';}
function rkCalcButton(){const b=$('#calcFromRk');if(!b)return;const m=rkCalcMarket();b.hidden=!(m&&m.equity>0);}
function rkCalcCapital(){const m=rkCalcMarket();if(!m||!(m.equity>0))return;const v=Math.round(m.equity);$('#cCap').value=v;setPref('calc.capital',v);calcCompute();}
function setupRisk(){
  const box=$('#rkBox');if(!box)return;
  $('#rkGoSet').addEventListener('click',e=>{e.preventDefault();location.hash='#prefs';showPrefTab('gen');setTimeout(()=>{const el=$('#rkSetPanel');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},60);});
  box.addEventListener('change',e=>{const i=e.target.closest('[data-rkcash]');if(!i)return;const v=+i.value;if(!(v>=0))return;
    const cash=Object.assign({},P.rk&&P.rk.cash,{[rkCashKey(i.dataset.rkcash)]:v});setPref('rk.cash',cash);renderRisk();calcCompute();});
  $('#calcFromRk').addEventListener('click',rkCalcCapital);
  $('#pRkReset').addEventListener('click',()=>{setPref('rk.posMax',RK_DEF.posMax);setPref('rk.secMax',RK_DEF.secMax);$('#pRkPos').value=RK_DEF.posMax;$('#pRkSec').value=RK_DEF.secMax;renderRisk();toast(_t('استُعيد الحدّان الافتراضيان.'));});
}
