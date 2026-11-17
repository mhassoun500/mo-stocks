/* ================= trade journal & portfolio ================= */
const J={trades:[],editing:null,closing:null,loaded:false};  /* nothing is saved before the saved journal has been read */
const TAGS_GOOD=['التزام بالخطة','دخول من منطقة الشراء','احترام وقف الخسارة'];
const TAGS_BAD=['دخول متسرع','مطاردة السعر','تجاهل وقف الخسارة','خروج مبكر','حجم صفقة كبير','قرار عاطفي'];
const dateInput=t=>{const d=new Date(t||Date.now());return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const parseDateInput=s=>s?Date.parse(s+'T12:00:00'):Date.now();

async function loadJournal(){J.trades=await Store.get('journal',[]);J.loaded=true;renderJournal();purFetchEst();}
async function saveJournal(){if(!J.loaded)return;await Store.set('journal',J.trades);}
function tradeR(t,px){const risk=t.entry-(t.stop||0);return t.stop&&risk>0?(px-t.entry)/risk:null;}

function renderTagChips(sel){
  $('#fTags').innerHTML=TAGS_GOOD.concat(TAGS_BAD).map(tg=>'<label class="chip"><input type="checkbox" value="'+esc(tg)+'"'+(sel.includes(tg)?' checked':'')+'><span>'+(TAGS_GOOD.includes(tg)?'✓ ':'')+esc(tg)+'</span></label>').join('');
}
function openTradeForm(pre){
  location.hash='#journal';J.editing=null;J.closing=null;
  $('#jFormTitle').textContent='صفقة جديدة';$('#fCloseBox').hidden=true;
  $('#fCode').value=S.source!=='sample'?(S.code||''):'';$('#fName').value=S.source!=='sample'?(S.meta&&S.meta.short||S.name||''):'';$('#fEx').value=S.ex||'SR';
  $('#fQty').value=pre.qty||'';$('#fEntry').value=pre.entry!=null?+(+pre.entry).toFixed(4):'';$('#fStop').value=pre.stop!=null?+(+pre.stop).toFixed(4):'';$('#fTarget').value=pre.target!=null?+(+pre.target).toFixed(4):'';
  $('#fDate').value=dateInput();$('#fReason').value=S.A&&S.A.stance==='buy'?'إشارة الأداة: '+$('#stanceText').textContent:'';
  renderTagChips([]);$('#jForm').hidden=false;$('#fCode').focus();
}
function openCloseForm(id){
  const t=J.trades.find(x=>x.id===id);if(!t)return;J.closing=id;J.editing=null;
  $('#jFormTitle').textContent='إغلاق صفقة '+(t.name||t.code);
  $('#fCode').value=t.code;$('#fName').value=t.name||'';$('#fEx').value=t.ex;$('#fQty').value=t.qty;$('#fEntry').value=t.entry;$('#fStop').value=t.stop||'';$('#fTarget').value=t.target||'';
  $('#fDate').value=dateInput(t.date);$('#fReason').value=t.reason||'';
  $('#fExit').value=t.last?+t.last.toFixed(4):'';$('#fExitDate').value=dateInput();$('#fExitReason').value='';
  $('#fCloseBox').hidden=false;renderTagChips(t.tags||[]);$('#jForm').hidden=false;$('#fExit').focus();
}
async function saveTradeForm(){
  const tags=$$('#fTags input:checked').map(i=>i.value);
  const base={code:$('#fCode').value.trim().toUpperCase(),name:$('#fName').value.trim(),ex:$('#fEx').value,qty:+$('#fQty').value,entry:+$('#fEntry').value,
    stop:+$('#fStop').value||null,target:+$('#fTarget').value||null,date:parseDateInput($('#fDate').value),reason:$('#fReason').value.trim(),tags};
  if(!base.code||!(base.qty>0)||!(base.entry>0)){toast('أدخل الرمز والكمية وسعر الدخول.');return;}
  if(J.closing){const t=J.trades.find(x=>x.id===J.closing);const exit=+$('#fExit').value;if(!(exit>0)){toast('أدخل سعر الخروج.');return;}
    Object.assign(t,base,{exit,exitDate:parseDateInput($('#fExitDate').value),exitReason:$('#fExitReason').value.trim()});}
  else J.trades.push(Object.assign({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),exit:null},base));
  await saveJournal();$('#jForm').hidden=true;J.closing=null;renderJournal();toast('حُفظت الصفقة.');refreshJournalPrices();
}
async function refreshJournalPrices(){
  if(!J.loaded)return;  /* opened straight on this page: the journal is still loading, and an empty list must never be saved over it */
  const open=J.trades.filter(t=>!t.exit);const seen={};
  for(const t of open){const k=t.ex+':'+t.code;
    if(S.source==='live'&&S.ex===t.ex&&S.code===t.code&&S.A){t.last=S.A.close;t.lastAt=Date.now();continue;}
    if(!LOCAL)continue;
    if(!(k in seen)){const j=await api('/api/history',{code:t.code,ex:t.ex,range:'1y'}).catch(()=>null);seen[k]=j&&j.ok&&j.rows.length?j.rows[j.rows.length-1][4]:null;}
    if(seen[k]){t.last=seen[k];t.lastAt=Date.now();}}
  await saveJournal();renderJournal();
}
function renderJournal(){
  const open=J.trades.filter(t=>!t.exit),closed=J.trades.filter(t=>t.exit).sort((a,b)=>b.exitDate-a.exitDate);
  let mv=0,cost=0;
  $('#jOpen').innerHTML=open.length?open.map(t=>{const px=t.last;const pl=px?(px-t.entry)*t.qty:null;if(px){mv+=px*t.qty;cost+=t.entry*t.qty;}
    const R=px?tradeR(t,px):null;
    return '<tr><td><b>'+esc(t.name||t.code)+'</b><br><span class="small muted num">'+esc(t.code)+'</span></td><td>'+NUM(fmtMoney.format(t.qty))+'</td><td>'+NUM(fp(t.entry))+'<br><span class="small muted">'+fmtDate.format(t.date)+'</span></td>'+
      '<td>'+(px?NUM(fp(px)):'<span class="small muted">'+(LOCAL?'اضغط تحديث الأسعار':'افتح الأصل في التحليل')+'</span>')+'</td>'+
      '<td>'+(pl!=null?'<b style="color:'+(pl>=0?'var(--up)':'var(--down)')+'">'+NUM(fmtMoney.format(pl))+'</b> '+chgSpan(px/t.entry-1,1):'—')+'</td>'+
      '<td>'+(t.stop?NUM(fp(t.stop)):'—')+'</td><td>'+(t.target?NUM(fp(t.target)):'—')+'</td><td>'+(R!=null?NUM(R.toFixed(2)+'R'):'—')+'</td>'+
      '<td><span class="actions"><button class="btn xs" type="button" data-close="'+t.id+'">إغلاق</button><button class="btn xs ghost danger" type="button" data-rm="'+t.id+'">حذف</button></span></td></tr>';}).join('')
    :'<tr><td colspan="9" class="empty">لا توجد صفقات مفتوحة. سجّل صفقتك من حاسبة حجم الصفقة أو بزر «صفقة جديدة».</td></tr>';
  $('#jClosed').innerHTML=closed.length?closed.map(t=>{const r=t.exit/t.entry-1,R=tradeR(t,t.exit),days=Math.max(0,Math.round((t.exitDate-t.date)/DAY));
    return '<tr><td><b>'+esc(t.name||t.code)+'</b></td><td>'+NUM(fp(t.entry))+'</td><td>'+NUM(fp(t.exit))+'</td><td>'+chgSpan(r,1)+' '+NUM(fmtMoney.format((t.exit-t.entry)*t.qty))+'</td>'+
      '<td>'+(R!=null?NUM(R.toFixed(2)+'R'):'—')+'</td><td>'+days+' يوم</td><td class="small">'+esc((t.tags||[]).join('، '))+'</td><td><button class="btn xs ghost danger" type="button" data-rm="'+t.id+'">حذف</button></td></tr>';}).join('')
    :'<tr><td colspan="8" class="empty">لا توجد صفقات مغلقة بعد.</td></tr>';
  /* stats */
  const wins=closed.filter(t=>t.exit>t.entry),losses=closed.filter(t=>t.exit<=t.entry);
  const gp=wins.reduce((s,t)=>s+(t.exit-t.entry)*t.qty,0),gl=-losses.reduce((s,t)=>s+(t.exit-t.entry)*t.qty,0);
  const Rs=closed.map(t=>tradeR(t,t.exit)).filter(x=>x!=null);
  const k=(label,val,sub)=>'<div class="metric"><span class="k">'+label+'</span><span class="v">'+val+'</span>'+(sub?'<span class="s">'+sub+'</span>':'')+'</div>';
  $('#jKpis').innerHTML=k('الصفقات المفتوحة',NUM(open.length),'')+k('قيمة المحفظة الحالية',NUM(fmtMoney.format(mv)),cost?'التكلفة '+NUM(fmtMoney.format(cost)):'')+
    k('ربح غير محقق',cost?'<span style="color:'+(mv>=cost?'var(--up)':'var(--down)')+'">'+NUM(fmtMoney.format(mv-cost))+'</span>':'—',cost?chgSpan(mv/cost-1,1):'')+
    k('صافي الربح المحقق',closed.length?'<span style="color:'+(gp>=gl?'var(--up)':'var(--down)')+'">'+NUM(fmtMoney.format(gp-gl))+'</span>':'—',closed.length+' صفقة مغلقة')+
    k('نسبة النجاح',closed.length?NUM(Math.round(wins.length/closed.length*100)+'%'):'—',closed.length?wins.length+' رابحة · '+losses.length+' خاسرة':'')+
    k('متوسط المضاعف',Rs.length?NUM((Rs.reduce((a,b)=>a+b,0)/Rs.length).toFixed(2)+'R'):'—',gl>0?'معامل الربح '+NUM((gp/gl).toFixed(2)):'');
  /* recurring patterns */
  const cnt={},lossCnt={};for(const t of closed)for(const tg of t.tags||[]){cnt[tg]=(cnt[tg]||0)+1;if(t.exit<=t.entry)lossCnt[tg]=(lossCnt[tg]||0)+1;}
  const items=[];
  const bad=TAGS_BAD.filter(t=>cnt[t]).sort((a,b)=>(lossCnt[b]||0)-(lossCnt[a]||0));
  for(const tg of bad)items.push('<li><span class="kind r">'+esc(tg)+'</span><span>تكرر في '+cnt[tg]+' صفقة، منها '+(lossCnt[tg]||0)+' خاسرة</span><span></span></li>');
  const adh=closed.filter(t=>(t.tags||[]).includes('التزام بالخطة'));
  if(closed.length){const aw=adh.filter(t=>t.exit>t.entry).length;items.push('<li><span class="kind s">الالتزام بالخطة</span><span>في '+adh.length+' من '+closed.length+' صفقة'+(adh.length?'، ونجح منها '+Math.round(aw/adh.length*100)+'%':'')+'</span><span></span></li>');}
  if(wins.length&&losses.length){const aw=wins.reduce((s,t)=>s+(t.exit/t.entry-1),0)/wins.length,al=losses.reduce((s,t)=>s+(t.exit/t.entry-1),0)/losses.length;
    items.push('<li><span class="kind n">الربح مقابل الخسارة</span><span>متوسط الصفقة الرابحة '+NUM(pct(aw))+' والخاسرة '+NUM(pct(al))+(Math.abs(al)>aw?'. خسائرك أكبر من أرباحك، فالتزم بوقف الخسارة.':'.')+'</span><span></span></li>');}
  renderPurify();
  $('#jMistakes').innerHTML=items.join('')||'<li class="plain"><p class="empty">بعد إغلاق عدة صفقات ووسمها، ستظهر هنا أخطاؤك المتكررة وأثرها على نتائجك.</p></li>';
}
async function exportJournal(){
  const head=['الرمز','الاسم','السوق','الكمية','تاريخ الدخول','سعر الدخول','الوقف','الهدف','سبب الدخول','تاريخ الخروج','سعر الخروج','سبب الخروج','الربح','الوسوم'];
  const q=v=>'"'+String(v==null?'':v).replace(/"/g,'""')+'"';
  const rows=J.trades.map(t=>[t.code,t.name,t.ex,t.qty,dateInput(t.date),t.entry,t.stop,t.target,t.reason,t.exit?dateInput(t.exitDate):'',t.exit||'',t.exitReason||'',t.exit?((t.exit-t.entry)*t.qty).toFixed(2):'',(t.tags||[]).join('، ')]);
  const csv=[head].concat(rows).map(r=>r.map(q).join(',')).join('\r\n');
  const name='سجل الصفقات '+todayKey()+'.csv';
  if(LOCAL){const j=await apiPost('/api/save',{filename:name,text:csv});if(j.ok){toast('حُفظ السجل في مجلد التنزيلات.');api('/api/reveal',{path:j.path});}else toast(j.error||'تعذّر الحفظ.');return;}
  try{const dl=window.claude&&await window.claude.use('downloads');if(!dl){toast('حفظ الملفات غير متاح هنا.');return;}await dl.save({filename:name,data:'﻿'+csv});}
  catch(e){if(e&&e.code!=='declined')toast('تعذّر حفظ الملف.');}
}
/* ---------- purification owed on the journal's holdings, and the record of what was given away ---------- */
const PUR={paid:[],divs:{},busy:false};
const purTradeKey=t=>t.ex+'|'+purCode(t.code);
async function loadPurPaid(){PUR.paid=await Store.get('purifyPaid',[]);}
async function savePurPaid(){await Store.set('purifyPaid',PUR.paid);}
/* cash dividends per share for each stock that is valued by a percentage (5 years of history, once per session) */
async function purFetchDivs(){if(!LOCAL||PUR.busy)return;PUR.busy=true;const b=$('#purCalc');if(b){b.disabled=true;b.textContent=_t('جارٍ جلب التوزيعات…');}
  try{for(const t of J.trades){const k=purTradeKey(t);if(k in PUR.divs||!['SR','CA','US'].includes(t.ex))continue;
      const e=purifyEntries(t.code,t.ex,true);if(!e.length||e[0].kind!=='pct'){continue;}
      const j=await api('/api/history',{code:t.code,ex:t.ex,range:'5y'}).catch(()=>null);PUR.divs[k]=j&&j.ok?(j.dividends||[]):null;}}
  finally{PUR.busy=false;if(b){b.disabled=false;b.textContent=_t('احسب مع التوزيعات');}renderPurify();}}
async function purFetchEst(){if(!LOCAL)return;let changed=false;
  for(const t of J.trades){if(!['SR','CA','US'].includes(t.ex))continue;const k=purTradeKey(t);
    if(purifyEntries(t.code,t.ex,false).length||k in PUR_EST)continue;PUR_EST[k]={ok:false,loading:true};
    const j=await api('/api/purify_est',{code:purCode(t.code),ex:t.ex}).catch(()=>null);PUR_EST[k]=j&&j.ok?j:{ok:false,error:j&&j.error||''};changed=true;}
  if(changed)renderPurify();}
function renderPurify(){if(!$('#purRows'))return;
  const opt={gains:P.sharia.gains!==false},rows=J.trades.map(t=>{const k=purTradeKey(t);return{t,r:purifyDue(t,purifyEntries(t.code,t.ex,true),k in PUR.divs?PUR.divs[k]:null,opt)};});
  const money=(v,cur)=>NUM(fmtMoney.format(v))+' '+esc(purCurLabel(cur));
  const shown=rows.filter(x=>x.r.status!=='skip');
  $('#purRows').innerHTML=shown.length?shown.map(({t,r})=>{const f=r.fig;
      const basis=!f?'<span class="muted">'+esc(_t('غير متوفرة'))+'</span>':purifyValHTML(f)+'<br><span class="small muted">'+esc(_t(f.by))+(f.period?' · '+NUM(esc(f.period)):'')+'</span>'+(f.src==='est'?'<br><span class="small muted">'+esc(_t('تقريبي'))+'</span>':'');
      const pctMode=f&&f.kind==='pct',k=purTradeKey(t),need=pctMode&&!(k in PUR.divs);
      const divCell=!pctMode?'<span class="muted small">'+esc(_t('لا يلزم'))+'</span>':need?'<span class="muted small">'+esc(_t('اضغط «احسب مع التوزيعات»'))+'</span>':r.divs==null?'<span class="muted small">'+esc(_t('تعذّرت القراءة'))+'</span>':money(r.divs,r.cur);
      const gainCell=!pctMode?'<span class="muted small">'+esc(_t('لا يلزم'))+'</span>':r.gain==null?'<span class="muted small">'+esc(_t('مفتوحة'))+'</span>':money(r.gain,r.cur)+(r.gain>0&&!opt.gains?' <span class="small muted">('+esc(_t('غير محسوب'))+')</span>':'');
      const dueCell=r.due==null?'—':need?'<span class="muted small">'+esc(_t('بانتظار التوزيعات'))+'</span>':'<b>'+money(r.due,r.cur)+'</b>'+(r.status==='partial'?'<br><span class="small muted">'+esc(_t('جزئي'))+': '+r.notes.map(n=>esc(_t(n))).join(' ')+'</span>':'');
      return '<tr><td><b>'+esc(t.name||t.code)+'</b><br><span class="small muted num">'+esc(t.code)+'</span>'+(t.exit?' <span class="tag">'+esc(_t('مغلقة'))+'</span>':'')+'</td><td>'+NUM(fmtMoney.format(t.qty))+'</td><td>'+NUM(r.days)+' '+esc(_t('يومًا'))+'</td><td>'+basis+'</td><td>'+divCell+'</td><td>'+gainCell+'</td><td>'+dueCell+'</td></tr>';}).join('')
    :'<tr><td colspan="7" class="empty">'+esc(_t('لا توجد أسهم في سجل صفقاتك بعد.'))+'</td></tr>';
  const ready=rows.filter(x=>{const f=x.r.fig;return !(f&&f.kind==='pct'&&!(purTradeKey(x.t) in PUR.divs));}).map(x=>x.r);
  const tot=purifyTotals(ready,PUR.paid),k=(label,val,sub)=>'<div class="metric"><span class="k">'+label+'</span><span class="v">'+val+'</span>'+(sub?'<span class="s">'+sub+'</span>':'')+'</div>';
  const curs=Object.keys(tot);
  $('#purTotals').innerHTML=curs.length?curs.map(c=>k(esc(_t('المستحق'))+' ('+esc(purCurLabel(c))+')',money(tot[c].due,c),esc(_t('أُخرج'))+' '+money(tot[c].paid,c))+k(esc(_t('المتبقي'))+' ('+esc(purCurLabel(c))+')','<span style="color:'+(tot[c].left>0?'var(--down)':'var(--up)')+'">'+money(tot[c].left,c)+'</span>','')).join('')
    :'';
  const missing=rows.filter(x=>x.r.status==='none').length;
  const pm=$('#purMissing');pm.hidden=!missing;pm.innerHTML=missing?esc(_t('أسهم بلا نسبة تطهير منشورة ولا تقدير:'))+' '+NUM(missing)+'. '+esc(_t('أدخلها من الإعدادات > الضوابط الشرعية لتدخل في الحساب.')):'';
  const paid=PUR.paid.slice().sort((a,b)=>b.date-a.date);
  $('#purPaid').innerHTML=paid.length?paid.map(p=>'<li><span class="kind s">'+money(p.amount,p.cur)+'</span><span>'+fmtDate.format(p.date)+(p.note?' · '+esc(p.note):'')+'</span><span><button class="btn xs ghost danger" type="button" data-purrm="'+p.id+'">'+esc(_t('حذف'))+'</button></span></li>').join('')
    :'<li class="plain"><p class="empty">'+esc(_t('لم تسجّل أي إخراج بعد.'))+'</p></li>';}
function setupPurify(){
  $('#purDate').value=dateInput();
  $('#purCalc').addEventListener('click',()=>{for(const t of J.trades)delete PUR.divs[purTradeKey(t)];purFetchDivs();});
  $('#purGains').addEventListener('change',()=>setTimeout(renderPurify,0));
  $('#purAdd').addEventListener('click',async()=>{const amount=+$('#purAmt').value;if(!(amount>0)){toast(_t('أدخل مبلغًا أكبر من صفر.'));return;}
    PUR.paid.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),amount,cur:$('#purCur').value,date:parseDateInput($('#purDate').value),note:$('#purNote').value.trim()});
    await savePurPaid();$('#purAmt').value='';$('#purNote').value='';renderPurify();toast(_t('سُجّل الإخراج.'));});
  $('#purPaid').addEventListener('click',async e=>{const b=e.target.closest('[data-purrm]');if(!b)return;
    if(b.dataset.confirm!=='1'){b.dataset.confirm='1';b.textContent=_t('تأكيد الحذف');setTimeout(()=>{if(b.isConnected){b.dataset.confirm='';b.textContent=_t('حذف');}},3500);return;}
    PUR.paid=PUR.paid.filter(p=>p.id!==b.dataset.purrm);await savePurPaid();renderPurify();});
  loadPurPaid().then(renderPurify);}
function setupJournal(){
  setupPurify();
  $('#jNew').addEventListener('click',()=>openTradeForm({}));
  $('#fSave').addEventListener('click',saveTradeForm);
  $('#fCancel').addEventListener('click',()=>{$('#jForm').hidden=true;J.closing=null;});
  $('#jRefresh').addEventListener('click',refreshJournalPrices);
  $('#jExport').addEventListener('click',exportJournal);
  document.querySelector('#view-journal').addEventListener('click',async e=>{
    const c=e.target.closest('[data-close]');if(c){openCloseForm(c.dataset.close);return;}
    const rm=e.target.closest('[data-rm]');if(rm){if(rm.dataset.confirm!=='1'){rm.dataset.confirm='1';rm.textContent='تأكيد الحذف';setTimeout(()=>{if(rm.isConnected){rm.dataset.confirm='';rm.textContent='حذف';}},3500);return;}
      J.trades=J.trades.filter(t=>t.id!==rm.dataset.rm);await saveJournal();renderJournal();}});
  loadJournal();
}
