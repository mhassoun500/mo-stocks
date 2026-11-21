/* ================= dashboard (Phase 6): markets, portfolio, opportunities, alerts, events ================= */
/* usual trading hours; public holidays are not known to the app, so it says "usual hours" */
/* 2.18: which market an opportunity belongs to, beside its name */
function mkBadge(ex){const n=SRC_MK[ex];return n?'<span class="mk-badge mk-'+esc(ex)+'" title="'+esc(_t('السوق'))+'">'+esc(_t(n))+'</span>':'';}
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
/* the words alone are timeframe names in the dictionary ('Hourly', 'Daily'), so the units here are spelt out */
const DUR_U=EN?{d:'d',h:'h',m:'min'}:{d:'يوم',h:'ساعة',m:'دقيقة'};
const durText=m=>m>=1440?NUM(Math.floor(m/1440))+' '+DUR_U.d+(m%1440>=60?' '+NUM(Math.floor((m%1440)/60))+' '+DUR_U.h:''):m>=60?NUM(Math.floor(m/60))+' '+DUR_U.h+(m%60?' '+NUM(m%60)+' '+DUR_U.m:''):NUM(m)+' '+DUR_U.m;

/* the strongest buy setups of the last scan */
function topOpportunities(scan,n){if(!scan||!scan.rows)return[];
  return scan.rows.filter(r=>r.stance==='buy').sort((a,b)=>(b.conf||0)-(a.conf||0)||(b.q||0)-(a.q||0)).slice(0,n||5);}

const H={busy:false};
/* 2.18.2: the main indices of the three markets */
const fmtIdx=new Intl.NumberFormat('en-US',{maximumFractionDigits:2,minimumFractionDigits:2});
function idxSpark(v){const a=(v||[]).filter(x=>x!=null&&isFinite(x));if(a.length<2)return'';
  const lo=Math.min(...a),hi=Math.max(...a),sp=hi-lo||1,w=140,h=26,pts=a.map((x,i)=>(i*w/(a.length-1)).toFixed(1)+','+(h-2-(x-lo)/sp*(h-4)).toFixed(1)).join(' ');
  return '<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke="'+(a[a.length-1]>=a[0]?'var(--up)':'var(--down)')+'" stroke-width="1.6" points="'+pts+'"/></svg>';}
const IDX_CUR={SAR:'ريال',EGP:'جنيه'};
function idxWhen(x){const t=x.updated?Date.parse(x.updated):x.at;if(!t||!isFinite(t))return'';
  const d=new Date(t),today=d.toDateString()===new Date().toDateString();   /* today: the time only, so the card stays one size */
  return new Intl.DateTimeFormat(EN?'en-GB':'ar-EG-u-nu-latn',today?{hour:'2-digit',minute:'2-digit'}:{day:'numeric',month:'short'}).format(d);}
function idxCard(x){
  const head='<span class="k"><b>'+esc(_t(x.short))+'</b></span>',open=x.open||('XX:'+x.code);
  if(!x.ok)return '<div class="metric idx-card na" title="'+esc(_t(x.name))+' — '+esc(_t(x.error||''))+'">'+head+'<span class="v">—</span><span class="s">'+esc(_t('غير متاح'))+'</span>'+(x.source?'<span class="s src">'+esc(_t(x.source))+'</span>':'')+'</div>';
  const local=!!x.source&&x.ex==='GOLD'&&x.cur;   /* a local gram price, read from the source's page */
  const tip=_t(x.name)+(x.month!=null?' · '+_t('آخر شهر')+' '+(x.month>=0?'+':'')+(x.month*100).toFixed(1)+'%':'')+(local?' · '+_t('الرسم عند الضغط محسوب من الأونصة وسعر الصرف'):'');
  return '<a href="#" class="metric idx-card'+(local?' local':'')+'" data-open="'+esc(open)+'" title="'+esc(tip)+'">'+head
    +'<span class="v">'+NUM(fmtIdx.format(x.last))+(x.cur?'<small>'+esc(_t(IDX_CUR[x.cur]||x.cur))+'</small>':'')+'</span>'
    +'<span class="s">'+(x.chg!=null?chgSpan(x.chg):'')+(x.offline?' · '+esc(_t('محفوظ')):'')+'</span>'
    +(x.buy?'<span class="s">'+esc(_t('شراء'))+' '+NUM(fmtIdx.format(x.buy))+'</span>':'')
    +(local?'<span class="s src">'+esc(_t(x.source))+(idxWhen(x)?' · '+NUM(esc(idxWhen(x))):'')+'</span>':idxSpark(x.spark))+'</a>';}
