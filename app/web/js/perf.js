/* ================= portfolio performance against the market, dividends, and scenarios (2.18) ================= */
const dayKey=t=>new Date(t).toISOString().slice(0,10);
/* closes by day, carried forward over the days a stock did not trade */
function closesOn(rows,days){const m=new Map(rows.map(r=>[dayKey(r[0]),r[4]]));let last=null;return days.map(d=>{if(m.has(d))last=m.get(d);return last;});}

/* time-weighted return of the trades of one currency: buys and sells are money in and out, dividends are income.
   trades: [{key, entry, qty, date, exit, exitDate}]; px: {key: [close per day]}; divs: {key: [[t, amount]]} */
function equityTWR(trades,days,px,divs){
  const idx=new Map(days.map((d,i)=>[d,i])),at=t=>{const d=dayKey(t);if(idx.has(d))return idx.get(d);for(let i=0;i<days.length;i++)if(days[i]>=d)return i;return -1;};
  const ev=days.map(()=>({flow:0,div:0}));const held=days.map(()=>new Map());
  for(const t of trades){const i0=at(t.date),i1=t.exit?at(t.exitDate):days.length;if(i0<0)continue;
    ev[i0].flow+=t.entry*t.qty;if(t.exit&&i1>=0&&i1<days.length)ev[i1].flow-=t.exit*t.qty;
    for(let i=i0;i<(i1<0?days.length:i1);i++)held[i].set(t.key,(held[i].get(t.key)||0)+t.qty);
    for(const [dt,amt] of divs[t.key]||[]){const i=at(dt);if(i>i0&&(i<i1||i1<0)&&i<days.length&&amt>0)ev[i].div+=amt*t.qty;}}
  const val=days.map((d,i)=>{let v=0;for(const [k,q] of held[i]){const c=(px[k]||[])[i];if(c==null)return null;v+=c*q;}return v;});
  const twr=[],divTot=[];let g=1,dsum=0,prev=null;
  for(let i=0;i<days.length;i++){const V=val[i];if(V==null){twr.push(twr.length?twr[twr.length-1]:null);divTot.push(dsum);continue;}
    dsum+=ev[i].div;
    if(prev!=null&&prev>0)g*=(V+ev[i].div+(ev[i].flow<0?-ev[i].flow:0)-(ev[i].flow>0?ev[i].flow:0))/prev;
    else if(ev[i].flow>0)g*=(V+ev[i].div)/ev[i].flow;
    twr.push(prev==null&&!(ev[i].flow>0)?null:g-1);divTot.push(dsum);prev=V;}
  return{days,val,twr,div:dsum,divTot};
}
/* sensitivity of a stock to its market from a year of daily returns */
function betaOf(a,b){const ra=[],rb=[];for(let i=1;i<a.length;i++)if(a[i]&&a[i-1]&&b[i]&&b[i-1]){ra.push(a[i]/a[i-1]-1);rb.push(b[i]/b[i-1]-1);}
  if(ra.length<60)return null;const ma=ra.reduce((x,y)=>x+y,0)/ra.length,mb=rb.reduce((x,y)=>x+y,0)/rb.length;let cv=0,vb=0;
  for(let i=0;i<ra.length;i++){cv+=(ra[i]-ma)*(rb[i]-mb);vb+=(rb[i]-mb)**2;}return vb?cv/vb:null;}
/* what a market move would do to each open position: value × beta × move (gold moves one for one with gold) */
function scenarioOf(positions,shocks){
  const rows=positions.map(p=>{const s=p.ex==='GOLD'?shocks.GOLD:shocks[p.ex];const b=p.ex==='GOLD'?1:p.beta;
    const eff=s==null||b==null?null:b*s/100;return Object.assign({},p,{move:eff,pl:eff==null?null:p.value*eff});});
  const tot={};for(const r of rows)if(r.pl!=null){const t=tot[r.cur]=tot[r.cur]||{value:0,pl:0};t.value+=r.value;t.pl+=r.pl;}
  return{rows,tot};
}

