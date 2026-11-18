/* ================= first-run tour, term explanations, keyboard shortcuts (Phase 6) ================= */

/* ---------- short explanations shown when the pointer rests on a term ---------- */
const GLOSSARY=[
  ['RSI','مؤشر القوة النسبية: من 0 إلى 100. فوق 70 تشبع شرائي (ارتفع كثيرًا وبسرعة)، وتحت 30 تشبع بيعي.'],
  ['MACD','الماكد: الفرق بين متوسطين متحركين أُسيين. صعوده فوق خط الإشارة يدل على زخم صاعد.'],
  ['منطقة الشراء','نطاق سعري تحت السعر الحالي ارتد منه السعر أكثر من مرة، فيُعد دعمًا.'],
  ['منطقة البيع','نطاق سعري فوق السعر الحالي تراجع منه السعر أكثر من مرة، فيُعد مقاومة وهدفًا.'],
  ['وقف الخسارة','السعر الذي تخرج عنده إذا خالفك السعر، لتبقى الخسارة صغيرة ومحددة مسبقًا.'],
  ['العائد إلى المخاطرة','كم تربح حتى الهدف الأول مقابل كل ريال تخسره حتى الوقف. 1 : 2 تعني ربحًا محتملًا ضعف الخسارة المحتملة.'],
  ['العائد للمخاطرة','كم تربح حتى الهدف الأول مقابل كل ريال تخسره حتى الوقف. 1 : 2 تعني ربحًا محتملًا ضعف الخسارة المحتملة.'],
  ['السعر العادل','تقدير لقيمة السهم من أرقامه المالية (الأرباح والقيمة الدفترية والتوزيعات وأهداف المحللين)، لا من حركة سعره.'],
  ['الثقة','قوة الأسباب الفنية مع نسبة نجاح نفس الإعداد على السهم نفسه تاريخيًا. ليست احتمال ربح مضمون.'],
  ['الجودة','درجة من 100 لإعداد الشراء: قرب الدعم، والاتجاه، والزخم، والحجم، والعائد إلى المخاطرة.'],
  ['التطهير','إخراج الجزء من الربح الذي يقابل الدخل غير المباح للشركة، حسب النسبة المنشورة.'],
  ['الزكاة','ربع العشر (2.5%) سنويًا هجريًا على وعاء الأسهم، حسب الطريقة التي تختارها.'],
  ['مكرر الربحية','سعر السهم مقسومًا على ربحه السنوي: كم سنة من الأرباح تدفعها الآن.'],
  ['الاتجاه','اتجاه السعر من المتوسطات المتحركة والقمم والقيعان: صاعد أو هابط أو عرضي.']];
function glossFor(text){const t=String(text||'');for(const [k,v] of GLOSSARY){const kt=_t(k);if(t.includes(k)||(kt!==k&&t.toLowerCase().includes(kt.toLowerCase())))return _t(v);}return null;}
function glossApply(root){
  /* wide tables scroll sideways: they must be reachable from the keyboard */
  for(const w of (root||document).querySelectorAll('.tbl-wrap:not([tabindex])'))w.tabIndex=0;
  for(const el of (root||document).querySelectorAll('th, .metric > .k, .sub-h, .field > span')){
    if(el.dataset.gl)continue;el.dataset.gl='1';if(el.title)continue;const g=glossFor(el.textContent);if(g){el.title=g;el.classList.add('gl');}}}

