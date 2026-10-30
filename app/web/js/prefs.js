/* ================= preferences, theme, education mode, app integration ================= */
const DAYS_AR=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const THEME_AR={system:'تلقائي',light:'فاتح',dark:'داكن'};

function applyTheme(){const t=P.theme||'system';if(t==='system')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',t);
  $('#themeBtn').textContent='المظهر: '+THEME_AR[t];if($('#pTheme'))$('#pTheme').value=t;}
const FONT_STACK=f=>'"'+f+'","Segoe UI",Tahoma,sans-serif';
const MONO_STACK='"IBM Plex Mono",ui-monospace,"SFMono-Regular",Menlo,monospace';
function applyFont(){
  const f=['Cairo','Tajawal','Almarai','Noto Kufi Arabic','IBM Plex Sans Arabic'].includes(P.font)?P.font:'Cairo';
  const r=document.documentElement.style;r.setProperty('--f-body',FONT_STACK(f));r.setProperty('--f-display',FONT_STACK(f));
  r.setProperty('--f-num',P.numFont==='mono'?MONO_STACK:FONT_STACK(f));
  if(document.fonts&&document.fonts.load)Promise.all([document.fonts.load('600 14px "'+f+'"'),document.fonts.load('700 14px "'+f+'"')]).then(()=>draw()).catch(()=>draw());else draw();
}
function applyEdu(){document.documentElement.classList.toggle('edu-on',!!P.edu);$('#eduBtn').setAttribute('aria-pressed',String(!!P.edu));if($('#pEdu'))$('#pEdu').checked=!!P.edu;}

