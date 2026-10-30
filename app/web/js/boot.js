/* ================= routing & startup ================= */
const VIEWS=['analysis','watch','scanner','funds','journal','prefs'];
function route(){
  let v=(location.hash||'#analysis').slice(1);
  if(!VIEWS.includes(v)||(!LOCAL&&(v==='watch'||v==='scanner'||v==='funds')))v='analysis';
  for(const n of VIEWS){const el=$('#view-'+n);if(el)el.hidden=n!==v;}
  $$('.nav a').forEach(a=>{if(a.dataset.view===v)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  if(v==='analysis')requestAnimationFrame(draw);
  if(v==='journal')refreshJournalPrices();
  if(v==='watch')renderWatch();
  if(v==='funds')loadFundList().then(loadFundStats);
}
(async function boot(){
  await loadPrefs();
  applyTheme();applyEdu();applyFont();
  S.tf=P.ana.tf==='W'?'W':'D';
  setupAnalysisView();setupChartInteraction();setupJournal();setupWatchViews();setupFavs();setupFunds();bindPrefs();
  window.addEventListener('hashchange',route);route();
  updateLinks();renderRecent();renderRangeSeg();
  {const top=$('header.top');const onScroll=()=>top.classList.toggle('stuck',window.scrollY>4);window.addEventListener('scroll',onScroll,{passive:true});onScroll();}
  if(LOCAL){setInterval(()=>{api('/api/ping').catch(()=>{});},20000);setInterval(liveTick,120000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)liveTick();});setTimeout(()=>checkUpdate(false),6000);}
  const rec=LOCAL?await getRecent():[];
  if(rec.length){applySource(rec[0].ex,rec[0].code);loadSample();fetchSymbol(rec[0].code,rec[0].ex);return;}
  const lf=await Store.get('lastFile',null);
  if(lf&&lf.text){try{applySource(lf.ex||'SR',lf.code||'');const D=parseData(lf.text);useStatic(D,{source:'user',fileName:lf.fileName,name:lf.name||'سهمي',code:lf.code});
    setStatus('تم استرجاع آخر بيانات حمّلتها ('+D.length+' شمعة).');return;}catch(e){}}
  loadSample();
})();