const PF={busy:false};
async function runPerformance(){
  const out=$('#pfOut'),cur=$('#pfCur').value;if(PF.busy)return;PF.busy=true;$('#pfGo').disabled=true;out.hidden=false;
  try{
    if(!J.loaded)await loadJournal();
    const tr=J.trades.filter(t=>curOf(t)===cur&&t.qty>0&&t.entry>0&&t.date);
    if(!tr.length){out.innerHTML='<p class="err">'+esc(_t('لا توجد صفقات بهذه العملة.'))+'</p>';return;}
    out.innerHTML='<p class="muted">'+esc(_t('جارٍ جلب الأسعار والتوزيعات…'))+'</p>';
    const keys=[...new Set(tr.map(t=>t.ex+':'+t.code))],H={};
    await Promise.all(keys.map(async k=>{const [ex,code]=[k.slice(0,k.indexOf(':')),k.slice(k.indexOf(':')+1)];
      const j=await api('/api/history',{code,ex,range:'5y'}).catch(()=>null);H[k]=j&&j.ok?j:null;}));
    const bad=keys.filter(k=>!H[k]);
    const ex0=tr[0].ex,idxj=ex0==='GOLD'?null:await api('/api/index',{ex:ex0,range:'5y'}).catch(()=>null);
    const start=dayKey(Math.min(...tr.map(t=>t.date))),allDays=new Set();
    for(const k of keys)if(H[k])for(const r of H[k].rows){const d=dayKey(r[0]);if(d>=start)allDays.add(d);}
    const days=[...allDays].sort();if(days.length<5){out.innerHTML='<p class="err">'+esc(_t('لا توجد أسعار كافية منذ أول صفقة.'))+'</p>';return;}
    const px={},dv={};for(const k of keys)if(H[k]){px[k]=closesOn(H[k].rows,days);dv[k]=H[k].dividends||[];}
    const eq=equityTWR(tr.filter(t=>H[t.ex+':'+t.code]).map(t=>Object.assign({key:t.ex+':'+t.code},t)),days,px,dv);
    const ix=idxj&&idxj.ok?closesOn(idxj.rows,days):null,i0=eq.twr.findIndex(v=>v!=null);
    const ixRet=ix&&ix[i0]?ix.map(v=>v?v/ix[i0]-1:null):null,last=eq.twr[eq.twr.length-1],ixLast=ixRet?ixRet[ixRet.length-1]:null;
    PF.last={days,eq,ixRet};drawPerfPortfolio($('#pfCv'),days,eq.twr,ixRet);
    /* scenarios: open positions with their beta */
    const idxRows=idxj&&idxj.ok?idxj.rows:null,open=[];
    for(const t of tr)if(!t.exit){const k=t.ex+':'+t.code,h=H[k];if(!h)continue;const lastC=h.rows[h.rows.length-1][4];
      let b=null;if(t.ex!=='GOLD'&&idxRows){const dd=h.rows.slice(-260).map(r=>dayKey(r[0]));b=betaOf(closesOn(h.rows,dd),closesOn(idxRows,dd));}
      open.push({name:t.name||t.code,code:t.code,ex:t.ex,cur,value:lastC*t.qty,beta:b});}
    PF.open=open;
    out.innerHTML='<div class="metrics"><div class="metric"><span class="k">'+esc(_t('عائد محفظتك (مرجّح بالزمن)'))+'</span><span class="v">'+NUM(last==null?'—':(last>=0?'+':'')+(last*100).toFixed(1)+'%')+'</span><span class="s">'+esc(_t('منذ'))+' '+NUM(fmtDate.format(Date.parse(days[Math.max(0,i0)])))+'</span></div>'
      +'<div class="metric"><span class="k">'+esc(_t(idxj&&idxj.label?idxj.label:'المؤشر'))+'</span><span class="v">'+NUM(ixLast==null?'—':(ixLast>=0?'+':'')+(ixLast*100).toFixed(1)+'%')+'</span><span class="s">'+esc(_t('نفس الفترة'))+'</span></div>'
      +'<div class="metric"><span class="k">'+esc(_t('التوزيعات المستلمة'))+'</span><span class="v">'+NUM(fmtMoney.format(eq.div))+'</span><span class="s">'+esc(purCurLabel(cur))+' · '+esc(_t('من سجل كل سهم'))+'</span></div>'
      +(last!=null&&ixLast!=null?'<div class="metric"><span class="k">'+esc(_t('الفرق عن المؤشر'))+'</span><span class="v" style="color:'+(last>=ixLast?'var(--up)':'var(--down)')+'">'+NUM(((last-ixLast)*100>=0?'+':'')+((last-ixLast)*100).toFixed(1))+' '+esc(_t('نقطة'))+'</span></div>':'')+'</div>'
      +(bad.length?'<p class="small err">'+esc(_t('لم تصل أسعار'))+': '+esc(bad.map(k=>k.split(':')[1]).join('، '))+'</p>':'')
      +(cur==='USD'&&tr.some(t=>t.ex==='GOLD')&&tr.some(t=>t.ex!=='GOLD')?'<p class="small muted">'+esc(_t('المقارنة مع مؤشر السوق الأمريكية، والذهب داخل في أداء المحفظة.'))+'</p>':'')
      +'<p class="small muted">'+esc(_t('العائد المرجّح بالزمن لا يتأثر بتوقيت إضافة المال أو سحبه، فيقارن قراراتك بالمؤشر بعدل. التوزيعات تُحسب في تاريخ استحقاقها على الكمية التي كانت معك، قبل الزكاة والضرائب.'))+'</p>';
    renderScenario();
  }finally{PF.busy=false;$('#pfGo').disabled=false;}
}
function drawPerfPortfolio(cv,days,a,b){
  const ser=[{pts:[],c:'#2563eb'},{pts:[],c:'#9aa4ae'}];
  days.forEach((d,i)=>{const t=Date.parse(d);if(a[i]!=null)ser[0].pts.push([t,100*(1+a[i])]);if(b&&b[i]!=null&&a[i]!=null)ser[1].pts.push([t,100*(1+b[i])]);});
  drawPerf(cv,ser.filter(s=>s.pts.length).map((s,i)=>Object.assign(s,{i})));
  $('#pfLegend').innerHTML='<span class="perf-key"><i style="background:'+PERF_COLORS[0]+'"></i>'+esc(_t('محفظتك'))+'</span>'+(b?'<span class="perf-key"><i style="background:'+PERF_COLORS[1]+'"></i>'+esc(_t('المؤشر'))+'</span>':'');
}
function renderScenario(){const box=$('#pfScen');if(!box||!PF.open)return;
  const sh={SR:+$('#scSR').value,CA:+$('#scCA').value,US:+$('#scUS').value,GOLD:+$('#scGOLD').value};
  const r=scenarioOf(PF.open,sh);
  box.innerHTML=r.rows.length?'<div class="tbl-wrap"><table><thead><tr><th>'+esc(_t('السهم'))+'</th><th>'+esc(_t('القيمة الآن'))+'</th><th title="'+esc(_t('حساسية السهم لسوقه في آخر سنة: 1 يعني يتحرك مثل السوق'))+'">'+esc(_t('بيتا'))+'</th><th>'+esc(_t('التغير المقدّر'))+'</th><th>'+esc(_t('الربح أو الخسارة المقدّرة'))+'</th></tr></thead><tbody>'
    +r.rows.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+NUM(fmtMoney.format(x.value))+'</td><td>'+(x.ex==='GOLD'?'—':x.beta==null?esc(_t('غير متوفر')):NUM(x.beta.toFixed(2)))+'</td><td>'+(x.move==null?'—':chgSpan(x.move))+'</td><td>'+(x.pl==null?'—':NUM(fmtMoney.format(x.pl)))+'</td></tr>').join('')
    +'</tbody></table></div>'+Object.entries(r.tot).map(([c,t])=>'<p><b>'+esc(_t('المحفظة'))+' ('+esc(purCurLabel(c))+'):</b> '+NUM(fmtMoney.format(t.pl))+' ('+chgSpan(t.value?t.pl/t.value:0)+')</p>').join('')
    +'<p class="small muted">'+esc(_t('تقدير تقريبي: يفترض أن كل سهم يتحرك مع سوقه كما تحرك في السنة الماضية. الواقع قد يختلف كثيرًا، خاصة في الأزمات.'))+'</p>'
    :'<p class="small muted">'+esc(_t('لا توجد مراكز مفتوحة بهذه العملة.'))+'</p>';}
function setupPerformance(){const b=$('#pfGo');if(!b)return;b.addEventListener('click',runPerformance);
  for(const id of ['scSR','scCA','scUS','scGOLD'])$('#'+id).addEventListener('input',renderScenario);}
