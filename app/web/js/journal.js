/* ================= trade journal & portfolio ================= */
const J={trades:[],all:[],pf:'all',pfs:[],editing:null,closing:null,loaded:false};  /* nothing is saved before the saved journal has been read */
const TAGS_GOOD=['التزام بالخطة','دخول من منطقة الشراء','احترام وقف الخسارة'];
const TAGS_BAD=['دخول متسرع','مطاردة السعر','تجاهل وقف الخسارة','خروج مبكر','حجم صفقة كبير','قرار عاطفي'];
const dateInput=t=>{const d=new Date(t||Date.now());return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const parseDateInput=s=>s?Date.parse(s+'T12:00:00'):Date.now();

/* ---------- several portfolios (2.18): J.all holds every trade, J.trades only those of the chosen portfolio ---------- */
const PF_MAIN='main';
const pfOf=t=>(t&&t.pf)||PF_MAIN;
function pfFilter(trades,pf){return pf==='all'?trades.slice():trades.filter(t=>pfOf(t)===pf);}
function pfList(saved){const l=(Array.isArray(saved)?saved:[]).filter(x=>x&&x.id&&x.name);if(!l.some(x=>x.id===PF_MAIN))l.unshift({id:PF_MAIN,name:'المحفظة الرئيسية'});return l;}
function pfName(id){const x=J.pfs.find(p=>p.id===id);return x?_t(x.name):'—';}
function jView(){J.trades=pfFilter(J.all,J.pf);}
function jAdd(t){if(!t.pf)t.pf=J.pf==='all'?PF_MAIN:J.pf;J.all.push(t);jView();}
function jRemove(id){J.all=J.all.filter(t=>t.id!==id);jView();}
async function loadJournal(){J.all=await Store.get('journal',[]);J.pfs=pfList(await Store.get('portfolios',[]));
  const cur=await Store.get('pfCur','all');J.pf=cur==='all'||J.pfs.some(p=>p.id===cur)?cur:'all';jView();J.loaded=true;renderPfBar();renderJournal();purFetchEst();
  if((location.hash||'')==='#journal')refreshJournalPrices();}  /* opened straight on this page: the refresh skipped while loading runs now */
async function saveJournal(){if(!J.loaded)return;await Store.set('journal',J.all);}
async function savePfs(){await Store.set('portfolios',J.pfs);await Store.set('pfCur',J.pf);}
function renderPfBar(){const sel=$('#pfSel');if(!sel)return;
  const cnt=id=>J.all.filter(t=>pfOf(t)===id).length;
  sel.innerHTML='<option value="all">'+esc(_t('كل المحافظ'))+' ('+NUM(J.all.length)+')</option>'+J.pfs.map(p=>'<option value="'+esc(p.id)+'">'+esc(_t(p.name))+' ('+NUM(cnt(p.id))+')</option>').join('');sel.value=J.pf;
  const f=$('#fPf');if(f){const v=f.value;f.innerHTML=J.pfs.map(p=>'<option value="'+esc(p.id)+'">'+esc(_t(p.name))+'</option>').join('');f.value=v&&J.pfs.some(p=>p.id===v)?v:(J.pf==='all'?PF_MAIN:J.pf);}
  const one=J.pf!=='all';for(const id of ['#pfRen','#pfDel'])if($(id))$(id).disabled=!one;if($('#pfDel'))$('#pfDel').disabled=!one||J.pf===PF_MAIN;}
async function pfSwitch(id){J.pf=id;jView();await savePfs();renderPfBar();renderJournal();if(typeof renderStats==='function')renderStats();}
async function pfAddNew(){const inp=$('#pfName'),name=inp.value.trim();if(!name){toast('اكتب اسم المحفظة.');inp.focus();return;}
  if(J.pfs.some(p=>p.name===name)){toast('يوجد محفظة بهذا الاسم.');return;}
  const id='p'+Date.now().toString(36);J.pfs.push({id,name});inp.value='';await pfSwitch(id);toast('أُنشئت المحفظة.');}
async function pfRename(){if(J.pf==='all')return;const inp=$('#pfName'),name=inp.value.trim();if(!name){toast('اكتب الاسم الجديد في الخانة.');inp.focus();return;}
  const p=J.pfs.find(x=>x.id===J.pf);if(p){p.name=name;inp.value='';await savePfs();renderPfBar();toast('غُيّر اسم المحفظة.');}}
async function pfDelete(){if(J.pf==='all'||J.pf===PF_MAIN)return;
  if(J.all.some(t=>pfOf(t)===J.pf)){toast('في هذه المحفظة صفقات. انقلها أولًا إلى محفظة أخرى من القائمة بجانب كل صفقة.');return;}
  if(!(await confirmBox(_t('حذف المحفظة')+' «'+pfName(J.pf)+'»؟')))return;
  J.pfs=J.pfs.filter(p=>p.id!==J.pf);await pfSwitch('all');}
function pfMoveHTML(t){if(J.pfs.length<2)return'';
  return '<select class="pf-mv" data-mv="'+esc(t.id)+'" aria-label="'+esc(_t('نقل إلى محفظة'))+'" title="'+esc(_t('نقل إلى محفظة'))+'">'+J.pfs.map(p=>'<option value="'+esc(p.id)+'"'+(p.id===pfOf(t)?' selected':'')+'>'+esc(_t(p.name))+'</option>').join('')+'</select>';}
async function pfMove(id,to){const t=J.all.find(x=>x.id===id);if(!t||!J.pfs.some(p=>p.id===to))return;t.pf=to;jView();await saveJournal();renderPfBar();renderJournal();toast(_t('نُقلت الصفقة إلى')+' «'+pfName(to)+'».');}
function setupPfBar(){const sel=$('#pfSel');if(!sel)return;sel.addEventListener('change',()=>pfSwitch(sel.value));
  $('#view-journal').addEventListener('change',e=>{const m=e.target.closest('select[data-mv]');if(m)pfMove(m.dataset.mv,m.value);});
  $('#pfAdd').addEventListener('click',pfAddNew);$('#pfRen').addEventListener('click',pfRename);$('#pfDel').addEventListener('click',pfDelete);
  $('#pfName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();pfAddNew();}});}
function tradeR(t,px){const risk=t.entry-(t.stop||0);return t.stop&&risk>0?(px-t.entry)/risk:null;}

function renderTagChips(sel){
  $('#fTags').innerHTML=TAGS_GOOD.concat(TAGS_BAD).map(tg=>'<label class="chip"><input type="checkbox" value="'+esc(tg)+'"'+(sel.includes(tg)?' checked':'')+'><span>'+(TAGS_GOOD.includes(tg)?'✓ ':'')+esc(tg)+'</span></label>').join('');
}
function openTradeForm(pre){
  location.hash='#journal';J.editing=null;J.closing=null;
  $('#jFormTitle').textContent='صفقة جديدة';$('#fCloseBox').hidden=true;
  if($('#fPf'))$('#fPf').value=J.pf==='all'?PF_MAIN:J.pf;
  $('#fCode').value=S.source!=='sample'?(S.code||''):'';$('#fName').value=S.source!=='sample'?(S.meta&&S.meta.short||S.name||''):'';$('#fEx').value=S.ex||'SR';
  $('#fQty').value=pre.qty||'';$('#fEntry').value=pre.entry!=null?+(+pre.entry).toFixed(4):'';$('#fStop').value=pre.stop!=null?+(+pre.stop).toFixed(4):'';$('#fTarget').value=pre.target!=null?+(+pre.target).toFixed(4):'';
  $('#fSetup').value=S.A&&S.A.buy&&S.A.buy.inside?_t('ارتداد من منطقة الشراء'):'';$('#fDate').value=dateInput();$('#fReason').value=S.A&&S.A.stance==='buy'?'إشارة الأداة: '+$('#stanceText').textContent:'';
  renderTagChips([]);$('#jForm').hidden=false;$('#fCode').focus();
}
function openCloseForm(id){
  const t=J.trades.find(x=>x.id===id);if(!t)return;J.closing=id;J.editing=null;
  $('#jFormTitle').textContent='إغلاق صفقة '+(t.name||t.code);
  $('#fCode').value=t.code;$('#fName').value=t.name||'';$('#fEx').value=t.ex;$('#fQty').value=t.qty;$('#fEntry').value=t.entry;$('#fStop').value=t.stop||'';$('#fTarget').value=t.target||'';
  $('#fDate').value=dateInput(t.date);$('#fReason').value=t.reason||'';$('#fSetup').value=t.setup||'';if($('#fPf'))$('#fPf').value=pfOf(t);
  $('#fExit').value=t.last?+t.last.toFixed(4):'';$('#fExitDate').value=dateInput();$('#fExitReason').value='';
  $('#fCloseBox').hidden=false;renderTagChips(t.tags||[]);$('#jForm').hidden=false;$('#fExit').focus();
}
async function saveTradeForm(){
  const tags=$$('#fTags input:checked').map(i=>i.value);
  const base={code:$('#fCode').value.trim().toUpperCase(),name:$('#fName').value.trim(),ex:$('#fEx').value,qty:+$('#fQty').value,entry:+$('#fEntry').value,
    stop:+$('#fStop').value||null,target:+$('#fTarget').value||null,date:parseDateInput($('#fDate').value),reason:$('#fReason').value.trim(),setup:$('#fSetup').value.trim(),tags,pf:($('#fPf')&&$('#fPf').value)||(J.pf==='all'?PF_MAIN:J.pf)};
  if(!base.code||!(base.qty>0)||!(base.entry>0)){toast('أدخل الرمز والكمية وسعر الدخول.');return;}
  if(J.closing){const t=J.trades.find(x=>x.id===J.closing);const exit=+$('#fExit').value;if(!(exit>0)){toast('أدخل سعر الخروج.');return;}
    Object.assign(t,base,{exit,exitDate:parseDateInput($('#fExitDate').value),exitReason:$('#fExitReason').value.trim()});}
  else jAdd(Object.assign({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),exit:null},base));
  jView();await saveJournal();renderPfBar();$('#jForm').hidden=true;J.closing=null;renderJournal();toast('حُفظت الصفقة.');refreshJournalPrices();
}
async function refreshJournalPrices(){
  if(!J.loaded)return;  /* opened straight on this page: the journal is still loading, and an empty list must never be saved over it */
  const open=J.all.filter(t=>!t.exit);const seen={};
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
      '<td><span class="actions"><button class="btn xs" type="button" data-close="'+t.id+'">إغلاق</button><button class="btn xs ghost danger" type="button" data-rm="'+t.id+'">حذف</button>'+pfMoveHTML(t)+'</span></td></tr>';}).join('')
    :'<tr><td colspan="9" class="empty">لا توجد صفقات مفتوحة. سجّل صفقتك من حاسبة حجم الصفقة أو بزر «صفقة جديدة».</td></tr>';
  $('#jClosed').innerHTML=closed.length?closed.map(t=>{const r=t.exit/t.entry-1,R=tradeR(t,t.exit),days=Math.max(0,Math.round((t.exitDate-t.date)/DAY));
    return '<tr><td><b>'+esc(t.name||t.code)+'</b></td><td>'+NUM(fp(t.entry))+'</td><td>'+NUM(fp(t.exit))+'</td><td>'+chgSpan(r,1)+' '+NUM(fmtMoney.format((t.exit-t.entry)*t.qty))+'</td>'+
      '<td>'+(R!=null?NUM(R.toFixed(2)+'R'):'—')+'</td><td>'+days+' يوم</td><td class="small">'+esc((t.tags||[]).join('، '))+'</td><td><span class="actions"><button class="btn xs ghost danger" type="button" data-rm="'+t.id+'">حذف</button>'+pfMoveHTML(t)+'</span></td></tr>';}).join('')
    :'<tr><td colspan="8" class="empty">لا توجد صفقات مغلقة بعد.</td></tr>';
  /* stats */
  const wins=closed.filter(t=>t.exit>t.entry),losses=closed.filter(t=>t.exit<=t.entry);
  const gp=wins.reduce((s,t)=>s+(t.exit-t.entry)*t.qty,0),gl=-losses.reduce((s,t)=>s+(t.exit-t.entry)*t.qty,0);
  const Rs=closed.map(t=>tradeR(t,t.exit)).filter(x=>x!=null);
  const k=(label,val,sub)=>'<div class="metric"><span class="k">'+label+'</span><span class="v">'+val+'</span>'+(sub?'<span class="s">'+sub+'</span>':'')+'</div>';
  $('#jKpis').innerHTML=k('الصفقات المفتوحة',NUM(open.length),'')+k('قيمة المحفظة الحالية',NUM(fmtMoney.format(mv)),cost?'التكلفة '+NUM(fmtMoney.format(cost)):'')+
    k('ربح غير محقق',cost?'<span style="color:'+(mv>=cost?'var(--up)':'var(--down)')+'">'+NUM(fmtMoney.format(mv-cost))+'</span>':'—',cost?chgSpan(mv/cost-1,1):'')+
    k('صافي الربح المحقق',closed.length?Object.entries(realisedByCur(closed)).map(([c,v])=>'<span style="color:'+(v>=0?'var(--up)':'var(--down)')+'">'+NUM(fmtMoney.format(v))+' '+esc(purCurLabel(c))+'</span>').join('<br>'):'—',closed.length+' صفقة مغلقة')+
    k('نسبة النجاح',closed.length?NUM(Math.round(wins.length/closed.length*100)+'%'):'—',closed.length?wins.length+' رابحة · '+losses.length+' خاسرة':'')+
    k('متوسط المضاعف',Rs.length?NUM((Rs.reduce((a,b)=>a+b,0)/Rs.length).toFixed(2)+'R'):'—',gl>0?'معامل الربح '+NUM((gp/gl).toFixed(2)):'');
  /* recurring patterns */
  const cnt={},lossCnt={};for(const t of closed)for(const tg0 of t.tags||[]){const tg=_t(tg0);cnt[tg]=(cnt[tg]||0)+1;if(t.exit<=t.entry)lossCnt[tg]=(lossCnt[tg]||0)+1;}  /* tags saved in either language count together */
  const items=[];
  const bad=TAGS_BAD.filter(t=>cnt[t]).sort((a,b)=>(lossCnt[b]||0)-(lossCnt[a]||0));
  for(const tg of bad)items.push('<li><span class="kind r">'+esc(tg)+'</span><span>تكرر في '+cnt[tg]+' صفقة، منها '+(lossCnt[tg]||0)+' خاسرة</span><span></span></li>');
  const adh=closed.filter(t=>(t.tags||[]).some(x=>_t(x)===_t('التزام بالخطة')));
  if(closed.length){const aw=adh.filter(t=>t.exit>t.entry).length;items.push('<li><span class="kind s">الالتزام بالخطة</span><span>في '+adh.length+' من '+closed.length+' صفقة'+(adh.length?'، ونجح منها '+Math.round(aw/adh.length*100)+'%':'')+'</span><span></span></li>');}
  if(wins.length&&losses.length){const aw=wins.reduce((s,t)=>s+(t.exit/t.entry-1),0)/wins.length,al=losses.reduce((s,t)=>s+(t.exit/t.entry-1),0)/losses.length;
    items.push('<li><span class="kind n">الربح مقابل الخسارة</span><span>متوسط الصفقة الرابحة '+NUM(pct(aw))+' والخاسرة '+NUM(pct(al))+(Math.abs(al)>aw?'. خسائرك أكبر من أرباحك، فالتزم بوقف الخسارة.':'.')+'</span><span></span></li>');}
  renderPurify();renderZakat();if(typeof renderStats==='function')renderStats();
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
      const j=await api('/api/history',{code:t.code,ex:t.ex,range:'5y'}).catch(()=>null);PUR.divs[k]=j&&j.ok?(j.dividends||[]):null;}}
  finally{PUR.busy=false;if(b){b.disabled=false;b.textContent=_t('احسب مع التوزيعات');}renderPurify();renderZakat();}}
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
/* ---------- zakat on open holdings, total return, and dividends you record yourself ---------- */
const ZK={divLog:[]};
const ZMETHOD={trade:'مضارب',invest:'مستثمر'};
async function loadDivLog(){ZK.divLog=await Store.get('divLog',[]);}
function manualDivs(id){const l=ZK.divLog.filter(d=>d.tradeId===id);return l.length?l.reduce((s,d)=>s+d.amount,0):null;}
function renderZakat(){if(!$('#zakRows'))return;
  const opt={method:P.zakat.method,cal:P.zakat.cal,saPays:P.zakat.saPays!==false,assets:zakatAssetsMap(P.zakat.assets),over:P.zakat.over||{}};
  const money=(v,cur)=>NUM(fmtMoney.format(v))+' '+esc(purCurLabel(cur));
  const open=J.trades.filter(t=>!t.exit),rows=open.map(t=>({t,z:zakatFor(t,opt)})).filter(x=>x.z.status!=='skip');
  const ST={noprice:'اضغط «تحديث الأسعار»',company:'تدفعها الشركة',needassets:'أدخل الوعاء الزكوي للسهم'};
  $('#zakRows').innerHTML=rows.length?rows.map(({t,z})=>{
      const sel=t.ex==='GOLD'?'<span class="small">'+esc(_t('بالقيمة'))+'</span>':'<select class="zk-m" data-zid="'+esc(t.id)+'" aria-label="'+esc(_t('الطريقة'))+'">'+Object.keys(ZMETHOD).map(k=>'<option value="'+k+'"'+(z.method===k?' selected':'')+'>'+esc(_t(ZMETHOD[k]))+'</option>').join('')+'</select>';
      const base=z.base!=null&&z.status==='ok'?money(z.base,z.cur):'<span class="muted small">'+esc(_t(ST[z.status]||'—'))+'</span>';
      const zk=z.status==='ok'?'<b>'+money(z.zakat,z.cur)+'</b>':z.status==='company'?NUM('0')+' <span class="small muted">('+esc(_t('تدفعها الشركة'))+')</span>':'—';
      return '<tr><td><b>'+esc(t.name||t.code)+'</b><br><span class="small muted num">'+esc(t.code)+'</span></td><td>'+NUM(fmtMoney.format(t.qty))+'</td><td>'+(t.last>0?NUM(fp(t.last)):'—')+'</td><td>'+sel+'</td><td>'+base+'</td><td>'+zk+'</td></tr>';}).join('')
    :'<tr><td colspan="6" class="empty">'+esc(_t('لا توجد صفقات مفتوحة.'))+'</td></tr>';
  const by={};for(const {z} of rows)if(z.status==='ok'){(by[z.cur]=by[z.cur]||{base:0,zakat:0}).base+=z.base;by[z.cur].zakat+=z.zakat;}
  const k=(label,val,sub)=>'<div class="metric"><span class="k">'+label+'</span><span class="v">'+val+'</span>'+(sub?'<span class="s">'+sub+'</span>':'')+'</div>';
  $('#zakTotals').innerHTML=Object.keys(by).map(c=>k(esc(_t('الزكاة'))+' ('+esc(purCurLabel(c))+')',money(by[c].zakat,c),esc(_t('على وعاء'))+' '+money(by[c].base,c))).join('');
  const miss=rows.filter(x=>x.z.status==='noprice'||x.z.status==='needassets').length,zn=$('#zakNote');
  zn.hidden=!miss;zn.innerHTML=miss?esc(_t('صفقات لم تدخل في المجموع لنقص السعر أو الوعاء الزكوي:'))+' '+NUM(miss)+'.':'';
  /* total return, open and closed */
  const all=J.trades.filter(t=>['SR','CA','US','GOLD'].includes(t.ex));
  $('#retRows').innerHTML=all.length?all.map(t=>{const cur=t.ex==='GOLD'?(String(t.code).split('-')[1]||'USD'):PUR_CUR[t.ex],k2=purTradeKey(t);
      const r=totalReturn(t,k2 in PUR.divs?PUR.divs[k2]:null,manualDivs(t.id));
      const noDiv=t.ex==='GOLD';
      const dv=noDiv?'<span class="muted small">'+esc(_t('لا يلزم'))+'</span>':r.divs==null?'<span class="muted small">'+esc(_t(k2 in PUR.divs?'تعذّرت القراءة':'اضغط «احسب مع التوزيعات»'))+'</span>':money(r.divs,cur)+(r.src==='manual'?' <span class="small muted">('+esc(_t('يدوي'))+')</span>':'');
      const tot=r.total==null?'—':'<b style="color:'+(r.total>=0?'var(--up)':'var(--down)')+'">'+money(r.total,cur)+'</b> '+(r.pct!=null?chgSpan(r.pct,1):'')+(r.divs==null&&!noDiv?'<br><span class="small muted">'+esc(_t('بدون التوزيعات'))+'</span>':'');
      return '<tr><td><b>'+esc(t.name||t.code)+'</b>'+(t.exit?' <span class="tag">'+esc(_t('مغلقة'))+'</span>':'')+'</td><td>'+money(r.cost,cur)+'</td><td>'+(r.value!=null?money(r.value,cur):'—')+'</td><td>'+(r.gain!=null?money(r.gain,cur):'—')+'</td><td>'+dv+'</td><td>'+tot+'</td></tr>';}).join('')
    :'<tr><td colspan="6" class="empty">'+esc(_t('لا توجد أسهم في سجل صفقاتك بعد.'))+'</td></tr>';
  /* dividends you recorded */
  const sel=$('#dvTrade'),cur=sel.value;sel.innerHTML=J.trades.filter(t=>t.ex!=='GOLD').map(t=>'<option value="'+esc(t.id)+'">'+esc((t.name||t.code)+' · '+fmtDate.format(t.date))+'</option>').join('');if(cur)sel.value=cur;
  const name=id=>{const t=J.all.find(x=>x.id===id);return t?(t.name||t.code):'—';};
  $('#dvList').innerHTML=ZK.divLog.length?ZK.divLog.slice().sort((a,b)=>b.date-a.date).map(d=>{const t=J.all.find(x=>x.id===d.tradeId);
      return '<li><span class="kind s">'+money(d.amount,t?PUR_CUR[t.ex]:'')+'</span><span>'+esc(name(d.tradeId))+' · '+fmtDate.format(d.date)+'</span><span><button class="btn xs ghost danger" type="button" data-dvrm="'+d.id+'">'+esc(_t('حذف'))+'</button></span></li>';}).join('')
    :'<li class="plain"><p class="empty">'+esc(_t('لم تسجّل توزيعات بنفسك.'))+'</p></li>';}
