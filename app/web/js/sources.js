/* ---------- data sources panel (Settings) ---------- */
const SRC_KIND={history:'أسعار',fundamentals:'بيانات مالية',news:'أخبار',dividends:'توزيعات',sharia:'قوائم شرعية',funds:'صناديق'};
async function renderSources(){
  const j=await api('/api/sources').catch(()=>null);if(!j||!j.ok)return;
  $('#srcList').innerHTML=j.sources.map(s=>{
    const kinds=s.kinds.map(k=>_t(SRC_KIND[k]||k)).join('، ');
    const wait=s.needsKey&&!s.hasKey;
    const state=wait?_t('يحتاج مفتاحًا'):!s.enabled?_t('موقوف'):_t('يعمل');
    const key=s.needsKey?'<input class="ltr" type="password" autocomplete="off" data-key="'+esc(s.id)+'" placeholder="'+(s.hasKey?'••••••••':_t('المفتاح'))+'">'
      +'<button class="btn xs" type="button" data-act="key" data-id="'+esc(s.id)+'">'+_t('حفظ المفتاح')+'</button>'
      +(s.hasKey?'<button class="btn xs ghost" type="button" data-act="delkey" data-id="'+esc(s.id)+'">'+_t('حذف المفتاح')+'</button>':'')
      +(s.keysUrl?'<a class="btn xs ghost" href="'+esc(s.keysUrl)+'" target="_blank" rel="noopener">'+_t('احصل على مفتاح')+'</a>':''):'';
    const on=!wait&&s.enabled;
    return '<div class="src-item"><div class="src-head"><b>'+esc(_t(s.name))+'</b><span class="src-state'+(on?' on':'')+'">'+esc(state)+'</span></div>'
      +'<div class="src-meta">'+esc(kinds)+(s.calls?' · '+_t('نجح')+' '+NUM(s.ok+' / '+s.calls):'')+(s.note?' · '+esc(_t(s.note)):'')+'</div>'
      +'<div class="src-act">'+key
      +'<button class="btn xs ghost" type="button" data-act="enable" data-id="'+esc(s.id)+'" data-on="'+(s.enabled?'0':'1')+'">'+(s.enabled?_t('إيقاف'):_t('تشغيل'))+'</button>'
      +'<button class="btn xs ghost" type="button" data-act="test" data-id="'+esc(s.id)+'"'+(wait?' disabled':'')+'>'+_t('اختبار')+'</button></div></div>';}).join('');
}
function setupSources(){
  if(!LOCAL)return;
  const st=$('#srcStatus'),say=(t,err)=>{st.className='status'+(err?' err':'');st.textContent=t;};
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
