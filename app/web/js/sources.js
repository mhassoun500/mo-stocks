/* ---------- data sources panel (Settings) ---------- */
const SRC_KIND={history:'أسعار',fundamentals:'بيانات مالية',news:'أخبار',dividends:'توزيعات',sharia:'قوائم شرعية',funds:'صناديق'};
const SRC_MK={SR:'السعودية',CA:'مصر',US:'أمريكا'};
const SRC_RANK_KINDS=['history','fundamentals','news'];
const _rtf=(()=>{try{return new Intl.RelativeTimeFormat(EN?'en':'ar',{numeric:'auto'});}catch(e){return null;}})();
function agoText(ts){
  if(!ts)return '';const s=Math.max(0,Date.now()/1000-ts);if(!_rtf)return new Date(ts*1000).toLocaleString();
  return s<90?_rtf.format(-Math.round(s),'second'):s<5400?_rtf.format(-Math.round(s/60),'minute'):s<129600?_rtf.format(-Math.round(s/3600),'hour'):_rtf.format(-Math.round(s/86400),'day');
}
async function renderSources(){
  const j=await api('/api/sources').catch(()=>null);if(!j||!j.ok)return j;
  $('#srcAuto').checked=!!j.auto;$('#srcWatch').checked=!!j.watch;
  const nm={};j.sources.forEach(s=>nm[s.id]=_t(s.name));
  $('#srcRank').innerHTML=SRC_RANK_KINDS.filter(k=>j.ranking[k]).map(k=>'<div class="rk"><b>'+esc(_t(SRC_KIND[k]))+'</b>'+Object.keys(j.ranking[k]).map(mk=>
    '<div><bdi>'+esc(_t(SRC_MK[mk]))+'</bdi>: <span class="ar">'+j.ranking[k][mk].map(id=>'<bdi>'+esc(nm[id]||id)+'</bdi>').join(' › ')+'</span></div>').join('')+'</div>').join('');
  $('#srcList').innerHTML=j.sources.map(s=>{
    const kinds=s.kinds.map(k=>_t(SRC_KIND[k]||k)).join('، ');
    const wait=s.needsKey&&!s.hasKey;
    const state=wait?_t('يحتاج مفتاحًا'):!s.enabled?_t('موقوف'):_t('يعمل');
    const mk=Object.keys(s.markets||{}).map(m=>{const v=s.markets[m],ag=v.agree+v.disagree;
      return '<bdi>'+esc(_t(SRC_MK[m]))+'</bdi> '+NUM(v.rate+'%')+(v.ms?' · '+NUM(v.ms+' ms'):'')+(ag?' · '+_t('اتفاق')+' '+NUM(Math.round(100*v.agree/ag)+'%'):'');}).join(' &nbsp;|&nbsp; ');
    const down=s.lastFail&&s.lastFail>s.lastOk;
    const key=s.needsKey?'<input class="ltr" type="password" autocomplete="off" data-key="'+esc(s.id)+'" placeholder="'+(s.hasKey?'••••••••':_t('المفتاح'))+'">'
      +'<button class="btn xs" type="button" data-act="key" data-id="'+esc(s.id)+'">'+_t('حفظ المفتاح')+'</button>'
      +(s.hasKey?'<button class="btn xs ghost" type="button" data-act="delkey" data-id="'+esc(s.id)+'">'+_t('حذف المفتاح')+'</button>':'')
      +(s.keysUrl?'<a class="btn xs ghost" href="'+esc(s.keysUrl)+'" target="_blank" rel="noopener">'+_t('احصل على مفتاح')+'</a>':''):'';
    const on=!wait&&s.enabled;
    return '<div class="src-item"><div class="src-head"><b>'+esc(_t(s.name))+'</b><span class="src-state'+(on?' on':'')+'">'+esc(state)+'</span></div>'
      +'<div class="src-meta">'+esc(kinds)+(s.calls?' · '+_t('نجح')+' '+NUM(s.ok+' / '+s.calls):'')+(s.note?' · '+esc(_t(s.note)):'')+'</div>'
      +(mk?'<div class="src-meta">'+mk+'</div>':'')
      +(down?'<p class="src-err">'+esc(_t('آخر فشل'))+' '+esc(agoText(s.lastFail))+(s.lastError?': <bdi class="ltr">'+esc(s.lastError)+'</bdi>':'')+'</p>':
        (s.lastOk?'<div class="src-meta">'+esc(_t('آخر نجاح'))+' '+esc(agoText(s.lastOk))+'</div>':''))
      +'<div class="src-act">'+key
      +'<button class="btn xs ghost" type="button" data-act="enable" data-id="'+esc(s.id)+'" data-on="'+(s.enabled?'0':'1')+'">'+(s.enabled?_t('إيقاف'):_t('تشغيل'))+'</button>'
      +'<button class="btn xs ghost" type="button" data-act="test" data-id="'+esc(s.id)+'"'+(wait?' disabled':'')+'>'+_t('اختبار')+'</button></div></div>';}).join('');
  return j;
}
function setupSources(){
  if(!LOCAL)return;
  const st=$('#srcStatus'),say=(t,err)=>{st.className='status'+(err?' err':'');st.textContent=t;};
  $('#srcAuto').addEventListener('change',async e=>{await apiPost('/api/sources',{action:'auto',enabled:e.target.checked}).catch(()=>{});renderSources();});
  $('#srcWatch').addEventListener('change',async e=>{await apiPost('/api/sources',{action:'watch',enabled:e.target.checked}).catch(()=>{});});
  $('#srcReset').addEventListener('click',async()=>{if(!(await confirmBox(_t('سيُمسح سجل أداء المصادر ويعود الترتيب الافتراضي. متابعة؟'))))return;
    await apiPost('/api/sources',{action:'reset'}).catch(()=>{});say(_t('صُفّر السجل.'));renderSources();});
  $('#srcProbe').addEventListener('click',async()=>{const b=$('#srcProbe');b.disabled=true;say(_t('جارٍ فحص المصادر…'));
    await apiPost('/api/sources',{action:'probe'}).catch(()=>{});
    for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,2000));const j=await renderSources();if(j&&!j.checking)break;}
    b.disabled=false;say(_t('انتهى الفحص.'));});
  $('#srcList').addEventListener('click',async e=>{
    const b=e.target.closest('button[data-act]');if(!b)return;const id=b.dataset.id,act=b.dataset.act;let j;
    if(act==='key'){const inp=$('#srcList').querySelector('input[data-key="'+id+'"]');
      j=await apiPost('/api/sources',{action:'key',id,key:inp.value}).catch(()=>null);
      if(!j||!j.ok){say((j&&_t(j.error))||_t('تعذّر الحفظ.'),true);return;}say(_t('حُفظ المفتاح. اضغط «اختبار» للتأكد.'));}
    else if(act==='delkey'){j=await apiPost('/api/sources',{action:'delkey',id}).catch(()=>null);say(_t('حُذف المفتاح.'));}
    else if(act==='enable'){j=await apiPost('/api/sources',{action:'enable',id,enabled:b.dataset.on==='1'}).catch(()=>null);}
    else if(act==='test'){b.disabled=true;say(_t('جارٍ الاختبار…'));
      j=await apiPost('/api/sources',{action:'test',id}).catch(()=>null);b.disabled=false;
      if(!j||!j.ok){say(_t('فشل الاختبار')+': '+((j&&j.error)||''),true);}
      else if(j.skipped){say(_t('لا يوجد اختبار سريع لهذا المصدر.'));}
      else if(j.nodata){say(_t('المصدر يرد لكن لا بيانات للرمز التجريبي.'));}
      else say(_t('المصدر يعمل')+' · '+j.ms+' ms');
      renderSources();return;}
    renderSources();});
  window.addEventListener('hashchange',()=>{if(location.hash==='#prefs')renderSources();});
  if(location.hash==='#prefs')renderSources();
}
