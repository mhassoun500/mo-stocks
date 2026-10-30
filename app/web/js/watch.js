/* ================= watchlist, alerts, morning report, market scanner (desktop app) ================= */
const W={items:[],res:{},checking:false,lastCheck:0};
const wKey=it=>it.ex+':'+it.code;
const STANCE_AR={buy:'منطقة شراء',sell:'منطقة بيع',neutral:'انتظار'};
const stanceKind=s=>s==='buy'?'s':s==='sell'?'r':'n';

async function analyzeAsset(ex,code,withBacktest){
  const j=await api('/api/history',{code,ex,range:'1y'});
  if(!j.ok)throw new Error(j.error||'تعذّر جلب البيانات');
  const D=rowsToData(j.rows),I=computeInd(D);
  let htf=null;const w=aggregateWeekly(D);if(w.length>=30){const Aw=analyzeCore(w,computeInd(w),{span:w.length,sens:3,zoneCount:6,lite:true});htf=Aw&&Aw.zones;}
  const A=analyzeCore(D,I,{span:Math.min(250,D.length),sens:5,zoneCount:6,stopMult:P.ana.stopMult,htf});
  const bt=withBacktest?runBacktest(D,I,{span:A.span,sens:5,zoneCount:6,stopMult:P.ana.stopMult}):null;
  const bc=blendConfidence(A,bt);
  return{j,D,A,conf:bc?bc.conf:null,price:A.close,chg:A.close/D[D.length-2].c-1,lastT:D[D.length-1].t};
}

