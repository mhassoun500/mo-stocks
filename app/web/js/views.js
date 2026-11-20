/* ================= analysis view: state, loading, rendering ================= */
const S={ex:'SR',code:'',name:'',source:'sample',fileName:'',meta:null,daily:null,hourly:null,data:[],ind:null,A:null,bt:null,
  tf:'D',range:{D:250,W:104,H:150},show:{zones:true,ma:true,bb:false,trend:true,pat:true,sig:true,vol:true,vp:false,gaps:true,events:true,cmp:false,fib:false,fair:true,cloud:false,ema3:false,super:false,buyz:false,yfib:false,smc:false,zz:false,ichi:false,nw:false},
  pane:'rsi',sens:5,zoneCount:6,profile:null,cmp:null,cmpRaw:null,cmpLabel:'',drawings:[],confText:'',calcAuto:true,loadSeq:0};
const RANGE_PRESETS={D:[['شهر',21],['٣ أشهر',63],['٦ أشهر',126],['سنة',250],['الكل',0]],W:[['٣ أشهر',13],['٦ أشهر',26],['سنة',52],['سنتان',104],['الكل',0]],H:[['أسبوع',35],['أسبوعان',70],['شهر',150],['الكل',0]]};

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
  /* short views still analyse at least 3 months (60 daily / 26 weekly bars) so zones stay meaningful */
  const minSpan=S.tf==='W'?26:S.tf==='H'?35:63;
  S.A=analyzeCore(D,S.ind,{span:r>0?Math.min(Math.max(r,minSpan),D.length):D.length,view:r>0?r:0,sens:S.sens,zoneCount:S.zoneCount,stopMult:P.ana.stopMult,htf,noGaps:S.isFund});
  S.bt=null;S.sim=null;S.simPick=null;S.modes=null;
  if(reset)resetView();
  render();
  clearTimeout(S.btTimer);
  S.btTimer=setTimeout(()=>{if(!S.A)return;S.bt=runBacktest(S.data,S.ind,{span:S.A.span,sens:S.sens,zoneCount:S.zoneCount,stopMult:P.ana.stopMult});renderBacktest();renderConfidence();setTimeout(()=>{if(!S.A||S.bt==null)return;S.simPick=pickModes(S.data,S.ind,{span:S.A.span,sens:S.sens,zoneCount:S.zoneCount,stopMult:P.ana.stopMult});priceSim();},30);},40);
}

