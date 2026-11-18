/* ================= scanner: compound conditions, saved scans, fair value, daily run (Phase 4, step 2) ================= */

/* the numbers a condition can test; every one is a column or shown in the row */
const SCAN_FIELDS=[
  {k:'rsi',ar:'القوة النسبية RSI'},
  {k:'conf',ar:'الثقة %'},
  {k:'chgP',ar:'تغير اليوم %'},
  {k:'distBuyP',ar:'المسافة إلى منطقة الشراء %'},
  {k:'ma50P',ar:'البعد عن المتوسط 50 %'},
  {k:'ma200P',ar:'البعد عن المتوسط 200 %'},
  {k:'fairDisc',ar:'الخصم عن السعر العادل %'},
  {k:'rr',ar:'العائد إلى المخاطرة'},
  {k:'q',ar:'درجة الجودة'},
  {k:'purN',ar:'التطهير'}];
const SCAN_OPS=[{k:'ge',ar:'أكبر من أو يساوي'},{k:'le',ar:'أصغر من أو يساوي'},{k:'bt',ar:'بين'}];

/* one condition on one row; a company without the value does not pass (it is not guessed) */
function scanRuleOk(r,rule){
  const v=r[rule.f];if(v==null||!isFinite(v))return false;
  const a=rule.a,b=rule.b;
  if(rule.op==='ge')return a==null||v>=a;
  if(rule.op==='le')return a==null||v<=a;
  if(rule.op==='bt')return(a==null||v>=Math.min(a,b??a))&&(b==null||v<=Math.max(a??b,b));
  return true;
}
const scanPass=(r,rules)=>(rules||[]).every(x=>scanRuleOk(r,x));

/* the extra numbers of a scanned company: distance from the averages, reward to risk, quality score */
function scanExtras(D,I,A){
  const N=D.length,c=D.map(d=>d.c),m50=sma(c,50)[N-1],m200=N>=200?sma(c,200)[N-1]:null,close=D[N-1].c;
  const q=typeof setupScore==='function'?setupScore(D,I,A,N-1):null;
  return{ma50P:m50?(close/m50-1)*100:null,ma200P:m200?(close/m200-1)*100:null,rr:A.rr!=null&&isFinite(A.rr)?A.rr:null,q:q?q.score:null};
}

/* the fair value from the market-wide read: same method as the analysis page, without the stock's own past multiple */
function scanFairInput(d,code,ex){
  const f=d&&d.f&&d.f[code];if(!f)return null;
  const sec=d.med[f.sector]||{},mk=d.med['*']||{};
  return{ok:true,ex,f,sectorPE:sec.pe,sectorPB:sec.pb,sectorDY:sec.dy,sectorN:sec.n||0,sectorNDY:sec.ndy||0,
    marketPE:mk.pe,marketPB:mk.pb,marketDY:mk.dy,marketN:mk.n||0,sectorAr:(d.sectorAr||{})[f.sector]||f.sector||''};
}
function scanFairOf(d,r,ex){
  const inp=scanFairInput(d,r.code,ex);if(!inp||typeof fairValue!=='function')return null;
  const fv=fairValue(inp,{ex});return fv&&fv.fair>0?{fair:fv.fair,disc:(fv.fair-r.price)/fv.fair*100,level:fv.conf&&fv.conf.level}:null;
}

/* the short message of a scan's results, for Telegram */
function scanDigest(rows,name,top,when){
  const L=['🔎 '+_t('نتائج الفحص اليومي')+(name?' «'+name+'»':'')+' — '+(when||fmtLocal.format(new Date())),
    _t('عدد الشركات المطابقة')+': '+rows.length,''];
  for(const r of rows.slice(0,top||10))
    L.push('• '+r.name+(r.code&&r.code!==r.name?' ('+r.code+')':'')+': '+fp(r.price)+' · '+_t(STANCE_AR[r.stance]||'')
      +(r.conf!=null?' · '+_t('الثقة')+' '+r.conf+'%':'')+(r.fairDisc!=null?' · '+_t('السعر العادل')+' '+fp(r.fair)+' ('+(r.fairDisc>=0?'+':'')+r.fairDisc.toFixed(0)+'%)':''));
  if(!rows.length)L.push(_t('لا توجد شركات تطابق الشروط اليوم.'));
  L.push('',_t('تحليل فني آلي وليس توصية استثمارية.'));
  return L.join('\n');
}

