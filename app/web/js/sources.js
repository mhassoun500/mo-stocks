/* ---------- data sources panel (Settings) ---------- */
const SRC_KIND={history:'أسعار',fundamentals:'بيانات مالية',news:'أخبار',dividends:'توزيعات',sharia:'قوائم شرعية',funds:'صناديق'};
const SRC_MK={SR:'السعودية',CA:'مصر',US:'أمريكا'};
const SRC_RANK_KINDS=['history','fundamentals','news'];
const _rtf=(()=>{try{return new Intl.RelativeTimeFormat(EN?'en':'ar',{numeric:'auto'});}catch(e){return null;}})();
function agoText(ts){
  if(!ts)return '';const s=Math.max(0,Date.now()/1000-ts);if(!_rtf)return new Date(ts*1000).toLocaleString();
  return s<90?_rtf.format(-Math.round(s),'second'):s<5400?_rtf.format(-Math.round(s/60),'minute'):s<129600?_rtf.format(-Math.round(s/3600),'hour'):_rtf.format(-Math.round(s/86400),'day');
}
function renderDefs(d){
  if(!d||!$('#defsInfo'))return;$('#defsAuto').checked=!!d.auto;
  $('#defsInfo').textContent=_t('التعريفات')+' '+(EN?'v':'إصدار ')+d.version+' · '+(d.source==='downloaded'?_t('محمّلة من GitHub'):_t('مدمجة في البرنامج'))
    +(d.checked?' · '+_t('آخر فحص')+' '+agoText(d.checked):'')+(d.error?' · '+_t('تعذّر التحديث'):'');}
async function renderSources(){
  const j=await api('/api/sources').catch(()=>null);if(!j||!j.ok)return j;
  $('#srcAuto').checked=!!j.auto;$('#srcWatch').checked=!!j.watch;renderDefs(j.defs);
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
  $('#defsAuto').addEventListener('change',async()=>{const j=await apiPost('/api/sources',{action:'defsauto',enabled:$('#defsAuto').checked}).catch(()=>null);if(j)renderDefs(j.defs);});
  $('#defsCheck').addEventListener('click',async()=>{const b=$('#defsCheck');b.disabled=true;say(_t('جارٍ التحقق من التعريفات…'));
    const j=await apiPost('/api/sources',{action:'defs'}).catch(()=>null);b.disabled=false;
    if(j&&j.status)renderDefs(j.status);
    say(!j?_t('تعذّر الاتصال بالبرنامج.'):!j.ok?_t('تعذّر تحديث التعريفات؛ يُستخدم ما هو موجود.'):j.changed?_t('حُدّثت التعريفات.'):_t('التعريفات محدّثة.'),!!(j&&!j.ok));});
  setupShImport();
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

/* ---------- import a Sharia list from a CSV / PDF file ---------- */
const SH_IMP={res:null,name:''};
function shImpRender(){
  const o=$('#shImpOut'),r=SH_IMP.res;if(!r){o.hidden=true;o.innerHTML='';return;}o.hidden=false;
  if(!r.ok){o.innerHTML='<p class="err">'+esc(_t(r.error||'تعذّرت القراءة.'))+'</p>';return;}
  const smp=r.sample.map(([c,v])=>'<bdi class="tag '+(v==='ok'?'b':v==='no'?'x':'in')+'">'+esc(c)+'</bdi>').join(' ');
  o.innerHTML='<p>'+_t('وجدتُ')+' <b>'+NUM(r.ok_list.length)+'</b> '+_t('متوافقة')+' · <b>'+NUM(r.no_list.length)+'</b> '+_t('غير متوافقة')
    +(r.doubt.length?' · '+NUM(r.doubt.length)+' '+_t('محل نظر (لا تُضاف لأن قائمتك تعرف متوافق وغير متوافق فقط)'):'')
    +(r.conflicts.length?' · '+NUM(r.conflicts.length)+' '+_t('متعارضة داخل الملف وتُترك')+' ('+r.conflicts.slice(0,6).map(esc).join('، ')+')':'')
    +' · '+NUM(r.skipped)+' '+_t('سطرًا تجاهلته')+'</p><p>'+smp+'</p>'
    +'<div class="actions"><button class="btn sm" id="shImpAdd" type="button">'+_t('أضف إلى قائمتي')+'</button>'
    +'<button class="btn sm ghost" id="shImpRep" type="button">'+_t('استبدل قائمتي')+'</button>'
    +'<button class="btn sm ghost" id="shImpCancel" type="button">'+_t('إلغاء')+'</button></div>';}
function shImpApply(replace){
  const r=SH_IMP.res;if(!r||!r.ok)return;
  const ok=new Set(replace?[]:[...shariaTokens(P.sharia.ok)]),no=new Set(replace?[]:[...shariaTokens(P.sharia.no)]);
  r.ok_list.forEach(c=>{no.delete(c);ok.add(c);});r.no_list.forEach(c=>{ok.delete(c);no.add(c);});  /* the imported verdict wins over an older one */
  const set=(sel,key,val)=>{const el=$(sel);el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
  set('#pShOk','sharia.ok',[...ok].join(' '));set('#pShNo','sharia.no',[...no].join(' '));
  if(!$('#pShDate').value)set('#pShDate','sharia.asOf',_t('مستورد من')+' '+SH_IMP.name);
  SH_IMP.res=null;shImpRender();$('#shFile').value='';savePrefs();if(typeof render==='function'&&S.A)render();
  const st=$('#shStatus');if(st){st.textContent=_t('حُفظت القائمة.');st.classList.remove('err');}}
function setupShImport(){
  const f=$('#shFile');if(!f||!LOCAL)return;
  f.addEventListener('change',async()=>{const file=f.files&&f.files[0];if(!file)return;SH_IMP.name=file.name;
    if(file.size>5*1024*1024){SH_IMP.res={ok:false,error:'الملف أكبر من 5 ميغابايت.'};shImpRender();return;}
    const o=$('#shImpOut');o.hidden=false;o.textContent=_t('جارٍ قراءة الملف…');
    const dataUrl=await new Promise(res=>{const fr=new FileReader();fr.onload=()=>res(fr.result);fr.onerror=()=>res(null);fr.readAsDataURL(file);});
    SH_IMP.res=dataUrl?await apiPost('/api/shariaimport',{name:file.name,dataUrl,ex:$('#shImpEx').value}).catch(()=>({ok:false,error:'تعذّر الاتصال بالبرنامج.'})):{ok:false,error:'تعذّرت قراءة الملف.'};
    shImpRender();});
  $('#shImpOut').addEventListener('click',e=>{const id=e.target.id;
    if(id==='shImpAdd')shImpApply(false);else if(id==='shImpRep'){confirmBox(_t('سيُستبدل كل ما في قائمتك الحالية. متابعة؟')).then(y=>{if(y)shImpApply(true);});}
    else if(id==='shImpCancel'){SH_IMP.res=null;$('#shFile').value='';shImpRender();}});
}