/* ---------- watchlist ---------- */
async function loadWatch(){W.items=await Store.get('watchlist',[]);renderWatch();}
async function saveWatch(){await Store.set('watchlist',W.items);}
async function addCurrentToWatch(){
  if(S.source!=='live'){toast('أضف أصلًا بعد جلب بياناته تلقائيًا، وليس من ملف أو بيانات تجريبية.');return;}
  if(W.items.some(it=>it.ex===S.ex&&it.code===S.code)){toast('هذا الأصل موجود في قائمة المراقبة.');return;}
  W.items.push({ex:S.ex,code:S.code,name:S.name,short:(S.meta&&S.meta.short)||'',above:null,below:null});await saveWatch();
  toast('أضيف '+(S.meta&&S.meta.short||S.code)+' إلى قائمة المراقبة.');renderWatch();checkWatchlist(false);
}
function renderWatch(){
  const body=$('#watchBody');if(!body)return;
  if(!W.items.length){body.innerHTML='<tr><td colspan="10" class="empty">قائمة المراقبة فارغة. افتح أي سهم أو معدن في صفحة التحليل واضغط «أضف إلى المراقبة».</td></tr>';return;}
  body.innerHTML=W.items.map((it,i)=>{const r=W.res[wKey(it)];
    const nm='<b>'+esc(it.short||it.code)+'</b><br><span class="small muted">'+esc((it.name||'').slice(0,34))+'</span>';
    const alerts='<input type="number" step="0.01" data-i="'+i+'" data-k="above" value="'+(it.above??'')+'" placeholder="أعلى من" aria-label="تنبيه إذا تجاوز السعر" style="width:90px;font:inherit;font-size:13px;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);direction:ltr"> '+
      '<input type="number" step="0.01" data-i="'+i+'" data-k="below" value="'+(it.below??'')+'" placeholder="أدنى من" aria-label="تنبيه إذا نزل السعر" style="width:90px;font:inherit;font-size:13px;padding:3px 6px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);direction:ltr">';
    if(!r)return '<tr><td>'+nm+'</td><td colspan="7" class="muted">'+(W.checking?'جارٍ الفحص…':'لم يُفحص بعد')+'</td><td>'+alerts+'</td><td><button class="btn xs ghost" data-del="'+i+'" type="button">إزالة</button></td></tr>';
    if(r.err)return '<tr><td>'+nm+'</td><td colspan="7" class="status err">'+esc(r.err)+'</td><td>'+alerts+'</td><td><button class="btn xs ghost" data-del="'+i+'" type="button">إزالة</button></td></tr>';
    const A=r.A;
    return '<tr class="clickable" data-open="'+i+'"><td>'+nm+'</td><td>'+NUM(fp(r.price))+'</td><td>'+chgSpan(r.chg)+'</td><td><span class="kind '+stanceKind(A.stance)+'">'+STANCE_AR[A.stance]+'</span></td>'+
      '<td>'+(r.conf!=null?NUM(r.conf+'%'):'—')+'</td><td>'+(A.buy?NUM(pct((A.buy.hi-A.close)/A.close)):'—')+'</td><td>'+(A.sell?NUM(pct((A.sell.lo-A.close)/A.close)):'—')+'</td>'+
      '<td>'+(A.rsi!=null?NUM(A.rsi.toFixed(0)):'—')+'</td><td>'+alerts+'</td><td><button class="btn xs ghost" data-del="'+i+'" type="button">إزالة</button></td></tr>';}).join('');
  $('#watchMeta').textContent=W.lastCheck?'آخر فحص '+fmtLocalTime.format(new Date(W.lastCheck)):'';
}
function alertFlags(it,r,trades){
  const A=r.A,D=r.D,N=D.length,nm=it.short||it.code,f=[];
  const yieldFund=r.j.isFund&&(r.j.category==='money'||r.j.category==='fixed');
  if(!yieldFund&&A.buy&&A.close<=A.buy.hi*1.01)f.push({k:'buy',msg:nm+' دخل منطقة الشراء '+fp(A.buy.lo)+' – '+fp(A.buy.hi)+' (السعر '+fp(A.close)+')'});
  if(!yieldFund&&A.sell&&A.close>=A.sell.lo*0.99)f.push({k:'sell',msg:nm+' وصل منطقة البيع '+fp(A.sell.lo)+' – '+fp(A.sell.hi)+' (السعر '+fp(A.close)+')'});
  for(const b of A.brk)if(b.i===N-1&&b.status==='confirmed')f.push({k:'brk'+b.dir+'-'+r.lastT,msg:nm+(b.dir>0?': اختراق مؤكد للمستوى ':': كسر مؤكد للمستوى ')+fp(b.dir>0?b.z.hi:b.z.lo)});
  for(const p of A.pats)if(p.confirmed)f.push({k:'pat-'+p.key+'-'+Math.round(p.neck*100),msg:nm+': اكتمل نموذج '+p.name+'، والهدف '+fp(p.target)});
  if(it.above&&A.close>=it.above)f.push({k:'above-'+it.above,msg:nm+' تجاوز السعر '+fp(it.above)+' (الآن '+fp(A.close)+')'});
  if(it.below&&A.close<=it.below)f.push({k:'below-'+it.below,msg:nm+' نزل تحت '+fp(it.below)+' (الآن '+fp(A.close)+')'});
  for(const e of r.events||[]){const d=Math.ceil((e.t-Date.now())/DAY);if(d>=0&&d<=2)f.push({k:'ev-'+e.t,msg:nm+': '+e.txt+(d===0?' اليوم':d===1?' غدًا':' بعد يومين')});}
  for(const t of trades)if(t.ex===it.ex&&t.code===it.code&&!t.exit){
    if(t.stop&&A.close<=t.stop)f.push({k:'stop-'+t.id,msg:nm+': وصل السعر '+fp(A.close)+' إلى وقف الخسارة '+fp(t.stop)+' لصفقتك المفتوحة'});
    if(t.target&&A.close>=t.target)f.push({k:'tgt-'+t.id,msg:nm+': حققت صفقتك الهدف '+fp(t.target)+' (السعر '+fp(A.close)+')'});}
  return f;
}
async function assetEvents(ex,j){
  if(ex==='GOLD'){const f=FOMC.find(t=>t+DAY>Date.now());return f?[{t:f,txt:'قرار الفيدرالي الأمريكي'}]:[];}
  const p=await api('/api/profile',{symbol:j.symbol}).catch(()=>null);const ev=[];
  if(p&&p.ok){for(const e of p.earningsDates||[])if(e*1000+DAY>Date.now()){ev.push({t:e*1000,txt:'إعلان النتائج'});break;}
    if(p.exDividendDate&&p.exDividendDate*1000+DAY>Date.now())ev.push({t:p.exDividendDate*1000,txt:'استحقاق التوزيع'});}
  return ev;
}
async function checkWatchlist(notify){
  if(!LOCAL||W.checking||!W.items.length)return;W.checking=true;renderWatch();
  const trades=await Store.get('journal',[]);const state=await Store.get('alertState',{});const fresh=[];
  for(const it of W.items){
    try{const r=await analyzeAsset(it.ex,it.code,true);r.events=await assetEvents(it.ex,r.j);W.res[wKey(it)]=r;
      const flags=alertFlags(it,r,trades),prev=new Set(state[wKey(it)]||[]);
      for(const f of flags)if(!prev.has(f.k))fresh.push(f);
      state[wKey(it)]=flags.map(f=>f.k);}
    catch(e){W.res[wKey(it)]={err:e.message||'تعذّر الفحص'};}
    renderWatch();
  }
  W.checking=false;W.lastCheck=Date.now();renderWatch();await Store.set('alertState',state);
  if(fresh.length){
    const log=await Store.get('alertLog',[]);for(const f of fresh)log.unshift({t:Date.now(),msg:f.msg});await Store.set('alertLog',log.slice(0,150));renderAlertLog();
    if(notify&&P.alerts.enabled){
      const body=fresh.slice(0,4).map(f=>f.msg).join('\n')+(fresh.length>4?'\nو'+(fresh.length-4)+' تنبيهات أخرى':'');
      apiPost('/api/notify',{title:'تنبيهات محلل الأسهم ('+fresh.length+')',body,desktop:P.alerts.desktop,telegram:P.alerts.telegram,
        text:'🔔 تنبيهات Mo Stocks\n\n'+fresh.map(f=>'• '+f.msg).join('\n')}).catch(()=>{});
      toast(fresh[0].msg+(fresh.length>1?' (+'+(fresh.length-1)+')':''));}
  }
}
async function renderAlertLog(){const log=await Store.get('alertLog',[]);
  $('#alertLog').innerHTML=log.length?log.slice(0,60).map(l=>'<li class="plain"><span>'+esc(l.msg)+'</span><br><span class="d">'+fmtLocalTime.format(new Date(l.t))+'</span></li>').join(''):'<li class="plain"><p class="empty">لا توجد تنبيهات بعد.</p></li>';}