function bindPrefs(){
  $$('[data-pref]').forEach(el=>{
    const path=el.dataset.pref,v=getPref(path);
    if(el.type==='checkbox')el.checked=!!v;else el.value=v==null?'':v;
    el.addEventListener('change',()=>{
      const val=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?null:+el.value):el.value;
      setPref(path,val);
      if(path==='theme')applyTheme();
      if(path==='edu')applyEdu();
      if(path==='font'||path==='numFont')applyFont();
      if(path.startsWith('ana.')&&path!=='ana.tf'&&S.daily){S.ind=computeInd(S.data);analyzeNow(false);}
      if(path.startsWith('sharia.')){if(S.A)render();if(typeof renderScan==='function'&&LOCAL)renderScan();}
      if(path==='alerts.enabled'&&val&&LOCAL)checkWatchlist(false);
    });
  });
  $('#pRepDays').innerHTML=DAYS_AR.map((d,i)=>'<label class="chip"><input type="checkbox" value="'+i+'"'+((P.report.days||[]).includes(i)?' checked':'')+'><span>'+d+'</span></label>').join('');
  $('#pRepDays').addEventListener('change',()=>setPref('report.days',$$('#pRepDays input:checked').map(i=>+i.value)));
  $('#pAnaReset').addEventListener('click',()=>{P.ana=JSON.parse(JSON.stringify(PREF_DEFAULTS.ana));savePrefs();
    $$('[data-pref^="ana."]').forEach(el=>{el.value=getPref(el.dataset.pref);});if(S.daily){S.ind=computeInd(S.data);analyzeNow(false);}toast('استُعيدت إعدادات التحليل الافتراضية.');});
  $('#themeBtn').addEventListener('click',()=>{const order=['system','light','dark'];P.theme=order[(order.indexOf(P.theme||'system')+1)%3];savePrefs();applyTheme();});
  $('#eduBtn').addEventListener('click',()=>{P.edu=!P.edu;savePrefs();applyEdu();});
  setupYaaqen();setupShariaLists();
  if(!LOCAL)return;
  /* desktop-only integration */
  api('/api/autostart').then(j=>{$('#pAuto').checked=!!j.enabled;if(!j.available){$('#pAuto').disabled=true;$('#pAutoNote').textContent='متاح في النسخة المثبتة من البرنامج.';}}).catch(()=>{});
  $('#pAuto').addEventListener('change',async e=>{const j=await apiPost('/api/autostart',{enabled:e.target.checked}).catch(()=>null);
    if(!j||!j.ok){e.target.checked=!e.target.checked;toast((j&&j.error)||'تعذّر تغيير الإعداد.');}else toast(j.enabled?'سيعمل البرنامج مصغّرًا عند بدء الجهاز.':'أُلغي التشغيل التلقائي.');});
  $('#tgDetect').addEventListener('click',async()=>{const st=$('#tgStatus');st.textContent='جارٍ البحث…';st.className='status';
    const j=await apiPost('/api/telegram',{action:'detect',token:$('#pTgToken').value.trim()}).catch(()=>null);
    if(j&&j.ok){$('#pTgChat').value=j.chat.id;setPref('telegram.chatId',String(j.chat.id));setPref('telegram.token',$('#pTgToken').value.trim());st.textContent='وُجدت المحادثة: '+(j.chat.name||j.chat.id);}
    else{st.textContent=(j&&j.error)||'تعذّر الاتصال بتيليجرام.';st.className='status err';}});
  $('#tgTest').addEventListener('click',async()=>{const st=$('#tgStatus');st.textContent='جارٍ الإرسال…';st.className='status';
    setPref('telegram.token',$('#pTgToken').value.trim());setPref('telegram.chatId',$('#pTgChat').value.trim());
    const j=await apiPost('/api/telegram',{action:'test',token:$('#pTgToken').value.trim(),chatId:$('#pTgChat').value.trim()}).catch(()=>null);
    if(j&&j.ok){st.textContent='وصلت الرسالة التجريبية إلى تيليجرام.';if(!P.telegram.enabled){setPref('telegram.enabled',true);$('#pTg').checked=true;}}
    else{st.textContent=(j&&j.error)||'تعذّر الإرسال.';st.className='status err';}});
  setupTvAccount();
  $('#quitBtn').addEventListener('click',()=>{api('/api/quit').catch(()=>{});document.body.innerHTML='<p style="padding:40px;text-align:center;font-family:sans-serif">أُغلق البرنامج.</p>';});
  $('#aboutText').innerHTML='الإصدار '+NUM(esc(LOCAL.version))+' · '+(LOCAL.platform==='win32'?'ويندوز':LOCAL.platform==='darwin'?'ماك':'لينكس')+(LOCAL.frozen?'':' · تشغيل من الكود');
  $('#updateCheck').addEventListener('click',()=>checkUpdate(true));
  $('#updateGo').addEventListener('click',()=>{if(S.updateUrl)openExternal(S.updateUrl);});
  $('#updateHide').addEventListener('click',()=>{$('#updateBanner').hidden=true;Store.set('updateSnooze',todayKey());});
}
/* ---------- Saudi and Egyptian lists ---------- */
function renderShariaInfo(){const a=[];
  if(SHL.sa)a.push('<li><b>السعودية (الرئيسية ونمو):</b> أرقام — '+NUM(Object.keys(SHL.sa.main).length+Object.keys(SHL.sa.nomu).length)+' شركة بتصنيف '+esc(SHL.sa.refs.map(r=>r[0]).join('، '))+'. «متوافق» إذا أجازه مرجعان أو ثلاثة، و«مختلف فيه» إذا أجازه مرجع واحد. آخر تحديث '+NUM(esc(SHL.sa.date))+'.</li>');
  if(SHL.eg)a.push('<li><b>مصر:</b> '+NUM(Object.keys(SHL.eg.rows).length)+' سهمًا من '+NUM(SHL.eg.refs.length)+' مصادر ('+esc(SHL.eg.refs.slice(1,-1).join('، '))+'). «متوافق» إذا أجازته نصف المصادر على الأقل، و«مختلف فيه» إذا أجازه بعضها، مع تمييز أسهم مؤشر الشريعة EGX33. آخر تحديث '+NUM(esc(SHL.eg.date))+'.</li>');
  a.push('<li><b>أمريكا:</b> تصنيف موقع يقين، ومكونات مؤشر S&P 500 الشرعي'+(SHL.spus?' ('+NUM(SHL.spus.tickers.length)+' سهمًا · '+NUM(esc(SHL.spus.date))+')':'')+(SHL.bitarabi?'، وقائمة البيت العربي وفق معيار الراجحي ('+NUM(Object.keys(SHL.bitarabi.rows).length)+' سهمًا · '+NUM(esc(SHL.bitarabi.date))+')':'')+'، ثم فحص مبدئي تلقائي لما لا تغطيه.</li>');
  $('#shInfo').innerHTML=a.join('');}
