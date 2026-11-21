/* ---------- periodic opportunity scan of the three markets (2.20) ----------
   Runs in the background while the program is open, one market at a time, and keeps the strongest buy setups of each market
   under its own key, so the home page shows every market with the time of its last scan. It never touches the scanner page. */
const OPP_MK=[{ex:'SR',size:null},{ex:'CA',size:null},{ex:'US',size:'500'}];
const OPP_KEEP=30;
const OPP={running:false,stop:false,cur:'',done:0,total:0,err:{}};

/* the interval the user typed, kept inside a range that does not hammer the free data sources */
function oppInterval(v){v=+v;return isFinite(v)&&v>0?Math.min(1440,Math.max(15,Math.round(v))):60;}
/* scan now? A market with no saved result is scanned once even when closed, so the card is never empty;
   a closed market otherwise keeps its last result; an open one is scanned again after the interval. */
function oppDue(o){
  if(!o.lastAt)return true;
  if(!o.open)return false;
  return o.now-o.lastAt>=oppInterval(o.interval)*60000;
}
/* compact saved rows of one scan: only buy setups, strongest first */
function oppPick(rows,n){
  return(rows||[]).filter(r=>r&&r.stance==='buy').sort((a,b)=>(b.conf||0)-(a.conf||0)||(b.q||0)-(a.q||0)).slice(0,n||OPP_KEEP)
    .map(r=>({symbol:r.symbol,code:r.code,name:r.name,nameEn:r.nameEn,price:r.price,conf:r.conf,q:r.q,fairDisc:r.fairDisc==null?null:r.fairDisc}));
}
/* a scan that reached fewer than half of the companies is a refusal by the data source, not a result: the old result stays */
function oppUsable(reached,total){return total>0&&reached>=Math.ceil(total*0.5);}

async function oppScanMarket(m){
  const u=await api('/api/universe',m.size?{ex:m.ex,size:m.size}:{ex:m.ex}).catch(()=>null);
  if(!u||!u.ok||!u.items||!u.items.length)return{ok:false,why:'تعذّر جلب قائمة الشركات.'};
  const items=u.items,rows=[];let idx=0,reached=0;OPP.total=items.length;OPP.done=0;
  const worker=async()=>{while(!OPP.stop&&idx<items.length){const it=items[idx++];
    try{const j=await api('/api/history',{code:it.symbol,ex:m.ex==='US'?'US':'XX',range:'1y',lite:'1'});
      if(j.ok&&j.rows.length>=60){reached++;const D=rowsToData(j.rows),I=computeInd(D);
        const A=analyzeCore(D,I,{span:Math.min(250,D.length),sens:5,zoneCount:6,stopMult:P.ana.stopMult});
        if(A)rows.push({symbol:it.symbol,code:it.symbol.replace(/\.(SR|CA)$/,''),name:it.short||it.name,nameEn:it.nameEn||it.name,price:A.close,stance:A.stance,conf:A.dirStrength,q:scanExtras(D,I,A).q});}}
    catch(e){}
    OPP.done++;if(OPP.done%20===0)oppMeta();}};
  await Promise.all([worker(),worker(),worker()]);
  if(OPP.stop)return{ok:false,why:'أُوقف الفحص.'};
  if(!oppUsable(reached,items.length))return{ok:false,why:'مصدر البيانات رفض معظم الطلبات؛ بقيت نتيجة آخر فحص.'};
  const top=oppPick(rows,OPP_KEEP);
  if(top.length&&typeof scanFairOf==='function'){
    const d=await api('/api/scanfund',m.size?{ex:m.ex,size:m.size}:{ex:m.ex}).catch(()=>null);
    if(d&&d.ok)for(const r of top){const x=scanFairOf(d,r,m.ex);r.fairDisc=x?x.disc:null;}}
  await Store.set('opp:'+m.ex,{ex:m.ex,at:Date.now(),n:items.length,reached,rows:top});
  return{ok:true,n:top.length};
}
function oppMeta(extra){
  const t=OPP.running?_t('جارٍ فحص')+' '+_t(SESSIONS[OPP.cur].ar)+' · '+NUM(OPP.done)+'/'+NUM(OPP.total):(extra||'');
  for(const id of ['#oppMeta','#homeOppMeta']){const el=$(id);if(el)el.textContent=t;}
}
/* one pass over the markets that are due (or all the chosen ones when forced) */
async function oppRun(force){
  if(!LOCAL||OPP.running||SC.running)return;
  OPP.running=true;OPP.stop=false;let did=false;
  try{for(const m of OPP_MK){
      if(OPP.stop)break;
      if(!(P.opp&&P.opp.mk&&P.opp.mk[m.ex]))continue;
      const last=await Store.get('opp:'+m.ex,null),now=Date.now();
      if(!force&&!oppDue({open:marketStatus(m.ex,new Date(now)).open,lastAt:last&&last.at,now,interval:P.opp.interval}))continue;
      OPP.cur=m.ex;OPP.done=0;OPP.total=0;oppMeta();
      const r=await oppScanMarket(m).catch(e=>({ok:false,why:'خطأ غير متوقع.'}));
      OPP.err[m.ex]=r.ok?'':(r.why||'');did=true;
      await renderHomeOpp();}
  }finally{OPP.running=false;}
  oppMeta(did?_t('اكتمل الفحص')+' · '+fmtLocalTime.format(new Date()):'');
}
async function oppTick(){if(P.opp&&P.opp.on)await oppRun(false);}