/* ---------- morning report ---------- */
async function buildReport(){
  await checkWatchlist(false);
  const lines=['☀️ التقرير الصباحي — '+fmtLocal.format(new Date()),''];
  if(!W.items.length)lines.push('قائمة المراقبة فارغة.');
  for(const it of W.items){const r=W.res[wKey(it)];const nm=(it.short||it.code)+(it.short?'':'')+(it.name&&!it.short?' — '+it.name.slice(0,28):'');
    if(!r||r.err){lines.push('• '+nm+': تعذّر الفحص');continue;}const A=r.A;
    lines.push('• '+nm+': '+fp(r.price)+' ('+pct(r.chg,1)+') — '+STANCE_AR[A.stance]+(r.conf!=null?'، الثقة '+r.conf+'%':''));
    lines.push('   دعم '+(A.buy?fp(A.buy.lo)+'–'+fp(A.buy.hi):'—')+' | مقاومة '+(A.sell?fp(A.sell.lo)+'–'+fp(A.sell.hi):'—')+(A.notable?' | '+A.notable:''));
    for(const e of r.events||[]){const d=Math.ceil((e.t-Date.now())/DAY);if(d>=0&&d<=7)lines.push('   📅 '+e.txt+' '+(d===0?'اليوم':'بعد '+d+' يوم'));}}
  const trades=(await Store.get('journal',[])).filter(t=>!t.exit);
  if(trades.length){lines.push('','💼 الصفقات المفتوحة');let tot=0;
    for(const t of trades){const r=W.res[t.ex+':'+t.code];const px=r&&r.price?r.price:null;
      if(px){const pl=(px-t.entry)*t.qty;tot+=pl;lines.push('• '+(t.name||t.code)+': '+fmtMoney.format(pl)+' ('+pct(px/t.entry-1,1)+')');}
      else lines.push('• '+(t.name||t.code)+': أضفه لقائمة المراقبة لمتابعة سعره');}
    lines.push('الإجمالي غير المحقق: '+fmtMoney.format(tot));}
  lines.push('','تحليل فني آلي وليس توصية استثمارية.');
  const text=lines.join('\n');$('#reportText').textContent=text;$('#reportMeta').textContent='أُنشئ '+fmtLocalTime.format(new Date());
  return text;
}
async function sendReport(){
  const text=await buildReport();
  const j=await apiPost('/api/notify',{title:'التقرير الصباحي جاهز',body:W.items.length+' أصول في قائمة المراقبة',desktop:true,telegram:true,text}).catch(()=>null);
  await Store.set('lastReport',todayKey());
  if(j&&j.telegram===true)toast('أُرسل التقرير إلى تيليجرام.');else if(j&&typeof j.telegram==='string')toast(j.telegram);else if(!P.telegram.enabled)toast('أُنشئ التقرير. فعّل تيليجرام من الإعدادات لإرساله إلى هاتفك.');
}
async function schedulerTick(){
  if(!LOCAL)return;const now=new Date();
  if(P.alerts.enabled&&W.items.length&&Date.now()-W.lastCheck>=Math.max(5,P.alerts.interval)*60000)checkWatchlist(true);
  if(P.report.enabled&&(P.report.days||[]).includes(now.getDay())){const [h,m]=(P.report.time||'09:30').split(':').map(Number);
    if(now.getHours()*60+now.getMinutes()>=h*60+m&&(await Store.get('lastReport',''))!==todayKey())sendReport();}
}

