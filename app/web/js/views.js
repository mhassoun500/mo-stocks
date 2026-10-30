/* ================= analysis view: state, loading, rendering ================= */
const S={ex:'SR',code:'',name:'',source:'sample',fileName:'',meta:null,daily:null,hourly:null,data:[],ind:null,A:null,bt:null,
  tf:'D',range:{D:250,W:104,H:150},show:{zones:true,ma:true,bb:false,trend:true,pat:true,sig:true,vol:true,vp:false,gaps:true,events:true,cmp:false,fib:false},
  pane:'rsi',sens:5,zoneCount:6,profile:null,cmp:null,cmpRaw:null,cmpLabel:'',drawings:[],confText:'',calcAuto:true,loadSeq:0};
const RANGE_PRESETS={D:[['٣ أشهر',63],['٦ أشهر',126],['سنة',250],['الكل',0]],W:[['٦ أشهر',26],['سنة',52],['سنتان',104],['الكل',0]],H:[['أسبوع',35],['أسبوعان',70],['شهر',150],['الكل',0]]};

function setStatus(msg,err){const s=$('#status');s.textContent=msg||'';s.className='status'+(err?' err':'');}
const isGold=()=>$('#ex').value==='GOLD';
const currentCode=()=>isGold()?$('#gold').value:$('#ex').value==='FUND'?$('#fund').value:$('#sym').value.trim();
const goldLabel=()=>{const o=$('#gold').selectedOptions[0];return o?o.textContent.trim():'الذهب';};