/* ---------- keyboard shortcuts ---------- */
const SHORTCUT_VIEWS=['home','analysis','watch','scanner','funds','journal','prefs'];
function shortcutAction(e,typing){
  if(e.key==='Escape')return{k:'esc'};if(typing||e.ctrlKey||e.metaKey)return null;
  if(e.altKey&&/^Digit[1-7]$/.test(e.code))return{k:'view',v:SHORTCUT_VIEWS[+e.code.slice(5)-1]};
  if(e.altKey)return null;
  if(e.key==='/')return{k:'search'};
  if(e.key==='?')return{k:'help'};
  return null;
}
function showShortcuts(on){const d=$('#kbdHelp');if(d)d.hidden=!on;}
function onShortcut(e){
  const el=e.target,typing=el&&(el.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  const a=shortcutAction(e,typing);if(!a)return;
  if(a.k==='esc'){showShortcuts(false);tourEnd(false);return;}
  e.preventDefault();
  if(a.k==='view'){if(!LOCAL&&['home','watch','scanner','funds'].includes(a.v))return;location.hash='#'+a.v;}
  if(a.k==='search'){if(location.hash!=='#analysis'){location.hash='#analysis';route();}const s=$('#sym');if(s&&s.offsetParent){s.focus();s.select();}else{const x=$('#ex');if(x)x.focus();}}  /* gold has no code box: the market list instead */
  if(a.k==='help')showShortcuts(true);
}

/* ---------- first-run tour: a small card that does not block the page ---------- */
const TOUR=[
  {sel:'.nav a[data-view="home"]',t:'الرئيسية: حالة الأسواق، ومحفظتك، وأقوى الفرص، وآخر التنبيهات في صفحة واحدة.'},
  {sel:'#sym',view:'analysis',t:'اكتب رمز السهم هنا (مثل 1120 أو COMI أو AAPL) لترى مناطق الشراء والبيع والسعر العادل ورأي المساعد الذكي.'},
  {sel:'.nav a[data-view="watch"]',t:'المراقبة: أضف أسهمك، واختر أنواع التنبيه لكل سهم، وتابع تقويم النتائج والتوزيعات.'},
  {sel:'.nav a[data-view="scanner"]',t:'الماسح: افحص السوق كله بشروطك، واحفظها باسم، وشغّلها يوميًا تلقائيًا.'},
  {sel:'.nav a[data-view="journal"]',t:'الصفقات والمحفظة: سجّل صفقاتك لترى أرباحك والتطهير والزكاة والتقرير الأسبوعي.'},
  {sel:'.nav a[data-view="prefs"]',t:'الإعدادات: ربط تيليجرام والمساعد الذكي، والضوابط الشرعية، والنسخ الاحتياطي. اضغط ? في أي وقت لعرض اختصارات لوحة المفاتيح.'}];
const TR={i:-1};
function tourShow(i){
  const card=$('#tour');if(!card)return;TR.i=i;const st=TOUR[i];
  $$('.tour-hl').forEach(x=>x.classList.remove('tour-hl'));
  if(st.view&&location.hash!=='#'+st.view)location.hash='#'+st.view;
  setTimeout(()=>{const el=$(st.sel);if(el){el.classList.add('tour-hl');el.scrollIntoView({block:'nearest',behavior:'smooth'});}},60);
  $('#tourText').textContent=_t(st.t);$('#tourStep').innerHTML=NUM((i+1)+' / '+TOUR.length);
  $('#tourPrev').disabled=i===0;$('#tourNext').textContent=_t(i===TOUR.length-1?'إنهاء':'التالي');card.hidden=false;
}
function tourEnd(save){const card=$('#tour');if(!card||card.hidden)return;card.hidden=true;TR.i=-1;$$('.tour-hl').forEach(x=>x.classList.remove('tour-hl'));if(save!==false)Store.set('tourDone',true);}
function tourStart(){tourShow(0);}

function setupUx(){
  setupMoreTabs();
  document.addEventListener('keydown',onShortcut);
  const ko=$('#kbdOpen');if(ko)ko.addEventListener('click',()=>showShortcuts(true));
  const kh=$('#kbdHelp');if(kh)kh.addEventListener('click',e=>{if(e.target===kh||e.target.closest('[data-kclose]'))showShortcuts(false);});
  if($('#tour')){
    $('#tourNext').addEventListener('click',()=>{if(TR.i>=TOUR.length-1)tourEnd(true);else tourShow(TR.i+1);});
    $('#tourPrev').addEventListener('click',()=>{if(TR.i>0)tourShow(TR.i-1);});
    $('#tourSkip').addEventListener('click',()=>tourEnd(true));
    const again=$('#tourAgain');if(again)again.addEventListener('click',()=>{location.hash='#home';setTimeout(tourStart,100);});
    if(LOCAL)Store.get('tourDone',false).then(d=>{if(!d)setTimeout(tourStart,1500);});
  }
  glossApply();
  let t=0;new MutationObserver(()=>{clearTimeout(t);t=setTimeout(()=>glossApply(),400);}).observe(document.body,{childList:true,subtree:true});
}

/* ---------- cards with tabs (the analysis details, the company file): a tab whose panel is hidden (gold, short fund
   records, a market without disclosures) is hidden too, and a card with no tab left is hidden ---------- */
const TABCARDS={};
function tabShow(id,t,save){const c=TABCARDS[id],card=$('#'+id);if(!c||!card)return;
  const btns=[...card.querySelectorAll(':scope > .more-tabs button')],vis=btns.filter(b=>!b.hidden);
  if(!vis.length){if(c.hideEmpty&&!card.hidden)card.hidden=true;return;}if(c.hideEmpty&&card.hidden)card.hidden=false;
  if(!vis.some(b=>b.dataset.tab===t))t=vis[0].dataset.tab;c.cur=t;
  for(const b of btns){const on=String(b.dataset.tab===t);if(b.getAttribute('aria-selected')!==on)b.setAttribute('aria-selected',on);b.tabIndex=b.dataset.tab===t?0:-1;}
  for(const p of card.querySelectorAll(':scope > .tab-panel'))p.classList.toggle('on',p.dataset.tab===t);
  if(save)try{localStorage.setItem(c.key,t);}catch(e){}
  if(c.onShow)c.onShow(t);}
function tabSync(id){const card=$('#'+id);if(!card||!TABCARDS[id])return;
  for(const b of card.querySelectorAll(':scope > .more-tabs button')){const p=card.querySelector(':scope > .tab-panel[data-tab="'+b.dataset.tab+'"]'),h=!p||p.hidden||(b.classList.contains('local-only')&&!LOCAL);if(b.hidden!==h)b.hidden=h;}
  tabShow(id,TABCARDS[id].cur);}
function setupTabCard(id,key,def,opt){const card=$('#'+id);if(!card)return;opt=opt||{};
  let t=def;try{t=localStorage.getItem(key)||def;}catch(e){}
  TABCARDS[id]={key,cur:t,hideEmpty:!!opt.hideEmpty,onShow:opt.onShow};
  const bar=card.querySelector(':scope > .more-tabs');
  bar.addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b)tabShow(id,b.dataset.tab,true);});
  bar.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;const v=[...bar.querySelectorAll('button')].filter(b=>!b.hidden);
    const i=v.findIndex(b=>b.dataset.tab===TABCARDS[id].cur),d=(e.key==='ArrowLeft')===(document.documentElement.dir==='rtl')?1:-1,n=v[(i+d+v.length)%v.length];
    if(n){e.preventDefault();tabShow(id,n.dataset.tab,true);n.focus();}});
  new MutationObserver(()=>tabSync(id)).observe(card,{subtree:true,attributes:true,attributeFilter:['hidden']});tabSync(id);}