/* ---------- market scanner ---------- */
const SC={running:false,stop:false,rows:[],sector:null,sort:{k:'conf',dir:'desc'},ex:'SR',sel:'SR'};
const SEG_AR={main:'الرئيسية',nomu:'نمو',reit:'ريت'};
const scanExOf=v=>/^US/.test(v)?{ex:'US',size:v.slice(2)}:{ex:v,size:null};
const rowSharia=r=>{const u=shariaStatus(r.code);return u?{s:u,auto:false}:r.shariaAuto?{s:r.shariaAuto,auto:true,why:r.shariaWhy}:null;};
function updateScanSeg(){$('#scanSegField').hidden=$('#scanEx').value!=='SR';$('#usShariaNote').hidden=!/^US/.test($('#scanEx').value);}
async function runScan(){
  if(SC.running)return;SC.running=true;SC.stop=false;SC.sector=null;
  const sel=$('#scanEx').value,{ex,size}=scanExOf(sel);SC.ex=ex;SC.sel=sel;$('#scanGo').hidden=true;$('#scanStop').hidden=false;$('#scanProg').hidden=false;
  $('#scanMeta').textContent='جارٍ جلب قائمة الشركات…';
  const u=await api('/api/universe',size?{ex,size}:{ex}).catch(()=>null);
  if(!u||!u.ok){$('#scanMeta').textContent=(u&&u.error)||'تعذّر جلب قائمة الشركات.';endScan();return;}
  SC.rows=[];const items=u.items;let done=0,idx=0;
  const worker=async()=>{while(!SC.stop&&idx<items.length){const it=items[idx++];
      try{const j=await api('/api/history',{code:it.symbol,ex:ex==='US'?'US':'XX',range:'1y',lite:'1'});
        if(j.ok&&j.rows.length>=60){const D=rowsToData(j.rows),I=computeInd(D);const A=analyzeCore(D,I,{span:Math.min(250,D.length),sens:5,zoneCount:6,stopMult:P.ana.stopMult});
          if(A)SC.rows.push({symbol:it.symbol,code:it.symbol.replace(/\.(SR|CA)$/,''),name:EN?(it.nameEn||it.name):(it.short||it.name),price:A.close,chg:it.chg!=null?it.chg/100:A.close/D[D.length-2].c-1,
            stance:A.stance,stanceN:A.stance==='buy'?1:A.stance==='sell'?-1:0,conf:A.dirStrength,bull:A.bull,distBuy:A.buy?(A.buy.hi-A.close)/A.close:null,
            rsi:A.rsi,trend:A.trend,trendN:A.trendN,notable:A.notable,sector:(EN?it.sectorEn:'')||it.sector||null,segment:it.segment||'',shariaAuto:it.shariaAuto||'',shariaWhy:it.shariaWhy||''});}}
      catch(e){}
      done++;$('#scanProg i').style.width=(done/items.length*100).toFixed(1)+'%';$('#scanMeta').textContent='فُحص '+done+' من '+items.length;
      if(done%15===0)renderScan();}};
  await Promise.all([worker(),worker(),worker(),worker()]);
  renderScan();
  if(!SC.stop&&!SC.rows.length){$('#scanMeta').textContent='لم تصل بيانات أسعار لأي شركة. غالبًا مصدر البيانات يرفض الطلبات مؤقتًا بسبب كثرتها؛ انتظر بضع دقائق ثم أعد الفحص.';
    $('#scanBody').innerHTML='<tr><td colspan="10" class="status err">لم تصل بيانات أسعار. أعد المحاولة بعد بضع دقائق.</td></tr>';endScan();return;}
  if(!SC.stop&&SC.rows.some(r=>!r.sector)){$('#scanMeta').textContent='اكتمل فحص '+SC.rows.length+' شركة · '+fmtLocalTime.format(new Date())+' · جارٍ تصنيف القطاعات…';await loadSectors();}
  else $('#scanMeta').textContent='آخر فحص '+fmtLocalTime.format(new Date())+' · '+SC.rows.length+' شركة';
  renderHeat();
  Store.set('lastScan',{ex,sel,at:Date.now(),rows:SC.rows});
  endScan();
}
function endScan(){SC.running=false;$('#scanGo').hidden=false;$('#scanStop').hidden=true;$('#scanProg').hidden=true;}
async function loadSectors(){
  for(let round=0;round<12&&!SC.stop;round++){
    const syms=SC.rows.map(r=>r.symbol);const j=await apiPost('/api/sectors',{symbols:syms}).catch(()=>null);if(!j||!j.ok)break;
    for(const r of SC.rows)if(j.sectors[r.symbol]!=null)r.sector=j.sectors[r.symbol];
    renderScan();renderHeat();
    if(!j.missing)break;$('#scanMeta').textContent='جارٍ تصنيف القطاعات… بقي '+j.missing;
  }
  $('#scanMeta').textContent='آخر فحص '+fmtLocalTime.format(new Date())+' · '+SC.rows.length+' شركة';
}
function scanFiltered(){
  const st=$('#scanStance').value,minC=+$('#scanConf').value||0,sh=$('#scanSharia').checked,seg=SC.ex==='SR'?$('#scanSeg').value:'';
  return SC.rows.filter(r=>(!st||r.stance===st)&&(!seg||r.segment===seg)&&(!minC||(r.conf||0)>=minC)&&(!sh||(rowSharia(r)||{}).s==='ok')&&(!SC.sector||sectorAr(r.sector)===SC.sector));
}
function renderScan(){
  const rows=scanFiltered().slice();const {k,dir}=SC.sort;const m=dir==='asc'?1:-1;
  rows.sort((a,b)=>{const x=a[k],y=b[k];if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return(typeof x==='string'?x.localeCompare(y,'ar'):x-y)*m;});
  $$('#scanTable th button').forEach(b=>{if(b.dataset.sort===k)b.dataset.dir=dir;else delete b.dataset.dir;});
  $('#scanBody').innerHTML=rows.length?rows.slice(0,2000).map(r=>{const shr=rowSharia(r),sh=shr&&shr.s;
    return '<tr class="clickable" data-sym="'+esc(r.symbol)+'"><td><b>'+esc(r.name)+'</b> <span class="num small muted">'+esc(/^\d+$/.test(r.code)||SC.ex==='US'?r.code:'')+'</span>'+(r.segment&&r.segment!=='main'?'<span class="tag seg-'+r.segment+'">'+SEG_AR[r.segment]+'</span>':'')+(sh?'<span class="tag '+(sh==='ok'?'b':'x')+'"'+(shr.auto?' title="'+esc(_t(shr.why||''))+'"':'')+'>'+(sh==='ok'?(shr.auto?'متوافق مبدئيًا':'متوافق'):(shr.auto?'غير متوافق مبدئيًا':'غير متوافق'))+'</span>':'')+'</td>'+
      '<td>'+NUM(fp(r.price))+'</td><td>'+chgSpan(r.chg)+'</td><td><span class="kind '+stanceKind(r.stance)+'">'+STANCE_AR[r.stance]+'</span></td><td>'+(r.conf!=null?NUM(r.conf+'%'):'—')+'</td>'+
      '<td>'+(r.distBuy!=null?NUM(pct(r.distBuy)):'—')+'</td><td>'+(r.rsi!=null?NUM(r.rsi.toFixed(0)):'—')+'</td><td>'+r.trend+'</td><td>'+esc(r.notable||'')+'</td><td>'+esc(r.sector?sectorAr(r.sector):'')+'</td></tr>';}).join('')
    :'<tr><td colspan="10" class="empty">'+(SC.rows.length?'لا توجد نتائج تطابق التصفية.':'اختر السوق واضغط «ابدأ الفحص».')+'</td></tr>';
}
function renderHeat(){
  const g={};const seg=SC.ex==='SR'?$('#scanSeg').value:'';for(const r of SC.rows){if(r.sector==null||(seg&&r.segment!==seg))continue;const s=sectorAr(r.sector);(g[s]=g[s]||{n:0,chg:0,buy:0});g[s].n++;g[s].chg+=r.chg||0;if(r.stance==='buy')g[s].buy++;}
  const list=Object.entries(g).map(([s,v])=>({s,n:v.n,chg:v.chg/v.n,buy:v.buy})).sort((a,b)=>b.chg-a.chg);
  if(!list.length){$('#heat').innerHTML='<p class="empty">شغّل الفحص لتظهر خريطة القطاعات.</p>';return;}
  $('#heat').innerHTML=list.map(x=>{const a=Math.min(60,Math.round(Math.abs(x.chg)*100*18));const col=x.chg>=0?'var(--buy)':'var(--sell)';
    return '<button type="button" data-sec="'+esc(x.s)+'" aria-pressed="'+(SC.sector===x.s)+'" style="background:color-mix(in srgb,'+col+' '+a+'%,var(--surface))"><b>'+esc(x.s)+'</b><span>'+NUM(pct(x.chg,2))+' · '+x.n+' شركة · '+x.buy+' في منطقة شراء</span></button>';}).join('');
}