/* ---------- conditions in the page ---------- */
const SCR={rules:[]};
function scanRuleRowHTML(x,i){
  return '<div class="scan-rule" data-ri="'+i+'"><select data-rk="f" aria-label="'+esc(_t('الحقل'))+'">'+SCAN_FIELDS.map(f=>'<option value="'+f.k+'"'+(f.k===x.f?' selected':'')+'>'+esc(_t(f.ar))+'</option>').join('')+'</select>'
    +'<select data-rk="op" aria-label="'+esc(_t('المقارنة'))+'">'+SCAN_OPS.map(o=>'<option value="'+o.k+'"'+(o.k===x.op?' selected':'')+'>'+esc(_t(o.ar))+'</option>').join('')+'</select>'
    +'<input type="number" step="any" data-rk="a" value="'+(x.a??'')+'" aria-label="'+esc(_t('القيمة'))+'">'
    +'<input type="number" step="any" data-rk="b" value="'+(x.b??'')+'" aria-label="'+esc(_t('إلى'))+'"'+(x.op==='bt'?'':' hidden')+'>'
    +'<button class="btn xs ghost" type="button" data-rdel="'+i+'">'+esc(_t('حذف'))+'</button></div>';
}
function renderScanRules(){const box=$('#scanRules');if(!box)return;
  box.innerHTML=SCR.rules.map(scanRuleRowHTML).join('')||'<p class="small muted">'+esc(_t('لا توجد شروط إضافية.'))+'</p>';
  $('#scanRuleN').textContent=SCR.rules.length;}

/* ---------- saved scans ---------- */
function scanCurrent(){return{sel:$('#scanEx').value,stance:$('#scanStance').value,conf:+$('#scanConf').value||0,
  sharia:$$('#scanShariaDD input:checked').map(i=>i.value),seg:$$('#scanSegDD input:checked').map(i=>i.value),rules:SCR.rules.map(x=>Object.assign({},x))};}
function scanApply(s){
  $('#scanEx').value=s.sel||'SR';$('#scanStance').value=s.stance||'';$('#scanConf').value=s.conf||0;
  $$('#scanShariaDD input').forEach(i=>{i.checked=(s.sharia||[]).includes(i.value);});
  $$('#scanSegDD input').forEach(i=>{i.checked=(s.seg||[]).includes(i.value);});
  SCR.rules=(s.rules||[]).map(x=>Object.assign({},x));renderScanRules();
  if(typeof updateScanSeg==='function')updateScanSeg();if(typeof updateShariaLabel==='function')updateShariaLabel();if(typeof updateSegLabel==='function')updateSegLabel();
}
async function renderSavedScans(){
  const list=await Store.get('savedScans',[]),cur=$('#scanSaved').value,auto=$('#scanAutoName'),ac=(P.scanAuto||{}).name||'';
  const opts=list.map(s=>'<option value="'+esc(s.name)+'">'+esc(s.name)+'</option>').join('');
  $('#scanSaved').innerHTML='<option value="">'+esc(_t('— اختر فحصًا محفوظًا —'))+'</option>'+opts;
  if(list.some(s=>s.name===cur))$('#scanSaved').value=cur;
  if(auto){auto.innerHTML='<option value="">'+esc(_t('الشروط الحالية في الصفحة'))+'</option>'+opts;auto.value=list.some(s=>s.name===ac)?ac:'';}
}
async function saveScanAs(){
  const name=($('#scanName').value||$('#scanSaved').value||'').trim().slice(0,60);
  if(!name){toast(_t('اكتب اسمًا للفحص أولًا.'));$('#scanName').focus();return;}
  const list=(await Store.get('savedScans',[])).filter(s=>s.name!==name);list.push(Object.assign({name},scanCurrent()));
  list.sort((a,b)=>a.name.localeCompare(b.name,'ar'));await Store.set('savedScans',list);await renderSavedScans();$('#scanSaved').value=name;$('#scanName').value='';
  toast(_t('حُفظ الفحص')+' «'+name+'».');
}
async function deleteSavedScan(){const name=$('#scanSaved').value;if(!name)return;
  await Store.set('savedScans',(await Store.get('savedScans',[])).filter(s=>s.name!==name));await renderSavedScans();toast(_t('حُذف الفحص')+' «'+name+'».');}

/* ---------- fair value for the scanned companies ---------- */
async function scanLoadFair(ex,size){
  if(!['SR','CA','US'].includes(ex))return;
  const d=await api('/api/scanfund',size?{ex,size}:{ex}).catch(()=>null);
  if(!d||!d.ok){SC.fairNote=_t('تعذّر جلب الأرقام المالية لحساب السعر العادل.');return;}
  for(const r of SC.rows){const x=scanFairOf(d,r,ex);r.fair=x?x.fair:null;r.fairDisc=x?x.disc:null;}
  SC.fairNote='';
  if(ex==='CA')await scanFillYahoo(d,ex);
}
/* 2.18: Egyptian results that TradingView left without enough figures get them from Yahoo Finance (kept a day).
   Only the rows that pass the other conditions are asked for, at most 75; the share covered is shown. */