/* ---------- timeframe & analysis ---------- */
function renderRangeSeg(){
  const cur=S.range[S.tf];
  $('#rangeSeg').innerHTML=RANGE_PRESETS[S.tf].map(([l,v])=>'<button type="button" data-range="'+v+'" aria-pressed="'+(v===cur)+'">'+l+'</button>').join('');
}
function applyTF(){
  if(S.tf==='H'&&!S.hourly)S.tf='D';
  $$('#tfSeg button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tf===S.tf)));
  S.data=S.tf==='W'?aggregateWeekly(S.daily):S.tf==='H'?S.hourly:S.daily;
  S.ind=computeInd(S.data);
  alignCompare();
  renderRangeSeg();
  analyzeNow(true);
}
function analyzeNow(reset){
  const D=S.data;if(!D||D.length<30){S.A=null;return;}
  let htf=null;
  if(S.tf==='D'&&S.daily.length>=60){const w=aggregateWeekly(S.daily);if(w.length>=30){const Aw=analyzeCore(w,computeInd(w),{span:Math.min(w.length,104),sens:3,zoneCount:6,lite:true});htf=Aw&&Aw.zones;}}
  else if(S.tf==='H'&&S.daily&&S.daily.length>=30){const Ad=analyzeCore(S.daily,computeInd(S.daily),{span:Math.min(S.daily.length,250),sens:S.sens,zoneCount:6,lite:true});htf=Ad&&Ad.zones;}
  const r=S.range[S.tf];
  S.A=analyzeCore(D,S.ind,{span:r>0?Math.min(r,D.length):D.length,sens:S.sens,zoneCount:S.zoneCount,stopMult:P.ana.stopMult,htf,noGaps:S.isFund});
  S.bt=null;
  if(reset)resetView();
  render();
  clearTimeout(S.btTimer);
  S.btTimer=setTimeout(()=>{if(!S.A)return;S.bt=runBacktest(S.data,S.ind,{span:S.A.span,sens:S.sens,zoneCount:S.zoneCount,stopMult:P.ana.stopMult});renderBacktest();renderConfidence();},40);
}

/* ---------- render ---------- */
function render(){
  const A=S.A,D=S.data;if(!A)return;const N=D.length,last=D[N-1],prev=D[N-2];
  const chg=last.c/prev.c-1;
  $('#chartName').textContent=S.name||'—';
  const b=$('#srcBadge');
  if(S.source==='sample'){b.textContent='بيانات تجريبية للعرض';b.className='badge sample';}
  else if(S.source==='live'&&S.meta){const m=S.meta;b.innerHTML='<bdi>'+esc(m.source)+'</bdi> · <bdi>'+esc(m.symbol)+'</bdi> · '+N+' شمعة'+(m.currency?' · <bdi>'+esc(m.currency)+'</bdi>':'');b.className='badge';}
  else{b.textContent=(S.fileName?S.fileName+' · ':'')+N+' شمعة';b.className='badge';}
  $('#offlineBadge').hidden=!(S.meta&&S.meta.offline);
  const shL=S.ex!=='GOLD'&&S.source!=='sample'?shariaStatus(S.code):null,shY=!shL&&S.ex==='US'&&S.source!=='sample'?yaaqenStatus(S.code):null,
    shA=!shL&&!shY&&S.ex==='US'&&S.usSharia&&S.usSharia.status?S.usSharia:null,sh=shL||shY||(shA&&shA.status),sb=$('#shariaBadge');
  sb.hidden=!sh;if(sh&&shY){sb.textContent=YQ_LABEL[shY];sb.className='badge '+(shY==='doubt'?'off':shY);sb.title='حسب تصنيف موقع يقين للأسهم الأمريكية · '+YQ.date;}
  else if(sh){sb.textContent=shA?(sh==='ok'?'متوافق شرعيًا مبدئيًا':'غير متوافق شرعيًا مبدئيًا'):(sh==='ok'?'متوافق شرعيًا':'غير متوافق شرعيًا');sb.className='badge '+sh;
    sb.title=shA?_t(shA.why)+' — فحص مبدئي لا يشمل نسبة الإيراد غير المباح.':(P.sharia.asOf?'حسب قائمة '+P.sharia.asOf:'');}
  const seg=S.source!=='sample'&&(S.ex==='SR'||/\.SR$/i.test(S.code))?saSegment(S.code):'',gb=$('#segBadge');
  gb.hidden=!seg;if(seg){gb.textContent=SEG_LABEL[seg];gb.className='badge seg-'+seg;gb.title=SEG_TIP[seg];}

  const st=$('#stance');st.className='stance'+(A.stance==='neutral'?'':' '+A.stance);
  const T={buy:['منطقة شراء محتملة','السعر قرب دعم قوي، والمؤشرات تميل لصالح الدخول التدريجي.'],
    sell:['منطقة بيع أو جني أرباح','السعر قرب مقاومة أو في تشبّع شرائي، والأفضل تخفيف المراكز أو الانتظار.'],
    neutral:['انتظار حتى تتضح الإشارة','السعر بين الدعم والمقاومة. راقب منطقة الشراء قبل الدخول.']};
  $('#stanceText').textContent=T[A.stance][0];$('#stanceSub').textContent=T[A.stance][1];
  $('#reasons').innerHTML=A.reasons.map(r=>'<li class="'+r[0]+'"><span class="dot"></span><span>'+r[1]+'</span></li>').join('');
  renderConfidence();

  const tfTxt=S.tf==='H'?fmtDateTime.format(last.t):fmtDate.format(last.t);
  $('#mPrice').innerHTML=fp(last.c);
  $('#mPriceSub').innerHTML=chgSpan(chg)+' · '+tfTxt;
  if(A.buy){$('#mBuy').innerHTML=RANGE(A.buy.lo,A.buy.hi);
    $('#mBuySub').innerHTML=(A.buy.inside?'السعر داخل المنطقة الآن':'الدخول المرجعي '+NUM(fp(A.entry)))+(A.buy.touches?' · '+A.buy.touches+' لمسات':'')+(A.buy.htf?' · أسبوعي':'');}
  else{$('#mBuy').textContent='—';$('#mBuySub').textContent='لا يوجد دعم واضح أسفل السعر';}
  if(A.sell){$('#mSell').innerHTML=RANGE(A.sell.lo,A.sell.hi);$('#mSellSub').innerHTML='الهدف الأول '+NUM(fp(A.t1))+' · الثاني '+NUM(fp(A.t2));}
  else{$('#mSell').innerHTML=NUM(fp(A.t1));$('#mSellSub').innerHTML='هدف تقديري، لا توجد مقاومة أعلى السعر';}
  $('#mStop').innerHTML=fp(A.stop);$('#mStopSub').innerHTML='يبعد '+NUM(pct((A.stop-A.close)/A.close))+' عن آخر سعر';
  if(A.rr!=null){$('#mRR').innerHTML=NUM('1 : '+A.rr.toFixed(2));$('#mRRSub').textContent=A.rr>=2?'نسبة جيدة للدخول':A.rr>=1?'نسبة مقبولة':'المخاطرة أعلى من العائد';}
  else{$('#mRR').textContent='—';$('#mRRSub').textContent='';}
  if(A.rsi!=null){$('#mRsi').innerHTML=A.rsi.toFixed(1);$('#mRsiBar').style.left=A.rsi.toFixed(1)+'%';$('#mRsiSub').textContent=A.rsi<30?'تشبّع بيعي':A.rsi>70?'تشبّع شرائي':'محايد بين 30 و 70';}
  $('#mTrend').textContent=A.trend;$('#mTrend').style.color=A.trendN>0?'var(--up)':A.trendN<0?'var(--down)':'var(--ink)';$('#mTrendSub').textContent=A.trendSub;
  const I=S.ind,mh=I.macdHist[N-1];
  if(mh!=null){$('#mMacd').textContent=mh>=0?'زخم صاعد':'زخم هابط';$('#mMacd').style.color=mh>=0?'var(--up)':'var(--down)';$('#mMacd').style.fontFamily='var(--f-display)';
    $('#mMacdSub').innerHTML='الفرق عن خط الإشارة '+NUM(mh.toFixed(3))+(I.macdHist[N-2]!=null?(Math.abs(mh)>Math.abs(I.macdHist[N-2])?(mh<0?' · الهبوط يقوى':' · الصعود يقوى'):(mh<0?' · الهبوط يضعف':' · الصعود يضعف')):'');}
  renderCompareMetric();

  const P2=A.perf,tfUnit=S.tf==='W'?'أسبوع':S.tf==='H'?'ساعة':'يوم';
  $('#perf').innerHTML='<span>أداء الفترة: <b>'+chgSpan(P2.ret,1)+'</b></span>'+
    '<span>أعلى: <b>'+NUM(fp(P2.hi))+'</b></span><span>أدنى: <b>'+NUM(fp(P2.lo))+'</b></span>'+
    '<span>متوسط المدى: <b>'+NUM(fp(A.atrv))+'</b> ('+NUM((P2.atrp*100).toFixed(1)+'%')+')</span>'+
    '<span>متوسط الحجم: <b>'+(P2.avgV?fmtVol.format(P2.avgV):'—')+'</b></span><span>عدد الشموع: <b>'+NUM(P2.days)+'</b> '+tfUnit+'</span>'+
    (A.vp?'<span>أعلى تداول عند: <b>'+NUM(fp(A.vp.pocPrice))+'</b></span>':'');

  /* levels */
  const rows=[];let priceRowDone=false;const maxScore=Math.max(...A.zones.map(x=>x.score),1);
  const priceRow='<tr class="cur"><td><span class="kind price">السعر الحالي</span></td><td>'+NUM(fp(A.close))+'</td><td></td><td></td><td></td></tr>';
  for(const z of A.zones){
    if(!priceRowDone&&z.kind==='s'){rows.push(priceRow);priceRowDone=true;}
    const tags=(z.role==='buy'?'<span class="tag b">منطقة الشراء</span>':'')+(z.role==='sell'?'<span class="tag x">منطقة البيع</span>':'')+
      (z.inside?'<span class="tag in">السعر داخلها</span>':'')+(z.htf?'<span class="tag v" title="تظهر أيضًا على الإطار الأعلى">أسبوعي</span>':'')+
      (z.poc?'<span class="tag v" title="أعلى سعر تداولًا في الفترة">أعلى تداول</span>':(z.vpStrong||z.hvn)?'<span class="tag v">حجم '+NUM(Math.round((z.vp||0)*100)+'%')+'</span>':'')+
      (z.flip?'<span class="tag in" title="كانت دعمًا ومقاومة">تبادل أدوار</span>':'')+(z.old?'<span class="tag in">من تاريخ أقدم</span>':'');
    rows.push('<tr><td><span class="kind '+z.kind+'">'+(z.kind==='s'?'دعم':'مقاومة')+'</span>'+tags+'</td><td>'+RANGE(z.lo,z.hi)+'</td><td>'+NUM(z.touches||'—')+'</td>'+
      '<td><span class="bar"><i style="width:'+Math.round(100*z.score/maxScore)+'%"></i></span></td><td>'+NUM(pct(z.dist))+'</td></tr>');}
  if(!priceRowDone)rows.push(priceRow);
  if(A.tl&&A.tl.sup)rows.push('<tr><td><span class="kind s">خط اتجاه داعم</span>'+(A.tl.sup.broken?'<span class="tag x">مكسور</span>':'')+'</td><td>'+NUM(fp(A.tl.sup.now))+'</td><td>'+NUM(A.tl.sup.touches)+'</td><td></td><td>'+NUM(pct((A.tl.sup.now-A.close)/A.close))+'</td></tr>');
  if(A.tl&&A.tl.res)rows.push('<tr><td><span class="kind r">خط اتجاه مقاوم</span>'+(A.tl.res.broken?'<span class="tag b">مخترق</span>':'')+'</td><td>'+NUM(fp(A.tl.res.now))+'</td><td>'+NUM(A.tl.res.touches)+'</td><td></td><td>'+NUM(pct((A.tl.res.now-A.close)/A.close))+'</td></tr>');
  for(const g of A.gaps||[])rows.push('<tr><td><span class="kind n">فجوة غير مغلقة</span></td><td>'+RANGE(g.lo,g.hi)+'</td><td></td><td></td><td>'+NUM(pct(((g.lo+g.hi)/2-A.close)/A.close))+'</td></tr>');
  $('#levels').innerHTML=rows.join('');

  /* signals & patterns */
  const items=[];
  for(const p of A.pats)items.push('<li><span class="kind '+(p.dir>0?'s':p.dir<0?'r':'n')+'">نموذج</span><span>'+p.name+(p.tri?' قيد التكوّن':p.confirmed?' مكتمل':' محتمل')+
    (p.neck!=null?'<br><span class="d">خط العنق '+NUM(fp(p.neck))+(p.target!=null?' · الهدف '+NUM(fp(p.target)):'')+'</span>':'')+'</span><span></span></li>');
  for(const s of A.sig.slice(-10).reverse())items.push('<li><span class="kind '+(s.t==='b'?'s':'r')+'">'+(s.t==='b'?'شراء':'بيع')+'</span><span>'+s.s+'<br><span class="d">'+(S.tf==='H'?fmtDateTime:fmtDate).format(D[s.i].t)+'</span></span>'+NUM(fp(D[s.i].c))+'</li>');
  $('#signals').innerHTML=items.length?items.join(''):'<li class="plain"><p class="empty">لا توجد إشارات أو نماذج داخل هذه الفترة.</p></li>';

  if(S.calcAuto)calcFill();else calcCompute();
  updateReadout(CH.hover>=0?CH.hover:N-1);
  draw();
  renderGoldCard();
  updateFavBtn();
  renderFundCard();
}
function renderConfidence(){
  const A=S.A;if(!A)return;const bc=blendConfidence(A,S.bt);
  if(bc){$('#confVal').textContent=bc.conf+'%';$('#confBar').style.width=bc.conf+'%';
    $('#confNote').textContent=bc.hist!=null?'منها نجاح تاريخي '+Math.round(bc.hist)+'% في '+bc.n+' حالة مشابهة':'مبنية على قوة الأسباب الحالية';
    S.confText='الثقة '+bc.conf+'%';}
  else{$('#confVal').textContent='—';$('#confBar').style.width=A.bull+'%';
    $('#confNote').textContent='لا توجد إشارة كافية. ميل المؤشرات '+(A.bull>=50?'نحو الشراء ':'نحو البيع ')+Math.round(Math.abs(A.bull-50)*2.5)+'%';S.confText='';}
}
function renderBacktest(){
  const bt=S.bt;if(!bt)return;
  const names={zone:'الشراء في منطقة الدعم',rsi:'خروج من التشبّع البيعي',cross:'تقاطع المتوسطين',macd:'تقاطع الماكد',brk:'اختراق قمة 20 شمعة بحجم'};
  $('#btBody').innerHTML=Object.keys(names).map(k=>{const s=bt[k];if(!s.n)return '<tr><td>'+names[k]+'</td><td>'+NUM(0)+'</td><td class="muted">—</td><td class="muted">—</td><td class="muted">—</td></tr>';
    const w=s.w/s.n;return '<tr><td>'+names[k]+'</td><td>'+NUM(s.n)+'</td><td><span class="kind '+(w>=0.55?'s':w<0.45?'r':'n')+'">'+NUM(Math.round(w*100)+'%')+'</span></td><td>'+chgSpan(s.r/s.n,1)+'</td><td>'+NUM((s.b/s.n).toFixed(0))+' شمعة</td></tr>';}).join('');
  $('#btNote').textContent='على آخر '+Math.min(S.data.length,700)+' شمعة من تاريخ هذا الأصل';
}
function updateReadout(i){const D=S.data;if(!D[i])return;const d=D[i],p=D[i-1];const ch=p?d.c/p.c-1:0;const r=S.ind.rsi[i];
  const evs=chartEvents().filter(e=>idxAtTime(e.t)===i).map(e=>'<span><b>'+e.txt+'</b></span>').join('');
  $('#readout').innerHTML='<span><b>'+(S.tf==='H'?fmtDateTime:fmtDate).format(d.t)+'</b></span><span>افتتاح <b>'+NUM(fp(d.o))+'</b></span><span>أعلى <b>'+NUM(fp(d.h))+'</b></span>'+
  '<span>أدنى <b>'+NUM(fp(d.l))+'</b></span><span>إغلاق <b>'+NUM(fp(d.c))+'</b> '+chgSpan(ch)+'</span>'+
  (d.v?'<span>الحجم <b>'+fmtVol.format(d.v)+'</b></span>':'')+(r!=null?'<span>القوة النسبية <b>'+NUM(r.toFixed(1))+'</b></span>':'')+evs;}

/* ---------- position size calculator ---------- */
function calcFill(){const A=S.A;if(!A)return;
  $('#cCap').value=P.calc.capital;$('#cRisk').value=P.calc.risk;$('#cFee').value=P.calc.fee;
  $('#cEntry').value=+A.entry.toFixed(dec(A.entry));$('#cStop').value=+A.stop.toFixed(dec(A.stop));$('#cTarget').value=+A.t1.toFixed(dec(A.t1));
  calcCompute();}
function calcCompute(){
  const cap=+$('#cCap').value,risk=+$('#cRisk').value,entry=+$('#cEntry').value,stop=+$('#cStop').value,target=+$('#cTarget').value,fee=(+$('#cFee').value||0)/100;
  const out=$('#calcOut');
  if(!(cap>0&&risk>0&&entry>0&&stop>0)){out.innerHTML='<p class="empty">أدخل رأس المال والأسعار.</p>';return null;}
  if(stop>=entry){out.innerHTML='<p class="empty">وقف الخسارة يجب أن يكون أقل من سعر الدخول.</p>';return null;}
  const riskAmt=cap*risk/100,perShare=(entry-stop)+entry*fee+stop*fee;
  let qty=Math.floor(riskAmt/perShare),capped=false;
  if(qty*entry*(1+fee)>cap){qty=Math.floor(cap/(entry*(1+fee)));capped=true;}
  const cost=qty*entry,loss=qty*perShare,profit=target>entry?qty*((target-entry)-entry*fee-target*fee):0,R=(target-entry)/(entry-stop);
  out.innerHTML='<div><span>عدد الأسهم</span><b>'+fmtMoney.format(qty)+'</b></div><div><span>قيمة الصفقة</span><b>'+fmtMoney.format(cost)+'</b></div>'+
    '<div><span>نسبة من رأس المال</span><b>'+(cost/cap*100).toFixed(1)+'%</b></div><div><span>الخسارة عند الوقف</span><b style="color:var(--sell)">'+fmtMoney.format(loss)+'</b></div>'+
    '<div><span>الربح عند الهدف</span><b style="color:var(--buy)">'+fmtMoney.format(profit)+'</b></div><div><span>العائد إلى المخاطرة</span><b>1 : '+(R>0?R.toFixed(2):'—')+'</b></div>'+
    (capped?'<div style="grid-column:1/-1"><span>الكمية محدودة برأس المال المتاح وليس بنسبة المخاطرة.</span></div>':'');
  return{qty,entry,stop,target};
}

/* ---------- comparison with the market index / dollar index ---------- */
function alignSeries(raw,D){if(!raw||!D)return null;const t=raw.map(r=>r[0]),c=raw.map(r=>r[4]);
  return D.map(d=>{let lo=0,hi=t.length-1;if(d.t<t[0])return null;while(hi-lo>1){const m=(lo+hi)>>1;if(t[m]<=d.t+DAY-1)lo=m;else hi=m;}return t[hi]<=d.t+DAY-1?c[hi]:c[lo];});}
function alignCompare(){S.cmp=S.tf==='H'?null:alignSeries(S.cmpRaw,S.data);}
async function loadCompare(seq){
  S.cmpRaw=null;S.cmp=null;
  if(!LOCAL||S.source!=='live'||!['SR','CA','US','GOLD'].includes(S.ex))return;
  S.cmpLabel=EX[S.ex].idx;$('#cmpChipLabel').textContent=S.ex==='GOLD'?'مقارنة بمؤشر الدولار':'مقارنة بالمؤشر العام';
  const j=await api('/api/index',{ex:S.ex,range:$('#rng').value}).catch(()=>null);
  if(seq!==S.loadSeq||!j||!j.ok)return;
  S.cmpRaw=j.rows;S.cmpLabel=j.label?_t(j.label):S.cmpLabel;alignCompare();renderCompareMetric();renderGoldCard();draw();
}
function renderCompareMetric(){
  const card=$('#mCmpCard');if(!LOCAL)return;
  if(!S.cmp||!S.A){card.hidden=true;return;}card.hidden=false;
  const A=S.A,i0=A.start,i1=S.data.length-1;const c0=S.cmp[i0]!=null?S.cmp[i0]:S.cmp.find((v,i)=>i>=i0&&v!=null),c1=S.cmp[i1];
  if(!c0||!c1){card.hidden=true;return;}
  const ir=c1/c0-1,sr=A.perf.ret,rel=sr-ir;
  $('#mCmpK').textContent=S.ex==='GOLD'?'الذهب مقابل الدولار':'مقارنة بـ'+S.cmpLabel;
  if(S.isFund)$('#mCmpK').textContent=S.fundCat==='metals'?'الصندوق مقابل الذهب':'الصندوق مقابل السوق';
  $('#mCmp').innerHTML=NUM(pct(rel));$('#mCmp').style.color=rel>=0?'var(--up)':'var(--down)';
  const fundMetal=S.isFund&&S.fundCat==='metals';
  $('#mCmpSub').innerHTML=(S.ex==='GOLD'?'الدولار ':fundMetal?'الذهب ':'المؤشر ')+chgSpan(ir,1)+' · '+(S.ex==='GOLD'?'الذهب ':S.isFund?'الصندوق ':'السهم ')+chgSpan(sr,1);
}

/* ---------- company profile, events, news ---------- */
const REC_AR={strong_buy:'شراء قوي',buy:'شراء',hold:'احتفاظ',underperform:'أداء أقل من السوق',sell:'بيع',none:'—'};
async function loadProfile(seq){
  S.profile=null;$('#profileKv').innerHTML='';$('#eventsList').innerHTML='';$('#profileSummaryBox').hidden=true;
  const row=$('#companyRow');
  if(!LOCAL||S.source!=='live'||S.isFund){row.hidden=true;return;}
  row.hidden=false;loadNews(seq);
  if(S.ex==='GOLD'){$('#profileNote').textContent='';renderEvents();return;}
  $('#profileNote').textContent='جارٍ التحميل…';
  const j=await api('/api/profile',{symbol:S.meta.symbol}).catch(()=>null);
  if(seq!==S.loadSeq)return;
  if(!j||!j.ok){$('#profileNote').textContent=(j&&j.error)||'تعذّر جلب البيانات الأساسية.';renderEvents();return;}
  S.profile=j;$('#profileNote').textContent=sectorAr(j.sector)+(j.industry?' · '+j.industry:'');
  const kv=[['القيمة السوقية',j.marketCap?fmtVol.format(j.marketCap):null],['مكرر الربحية',j.trailingPE&&j.trailingPE.toFixed(1)],['المكرر المتوقع',j.forwardPE&&j.forwardPE.toFixed(1)],
    ['السعر إلى القيمة الدفترية',j.priceToBook&&j.priceToBook.toFixed(2)],['العائد التوزيعي',j.dividendYield!=null?(j.dividendYield*100).toFixed(2)+'%':null],['نسبة توزيع الأرباح',j.payoutRatio!=null?(j.payoutRatio*100).toFixed(0)+'%':null],
    ['هامش الربح الصافي',j.profitMargins!=null?(j.profitMargins*100).toFixed(1)+'%':null],['العائد على حقوق الملكية',j.returnOnEquity!=null?(j.returnOnEquity*100).toFixed(1)+'%':null],
    ['نمو الإيرادات',j.revenueGrowth!=null?pct(j.revenueGrowth):null],['نمو الأرباح',j.earningsGrowth!=null?pct(j.earningsGrowth):null],['الدين إلى حقوق الملكية',j.debtToEquity!=null?j.debtToEquity.toFixed(0)+'%':null],
    ['معامل بيتا',j.beta!=null?j.beta.toFixed(2):null],['متوسط هدف المحللين',j.targetMeanPrice?fp(j.targetMeanPrice)+(j.analysts?' ('+j.analysts+')':''):null],['توصية المحللين',j.recommendation?(REC_AR[j.recommendation]||j.recommendation):null]];
  $('#profileKv').innerHTML=kv.filter(x=>x[1]!=null&&x[1]!=='').map(([k,v])=>'<div><span>'+k+'</span><b'+(/[ء-ي]/.test(String(v))?' class="txt"':'')+'>'+esc(v)+'</b></div>').join('')||'<p class="empty">لا تتوفر بيانات أساسية لهذا الرمز.</p>';
  if(j.summary){$('#profileSummary').textContent=j.summary;$('#profileSummaryBox').hidden=false;}
  renderEvents();draw();
}
function upcomingEvents(){
  const now=Date.now(),ev=[];
  if(S.ex==='GOLD'){const f=FOMC.find(t=>t+DAY>now);if(f)ev.push({t:f,txt:'قرار الفيدرالي الأمريكي بشأن الفائدة'});}
  const p=S.profile;
  if(p&&p.ok){for(const e of p.earningsDates||[])if(e*1000+DAY>now){ev.push({t:e*1000,txt:'إعلان النتائج المالية'});break;}
    if(p.exDividendDate&&p.exDividendDate*1000+DAY>now)ev.push({t:p.exDividendDate*1000,txt:'تاريخ استحقاق التوزيع (آخر يوم شراء قبله)'});
    if(p.dividendDate&&p.dividendDate*1000+DAY>now)ev.push({t:p.dividendDate*1000,txt:'تاريخ صرف التوزيع'});}
  return ev.sort((a,b)=>a.t-b.t);
}
function renderEvents(){
  const now=Date.now(),items=[];
  for(const e of upcomingEvents()){const days=Math.ceil((e.t-now)/DAY);items.push('<li><span class="kind '+(days<=7?'r':'n')+'">'+(days<=0?'اليوم':'بعد '+days+' يوم')+'</span><span>'+e.txt+'</span>'+'<span class=\"small muted\">'+fmtDate.format(e.t)+'</span>'+'</li>');}
  const divs=((S.meta&&S.meta.dividends)||[]).slice(-3).reverse();
  for(const d of divs)items.push('<li><span class="kind s">توزيع سابق</span><span>'+(d[1]!=null?NUM(fp(d[1]))+' للسهم':'')+'</span>'+'<span class=\"small muted\">'+fmtDate.format(d[0])+'</span>'+'</li>');
  $('#eventsList').innerHTML=items.join('')||'<li class="plain"><p class="empty">لا توجد أحداث قادمة معروفة.</p></li>';
}
async function loadNews(seq){
  const key=drawKey(),saved=await Store.get('newsQ',{});
  let q=saved[key];
  if(!q){q=S.ex==='GOLD'?(S.code.startsWith('XAG')?'أسعار الفضة':'أسعار الذهب'):(S.name||S.code).replace(/\b(Corporation|Company|Co\.?|S\.?A\.?E\.?|Inc\.?|Ltd\.?|PJSC|SJSC|Holding|Group|and|for)\b/gi,'').replace(/\(.*?\)/g,'').replace(/\s+/g,' ').trim()+' سهم';}
  $('#newsQ').value=q;fetchNews(q,seq);
}
async function fetchNews(q,seq){
  $('#newsList').innerHTML='<li class="plain"><p class="empty">جارٍ جلب الأخبار…</p></li>';
  const j=await api('/api/news',{q,region:EX[S.ex]?EX[S.ex].region:'SR'}).catch(()=>null);
  if(seq!=null&&seq!==S.loadSeq)return;
  if(!j||!j.ok||!j.items.length){$('#newsList').innerHTML='<li class="plain"><p class="empty">'+(j&&j.error||'لم أجد أخبارًا. جرّب كلمات بحث أخرى، مثل اسم الشركة بالعربية.')+'</p></li>';return;}
  $('#newsList').innerHTML=j.items.map(n=>{const t=Date.parse(n.date);return '<li class="plain"><a href="'+esc(n.link)+'" data-ext>'+esc(n.title)+'</a><br><span class="d">'+esc(n.source)+(isFinite(t)?' · '+fmtLocalTime.format(new Date(t)):'')+'</span></li>';}).join('');
}

/* ---------- gold panel ---------- */
async function loadGoldExtras(seq){
  S.gold=null;if(!LOCAL||S.ex!=='GOLD'||S.source!=='live')return;
  const [g,s]=await Promise.all([api('/api/history',{code:'XAU-USD-OZ',ex:'GOLD',range:'2y'}),api('/api/history',{code:'XAG-USD-OZ',ex:'GOLD',range:'2y'})].map(p=>p.catch(()=>null)));
  if(seq!==S.loadSeq||!g||!g.ok||!s||!s.ok)return;
  const sm=new Map(s.rows.map(r=>[r[0],r[4]]));const ratio=g.rows.filter(r=>sm.has(r[0])).map(r=>[r[0],r[4]/sm.get(r[0])]);
  S.gold={ratio,goldRows:g.rows};renderGoldCard();
}
function renderGoldCard(){
  const card=$('#goldCard');if(S.ex!=='GOLD'||S.source==='sample'){card.hidden=true;return;}card.hidden=false;
  const kv=[];const now=Date.now();
  const f=FOMC.find(t=>t+DAY>now);if(f)kv.push(['قرار الفيدرالي القادم',fmtDate.format(f)+' · بعد '+Math.max(0,Math.ceil((f-now)/DAY))+' يوم',true]);
  if(S.gold&&S.gold.ratio.length>50){const r=S.gold.ratio,cur=r[r.length-1][1],yr=r.slice(-250).map(x=>x[1]);const avg=yr.reduce((a,b)=>a+b,0)/yr.length;
    kv.push(['نسبة الذهب إلى الفضة',cur.toFixed(1)]);kv.push(['متوسطها خلال سنة',avg.toFixed(1)]);kv.push(['أدنى وأعلى خلال سنة',Math.min(...yr).toFixed(1)+' – '+Math.max(...yr).toFixed(1)]);
    kv.push(['القراءة',cur>avg*1.05?'الفضة رخيصة نسبيًا مقارنة بالذهب':cur<avg*0.95?'الذهب رخيص نسبيًا مقارنة بالفضة':'قرب متوسطها السنوي',true]);}
  if(S.cmpRaw&&S.gold){const dx=S.cmpRaw,m=new Map(dx.map(r=>[r[0],r[4]]));const gr=S.gold.goldRows.filter(r=>m.has(r[0])).slice(-61);
    if(gr.length>30){const a=[],b=[];for(let i=1;i<gr.length;i++){a.push(gr[i][4]/gr[i-1][4]-1);b.push(m.get(gr[i][0])/m.get(gr[i-1][0])-1);}
      const ma=a.reduce((x,y)=>x+y,0)/a.length,mb=b.reduce((x,y)=>x+y,0)/b.length;let sab=0,sa=0,sb=0;for(let i=0;i<a.length;i++){sab+=(a[i]-ma)*(b[i]-mb);sa+=(a[i]-ma)**2;sb+=(b[i]-mb)**2;}
      const corr=sab/Math.sqrt(sa*sb);const d1=dx[dx.length-1][4],d0=dx[Math.max(0,dx.length-22)][4];
      kv.push(['مؤشر الدولار',fp(d1)+' ('+pct(d1/d0-1)+' في شهر)']);kv.push(['ارتباط الذهب بالدولار (60 يومًا)',corr.toFixed(2)+(corr<-0.3?' · عكسي':corr>0.3?' · طردي':' · ضعيف')]);}}
  $('#goldKv').innerHTML=kv.map(([k,v,t])=>'<div><span>'+k+'</span><b'+(t||/[ء-ي]/.test(v)?' class="txt"':'')+'>'+esc(v)+'</b></div>').join('')||'<p class="empty">بيانات الذهب الإضافية متاحة في نسخة سطح المكتب.</p>';
  const egp=S.code&&S.code.startsWith('XAU-EGP');$('#egpGapBox').hidden=!egp||!LOCAL;
  if(egp){const v=P.egpLocal[S.code];$('#egpLocal').value=v||'';egpGap();}
}
function egpGap(){const v=+$('#egpLocal').value,A=S.A;const out=$('#egpGapOut');
  if(!(v>0)||!A){out.textContent='أدخل سعر الجرام عند الصاغة اليوم لحساب الفرق عن السعر العالمي المحوّل.';return;}
  const gap=(v-A.close)/A.close;out.innerHTML='السعر العالمي المحوّل '+NUM(fp(A.close))+' جنيه، وسعر الصاغة '+NUM(fp(v))+'. الفرق '+chgSpan(gap,1)+(gap>0.03?' — السوق المحلي أغلى من العالمي، وقد يتراجع الفرق لاحقًا.':gap<-0.03?' — السوق المحلي أرخص من العالمي.':' — الفرق طبيعي.');}

/* ---------- data loading ---------- */
function updateLinks(){const ex=$('#ex').value,code=$('#sym').value.trim().toUpperCase().replace(/\s+/g,'');
  $('#symField').hidden=ex==='GOLD'||ex==='FUND';$('#goldField').hidden=ex!=='GOLD';$('#fundField').hidden=ex!=='FUND';$('#fundAllField').hidden=ex!=='FUND';$('#fundCountryField').hidden=ex!=='FUND';
  if(ex==='FUND'){loadFundList();return;}
  if(ex==='GOLD'){const silver=$('#gold').value.startsWith('XAG');
    $('#invLink').href='https://sa.investing.com/commodities/'+(silver?'silver':'gold')+'-historical-data';
    $('#tvLink').href='https://www.tradingview.com/chart/?symbol=TVC:'+(silver?'SILVER':'GOLD');return;}
  $('#sym').placeholder=EX[ex].ph;const bare=code.replace(/\.[A-Z]{1,3}$/,'');
  $('#invLink').href=bare?'https://sa.investing.com/search/?q='+encodeURIComponent(bare):'https://sa.investing.com/';
  $('#tvLink').href=bare?'https://www.tradingview.com/chart/?symbol='+encodeURIComponent((EX[ex].tv?EX[ex].tv+':':'')+bare):'https://www.tradingview.com/';}
async function getRecent(){return Store.get('recent',[]);}
async function addRecent(it){let r=(await getRecent()).filter(x=>!(x.ex===it.ex&&x.code===it.code));r.unshift(it);r=r.slice(0,8);await Store.set('recent',r);renderRecent();}
async function renderRecent(){if(!LOCAL)return;const r=await getRecent();
  $('#recent').innerHTML=r.length?'<span>الأخيرة:</span>'+r.map((x,i)=>'<button type="button" class="pill-btn" '+(x.short?'':'dir="ltr" ')+'data-i="'+i+'" title="'+esc(x.name)+'">'+esc(x.short||x.code)+'</button>').join(''):'';}
function applySource(ex,code){$('#ex').value=ex;if(ex==='GOLD')$('#gold').value=code;else if(ex==='FUND')selectFund(code);else $('#sym').value=code;updateLinks();}

async function fetchSymbol(code,ex){
  code=(code||'').trim();if(!code){setStatus('اكتب رمز السهم أولًا.',true);$('#sym').focus();return;}
  const btn=$('#fetchBtn');btn.disabled=true;btn.textContent='جارٍ الجلب…';$('#results').hidden=true;
  const label=ex==='GOLD'?goldLabel():code;setStatus('جارٍ جلب بيانات '+label+' …');
  const seq=++S.loadSeq;
  try{
    const rng=$('#rng').value;
    const [j,h]=await Promise.all([api('/api/history',{code,ex,range:rng}),S.tf==='H'?api('/api/history',{code,ex,range:'2y',interval:'60m'}).catch(()=>null):Promise.resolve(null)]);
    if(seq!==S.loadSeq)return;
    if(!j.ok){if(j.notFound&&ex!=='FUND')await runSearch(code,ex,j.error);else setStatus(j.error||'تعذّر جلب البيانات.',true);return;}
    S.isFund=!!j.isFund;S.fundCat=j.category||'';S.fundCmp=null;S.cmpRaw=null;S.cmp=null;
    if(S.isFund&&j.rows.length<30){
      S.ex=ex;S.code=String(code);S.name=j.name;S.source='live';S.meta=j;S.fileName='';S.A=null;
      S.daily=j.rows.map(r=>({t:r[0],o:r[4],h:r[4],l:r[4],c:r[4],v:0}));S.hourly=null;
      $('#chartName').textContent=S.name;$('#companyRow').hidden=true;renderFundCard();updateFavBtn();
      setStatus('سجل هذا الصندوق قصير ('+(j.rows.length===1?'سعر واحد':j.rows.length+' سعرًا')+')، فيظهر أداؤه فقط حتى يكتمل السجل.');
      addRecent({ex,code:S.code,name:S.name,short:j.short||''});return;}
    S.ex=ex;S.code=ex==='GOLD'?code:code.toUpperCase();S.name=j.name||j.symbol;S.source='live';S.meta=j;S.fileName='';
    S.daily=rowsToData(j.rows);S.hourly=h&&h.ok?rowsToData(h.rows):null;S.calcAuto=true;
    await loadDrawings();
    applyTF();
    setStatus('تم جلب '+S.daily.length+(S.isFund?' سعرًا للصندوق من ':' يوم تداول من ')+j.source+(j.live||j.source==='TradingView'?'، وآخر سعر من جلسة '+fmtDate.format(S.daily[S.daily.length-1].t)+' ('+priceQual(j)+(marketOpen(ex)?' ويتحدث تلقائيًا كل دقيقتين':'')+').':'، وآخر إغلاق بتاريخ '+fmtDate.format(S.daily[S.daily.length-1].t)+'.')+(j.note?' '+j.note:''),!!j.offline);
    addRecent({ex,code:S.code,name:S.name,short:j.short||''});
    loadProfile(seq);if(S.isFund)loadFundCompare(seq);else loadCompare(seq);loadGoldExtras(seq);
    S.usSharia=null;if(LOCAL&&ex==='US')api('/api/ussharia',{code:S.code}).then(r=>{if(seq===S.loadSeq&&r&&r.ok){S.usSharia=r;if(S.A)render();}}).catch(()=>{});
  }catch(e){setStatus(e instanceof TypeError||e instanceof SyntaxError?'تعذّر الاتصال بالبرنامج. أعد تشغيله إذا استمرت المشكلة.':(e.message||'تعذّر جلب البيانات.'),true);}
  finally{btn.disabled=false;btn.textContent='جلب البيانات';}
}
/* ---------- live refresh while the market is open ---------- */
const priceQual=j=>j.source==='TradingView'&&j.delayed===false?'لحظي'+(j.tvAccount?' من حسابك':''):'متأخر 15 دقيقة';
const MKT_HOURS={SR:{tz:'Asia/Riyadh',days:[0,1,2,3,4],open:600,close:920},CA:{tz:'Africa/Cairo',days:[0,1,2,3,4],open:600,close:870},
  US:{tz:'America/New_York',days:[1,2,3,4,5],open:570,close:960},GOLD:{tz:'America/New_York',days:[0,1,2,3,4,5],open:0,close:1440}};
function marketOpen(ex){const m=MKT_HOURS[ex];if(!m)return false;
  try{const p=new Intl.DateTimeFormat('en-US',{timeZone:m.tz,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
    const g=k=>(p.find(x=>x.type===k)||{}).value;const wd=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(g('weekday'));const mins=(+g('hour'))*60+(+g('minute'));
    if(ex==='GOLD')return !(wd===5&&mins>=1020)&&!(wd===0&&mins<1080)&&wd!==6;
    return m.days.includes(wd)&&mins>=m.open-5&&mins<=m.close+20;}catch(e){return false;}}
async function liveTick(){
  if(!LOCAL||document.hidden||S.source!=='live'||S.isFund||!S.daily||!S.code||S.tf==='H'||$('#view-analysis').hidden||!marketOpen(S.ex))return;
  const seq=S.loadSeq,code=S.code,ex=S.ex;
  const j=await api('/api/history',{code,ex,range:$('#rng').value}).catch(()=>null);
  if(!j||!j.ok||seq!==S.loadSeq||S.tf==='H'||!j.rows||j.rows.length<30)return;
  let D;try{D=rowsToData(j.rows);}catch(e){return;}
  const a=S.daily[S.daily.length-1],b=D[D.length-1];S.meta=j;
  const when=new Date().toLocaleTimeString(EN?'en-GB':'ar-SA-u-nu-latn',{hour:'2-digit',minute:'2-digit'});
  const same=(x,y)=>x===y||(x!==x&&y!==y);
  if(b.t===a.t&&same(b.c,a.c)&&same(b.h,a.h)&&same(b.l,a.l)&&same(b.v,a.v)){setStatus('السعر محدَّث ('+priceQual(j)+') — آخر فحص '+when+'.');return;}
  const oldN=S.data.length,atEnd=CH.to>=oldN;
  S.daily=D;S.data=S.tf==='W'?aggregateWeekly(S.daily):S.daily;S.ind=computeInd(S.data);alignCompare();
  const shift=S.data.length-oldN;if(atEnd){CH.to=S.data.length;CH.from=Math.max(0,CH.from+shift);}else{CH.to=Math.min(CH.to,S.data.length);}
  analyzeNow(false);
  setStatus('تحدّث السعر: '+fmtDate.format(b.t)+' — آخر فحص '+when+' ('+priceQual(j)+').');
}
async function ensureHourly(){
  if(S.hourly||!LOCAL||S.source!=='live')return!!S.hourly;
  setStatus('جارٍ جلب بيانات الساعة…');
  const h=await api('/api/history',{code:S.code,ex:S.ex,range:'2y',interval:'60m'}).catch(()=>null);
  if(h&&h.ok){try{S.hourly=rowsToData(h.rows);setStatus('');return true;}catch(e){}}
  setStatus('بيانات الساعة غير متاحة لهذا الأصل.',true);return false;
}
async function runSearch(q,ex,err){
  try{const j=await api('/api/search',{q,ex});const box=$('#results');
    if(j.ok&&j.items&&j.items.length){
      box.innerHTML='<span>لم أجد الرمز مباشرة. اختر المقصود:</span>'+j.items.map(it=>'<button type="button" class="pill-btn" data-s="'+esc(it.symbol)+'">'+esc(it.name)+' · <span class="num">'+esc(it.symbol)+'</span></button>').join('');
      box.hidden=false;setStatus('وجدت '+j.items.length+' نتائج قريبة من «'+q+'».');}
    else setStatus((err||'لم أجد هذا الرمز.')+' تأكد من السوق والرمز، أو اكتب اسم الشركة بالإنجليزية.',true);
  }catch(e){setStatus(err||'لم أجد هذا الرمز.',true);}
}
function useStatic(D,meta){
  S.loadSeq++;S.isFund=false;S.fundCat='';S.fundCmp=null;S.daily=D;S.hourly=null;S.meta=null;S.profile=null;S.cmpRaw=null;S.cmp=null;S.gold=null;S.source=meta.source;S.fileName=meta.fileName||'';S.name=meta.name;
  S.ex=$('#ex').value;S.code=meta.code||'';S.calcAuto=true;$('#results').hidden=true;
  if(S.tf==='H')S.tf='D';
  loadDrawings().then(()=>{applyTF();});
  $('#companyRow').hidden=true;
}
function loadText(text,meta){if(LOCAL&&$('#ex').value==='FUND'){importFundHistory(text);return;}try{const D=parseData(text);
    const code=isGold()?$('#gold').value:$('#sym').value.trim().toUpperCase();
    const name=isGold()?goldLabel():(code||(meta.fileName?meta.fileName.replace(/\.[^.]+$/,''):'سهمي'));
    useStatic(D,{source:'user',fileName:meta.fileName,name,code});
    setStatus('تم تحميل '+D.length+' شمعة، من '+fmtDate.format(D[0].t)+' إلى '+fmtDate.format(D[D.length-1].t)+'.');
    if(text.length<3e6)Store.set('lastFile',{text,fileName:meta.fileName||'',name,code,ex:$('#ex').value});
  }catch(e){setStatus(e.message||'تعذّرت قراءة البيانات.',true);}}
function loadSample(){$('#companyRow').hidden=true;useStatic(sampleData(),{source:'sample',name:'سهم تجريبي'});
  setStatus(LOCAL?'تعرض الأداة بيانات افتراضية للتوضيح. اختر السوق واكتب رمز السهم ثم اضغط «جلب البيانات».'
    :'تعرض الأداة الآن بيانات افتراضية للتوضيح. اكتب رمز السهم، نزّل بياناته من أحد الموقعين، ثم ارفع الملف.');}
function readFile(f){if(!f)return;const r=new FileReader();r.onload=()=>loadText(r.result,{fileName:f.name});r.onerror=()=>setStatus('تعذّرت قراءة الملف.',true);r.readAsText(f);}

function setupAnalysisView(){
  $('#ex').addEventListener('change',updateLinks);
  $('#gold').addEventListener('change',()=>{updateLinks();if(LOCAL)fetchSymbol(currentCode(),'GOLD');});
  $('#sym').addEventListener('input',updateLinks);
  $('#sym').addEventListener('keydown',e=>{if(e.key==='Enter'&&LOCAL){e.preventDefault();fetchSymbol(currentCode(),$('#ex').value);}});
  $('#fetchBtn').addEventListener('click',()=>fetchSymbol(currentCode(),$('#ex').value));
  $('#results').addEventListener('click',e=>{const b=e.target.closest('button[data-s]');if(!b)return;$('#sym').value=b.dataset.s;updateLinks();fetchSymbol(b.dataset.s,$('#ex').value);});
  $('#recent').addEventListener('click',async e=>{const b=e.target.closest('button[data-i]');if(!b)return;const x=(await getRecent())[+b.dataset.i];if(!x)return;applySource(x.ex,x.code);fetchSymbol(x.code,x.ex);});
  if(!LOCAL){$('#gold').querySelectorAll('option[data-gram]').forEach(o=>o.remove());$('#ex').querySelectorAll('option[data-local]').forEach(o=>o.remove());}
  $('#file').addEventListener('change',e=>{readFile(e.target.files[0]);e.target.value='';});
  $('#pasteBtn').addEventListener('click',()=>{$('#pastePanel').hidden=false;$('#pasteText').focus();});
  $('#pasteCancel').addEventListener('click',()=>{$('#pastePanel').hidden=true;});
  $('#pasteGo').addEventListener('click',()=>{const t=$('#pasteText').value;if(!t.trim()){setStatus('الصق البيانات أولًا.',true);return;}
    loadText(t,{fileName:''});if(!$('#status').classList.contains('err'))$('#pastePanel').hidden=true;});
  $('#sampleBtn').addEventListener('click',()=>{Store.set('lastFile',null);loadSample();});
  $('#tfSeg').addEventListener('click',async e=>{const b=e.target.closest('button[data-tf]');if(!b||b.dataset.tf===S.tf)return;
    if(b.dataset.tf==='H'&&!(await ensureHourly()))return;S.tf=b.dataset.tf;applyTF();});
  $('#rangeSeg').addEventListener('click',e=>{const b=e.target.closest('button[data-range]');if(!b)return;S.range[S.tf]=+b.dataset.range;renderRangeSeg();CH.hover=-1;analyzeNow(true);});
  $$('[data-show]').forEach(c=>{c.checked=!!S.show[c.dataset.show];c.addEventListener('change',()=>{S.show[c.dataset.show]=c.checked;draw();});});
  $('#pane').addEventListener('change',e=>{S.pane=e.target.value;draw();});
  $('#sens').addEventListener('change',e=>{S.sens=+e.target.value;analyzeNow(false);});
  $('#zc').addEventListener('change',e=>{S.zoneCount=+e.target.value;analyzeNow(false);});
  ['cCap','cRisk','cEntry','cStop','cTarget','cFee'].forEach(id=>$('#'+id).addEventListener('input',()=>{
    if(['cEntry','cStop','cTarget'].includes(id))S.calcAuto=false;
    if(id==='cCap')setPref('calc.capital',+$('#cCap').value);if(id==='cRisk')setPref('calc.risk',+$('#cRisk').value);if(id==='cFee')setPref('calc.fee',+$('#cFee').value);
    calcCompute();}));
  $('#calcReset').addEventListener('click',()=>{S.calcAuto=true;calcFill();});
  $('#calcToJournal').addEventListener('click',()=>{const c=calcCompute();if(!c)return;openTradeForm({qty:c.qty,entry:c.entry,stop:c.stop,target:c.target});});
  $('#tradeFromView').addEventListener('click',()=>{const c=calcCompute()||{};openTradeForm(c);});
  $('#exportBtn').addEventListener('click',exportImage);
  $('#newsGo').addEventListener('click',async()=>{const q=$('#newsQ').value.trim();if(!q)return;const s=await Store.get('newsQ',{});s[drawKey()]=q;Store.set('newsQ',s);fetchNews(q);});
  $('#newsQ').addEventListener('keydown',e=>{if(e.key==='Enter')$('#newsGo').click();});
  $('#newsList').addEventListener('click',e=>{const a=e.target.closest('a[data-ext]');if(!a||!LOCAL)return;e.preventDefault();openExternal(a.href);});
  $('#egpLocal').addEventListener('input',()=>{P.egpLocal[S.code]=+$('#egpLocal').value||undefined;savePrefs();egpGap();});
  let dragDepth=0;
  document.addEventListener('dragenter',e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files')){dragDepth++;$('#dropHint').hidden=false;}});
  document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('#dropHint').hidden=true;});
  document.addEventListener('dragover',e=>e.preventDefault());
  document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('#dropHint').hidden=true;const f=e.dataTransfer&&e.dataTransfer.files[0];if(f){location.hash='#analysis';readFile(f);}});
}