function setupWatchViews(){
  if(!LOCAL)return;
  $('#watchAdd').addEventListener('click',addCurrentToWatch);
  $('#watchRefresh').addEventListener('click',()=>checkWatchlist(true));
  $('#watchBody').addEventListener('click',e=>{
    const del=e.target.closest('[data-del]');if(del){e.stopPropagation();const i=+del.dataset.del;const it=W.items.splice(i,1)[0];delete W.res[wKey(it)];saveWatch();renderWatch();return;}
    if(e.target.closest('input'))return;
    const tr=e.target.closest('tr[data-open]');if(!tr)return;const it=W.items[+tr.dataset.open];location.hash='#analysis';applySource(it.ex,it.code);fetchSymbol(it.code,it.ex);});
  $('#watchBody').addEventListener('change',e=>{const inp=e.target.closest('input[data-k]');if(!inp)return;const it=W.items[+inp.dataset.i];it[inp.dataset.k]=inp.value?+inp.value:null;saveWatch();});
  $('#alertClear').addEventListener('click',async()=>{await Store.set('alertLog',[]);renderAlertLog();});
  $('#reportNow').addEventListener('click',buildReport);
  $('#reportSend').addEventListener('click',sendReport);
  $('#scanGo').addEventListener('click',runScan);
  $('#scanStop').addEventListener('click',()=>{SC.stop=true;});
  ['scanStance','scanConf','scanSharia','scanSeg'].forEach(id=>$('#'+id).addEventListener('input',()=>{renderScan();renderHeat();}));
  $('#scanEx').addEventListener('change',updateScanSeg);updateScanSeg();
  $('#scanTable thead').addEventListener('click',e=>{const b=e.target.closest('button[data-sort]');if(!b)return;const k=b.dataset.sort;
    SC.sort={k,dir:SC.sort.k===k&&SC.sort.dir==='desc'?'asc':'desc'};renderScan();});
  $('#scanBody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-sym]');if(!tr)return;location.hash='#analysis';applySource(SC.ex,tr.dataset.sym);fetchSymbol(tr.dataset.sym,SC.ex);});
  $('#heat').addEventListener('click',e=>{const b=e.target.closest('button[data-sec]');if(!b)return;SC.sector=SC.sector===b.dataset.sec?null:b.dataset.sec;renderHeat();renderScan();});
  Store.get('lastScan',null).then(ls=>{if(ls&&ls.rows&&!SC.rows.length){SC.rows=ls.rows;SC.ex=ls.ex;SC.sel=ls.sel||ls.ex;$('#scanEx').value=SC.sel;updateScanSeg();$('#scanMeta').textContent='نتائج آخر فحص · '+fmtLocalTime.format(new Date(ls.at));renderScan();renderHeat();}});
  loadWatch();renderAlertLog();
  setInterval(schedulerTick,60000);setTimeout(schedulerTick,8000);
}
