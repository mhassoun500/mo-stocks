/* ================= routing & startup ================= */
const VIEWS=['home','analysis','watch','scanner','funds','journal','prefs','about'];
function route(){
  let v=(location.hash||(LOCAL?'#home':'#analysis')).slice(1);
  if(!VIEWS.includes(v)||(!LOCAL&&(v==='home'||v==='watch'||v==='scanner'||v==='funds')))v='analysis';
  for(const n of VIEWS){const el=$('#view-'+n);if(el)el.hidden=n!==v;}
  $$('.nav a').forEach(a=>{if(a.dataset.view===v)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  if(v==='analysis')requestAnimationFrame(draw);
  if(v==='journal')refreshJournalPrices();
  if(v==='watch')renderWatch();
  if(v==='funds')loadFundList().then(loadFundStats);
  if(v==='home')renderHome();
  if(v==='about')renderAbout();
}
(async function boot(){
  await loadPrefs();
  applyTheme();applyEdu();applyFont();
  S.tf=P.ana.tf==='W'?'W':'D';
  setupAnalysisView();setupChartInteraction();setupJournal();setupRisk();setupOpp();setupWatchViews();setupFavs();setupFunds();bindPrefs();setupScanTools();setupCalendar();setupReports();setupPlan();setupAiExtras();setupAiTools();setupHome();setupUx();setupReport();setupTgCmd();setupScanBt();setupPerformance();setupMaint();setupSources();setupSim();setupPrefTabs();$('#mtfHourly').addEventListener('click',async()=>{if(await ensureHourly())renderMtf();});
  window.addEventListener('hashchange',route);route();
  updateLinks();renderRecent();renderRangeSeg();
  setupShariaPop();setupCompanyFile();
  {const top=$('header.top');const onScroll=()=>top.classList.toggle('stuck',window.scrollY>4);window.addEventListener('scroll',onScroll,{passive:true});onScroll();}
  if(LOCAL){setInterval(()=>{api('/api/ping').catch(()=>{});},20000);setInterval(liveTick,120000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)liveTick();});setTimeout(()=>checkUpdate(false),6000);}
  /* the first data on screen: the last stock opened, else the last file, else the sample */
  await (async()=>{
    const rec=LOCAL?await getRecent():[];
    if(S.loadSeq)return;  /* the user already opened a stock while the app was starting: keep it */
    if(rec.length){applySource(rec[0].ex,rec[0].code);loadSample();fetchSymbol(rec[0].code,rec[0].ex);return;}
    const lf=await Store.get('lastFile',null);
    if(S.loadSeq)return;
    if(lf&&lf.text){try{applySource(lf.ex||'SR',lf.code||'');const D=parseData(lf.text);useStatic(D,{source:'user',fileName:lf.fileName,name:lf.name||'سهمي',code:lf.code});
      setStatus('تم استرجاع آخر بيانات حمّلتها ('+D.length+' شمعة).');return;}catch(e){}}
    loadSample();
  })();
  try{performance.mark('mo-ready');}catch(e){}
})();