/* ---- home card: every market with its own last-scan time ---- */
async function renderHomeOpp(){
  const box=$('#homeOpp');if(!box)return;const parts=[];
  for(const m of OPP_MK){
    if(!(P.opp&&P.opp.mk&&P.opp.mk[m.ex]))continue;
    let d=await Store.get('opp:'+m.ex,null);
    if(!d){const ls=await Store.get('lastScan',null);   /* before the first periodic scan: the last manual scan of that market, if any */
      if(ls&&ls.ex===m.ex&&ls.rows)d={at:ls.at,rows:oppPick(ls.rows,OPP_KEEP),manual:true};}
    const st=marketStatus(m.ex,new Date()),top=d?d.rows.slice(0,5):[];
    let h='<div class="opp-mk"><h3>'+esc(_t(SESSIONS[m.ex].ar))+' <span class="kind '+(st.open?'s':'n')+'">'+esc(_t(st.open?'مفتوحة':'مغلقة'))+'</span></h3>';
    if(!d)h+='<p class="small muted">'+esc(_t(P.opp.on?'لم يُفحص هذا السوق بعد؛ سيبدأ الفحص تلقائيًا.':'شغّل الفحص الدوري من الإعدادات أو اضغط «افحص الآن».'))+'</p>';
    else{h+=top.length?'<ul class="list">'+top.map(r=>'<li><span class="kind s">'+NUM((r.conf||0)+'%')+'</span><span><a href="#" data-open="'+esc(m.ex)+':'+esc(r.code)+'"><b>'+esc(EN?(r.nameEn||r.name):r.name)+'</b></a> <span class="small muted num">'+esc(r.code)+'</span> '+mkBadge(m.ex)+' '
        +'<span class="small muted">'+NUM(fp(r.price))+(r.fairDisc!=null?' · '+esc(_t('السعر العادل'))+' '+NUM((r.fairDisc>=0?'+':'')+r.fairDisc.toFixed(0)+'%'):'')+'</span></span></li>').join('')+'</ul>'
        :'<p class="small muted">'+esc(_t('لا توجد أسهم في منطقة شراء في آخر فحص.'))+'</p>';
      h+='<p class="small muted">'+esc(_t(d.manual?'من آخر فحص يدوي للماسح':'آخر فحص'))+' · '+NUM(fmtLocalTime.format(new Date(d.at)))+(st.open?'':' · '+esc(_t('السوق مغلق: تبقى نتيجة آخر فحص')))+'</p>';}
    if(OPP.err[m.ex])h+='<p class="small rk-warn">'+esc(_t(OPP.err[m.ex]))+'</p>';
    parts.push(h+'</div>');}
  box.innerHTML=parts.length?parts.join(''):'<p class="small muted">'+esc(_t('كل الأسواق متوقفة في إعدادات الفحص الدوري.'))+'</p>';
}
function setupOpp(){
  const go=()=>{oppRun(true);};
  for(const id of ['#oppNow','#homeOppNow']){const b=$(id);if(b)b.addEventListener('click',go);}
  const s=$('#oppStop');if(s)s.addEventListener('click',()=>{OPP.stop=true;});
  $$('#oppSet [data-pref]').forEach(el=>el.addEventListener('change',()=>{renderHomeOpp();if(el.dataset.pref==='opp.interval')setPref('opp.interval',oppInterval(el.value));}));
}
