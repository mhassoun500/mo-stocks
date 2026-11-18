/* ================= dashboard (Phase 6): markets, portfolio, opportunities, alerts, events ================= */
/* usual trading hours; public holidays are not known to the app, so it says "usual hours" */
const SESSIONS={SR:{tz:'Asia/Riyadh',days:[0,1,2,3,4],open:600,close:900,ar:'السوق السعودية'},
  CA:{tz:'Africa/Cairo',days:[0,1,2,3,4],open:600,close:870,ar:'البورصة المصرية'},
  US:{tz:'America/New_York',days:[1,2,3,4,5],open:570,close:960,ar:'السوق الأمريكية'}};
const WD={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
function zoneClock(tz,now){const p=new Intl.DateTimeFormat('en-US',{timeZone:tz,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const g=t=>(p.find(x=>x.type===t)||{}).value;return{day:WD[g('weekday')],min:(+g('hour'))*60+(+g('minute'))};}
/* open or closed now, and minutes until the next change */
function marketStatus(ex,now){
  const s=SESSIONS[ex];if(!s)return null;now=now||new Date();const c=zoneClock(s.tz,now);
  const trading=s.days.includes(c.day),open=trading&&c.min>=s.open&&c.min<s.close;
  let mins;
  if(open)mins=s.close-c.min;
  else{let d=0,m=c.min;for(;d<8;d++){const day=(c.day+d)%7;if(s.days.includes(day)&&(d>0||m<s.open)){mins=d*1440+s.open-m;break;}}}
  return{ex,open,mins};
}
const durText=m=>m>=1440?NUM(Math.floor(m/1440))+' '+_t('يوم')+(m%1440>=60?' '+NUM(Math.floor((m%1440)/60))+' '+_t('ساعة'):''):m>=60?NUM(Math.floor(m/60))+' '+_t('ساعة')+(m%60?' '+NUM(m%60)+' '+_t('دقيقة'):''):NUM(m)+' '+_t('دقيقة');

/* the strongest buy setups of the last scan */
function topOpportunities(scan,n){if(!scan||!scan.rows)return[];
  return scan.rows.filter(r=>r.stance==='buy').sort((a,b)=>(b.conf||0)-(a.conf||0)||(b.q||0)-(a.q||0)).slice(0,n||5);}

const H={busy:false};
async function renderHome(){
  if(!$('#view-home')||H.busy)return;H.busy=true;
  try{
    const now=new Date();
    $('#homeMarkets').innerHTML=Object.keys(SESSIONS).map(ex=>{const st=marketStatus(ex,now);
      return '<div class="metric" data-hx="'+ex+'"><span class="k">'+esc(_t(SESSIONS[ex].ar))+'</span><span class="v"><span class="kind '+(st.open?'s':'n')+'">'+esc(_t(st.open?'مفتوحة':'مغلقة'))+'</span></span>'
        +'<span class="s">'+esc(_t(st.open?'تغلق بعد':'تفتح بعد'))+' '+durText(st.mins)+'</span><span class="s" data-idx="'+ex+'"></span></div>';}).join('');
    for(const ex of Object.keys(SESSIONS))api('/api/index',{ex,range:'1mo'}).then(j=>{const el=$('[data-idx="'+ex+'"]');if(!el||!j||!j.ok||!j.rows||j.rows.length<2)return;
      const r=j.rows,ch=r[r.length-1][4]/r[r.length-2][4]-1;el.innerHTML=esc(_t(j.label||''))+' '+chgSpan(ch);}).catch(()=>{});
    /* portfolio */
    if(!J.loaded)await loadJournal();
    const s=weekSummary(J.all),curs=Object.keys(s.cur);
    $('#homePort').innerHTML=curs.length?curs.map(c=>{const x=s.cur[c];return '<div class="metric"><span class="k">'+esc(_t('المفتوحة'))+' ('+esc(purCurLabel(c))+')</span><span class="v">'+(x.value?NUM(fmtMoney.format(x.value)):'—')+'</span>'
        +'<span class="s">'+NUM(x.n)+' '+esc(_t('صفقة'))+(x.value?' · <b style="color:'+(x.pl>=0?'var(--up)':'var(--down)')+'">'+NUM(fmtMoney.format(x.pl))+'</b>':'')+(x.noPrice?' · '+NUM(x.noPrice)+' '+esc(_t('بلا سعر حديث')):'')+'</span></div>';}).join('')
      :'<p class="small muted">'+esc(_t('لا توجد صفقات مفتوحة. سجّلها من «الصفقات والمحفظة».'))+'</p>';
    /* opportunities */
    const scan=await Store.get('lastScan',null),top=topOpportunities(scan,5);
    $('#homeOpp').innerHTML=top.length?'<ul class="list">'+top.map(r=>'<li><span class="kind s">'+NUM((r.conf||0)+'%')+'</span><span><a href="#" data-open="'+esc(scan.ex)+':'+esc(r.code)+'"><b>'+esc(r.name)+'</b></a> <span class="small muted num">'+esc(r.code)+'</span></span>'
        +'<span class="small muted">'+NUM(fp(r.price))+(r.fairDisc!=null?' · '+esc(_t('السعر العادل'))+' '+NUM((r.fairDisc>=0?'+':'')+r.fairDisc.toFixed(0)+'%'):'')+'</span></li>').join('')+'</ul>'
        +'<p class="small muted">'+esc(_t('من آخر فحص للماسح'))+' · '+NUM(fmtLocalTime.format(new Date(scan.at)))+'</p>'
      :'<p class="small muted">'+esc(_t(scan?'لا توجد أسهم في منطقة شراء في آخر فحص.':'شغّل الماسح مرة لتظهر هنا أقوى الفرص.'))+'</p>';
    /* alerts */
    const log=(await Store.get('alertLog',[])).slice(0,5);
    $('#homeAlerts').innerHTML=log.length?'<ul class="list">'+log.map(l=>'<li class="plain"><span>'+esc(alertText(l))+'</span><br><span class="d">'+fmtLocalTime.format(new Date(l.t))+'</span></li>').join('')+'</ul>'
      :'<p class="small muted">'+esc(_t('لا توجد تنبيهات بعد.'))+'</p>';
    /* events of the week */
    if(LOCAL&&!CAL.events)await loadCalendar(false).catch(()=>{});
    const groups=calendarRows(CAL.events,calAssets(W.items,J.all),{days:7});
    $('#homeEvents').innerHTML=groups.length?calendarHTML(groups):'<li class="plain"><p class="small muted">'+esc(_t('لا أحداث معروفة هذا الأسبوع لأسهمك.'))+'</p></li>';
    $('#homeMeta').textContent=fmtLocal.format(now);
  }finally{H.busy=false;}
}
function setupHome(){
  if(!$('#view-home'))return;
  $('#view-home').addEventListener('click',e=>{const x=e.target.closest('a[data-ext]');if(x){e.preventDefault();openExternal(x.getAttribute('href'));return;}
    const a=e.target.closest('a[data-open]');if(!a)return;e.preventDefault();const [ex,code]=a.dataset.open.split(':');
    location.hash='#analysis';applySource(ex,code);fetchSymbol(code,ex);});
  $('#homeCheck').addEventListener('click',()=>{location.hash='#watch';checkWatchlist(true);});
  $('#homeScan').addEventListener('click',()=>{location.hash='#scanner';});
}