/* ---------- how old the newest price is, and whether the data looks sound ---------- */
const mktKey=(ex,code)=>ex==='XX'?(/\.SR$/i.test(code||'')?'SR':/\.CA$/i.test(code||'')?'CA':''):ex;
function dataAge(){
  if(S.source!=='live'||!S.meta||!S.data||!S.data.length)return null;
  const t=S.data[S.data.length-1].t,d0=new Date(t),n=new Date(),day=x=>new Date(x.getFullYear(),x.getMonth(),x.getDate()).getTime();
  const days=Math.round((day(n)-day(d0))/864e5),date=d0.toISOString().slice(0,10);
  let txt,k='';
  if(S.meta.offline){txt=_t('قديم');k='old';}
  else if(days<=0){const mk=mktKey(S.ex,S.code);
    if(mk&&!marketOpen(mk))txt=_t('إغلاق اليوم');else if(S.meta.source==='TradingView'&&S.meta.delayed===false){txt=_t('حي');k='live';}else txt=_t('متأخر');}
  else if(days===1)txt=_t('إغلاق أمس');
  else if(days<=4)txt=_t('آخر إغلاق')+' '+date;
  else{txt=_t('قديم');k='old';}
  return{txt,k,date,tip:_t('تاريخ آخر شمعة')+': '+date+' · '+_t('المصدر')+': '+(S.meta.source||'')};
}
const QUAL_TXT={zero:'أسعار صفرية أو سالبة',order:'ترتيب تواريخ غير منطقي',bar:'شموع غير متسقة (الإغلاق خارج المدى)',jump:'قفزات سعرية غير معتادة',gap:'أيام ناقصة في البيانات',stale:'آخر شمعة قديمة'};
function renderDataBadges(){
  const ab=$('#ageBadge'),qb=$('#qualBadge'),a=dataAge();
  ab.hidden=!a;if(a){ab.textContent=a.txt;ab.className='badge'+(a.k?' age-'+a.k:'');ab.title=a.tip;}
  const q=(S.meta&&S.meta.quality)||[];qb.hidden=!q.length||S.source!=='live';
  if(q.length){qb.textContent='⚠ '+_t('تحذير بيانات');qb.title=q.map(i=>_t(QUAL_TXT[i.code]||i.code)+(i.n>1?' ('+i.n+')':'')).join('\n')+'\n'+_t('راجع الأرقام قبل الاعتماد عليها.');}
}
/* ---------- purification badge: the first figure, every source on hover, the program's estimate only when no source has one ---------- */
function purifyStock(){return S.source!=='sample'&&!S.isFund&&['SR','CA','US'].includes(S.ex)&&S.code;}
function renderPurifyBadge(){const pb=$('#purBadge');if(!pb)return;
  if(!purifyStock()){pb.hidden=true;return;}
  const list=purifyEntries(S.code,S.ex,true),k=S.ex+'|'+purCode(S.code);
  if(!list.length&&LOCAL&&!(k in PUR_EST)){PUR_EST[k]={ok:false,loading:true};
    api('/api/purify_est',{code:purCode(S.code),ex:S.ex}).then(j=>{PUR_EST[k]=j&&j.ok?j:{ok:false,error:j&&j.error||''};}).catch(()=>{PUR_EST[k]={ok:false};})
      .then(()=>{if(purCode(S.code)===k.split('|')[1])renderPurifyBadge();});}
  const x=PUR_EST[k],f=list[0];pb.hidden=false;pb.tabIndex=0;
  if(f){pb.innerHTML=esc(_t('التطهير'))+': '+purifyValHTML(f)+(f.src==='est'?' <em>('+esc(_t('تقدير البرنامج'))+')</em>':'')
      +'<span class="sh-pop" hidden>'+purifyPopHTML(list)+'</span>';
    pb.className='badge sh-tag pur'+(f.src==='est'?' off':'');return;}
  pb.className='badge sh-tag off pur';
  pb.innerHTML=esc(_t('التطهير'))+': '+esc(x&&x.loading?_t('جارٍ البحث…'):_t('غير متوفرة'))
    +'<span class="sh-pop" hidden><span class="sh-note">'+esc(_t('لم ينشرها أي مصدر متاح لهذا السهم، ولم تتوفر أرقام كافية لتقديرها. لا نضع رقمًا من عندنا.'))+'</span>'
    +(x&&x.error?'<span class="sh-note muted">'+esc(_t(x.error))+'</span>':'')+'<span class="sh-note muted">'+esc(_t('يمكنك إدخالها من الإعدادات، أو طلبها من «املأ الناقص بالمساعد».'))+'</span></span>';}