async function syncShariaLists(){const j=await api('/api/sharialists').catch(()=>null);if(!j)return null;
  const newer=(x,cur)=>x&&(!cur||x.date>=cur.date);
  if(newer(j.sa,SHL.sa))SHL.sa=j.sa;if(newer(j.eg,SHL.eg))SHL.eg=j.eg;if(newer(j.spus,SHL.spus))loadShariaLists(null,null,j.spus);renderShariaInfo();if(typeof renderScan==='function')renderScan();if(S.A)render();return j;}
function setupShariaLists(){renderShariaInfo();if(!LOCAL)return;syncShariaLists();
  $('#shRefresh').addEventListener('click',async()=>{const st=$('#shStatus');st.className='status';st.textContent='جارٍ تحديث القوائم من أرقام والمصادر المصرية…';
    await api('/api/sharialists',{refresh:'1'}).catch(()=>null);const t0=Date.now();
    const iv=setInterval(async()=>{const j=await syncShariaLists();
      if(j&&!j.busy){clearInterval(iv);st.textContent='تم تحديث القوائم.';}
      else if(Date.now()-t0>3*60e3){clearInterval(iv);st.className='status err';st.textContent='تعذّر التحديث الآن؛ تبقى النسخة المحفوظة.';}},3000);});}

/* ---------- Yaqeen list (US stocks) ---------- */
function renderYaaqenInfo(){$('#yqInfo').innerHTML=YQ.ok.size?'شرعي: '+NUM(YQ.ok.size)+' سهمًا · غير شرعي: '+NUM(YQ.no.size)+' · محل نظر: '+NUM(YQ.doubt.size)+' · آخر تحديث: '+NUM(esc(YQ.date))+'. تحدّث تلقائيًا كل أسبوعين في البرنامج المثبت.':'لا تتوفر القائمة.';}
async function syncYaaqen(){const j=await api('/api/yaaqen').catch(()=>null);
  if(j&&j.list&&j.list.date&&j.list.date>=YQ.date){loadYaaqen(j.list);renderYaaqenInfo();if(typeof renderScan==='function')renderScan();}return j;}