const IDX_GROUPS=[['SR',()=>SESSIONS.SR.ar],['CA',()=>SESSIONS.CA.ar],['US',()=>SESSIONS.US.ar],['GOLD',()=>'الذهب']];
function indicesHTML(items){
  return IDX_GROUPS.map(([ex,nm])=>{const g=(items||[]).filter(x=>x.ex===ex);if(!g.length)return'';
    return '<div class="idx-group" style="--n:'+g.length+'"><h4>'+esc(_t(nm()))+'</h4><div class="idx-cards">'+g.map(idxCard).join('')+'</div></div>';}).join('');}
async function renderIndices(){const box=$('#homeIdx');if(!box)return;
  const j=await api('/api/indices').catch(()=>null);
  if(!j||!j.ok){box.innerHTML='<p class="small err">'+esc(_t('تعذّر جلب المؤشرات.'))+'</p>';return;}
  box.innerHTML=indicesHTML(j.items);
  /* one row: what the frames and gaps take, so the rest is shared equally between the cards */
  const groups=box.querySelectorAll('.idx-group').length,cards=box.querySelectorAll('.idx-card').length;
  box.style.setProperty('--cnt',cards||1);box.style.setProperty('--fix',(groups*18+Math.max(0,groups-1)*12+Math.max(0,cards-groups)*8+2)+'px');
  const note=$('#homeIdxNote');if(note)note.hidden=!j.items.some(x=>!x.ok&&/TradingView/.test(x.error||''));}
async function renderHome(){
  if(!$('#view-home')||H.busy)return;H.busy=true;
  try{
    const now=new Date();
    $('#homeMarkets').innerHTML=Object.keys(SESSIONS).map(ex=>{const st=marketStatus(ex,now);
      return '<div class="metric" data-hx="'+ex+'"><span class="k">'+esc(_t(SESSIONS[ex].ar))+'</span><span class="v"><span class="kind '+(st.open?'s':'n')+'">'+esc(_t(st.open?'مفتوحة':'مغلقة'))+'</span></span>'
        +'<span class="s">'+esc(_t(st.open?'تغلق بعد':'تفتح بعد'))+' '+durText(st.mins)+'</span><span class="s" data-idx="'+ex+'"></span></div>';}).join('');
    for(const ex of Object.keys(SESSIONS))api('/api/index',{ex,range:'1mo'}).then(j=>{const el=$('[data-idx="'+ex+'"]');if(!el||!j||!j.ok||!j.rows||j.rows.length<2)return;
      const r=j.rows,ch=r[r.length-1][4]/r[r.length-2][4]-1;el.innerHTML=esc(_t(j.label||''))+' '+chgSpan(ch);}).catch(()=>{});
    renderIndices();
    /* portfolio */
    if(!J.loaded)await loadJournal();
    const s=weekSummary(J.all),curs=Object.keys(s.cur);
    $('#homePort').innerHTML=curs.length?curs.map(c=>{const x=s.cur[c];return '<div class="metric"><span class="k">'+esc(_t('المفتوحة'))+' ('+esc(purCurLabel(c))+')</span><span class="v">'+(x.value?NUM(fmtMoney.format(x.value)):'—')+'</span>'
        +'<span class="s">'+NUM(x.n)+' '+esc(_t('صفقة'))+(x.value?' · <b style="color:'+(x.pl>=0?'var(--up)':'var(--down)')+'">'+NUM(fmtMoney.format(x.pl))+'</b>':'')+(x.noPrice?' · '+NUM(x.noPrice)+' '+esc(_t('بلا سعر حديث')):'')+'</span></div>';}).join('')
      :'<p class="small muted">'+esc(_t('لا توجد صفقات مفتوحة. سجّلها من «الصفقات والمحفظة».'))+'</p>';
    /* opportunities of the three markets, each with the time of its own last scan */
    await renderHomeOpp();
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