function scanFillMerge(d,extra){let n=0;for(const [c,f] of Object.entries(extra||{})){const cur=d.f[c];
  if(!cur){d.f[c]=Object.assign({},f);n++;continue;}for(const [k,v] of Object.entries(f))if(cur[k]==null&&v!=null){cur[k]=v;n++;}}return n;}
async function scanFillYahoo(d,ex){
  const rules=(SCR.rules||[]).filter(x=>x.f!=='fairDisc'),keep=SCR.rules;
  let want;try{SCR.rules=rules;want=scanFiltered();}catch(e){want=SC.rows;}finally{SCR.rules=keep;}
  const miss=want.filter(r=>r.fair==null).slice(0,75),before=want.filter(r=>r.fair!=null).length;
  let got=0;
  for(let i=0;i<miss.length&&!SC.stop;i+=25){const part=miss.slice(i,i+25);
    const j=await api('/api/scanfund',{ex,fill:part.map(r=>r.code).join(',')}).catch(()=>null);if(!j||!j.ok)break;
    scanFillMerge(d,j.f);for(const r of part){const x=scanFairOf(d,r,ex);if(x){r.fair=x.fair;r.fairDisc=x.disc;got++;}}}
  SC.fairCover={n:want.length,have:before+got,yahoo:got};
  if(want.length)SC.fairNote=_t('السعر العادل متاح لـ')+' '+NUM(before+got)+' '+_t('من')+' '+NUM(want.length)+(got?' ('+NUM(got)+' '+_t('منها من Yahoo Finance')+')':'');
}

/* ---------- the daily run ---------- */
async function scanAutoTick(now){
  const A=P.scanAuto||{};if(!LOCAL||!A.on||SC.running)return;
  now=now||new Date();const [h,m]=(A.time||'16:00').split(':').map(Number);
  if(now.getHours()*60+now.getMinutes()<h*60+m||(await Store.get('lastAutoScan',''))===todayKey())return;
  await Store.set('lastAutoScan',todayKey());
  if(A.name){const s=(await Store.get('savedScans',[])).find(x=>x.name===A.name);if(s)scanApply(s);}
  await runScan();
  const rows=scanFiltered().slice().sort((a,b)=>(b.conf||0)-(a.conf||0));
  const text=scanDigest(rows,A.name||'',A.top||10);
  await Store.set('lastAutoScanText',{at:Date.now(),text});
  const j=await apiPost('/api/notify',{title:_t('نتائج الفحص اليومي'),body:rows.length+' '+_t('شركة مطابقة'),desktop:true,telegram:true,text}).catch(()=>null);
  $('#scanAutoMeta').textContent=_t('آخر تشغيل تلقائي')+': '+fmtLocalTime.format(new Date())+' · '+rows.length+' '+_t('شركة مطابقة')
    +(j&&j.telegram===true?' · '+_t('أُرسلت إلى تيليجرام'):j&&typeof j.telegram==='string'?' · '+_t(j.telegram):'');
}

function setupScanTools(){
  if(!$('#scanRules'))return;
  renderScanRules();renderSavedScans();
  $('#scanAddRule').addEventListener('click',()=>{SCR.rules.push({f:'rsi',op:'bt',a:40,b:60});renderScanRules();renderScan();});
  $('#scanRules').addEventListener('click',e=>{const d=e.target.closest('[data-rdel]');if(!d)return;SCR.rules.splice(+d.dataset.rdel,1);renderScanRules();renderScan();});
  $('#scanRules').addEventListener('change',e=>{const el=e.target.closest('[data-rk]');if(!el)return;const i=+el.closest('[data-ri]').dataset.ri,x=SCR.rules[i],k=el.dataset.rk;
    x[k]=k==='a'||k==='b'?(el.value===''?null:+el.value):el.value;if(k==='op')renderScanRules();renderScan();});
  $('#scanSaved').addEventListener('change',async()=>{const name=$('#scanSaved').value;if(!name)return;
    const s=(await Store.get('savedScans',[])).find(x=>x.name===name);if(s){scanApply(s);$('#scanName').value=name;renderScan();}});
  $('#scanSave').addEventListener('click',saveScanAs);
  $('#scanDel').addEventListener('click',deleteSavedScan);
  $('#scanAutoName').addEventListener('change',()=>{setPref('scanAuto.name',$('#scanAutoName').value);});
  Store.get('lastAutoScanText',null).then(x=>{if(x&&x.at)$('#scanAutoMeta').textContent=_t('آخر تشغيل تلقائي')+': '+fmtLocalTime.format(new Date(x.at));});
}