function setupYaaqen(){
  renderYaaqenInfo();if(!LOCAL)return;syncYaaqen();
  $('#yqRefresh').addEventListener('click',async()=>{const st=$('#yqStatus');st.className='status';st.textContent='جارٍ تحديث القائمة من موقع يقين… يستغرق دقيقة إلى دقيقتين.';
    await api('/api/yaaqen',{refresh:'1'}).catch(()=>null);
    const t0=Date.now();const iv=setInterval(async()=>{const j=await syncYaaqen();
      if(j&&!j.busy){clearInterval(iv);st.textContent=j.list?'تم تحديث قائمة يقين.':'تعذّر تحديث القائمة؛ تبقى النسخة المحفوظة.';if(!j.list)st.className='status err';}
      else if(Date.now()-t0>6*60e3){clearInterval(iv);st.className='status err';st.textContent='استغرق التحديث وقتًا أطول من المعتاد.';}},5000);});
}
/* ---------- TradingView account ---------- */
function renderTvAccount(j){
  const dot=$('#tvDot'),st=$('#tvState');if(!j||!j.ok){st.textContent='تعذّر قراءة حالة الحساب.';dot.className='tv-dot warn';return;}
  const store={dpapi:'مشفّرة بنظام ويندوز',keychain:'محفوظة في سلسلة مفاتيح ماك',file:'محفوظة في ملف محلي'}[j.storage]||'';
  if(!j.feed){st.textContent='مكتبة الاتصال بـ TradingView غير مثبتة؛ يُستخدم Yahoo Finance.';dot.className='tv-dot warn';}
  else if(j.loggedIn){st.innerHTML='متصل بحساب: <bdi>'+esc(j.username||'TradingView')+'</bdi>'+(j.plan?' · الخطة: <bdi>'+esc(j.plan)+'</bdi>':'')+(store?' · الجلسة '+store:'');dot.className='tv-dot on';}
  else if(j.expired){st.textContent='انتهت جلسة TradingView. سجّل الدخول من جديد.';dot.className='tv-dot warn';}
  else{st.textContent='غير مسجّل — تُستخدم بيانات TradingView العامة.';dot.className='tv-dot';}
  $('#tvLogout').hidden=!(j.loggedIn||j.expired);
  $('#tvLogin').textContent=j.loggedIn?'تغيير الحساب':'تسجيل الدخول إلى TradingView';
  if(!j.windowLogin){$('#tvLogin').hidden=true;$('#tvManual').open=true;}
}
async function refreshTvAccount(){const j=await api('/api/tvaccount').catch(()=>null);renderTvAccount(j);return j;}
function setupTvAccount(){
  const st=$('#tvStatus');
  refreshTvAccount();
  $('#pSource').addEventListener('change',()=>{apiPost('/api/tvaccount',{action:'source'}).catch(()=>{});
    toast($('#pSource').value==='tv'?'سيُجلب من TradingView أولًا.':'سيُجلب من Yahoo Finance أولًا.');});
  $('#tvLogin').addEventListener('click',async()=>{
    st.className='status';st.textContent='افتح نافذة TradingView وسجّل الدخول كالمعتاد…';
    const j=await apiPost('/api/tvaccount',{action:'window'}).catch(()=>null);
    if(!j||!j.ok){st.className='status err';st.textContent=(j&&j.error)||'تعذّر فتح نافذة الدخول.';$('#tvManual').open=true;return;}
    clearInterval(S.tvPoll);const t0=Date.now();
    S.tvPoll=setInterval(async()=>{const a=await refreshTvAccount();const L=a&&a.login||{};
      if(L.state==='done'){clearInterval(S.tvPoll);st.textContent=L.message+'. ستُستخدم بيانات حسابك من الآن.';toast('تم ربط حساب TradingView.');}
      else if(L.state==='closed'||Date.now()-t0>20*60e3){clearInterval(S.tvPoll);st.className='status err';st.textContent=L.message||'لم يكتمل الدخول.';}
    },2500);
  });
  $('#tvSave').addEventListener('click',async()=>{
    const sid=$('#tvSid').value.trim(),sign=$('#tvSign').value.trim();
    if(!sid){st.className='status err';st.textContent='الصق قيمة sessionid أولًا.';return;}
    st.className='status';st.textContent='جارٍ التحقق من الجلسة…';
    const j=await apiPost('/api/tvaccount',{action:'cookie',sessionid:sid,sessionid_sign:sign}).catch(()=>null);
    if(j&&j.ok){$('#tvSid').value='';$('#tvSign').value='';st.textContent='تم ربط حساب TradingView: '+(j.username||'');refreshTvAccount();}
    else{st.className='status err';st.textContent=(j&&j.error)||'تعذّر حفظ الجلسة.';}
  });
  $('#tvLogout').addEventListener('click',async()=>{await apiPost('/api/tvaccount',{action:'logout'}).catch(()=>null);
    st.className='status';st.textContent='تم تسجيل الخروج وحذف الجلسة من الجهاز.';refreshTvAccount();});
}
async function checkUpdate(manual){
  const st=$('#updateStatus');if(manual){st.textContent='جارٍ التحقق…';st.className='status';}
  const j=await api('/api/update').catch(()=>null);
  if(!j||!j.ok){if(manual){st.textContent=(j&&j.error)||'تعذّر التحقق.';st.className='status err';}return;}
  if(j.newer){S.updateUrl=j.url;$('#updateText').innerHTML='يتوفر إصدار جديد '+NUM(esc(j.latest))+' (لديك '+NUM(esc(j.current))+').';
    if(manual||(await Store.get('updateSnooze',''))!==todayKey())$('#updateBanner').hidden=false;if(manual)st.textContent='يتوفر الإصدار '+j.latest+'.';}
  else if(manual)st.textContent='لديك أحدث إصدار ('+j.current+').';
}