/* the timeframes box fills what is left of the last row of metric cards (3 of 6 on a wide screen), or a row of its own */
function mtfSpan(cols,n){const free=cols-(n%cols);return free>=2?free:cols;}
function fitMtf(){const m=$('#verdictSec .metrics'),x=$('#mtfBox');if(!m||!x||x.hidden)return;
  const cols=getComputedStyle(m).gridTemplateColumns.split(' ').filter(Boolean).length||1;
  const n=[...m.children].filter(c=>c!==x&&getComputedStyle(c).display!=='none').length,v='span '+mtfSpan(cols,n);
  if(x.style.gridColumn!==v)x.style.gridColumn=v;}
function setupFitMtf(){const m=$('#verdictSec .metrics');if(!m)return;
  if(typeof ResizeObserver==='function')new ResizeObserver(()=>fitMtf()).observe(m);
  new MutationObserver(()=>fitMtf()).observe(m,{subtree:true,attributes:true,attributeFilter:['hidden','class']});fitMtf();}
/* 2.18.2: the AI opinion is its own card at the foot of the page, shown with the price plan */
function setupAiCard(){const pc=$('#planCard'),ac=$('#aiCard');if(!pc||!ac)return;const sync=()=>{if(ac.hidden!==pc.hidden)ac.hidden=pc.hidden;};
  new MutationObserver(sync).observe(pc,{attributes:true,attributeFilter:['hidden']});sync();}
function setupMoreTabs(){
  setupFitMtf();setupAiCard();
  setupTabCard('moreCard','mo-more-tab','lv',{hideEmpty:true,onShow:t=>{if(t==='bt'&&typeof drawSimCanvas==='function')requestAnimationFrame(()=>{try{drawSimCanvas();}catch(e){}});}});
  setupTabCard('companyRow','mo-co-tab','data');}
