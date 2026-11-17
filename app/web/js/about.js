/* ================= about and method page, stock-open timing (Phase 6) ================= */
const PERF={log:[]};
/* how long opening a stock takes: fetching the prices, and the whole until the analysis is drawn */
function perfNote(code,ex,fetchMs,totalMs){PERF.log.unshift({t:Date.now(),code:ex+':'+code,fetch:Math.round(fetchMs),total:Math.round(totalMs)});PERF.log=PERF.log.slice(0,30);
  if(LOCAL)Store.set('perfLog',PERF.log).catch(()=>{});}
function perfSummary(log){const l=(log||[]).filter(x=>x.total>=0);if(!l.length)return null;
  const tot=l.map(x=>x.total).sort((a,b)=>a-b),med=tot[tot.length>>1];
  return{n:l.length,last:l[0],median:med,max:tot[tot.length-1],fetchMedian:l.map(x=>x.fetch).sort((a,b)=>a-b)[l.length>>1]};}
async function renderAbout(){
  const v=$('#aboutVer');if(v&&LOCAL){const j=await api('/api/errors').catch(()=>null);if(j&&j.version)v.textContent=_t('الإصدار')+' '+j.version;}
  if(LOCAL&&!PERF.log.length)PERF.log=await Store.get('perfLog',[]);
  const p=perfSummary(PERF.log),el=$('#perfStats');if(!el)return;
  el.textContent=p?_t('زمن فتح السهم حتى ظهور التحليل')+': '+_t('الأخير')+' '+(p.last.total/1000).toFixed(1)+' '+_t('ث')+' ('+p.last.code+') · '+_t('الوسيط')+' '+(p.median/1000).toFixed(1)+' '+_t('ث')+' · '+_t('الأبطأ')+' '+(p.max/1000).toFixed(1)+' '+_t('ث')+' · '+_t('منها جلب الأسعار')+' '+(p.fetchMedian/1000).toFixed(1)+' '+_t('ث')+' ('+p.n+' '+_t('مرة')+')'
    :_t('افتح سهمًا ليظهر هنا زمن فتحه.');
}
