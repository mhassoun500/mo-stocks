/* ================= events calendar for the watchlist and the portfolio (Phase 4, step 3) ================= */
const CAL_KIND={earn:'إعلان النتائج',exdiv:'تاريخ استحقاق التوزيع',divpay:'صرف التوزيع',
  ann_assembly:'إعلان عن جمعية عمومية',ann_dividend:'إعلان عن توزيع أرباح',fomc:'قرار الفيدرالي الأمريكي'};
const CAL={events:null,failed:[],busy:false,loaded:false};

/* the assets to follow: watchlist and open trades, each with where it comes from */
function calAssets(watch,trades){
  const m=new Map();
  for(const it of watch||[]){const k=it.ex+':'+it.code;m.set(k,{ex:it.ex,code:it.code,name:it.short||it.name||it.code,from:new Set(['watch'])});}
  for(const t of trades||[])if(!t.exit&&t.code){const k=t.ex+':'+t.code,o=m.get(k);if(o)o.from.add('port');else m.set(k,{ex:t.ex,code:t.code,name:t.name||t.code,from:new Set(['port'])});}
  return[...m.values()];
}

/* events (server's plus the Fed's for gold) within the window, filtered by where the asset comes from, grouped by day */
function calendarRows(events,assets,opt){
  const now=opt.now||Date.now(),days=opt.days||90,from=opt.from||'',lo=now-7*DAY,hi=now+days*DAY;
  const byKey=new Map(assets.map(a=>[a.ex+':'+a.code,a]));
  const all=(events||[]).slice();
  if(assets.some(a=>a.ex==='GOLD'))for(const t of FOMC)all.push({t,kind:'fomc',code:'GOLD',ex:'GOLD',src:'Federal Reserve'});
  const rows=[];
  for(const e of all){
    const a=e.ex==='GOLD'?assets.find(x=>x.ex==='GOLD'):byKey.get(e.ex+':'+e.code);
    if(!a||e.t<lo||e.t>hi)continue;if(from&&!a.from.has(from))continue;
    rows.push(Object.assign({},e,{name:a.name,from:[...a.from],past:e.t<now-DAY/2}));}
  rows.sort((x,y)=>x.t-y.t);
  const groups=[];for(const r of rows){const d=new Date(r.t).toISOString().slice(0,10),g=groups[groups.length-1];if(g&&g.day===d)g.rows.push(r);else groups.push({day:d,t:r.t,rows:[r]});}
  return groups;
}

function calendarHTML(groups){
  if(!groups.length)return '<li class="plain"><p class="empty">'+esc(_t('لا توجد أحداث معروفة في هذه الفترة لأسهم المراقبة والمحفظة.'))+'</p></li>';
  return groups.map(g=>'<li class="plain cal-day"><b class="num">'+NUM(fmtLocal.format(new Date(g.t)))+'</b><ul class="list">'+g.rows.map(r=>{
    const tags=(r.est?'<span class="tag">'+esc(_t('تقدير'))+'</span>':'')+(r.past?'<span class="tag">'+esc(_t('مضى'))+'</span>':'')
      +r.from.map(f=>'<span class="tag v">'+esc(_t(f==='port'?'المحفظة':'المراقبة'))+'</span>').join('');
    const what=r.announced?esc(_t(CAL_KIND[r.kind]||r.kind))+(r.title?': <a href="'+esc(r.url||'')+'" data-ext>'+esc(r.title.slice(0,110))+'</a>':''):esc(_t(CAL_KIND[r.kind]||r.kind));
    return '<li class="plain"><span><b>'+esc(r.name)+'</b> · '+what+'</span> '+tags+'<br><span class="d">'+esc(_t('المصدر'))+': '+esc(_t(r.src||''))
      +(r.announced?' · '+esc(_t('تاريخ الإعلان، لا تاريخ الحدث')):'')+'</span></li>';}).join('')+'</ul></li>').join('');
}

async function loadCalendar(force){
  if(!LOCAL||CAL.busy)return;const box=$('#calList');if(!box)return;
  const assets=calAssets(W.items,await Store.get('journal',[]));
  if(!assets.length){box.innerHTML='<li class="plain"><p class="empty">'+esc(_t('أضف أسهمًا إلى المراقبة أو سجّل صفقات مفتوحة ليظهر تقويمها.'))+'</p></li>';return;}
  if(CAL.events&&!force){renderCalendar();return;}
  CAL.busy=true;$('#calMeta').textContent=_t('جارٍ جمع المواعيد…');
  const j=await apiPost('/api/calendar',{items:assets.filter(a=>a.ex!=='GOLD').map(a=>({code:a.code,ex:a.ex}))}).catch(()=>null);
  CAL.busy=false;CAL.loaded=true;CAL.events=j&&j.ok?j.events:[];CAL.failed=j&&j.ok?j.failed:assets.map(a=>a.code);
  renderCalendar();
}
async function renderCalendar(){
  const assets=calAssets(W.items,await Store.get('journal',[]));
  const groups=calendarRows(CAL.events,assets,{days:+$('#calDays').value||90,from:$('#calFrom').value});
  $('#calList').innerHTML=calendarHTML(groups);
  $('#calMeta').textContent=_t('آخر تحديث')+' '+fmtLocalTime.format(new Date())+(CAL.failed&&CAL.failed.length?' · '+_t('تعذّر جلب مواعيد')+': '+CAL.failed.map(c=>(assets.find(a=>a.code===c)||{}).name||c).join('، '):'');
}
function setupCalendar(){
  if(!$('#calList'))return;
  $('#calRefresh').addEventListener('click',()=>loadCalendar(true));
  $('#calDays').addEventListener('change',renderCalendar);$('#calFrom').addEventListener('change',renderCalendar);
  $('#calList').addEventListener('click',e=>{const a=e.target.closest('a[data-ext]');if(a){e.preventDefault();openExternal(a.getAttribute('href'));}});
  const go=()=>{if(location.hash==='#watch'&&!CAL.loaded)setTimeout(()=>loadCalendar(false),400);};
  addEventListener('hashchange',go);go();
}