function setupZakat(){
  $('#dvDate').value=dateInput();
  ['#zMethod','#zCal','#zSaPays','#zAssets'].forEach(s=>$(s).addEventListener('change',()=>setTimeout(renderZakat,0)));
  $('#zakRows').addEventListener('change',e=>{const s=e.target.closest('.zk-m');if(!s)return;P.zakat.over=Object.assign({},P.zakat.over,{[s.dataset.zid]:s.value});savePrefs();renderZakat();});
  $('#dvAdd').addEventListener('click',async()=>{const amount=+$('#dvAmt').value,tradeId=$('#dvTrade').value;
    if(!tradeId){toast(_t('سجّل صفقة أولًا.'));return;}if(!(amount>0)){toast(_t('أدخل مبلغًا أكبر من صفر.'));return;}
    ZK.divLog.push({id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),tradeId,amount,date:parseDateInput($('#dvDate').value)});
    await Store.set('divLog',ZK.divLog);$('#dvAmt').value='';renderZakat();toast(_t('سُجّل التوزيع.'));});
  $('#dvList').addEventListener('click',async e=>{const b=e.target.closest('[data-dvrm]');if(!b)return;
    if(b.dataset.confirm!=='1'){b.dataset.confirm='1';b.textContent=_t('تأكيد الحذف');setTimeout(()=>{if(b.isConnected){b.dataset.confirm='';b.textContent=_t('حذف');}},3500);return;}
    ZK.divLog=ZK.divLog.filter(d=>d.id!==b.dataset.dvrm);await Store.set('divLog',ZK.divLog);renderZakat();});
  loadDivLog().then(renderZakat);}
function setupJournal(){
  setupPurify();setupZakat();setupJTools();setupPfBar();
  $('#jNew').addEventListener('click',()=>openTradeForm({}));
  $('#fSave').addEventListener('click',saveTradeForm);
  $('#fCancel').addEventListener('click',()=>{$('#jForm').hidden=true;J.closing=null;});
  $('#jRefresh').addEventListener('click',refreshJournalPrices);
  $('#jExport').addEventListener('click',exportJournal);
  document.querySelector('#view-journal').addEventListener('click',async e=>{
    const c=e.target.closest('[data-close]');if(c){openCloseForm(c.dataset.close);return;}
    const rm=e.target.closest('[data-rm]');if(rm){if(rm.dataset.confirm!=='1'){rm.dataset.confirm='1';rm.textContent='تأكيد الحذف';setTimeout(()=>{if(rm.isConnected){rm.dataset.confirm='';rm.textContent='حذف';}},3500);return;}
      jRemove(rm.dataset.rm);await saveJournal();renderPfBar();renderJournal();}});
  loadJournal();
}