/* ---------- render ---------- */
function render(){
  const A=S.A,D=S.data;if(!A)return;const N=D.length,last=D[N-1],prev=D[N-2];
  const chg=last.c/prev.c-1;
  $('#chartName').textContent=S.name||'—';
  const b=$('#srcBadge');
  if(S.source==='sample'){b.textContent='بيانات تجريبية للعرض';b.className='badge sample';}
  else if(S.source==='live'&&S.meta){const m=S.meta;b.innerHTML='<bdi>'+esc(m.source)+'</bdi> · <bdi>'+esc(m.symbol)+'</bdi> · '+N+' شمعة'+(m.currency?' · <bdi>'+esc(m.currency)+'</bdi>':'');b.className='badge';}
  else{b.textContent=(S.fileName?S.fileName+' · ':'')+N+' شمعة';b.className='badge';}
  $('#offlineBadge').hidden=!(S.meta&&S.meta.offline);renderDataBadges();
  const shI=S.ex!=='GOLD'&&S.ex!=='FUND'&&S.source!=='sample'?shariaInfo(S.code,S.ex):null,
    shA=!shI&&S.ex==='US'&&S.usSharia&&S.usSharia.status?S.usSharia:null,sb=$('#shariaBadge');
  sb.hidden=!(shI||shA);
  sb.removeAttribute('title');sb.tabIndex=-1;
  if(shI){sb.innerHTML='شرعيًا: '+esc(shI.word)+(shI.count?' '+NUM(esc(shI.count)):'')+shariaPopHTML(shI);sb.className='badge sh-tag '+(shI.s==='doubt'?'off':shI.s);sb.tabIndex=0;}
  else if(shA){sb.innerHTML=(shA.status==='ok'?'متوافق شرعيًا مبدئيًا':'غير متوافق شرعيًا مبدئيًا')+shariaPopHTML({head:'فحص مبدئي تلقائي',note:_t(shA.why)+' — لا يشمل نسبة الإيراد غير المباح.',refs:[]});
    sb.className='badge sh-tag '+shA.status;sb.tabIndex=0;}
  renderPurifyBadge();
  const seg=S.source!=='sample'&&(S.ex==='SR'||/\.SR$/i.test(S.code))?saSegment(S.code):'',gb=$('#segBadge');
  gb.hidden=!seg;if(seg){gb.textContent=SEG_LABEL[seg];gb.className='badge seg-'+seg;gb.title=SEG_TIP[seg];}
  if(S.ex==='US'&&S.source!=='sample'&&shI&&shI.spus){gb.hidden=false;gb.textContent='ضمن مؤشر S&P 500 الشرعي';gb.className='badge seg-main';gb.title='من مكونات مؤشر S&P 500 الشرعي (حسب حيازات صندوق SPUS).';}
  const e33=S.ex==='CA'&&S.source!=='sample'&&(egSharia(S.code)||{}).egx33;if(e33){gb.hidden=false;gb.textContent='ضمن مؤشر الشريعة EGX33';gb.className='badge seg-main';gb.title='من مكونات مؤشر الشريعة EGX33 للبورصة المصرية.';}

  const st=$('#stance');st.className='stance'+(A.stance==='neutral'?'':' '+A.stance);
  const T={buy:['منطقة شراء محتملة','السعر قرب دعم قوي، والمؤشرات تميل لصالح الدخول التدريجي.'],
    sell:['منطقة بيع أو جني أرباح','السعر قرب مقاومة أو في تشبّع شرائي، والأفضل تخفيف المراكز أو الانتظار.'],
    neutral:['انتظار حتى تتضح الإشارة','السعر بين الدعم والمقاومة. راقب منطقة الشراء قبل الدخول.']};
  $('#stanceText').textContent=T[A.stance][0];$('#stanceSub').textContent=T[A.stance][1];
  $('#reasons').innerHTML=A.reasons.map(r=>'<li class="'+r[0]+'"><span class="dot"></span><span>'+r[1]+'</span></li>').join('');
  renderConfidence();renderQuality();renderMtf();renderExitPlan();

  const tfTxt=S.tf==='H'?fmtDateTime.format(last.t):fmtDate.format(last.t);
  $('#mPrice').innerHTML=fp(last.c);
  $('#mPriceSub').innerHTML=chgSpan(chg)+' · '+tfTxt;
  if(A.buy){$('#mBuy').innerHTML=RANGE(A.buy.lo,A.buy.hi);
    $('#mBuySub').innerHTML=(A.buy.inside?'السعر داخل المنطقة الآن':'الدخول المرجعي '+NUM(fp(A.entry)))+(A.buy.touches?' · '+A.buy.touches+' لمسات':'')+(A.buy.htf?' · أسبوعي':'');}
  else{$('#mBuy').textContent='—';$('#mBuySub').textContent='لا يوجد دعم واضح أسفل السعر';}
  if(A.sell){$('#mSell').innerHTML=RANGE(A.sell.lo,A.sell.hi);$('#mSellSub').innerHTML='الأهداف '+NUM(fp(A.t1))+' · '+NUM(fp(A.t2))+' · '+NUM(fp(A.t3));}
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
  renderPlan();renderAdvSummary();

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
/* ---------- trade simulation with commission and slippage ---------- */
const BT_KEYS=['SR','CA','US','GOLD'];
function btKey(){const k=mktKey(S.ex,S.code);return BT_KEYS.includes(k)?k:'OTHER';}
function priceSim(){
  const k=btKey(),c=P.bt[k]||P.bt.OTHER;
  $('#btFee').value=c.fee;$('#btSlip').value=c.slip;
  const nm={SR:'السوق السعودي',CA:'السوق المصري',US:'السوق الأمريكي',GOLD:'الذهب والفضة',OTHER:'الأصول الأخرى'};
  $('#btCostFor').textContent=_t('تُحفظ لـ')+' '+_t(nm[k]);
  priceAllModes(c.fee,c.slip);renderSim();}
function priceAllModes(fee,slip){
  S.modes=null;if(!S.simPick){S.sim=null;return;}
  S.modes={};for(const m of Object.keys(S.simPick.modes))S.modes[m]=priceTrades(S.data,S.simPick.modes[m],S.simPick.first,fee,slip);
  S.sim=S.modes.single;}
const MODE_NAME={single:'بيع كامل عند الهدف الأول (30 شمعة)',staged:'بيع ثلث عند كل هدف من الثلاثة (60 شمعة)',trail:'بيع ثلث عند كل هدف + وقف متحرك'};
function renderModes(){
  const M=S.modes,b=$('#btModes');if(!M){b.innerHTML='';$('#btScoreNote').textContent='';$('#btAlignNote').textContent='';return;}
  {const as=alignSplit(M.single.trades),f=g=>g.n?NUM(g.n)+' '+_t('صفقة')+'، '+_t('متوسط العائد')+' '+pctTxt(g.avg,true):_t('لا صفقات');
   $('#btAlignNote').innerHTML=_t('بحسب الاتجاه الأسبوعي عند الدخول: غير هابط')+' — '+f(as.wkOk)+' · '+_t('هابط')+' — '+f(as.wkDown)+'. '+_t('اليومي والأسبوعي معًا صاعدان')+' — '+f(as.up)+'. '
    +((as.wkOk.n<10||as.wkDown.n<10)?_t('العينة صغيرة جدًا للحكم على فائدة التوافق.'):(as.wkOk.avg>as.wkDown.avg?_t('التوافق أفضل في هذا التاريخ.'):_t('التوافق لم يتفوق في هذا التاريخ.')));}
  b.innerHTML=Object.keys(MODE_NAME).map(k=>{const st=M[k].stats;return '<tr><td>'+_t(MODE_NAME[k])+'</td><td>'+NUM(st.n)+'</td><td>'+pctTxt(st.winRate)+'</td><td>'+pctTxt(st.expectancy,true)+'</td><td>'+pctTxt(st.total,true)+'</td><td>'+pctTxt(st.maxDD)+'</td></tr>';}).join('');
  const sp=scoreSplit(M.single.trades,60),f=g=>g.n?NUM(g.n)+' '+_t('صفقة')+'، '+_t('متوسط العائد')+' '+pctTxt(g.avg,true):_t('لا صفقات');
  $('#btScoreNote').innerHTML=_t('بحسب درجة الجودة: صفقات درجتها 60 فأكثر')+' — '+f(sp.hi)+' · '+_t('وصفقات درجتها أقل من 60')+' — '+f(sp.lo)+'. '
    +((sp.hi.n<10||sp.lo.n<10)?_t('العينة صغيرة جدًا للحكم على فائدة الدرجة.'):(sp.hi.avg>sp.lo.avg?_t('الدرجة المرتفعة أفضل في هذا التاريخ.'):_t('الدرجة المرتفعة لم تتفوق في هذا التاريخ.')));}
const DIR_TXT={1:'صاعد',0:'محايد','-1':'هابط'};
function frameBias(k){
  const D=S.daily;if(!D||D.length<80)return null;
  if(k==='D')return tfBias(D,S.tf==='D'&&S.ind?S.ind:computeInd(D));
  if(k==='W'){const w=aggregateWeekly(D);return w.length>=P.ana.maSlow+5?tfBias(w,computeInd(w)):null;}
  const h=S.hourly;return h&&h.length>=P.ana.maSlow+5?tfBias(h,computeInd(h)):null;}
function renderMtf(){
  const box=$('#mtfBox');if(!box)return;
  if(S.isFund||!S.daily||S.daily.length<80||S.ex==='XX'){box.hidden=true;return;}box.hidden=false;
  const fr={W:frameBias('W'),D:frameBias('D'),H:frameBias('H')},NAMES={W:'الأسبوعي (الاتجاه العام)',D:'اليومي (الإعداد)',H:'الساعي (التوقيت)'};
  $('#mtfRows').innerHTML=['W','D','H'].map(k=>{const b=fr[k];
    const t=b?'<span class="mtf-dir '+(b.dir>0?'u':b.dir<0?'d':'n')+'">'+_t(DIR_TXT[b.dir])+'</span> <small>('+NUM(b.score)+' / 4)</small>':'<span class="muted">'+_t(k==='H'&&!S.hourly?'غير محمّل':'بيانات غير كافية')+'</span>';
    return '<div class="mtf-row" title="'+esc(b?b.parts.map(p=>_t(p.k)+': '+(p.v>0?'+':p.v<0?'−':'0')).join(' · '):'')+'"><span>'+_t(NAMES[k])+'</span><span>'+t+'</span></div>';}).join('');
  const v=mtfVerdict(fr);$('#mtfVerdict').innerHTML=_t(v.text)+(v.have.length<3?' ('+_t('اعتمادًا على')+' '+NUM(v.have.length)+' '+_t('أطر')+')':'');
  const hb=$('#mtfHourly');hb.hidden=!!S.hourly||!LOCAL||S.source!=='live';
  const A=S.daily,I=computeInd(A),n=A.length-1,li=[],ax=adxCalc(A,14),ad=ax.adx[n];
  if(ad!=null){const dirTxt=ax.pdi[n]>ax.mdi[n]?_t('صاعد'):_t('هابط');
    li.push('<li><b>ADX</b> '+NUM(ad.toFixed(0))+' — '+_t(ad>=40?'اتجاه قوي جدًا':ad>=25?'اتجاه قوي':ad>=20?'اتجاه يتكوّن':'لا اتجاه واضح (سوق عرضي)')+(ad>=20?' ('+dirTxt+')':'')+'</li>');}
  const ob=obvRead(A,20);
  li.push('<li><b>OBV</b> '+(ob?_t(ob.state==='confirm'?(ob.fd>0?'تدفق الحجم يؤكد الصعود':'تدفق الحجم يؤكد الهبوط'):ob.state==='bear'?'السعر يصعد وتدفق الحجم يخرج (تحذير)':ob.state==='bull'?'السعر يهبط وتدفق الحجم يدخل (إشارة ارتداد محتملة)':ob.state==='flat'?'لا اتجاه واضح في تدفق الحجم':'تدفق الحجم لا يوافق السعر بوضوح'):_t('لا تتوفر بيانات حجم'))+'</li>');
  const dv=rsiDivergence(A,I.rsi);
  li.push('<li><b>'+_t('انحراف القوة النسبية')+'</b> '+(dv?_t(dv.type==='bull'?'انحراف صاعد: قاع أدنى في السعر وقاع أعلى في المؤشر':'انحراف هابط: قمة أعلى في السعر وقمة أدنى في المؤشر')+' · '+_t('قبل')+' '+NUM(dv.ago)+' '+_t('شمعة'):_t('لا يوجد انحراف'))+'</li>');
  const rv=relVol(A,n);
  li.push('<li><b>'+_t('الحجم النسبي')+'</b> '+(rv==null?_t('لا تتوفر بيانات حجم'):NUM(rv.toFixed(1))+'× '+_t('متوسط 20 يومًا')+' — '+_t(rv>=1.5?'نشاط مرتفع':rv<0.7?'نشاط ضعيف':'نشاط عادي'))+'</li>');
  $('#xiList').innerHTML=li.join('');
  $('#xiNote').textContent=_t('مؤشرات على الإطار اليومي للقراءة فقط ولا تدخل في درجة الجودة. الانحراف يُعتمد بعد ثلاث شموع من تكوّن القمة أو القاع، فهو يتأخر عن السعر.');}
function renderQuality(){
  const box=$('#qualBox'),A=S.A;if(!box)return;
  const q=A&&!S.isFund?setupScore(S.data,S.ind,A,S.data.length-1):null;
  if(!q){box.hidden=true;return;}box.hidden=false;
  $('#qualVal').textContent=q.score+' / 100 · '+_t(q.grade==='strong'?'قوي':q.grade==='mid'?'متوسط':'ضعيف');$('#qualBar').style.width=q.score+'%';
  $('#qualParts').innerHTML=q.parts.map(p=>'<li><span>'+p.items.map(t=>esc(_t(t.k))+(t.n!=null?' '+NUM(t.n):'')).join('، ')+'</span><b>'+NUM(p.pts)+' / '+NUM(p.max)+'</b></li>').join('');
  $('#qualNote').textContent=_t('الدرجة تقيّم إعداد الشراء فقط، وكل نقطة فيها مشروحة أعلاه. قيمتها الفعلية تُقاس في جدول الاختبار التاريخي ولا تُفترض.');}
function renderExitPlan(){
  const A=S.A,el=$('#exitPlan');if(!el)return;if(!A||S.isFund){el.innerHTML='';return;}
  const risk=A.entry-A.stop,R=v=>risk>0?' ('+((v-A.entry)/risk).toFixed(1)+'R)':'';
  el.innerHTML='<h4>'+_t('خطة الخروج المجزأ')+'</h4><ol><li>'+_t('عند الهدف الأول')+' '+NUM(fp(A.t1))+R(A.t1)+': '+_t('بع الثلث وانقل الوقف إلى سعر الدخول')+' '+NUM(fp(A.entry))+'.</li>'
    +'<li>'+_t('عند الهدف الثاني')+' '+NUM(fp(A.t2))+R(A.t2)+': '+_t('بع ثلثًا آخر وانقل الوقف إلى الهدف الأول')+'.</li>'
    +'<li>'+_t('عند الهدف الثالث')+' '+NUM(fp(A.t3))+R(A.t3)+': '+_t('بع الباقي')+'.</li></ol>'
    +'<p class="muted small">'+_t('بعد الهدف الأول يمكن استبدال الوقف بوقف متحرك تحت أعلى سعر بمقدار مدى متوسطين. قارن النتائج التاريخية لكل طريقة في بطاقة الاختبار التاريخي.')+'</p>';}
function pctTxt(x,sign){return x==null||!isFinite(x)?'—':NUM((sign&&x>0?'+':'')+(x*100).toFixed(1)+'%');}
function renderSim(){
  const R=S.sim,st=R&&R.stats,w=$('#btWarn'),g=$('#btStats');
  if(!R){w.hidden=true;g.innerHTML='';$('#btEqNote').textContent='';clearSimCanvas();return;}
  if(st.lowSample){w.hidden=false;w.textContent=_t('تحذير: عدد الصفقات')+' '+st.n+' '+_t('أقل من 20، فالنتائج أدناه ضعيفة الدلالة الإحصائية ولا يُعتمد عليها وحدها.');}else w.hidden=true;
  const cell=(l,v)=>'<div><span>'+_t(l)+'</span><b>'+v+'</b></div>';
  g.innerHTML=cell('عدد الصفقات',NUM(st.n))+cell('نسبة النجاح',pctTxt(st.winRate))+cell('متوسط الربح',pctTxt(st.avgWin,true))+cell('متوسط الخسارة',pctTxt(st.avgLoss,true))
    +cell('العائد المتوقع للصفقة',pctTxt(st.expectancy,true))+cell('عامل الربح',st.profitFactor==null?'—':st.profitFactor===Infinity?'∞':NUM(st.profitFactor.toFixed(2)))
    +cell('إجمالي عائد الاستراتيجية',pctTxt(st.total,true))+cell('أقصى تراجع',pctTxt(st.maxDD))
    +cell('عائد الشراء والاحتفاظ',pctTxt(st.bhTotal,true))+cell('أقصى تراجع للاحتفاظ',pctTxt(st.bhDD))
    +cell('نسبة البقاء في السوق',pctTxt(st.exposure))+cell('متوسط مدة الصفقة',st.avgBars==null?'—':NUM(st.avgBars.toFixed(0))+' <small>'+_t('شمعة')+'</small>');
  $('#btEqNote').textContent=_t('الدخول عند افتتاح الشمعة التالية للإشارة، وإذا لمست شمعة واحدة الوقف والهدف يُحتسب الوقف. الأرقام بعد العمولة والانزلاق. منحنى رأس المال يفترض استثمار كامل الرصيد في كل صفقة بالتتابع، وهو لا يضمن المستقبل.')
    +' ('+_t('وقف')+' '+st.byWhy.stop+' · '+_t('هدف')+' '+st.byWhy.target+' · '+_t('انتهاء المدة')+' '+st.byWhy.time+')';
  renderModes();drawSimCanvas();}
function clearSimCanvas(){const cv=$('#btEq');if(cv&&cv.getContext){const x=cv.getContext('2d');x.clearRect(0,0,cv.width,cv.height);}}
function drawSimCanvas(){
  const cv=$('#btEq'),R=S.sim;if(!cv||!R||!cv.getContext)return;const C=colors(),dpr=window.devicePixelRatio||1,W=Math.max(300,cv.clientWidth||600),H=200;
  cv.width=W*dpr;cv.height=H*dpr;const x=cv.getContext('2d');x.setTransform(dpr,0,0,dpr,0,0);x.clearRect(0,0,W,H);
  const all=R.eq.concat(R.bh),lo=Math.min(...all,1),hi=Math.max(...all,1),pad=lo===hi?0.05:(hi-lo)*0.08,mn=lo-pad,mx=hi+pad,L=48,Rm=8,T=8,B=22;
  const X=i=>L+(W-L-Rm)*(i/Math.max(1,R.eq.length-1)),Y=v=>T+(H-T-B)*(1-(v-mn)/(mx-mn));
  x.direction='ltr';x.font='11px '+(FB||'sans-serif');x.fillStyle=C.muted;x.strokeStyle=C.grid;x.lineWidth=1;
  for(const v of ticks(mn,mx,4)){const y=Y(v);x.beginPath();x.moveTo(L,y);x.lineTo(W-Rm,y);x.stroke();x.textAlign='right';x.fillText(((v-1)*100).toFixed(0)+'%',L-4,y+4);}
  x.strokeStyle=C.muted;x.setLineDash([4,3]);x.beginPath();x.moveTo(L,Y(1));x.lineTo(W-Rm,Y(1));x.stroke();x.setLineDash([]);
  const line=(a,col,dash)=>{x.strokeStyle=col;x.lineWidth=2;x.setLineDash(dash||[]);x.beginPath();a.forEach((v,i)=>{i?x.lineTo(X(i),Y(v)):x.moveTo(X(i),Y(v));});x.stroke();x.setLineDash([]);};
  line(R.bh,C.neutral||C.muted,[6,3]);line(R.eq,C.accent||C.buy);
  x.textAlign='left';x.fillStyle=C.accent||C.buy;x.fillText(_t('الاستراتيجية'),L+6,T+12);x.fillStyle=C.muted;x.fillText(_t('الشراء والاحتفاظ'),L+86,T+12);
  const d0=S.data[R.first],d1=S.data[S.data.length-1];x.fillStyle=C.muted;x.textAlign='left';x.fillText(fmtDate.format(d0.t),L,H-6);x.textAlign='right';x.fillText(fmtDate.format(d1.t),W-Rm,H-6);}
function setupSim(){
  const upd=()=>{const k=btKey(),f=+$('#btFee').value,s=+$('#btSlip').value;
    if(!(f>=0&&f<=5&&s>=0&&s<=5))return;P.bt[k]=Object.assign({},P.bt[k],{fee:f,slip:s});savePrefs();
    priceAllModes(f,s);renderSim();};
  $('#btFee').addEventListener('change',upd);$('#btSlip').addEventListener('change',upd);}
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
  if(typeof rkCalcButton==='function')rkCalcButton();
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
    (capped?'<div style="grid-column:1/-1"><span>الكمية محدودة برأس المال المتاح وليس بنسبة المخاطرة.</span></div>':'')+rkCalcHTML(loss);
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
  row.hidden=false;loadNews(seq);$('#cpData').hidden=S.ex==='GOLD';
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
  renderEvents();draw();renderNine();
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
  if(!items.length)items.push('<li class="plain"><p class="empty">لا توجد أحداث قادمة معروفة.</p></li>');
  /* 2.18: the dividends paid, with the total of the last 12 months, in the company card's own tab */
  const all=((S.meta&&S.meta.dividends)||[]).filter(d=>d&&d[1]!=null),yr=all.filter(d=>d[0]>now-365*DAY),tot=yr.reduce((a,d)=>a+d[1],0);
  if(all.length){items.push('<li class="plain"><h3 class="sub-h">التوزيعات السابقة</h3>'+(yr.length?'<p class="small">'+esc(_t('مجموع آخر 12 شهرًا'))+': <b>'+NUM(fp(tot))+'</b> '+esc(_t('للسهم'))+' ('+NUM(yr.length)+' '+esc(_t('توزيع'))+')</p>':'')+'</li>');
    for(const d of all.slice(-10).reverse())items.push('<li><span class="kind s">توزيع</span><span>'+NUM(fp(d[1]))+' للسهم</span>'+'<span class=\"small muted\">'+fmtDate.format(d[0])+'</span>'+'</li>');}
  else if(S.ex!=='GOLD')items.push('<li class="plain"><p class="small muted">لا توجد توزيعات في سجل الأسعار للفترة المختارة.</p></li>');
  $('#eventsList').innerHTML=items.join('');
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
  const seq=++S.loadSeq,t0=performance.now();
  try{
    const rng=$('#rng').value;
    const [j,h]=await Promise.all([api('/api/history',{code,ex,range:rng}),S.tf==='H'?api('/api/history',{code,ex,range:'2y',interval:'60m'}).catch(()=>null):Promise.resolve(null)]);
    if(seq!==S.loadSeq)return;
    if(!j.ok){if(j.notFound&&ex!=='FUND')await runSearch(code,ex,j.error);else setStatus(j.error||'تعذّر جلب البيانات.',true);return;}
    S.isFund=!!j.isFund;S.fundCat=j.category||'';S.fundCmp=null;S.cmpRaw=null;S.cmp=null;S.ai=null;S.fund=undefined;S.fv=null;
    if(S.isFund&&j.rows.length<30){
      S.ex=ex;S.code=String(code);S.name=j.name;S.source='live';S.meta=j;S.fileName='';S.A=null;
      S.daily=j.rows.map(r=>({t:r[0],o:r[4],h:r[4],l:r[4],c:r[4],v:0}));S.hourly=null;
      $('#chartName').textContent=S.name;$('#companyRow').hidden=true;renderFundCard();renderPlan();updateFavBtn();
      setStatus('سجل هذا الصندوق قصير ('+(j.rows.length===1?'سعر واحد':j.rows.length+' سعرًا')+')، فيظهر أداؤه فقط حتى يكتمل السجل.');
      addRecent({ex,code:S.code,name:S.name,short:j.short||''});return;}
    S.ex=ex;S.code=ex==='GOLD'?code:code.toUpperCase();S.name=j.name||j.symbol;S.source='live';S.meta=j;S.fileName='';
    S.daily=rowsToData(j.rows);S.hourly=h&&h.ok?rowsToData(h.rows):null;S.calcAuto=true;
    await loadDrawings();
    const t1=performance.now();applyTF();if(typeof perfNote==='function')perfNote(code,ex,t1-t0,performance.now()-t0);
    setStatus('تم جلب '+S.daily.length+(S.isFund?' سعرًا للصندوق من ':' يوم تداول من ')+j.source+(j.live||j.source==='TradingView'?'، وآخر سعر من جلسة '+fmtDate.format(S.daily[S.daily.length-1].t)+' ('+priceQual(j)+(marketOpen(ex)?' ويتحدث تلقائيًا كل دقيقتين':'')+').':'، وآخر إغلاق بتاريخ '+fmtDate.format(S.daily[S.daily.length-1].t)+'.')+(j.note?' '+j.note:''),!!j.offline);
    addRecent({ex,code:S.code,name:S.name,short:j.short||''});
    loadFundamentals(seq);
    loadProfile(seq);loadCompanyFile(seq);if(S.isFund)loadFundCompare(seq);else loadCompare(seq);loadGoldExtras(seq);
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
function useStatic(D,meta){S.fund=undefined;S.fv=null;S.ai=null;
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
  try{const sv=P.advShow||{};for(const k of Object.keys(sv))if(k in S.show)S.show[k]=!!sv[k];}catch(e){}
  $$('[data-show]').forEach(c=>{c.checked=!!S.show[c.dataset.show];c.addEventListener('change',()=>{S.show[c.dataset.show]=c.checked;
    if(c.closest('#advDD')){P.advShow=P.advShow||{};P.advShow[c.dataset.show]=c.checked;savePrefs();updateAdvLabel();}draw();});});
  const fm=$('#advFibMode');if(fm){fm.value=(P.adv&&P.adv.fibMode)||'365';fm.addEventListener('change',()=>{P.adv=Object.assign({},P.adv||{},{fibMode:fm.value});savePrefs();draw();});}
  $('#advDD').addEventListener('click',e=>{const b=e.target.closest('[data-adv]');if(!b)return;const on=b.dataset.adv==='all';
    $$('#advDD [data-show]').forEach(c=>{c.checked=on&&!['zz','nw','ichi'].includes(c.dataset.show);S.show[c.dataset.show]=c.checked;P.advShow=P.advShow||{};P.advShow[c.dataset.show]=c.checked;});savePrefs();updateAdvLabel();draw();});
  updateAdvLabel();
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

function updateAdvLabel(){const n=$$('#advDD [data-show]').filter(c=>c.checked).length;$('#advLbl').textContent=_t('أدوات متقدمة')+(n?' ('+n+')':'');}
