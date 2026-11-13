/* ---------- price plan (stop, entry, three targets), fair value and Claude's opinion ---------- */
const REC_WORD=m=>m==null?'':m<1.5?'شراء قوي':m<2.5?'شراء':m<3.5?'محايد':m<4.5?'بيع':'بيع قوي';

/* fair value from the company's own figures; every method is listed so the user can see where the number comes from */
function fairValue(r){
  if(!r||!r.ok||!r.f)return null;const F=r.f,px=F.close;if(!px)return null;
  const pe=F.price_earnings_ttm,pb=F.price_book_fq;
  /* derive per-share figures from TradingView's own ratios so they are in the trading currency */
  const eps=pe>0?px/pe:null,bvps=pb>0?px/pb:null,fin=F.sector==='Finance',sane=v=>v&&isFinite(v)&&v>px*0.2&&v<px*5;
  const m=[];
  if(sane(F.price_target_average))m.push({k:'an',name:'متوسط أسعار المحللين المستهدفة (12 شهرًا)',v:F.price_target_average,
    note:(F.price_target_low&&F.price_target_high?'أدنى تقدير '+fp(F.price_target_low)+' وأعلاه '+fp(F.price_target_high):'')+(F.recommendation_mark?' · توصية المحللين: '+REC_WORD(F.recommendation_mark):''),use:true});
  if(eps&&r.sectorPE&&(r.sectorN||0)>=5){const v=eps*r.sectorPE;if(sane(v))m.push({k:'pe',name:'مكرر ربحية القطاع',v,
    note:'ربحية السهم '+fp(eps)+' × متوسط مكرر قطاع '+(r.sectorAr||'')+' '+r.sectorPE.toFixed(1)+' (مكرر السهم '+pe.toFixed(1)+')',use:true});}
  if(fin&&bvps&&r.sectorPB&&(r.sectorN||0)>=5){const v=bvps*r.sectorPB;if(sane(v))m.push({k:'pb',name:'مضاعف القيمة الدفترية للقطاع',v,
    note:'القيمة الدفترية للسهم '+fp(bvps)+' × متوسط القطاع '+r.sectorPB.toFixed(2)+' — الطريقة الأنسب للبنوك',use:true});}
  if(eps&&bvps){const v=Math.sqrt(22.5*eps*bvps);if(v&&isFinite(v))m.push({k:'gr',name:'معادلة جراهام (تقدير متحفظ)',v,
    note:'الجذر التربيعي لـ 22.5 × الربحية × القيمة الدفترية'+(pb>6?' — لا تُحتسب هنا لأن السعر يزيد كثيرًا عن القيمة الدفترية':''),use:pb<=6}); }
  /* the analysts' average counts twice: it already folds in growth, guidance and news that ratios can't see */
  const used=m.filter(x=>x.use).flatMap(x=>x.k==='an'?[x.v,x.v]:[x.v]).sort((a,b)=>a-b);
  if(!used.length)return{methods:m,fair:null,loss:!(pe>0)&&F.net_income_ttm!=null&&F.net_income_ttm<0,r};
  const mid=used.length>>1,fair=used.length%2?used[mid]:(used[mid-1]+used[mid])/2;
  return{methods:m,fair,lo:used[0],hi:used[used.length-1],r,eps,bvps,pe,pb,anW:m.some(x=>x.k==='an')};
}

function renderFair(){
  const box=$('#fairBox');if(!box)return;const f=S.fund,A=S.A;
  if(!LOCAL||S.ex==='GOLD'||S.ex==='FUND'||S.ex==='XX'||S.isFund||S.source!=='live'){box.innerHTML='<b>السعر العادل</b><p class="muted small">'+
    (S.ex==='GOLD'?'الذهب سلعة لا أرباح لها، فلا يُحسب له سعر عادل؛ استخدم الأهداف الفنية.':S.isFund?'سعر الصندوق هو قيمة أصوله الصافية، فهو سعره العادل.':!LOCAL?'يُحسب السعر العادل في نسخة البرنامج المثبتة.':'يتوفر للأسهم السعودية والمصرية والأمريكية.')+'</p>';return;}
  if(f===undefined||f==='loading'){box.innerHTML='<b>السعر العادل</b><p class="muted small">جارٍ جلب بيانات الشركة المالية…</p>';return;}
  const fv=S.fv;
  if(!fv){box.innerHTML='<b>السعر العادل</b><p class="muted small">لا تتوفر بيانات مالية كافية لهذه الشركة.</p>';return;}
  const F=fv.r.f,px=A?A.close:F.close;
  let h='<div class="fv-top"><b>السعر العادل</b>';
  if(fv.fair){const d=px/fv.fair-1,k=d<-0.1?'b':d>0.1?'x':'n';
    h+='<span class="fv-v">'+NUM(fp(fv.fair))+'</span><span class="fv-verdict '+k+'">'+(k==='b'?'السهم أقل من قيمته العادلة بـ '+NUM(((1-px/fv.fair)*100).toFixed(1)+'%')+' (مساحة صعود '+NUM(pct(fv.fair/px-1))+')':
      k==='x'?'السهم أعلى من قيمته العادلة بـ '+NUM((d*100).toFixed(1)+'%'):'السعر قريب من قيمته العادلة')+'</span></div>'+
      (fv.lo!==fv.hi?'<p class="muted small">نطاق التقديرات من '+RANGE(fv.lo,fv.hi)+(fv.anW?'، والسعر العادل هو الوسيط بينها (متوسط المحللين بوزن مضاعف).</p>':'، والسعر العادل هو الوسيط بينها.</p>'):'');}
  else h+='</div><p class="muted small">'+(fv.loss?'الشركة خاسرة في آخر 12 شهرًا، فلا يصلح تقييمها بالأرباح.':'لا تكفي البيانات لحساب سعر عادل موثوق.')+'</p>';
  h+='<ul>'+fv.methods.map(x=>'<li class="'+(x.use?'':'off')+'"><span>'+esc(x.name)+'</span><b>'+NUM(fp(x.v))+'</b><span class="n">'+x.note+'</span></li>').join('')+'</ul>';
  const fx=[];if(fv.pe)fx.push('مكرر الربحية <b>'+NUM(fv.pe.toFixed(1))+'</b>');if(fv.r.sectorPE)fx.push('مكرر القطاع <b>'+NUM(fv.r.sectorPE.toFixed(1))+'</b>');
  if(fv.pb)fx.push('السعر إلى القيمة الدفترية <b>'+NUM(fv.pb.toFixed(2))+'</b>');if(F.dividends_yield_current)fx.push('عائد التوزيعات <b>'+NUM(F.dividends_yield_current.toFixed(2)+'%')+'</b>');
  if(F.return_on_equity_fq!=null)fx.push('العائد على حقوق المساهمين <b>'+NUM(F.return_on_equity_fq.toFixed(1)+'%')+'</b>');
  h+='<div class="facts">'+fx.map(x=>'<span>'+x+'</span>').join('')+'</div><p class="muted small">المصدر: TradingView · '+NUM(esc(fv.r.date||''))+'. السعر العادل تقدير تقريبي وليس ضمانًا.</p>';
  box.innerHTML=h;
}

function renderPlan(){
  const card=$('#planCard');const A=S.A;if(!card)return;card.hidden=!A;if(!A)return;
  const px=A.close,risk=A.entry-A.stop,R=v=>risk>0?((v-A.entry)/risk).toFixed(1)+'R':'';
  const src={r:'منطقة مقاومة',hi:'أعلى سعر في الفترة',atr:'تقدير من متوسط المدى'};
  const cell=(cls,k,v,note)=>'<div class="lad '+cls+'"><span class="k">'+k+'</span><span class="v">'+NUM(fp(v))+'</span><span class="p">'+(cls==='cur'?'&nbsp;':chgSpan(v/px-1,1))+'</span><span class="n">'+(note||'&nbsp;')+'</span></div>';
  $('#ladder').innerHTML=cell('stop','وقف الخسارة',A.stop,'اخرج إذا أغلق السعر تحته')+cell('','سعر الدخول',A.entry,A.buy&&A.buy.inside?'السعر داخل منطقة الشراء':A.entry<px*0.97?'انتظر نزول السعر إلى منطقة الشراء':'داخل منطقة الشراء')+
    cell('cur','السعر الحالي',px,'')+cell('tg','الهدف الأول',A.t1,src[A.tSrc[0]]+(risk>0?' · '+R(A.t1):''))+
    cell('tg','الهدف الثاني',A.t2,src[A.tSrc[1]]+(risk>0?' · '+R(A.t2):''))+cell('tg','الهدف الثالث',A.t3,src[A.tSrc[2]]+(risk>0?' · '+R(A.t3):''));
  /* a scale from the stop to the third target with the price and the fair value marked */
  const lo=Math.min(A.stop,px),hi=Math.max(A.t3,px),span=hi-lo||1,pos=v=>((v-lo)/span*100).toFixed(2)+'%';
  const fair=S.fv&&S.fv.fair&&S.fv.fair>=lo&&S.fv.fair<=hi?S.fv.fair:null;  /* only when it falls on the scale */
  const side=document.documentElement.dir==='ltr'?'left':'right';
  const mk=(v,cls,lab)=>'<i class="'+cls+'" style="'+side+':'+pos(v)+'"></i>'+(lab?'<span style="'+side+':'+pos(v)+'">'+lab+'</span>':'');
  $('#planScale').innerHTML='<div class="pl-bar"></div>'+mk(A.stop,'','الوقف')+mk(A.t1,'','ه1')+mk(A.t2,'','ه2')+mk(A.t3,'','ه3')+(fair?mk(fair,'fv','العادل'):'')+mk(px,'cur','');
  $('#planNote').textContent=S.tf==='W'?'على الإطار الأسبوعي':S.tf==='H'?'على إطار الساعة':'على الإطار اليومي';
  renderFair();renderAiBox();
}

async function loadFundamentals(seq){
  S.fund=undefined;S.fv=null;
  if(!LOCAL||!['SR','CA','US'].includes(S.ex)||S.isFund)return;
  S.fund='loading';renderFair();
  const r=await api('/api/fundamentals',{code:S.code,ex:S.ex}).catch(()=>null);if(seq!==S.loadSeq)return;
  S.fund=r&&r.ok?r:null;S.fv=fairValue(S.fund);renderPlan();draw();
}

/* ---------- Claude ---------- */
const AI={status:null};
async function loadClaudeStatus(){if(!LOCAL)return null;AI.status=await api('/api/claude').catch(()=>null);return AI.status;}
function renderAiBox(){
  if(!LOCAL)return;const has=AI.status&&AI.status.hasKey;
  $('#aiSetup').hidden=!!has;$('#aiControls').hidden=!has;
  const c=S.ai&&S.ai.code===S.code&&S.ai.ex===S.ex?S.ai:null,out=$('#aiOut');
  if(!c){out.hidden=true;$('#aiMeta').textContent=has?(P.claude.model||AI.status.defaultModel):'';return;}
  out.hidden=false;
  if(c.busy){out.innerHTML='<p class="muted">Claude يقرأ بيانات السهم'+($('#aiWeb').checked?' ويبحث في الأخبار':'')+'… قد يستغرق ذلك نصف دقيقة.</p>';return;}
  if(!c.ok){out.innerHTML='<p class="err">'+esc(c.error)+'</p>';return;}
  out.innerHTML=mdLite(c.text);
  $('#aiMeta').innerHTML=esc(c.model)+(c.searches?' · '+NUM(c.searches)+' بحث':'')+(c.noWeb?' · بدون بحث (غير مفعّل في حسابك)':'')+' · '+NUM(esc(c.at));
}
/* small, safe markdown: ## headings, - bullets, **bold** */
function mdLite(t){
  const lines=String(t||'').split('\n');let h='',inUl=false;
  const inl=s=>esc(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>');
  for(let ln of lines){ln=ln.trimEnd();
    const li=/^\s*[-•*]\s+(.*)/.exec(ln);
    if(li){if(!inUl){h+='<ul>';inUl=true;}h+='<li>'+inl(li[1])+'</li>';continue;}
    if(inUl){h+='</ul>';inUl=false;}
    const hd=/^#{1,4}\s*(.*)/.exec(ln);
    if(hd)h+='<h4>'+inl(hd[1])+'</h4>';else if(ln.trim())h+='<p>'+inl(ln)+'</p>';}
  return h+(inUl?'</ul>':'');
}
function aiPayload(){
  const A=S.A,D=S.data,N=D.length,I=S.ind,f=S.fund&&S.fund.f,fv=S.fv,r=v=>v==null||!isFinite(v)?null:+(+v).toPrecision(6);
  const sh=S.ex!=='GOLD'?shariaInfo(S.code,S.ex):null;
  const last=D.slice(-60).map(d=>[new Date(d.t).toISOString().slice(0,10),r(d.c)]);
  return{symbol:S.code,name:S.name,market:{SR:'Saudi Exchange (Tadawul)',CA:'Egyptian Exchange (EGX)',US:'US market',GOLD:'Gold',XX:'Other'}[S.ex]||S.ex,
    currency:S.meta&&S.meta.currency||null,timeframe:S.tf,lastDate:new Date(D[N-1].t).toISOString().slice(0,10),price:r(A.close),
    machineVerdict:A.stance,confidence:(blendConfidence(A,S.bt)||{}).conf||null,reasons:A.reasons.map(x=>x[1].replace(/<[^>]+>/g,'')),
    zones:A.zones.map(z=>({type:z.kind==='s'?'support':'resistance',lo:r(z.lo),hi:r(z.hi),touches:z.touches,weekly:!!z.htf})),
    plan:{entry:r(A.entry),stop:r(A.stop),target1:r(A.t1),target2:r(A.t2),target3:r(A.t3),riskReward1:A.rr!=null?+A.rr.toFixed(2):null},
    indicators:{rsi:r(A.rsi),trend:A.trend,macdHist:r(I.macdHist[N-1]),ma1:r(I.ma1[N-1]),ma2:r(I.ma2[N-1]),atr:r(A.atrv),
      periodReturn:A.perf?r(A.perf.ret):null,periodHigh:A.perf?r(A.perf.hi):null,periodLow:A.perf?r(A.perf.lo):null},
    patterns:(A.pats||[]).map(p=>({name:p.name,confirmed:p.confirmed,target:r(p.target)})),
    backtest:S.bt?Object.fromEntries(Object.entries(S.bt).filter(([k,v])=>v&&v.n>0).map(([k,v])=>[k,{signals:v.n,winRate:+(v.w/v.n).toFixed(2)}])):null,
    fundamentals:f?{pe:r(f.price_earnings_ttm),sectorPE:r(S.fund.sectorPE),pb:r(f.price_book_fq),dividendYield:r(f.dividends_yield_current),roe:r(f.return_on_equity_fq),
      epsNextYearForecast:r(f.earnings_per_share_forecast_next_fy),analystTarget:{avg:r(f.price_target_average),low:r(f.price_target_low),high:r(f.price_target_high)},
      analystRating:f.recommendation_mark?REC_WORD(f.recommendation_mark):null,sector:f.sector,marketCap:r(f.market_cap_basic)}:null,
    fairValue:fv&&fv.fair?{value:r(fv.fair),methods:fv.methods.map(m=>({method:m.k,value:r(m.v),used:m.use}))}:null,
    sharia:sh?{verdict:sh.s,count:sh.count||null,references:(sh.refs||[]).map(x=>x[0]+': '+x[1])}:null,
    last60Closes:last};
}
async function runClaude(){
  if(!S.A)return;const code=S.code,ex=S.ex;S.ai={code,ex,busy:true};renderAiBox();$('#aiRun').disabled=true;
  try{const r=await apiPost('/api/claude',{action:'analyze',payload:aiPayload(),model:P.claude.model||'',web:$('#aiWeb').checked,lang:LANG==='en'?'en':'ar',question:$('#aiQ').value});
    if(S.code!==code||S.ex!==ex)return;
    S.ai=Object.assign({code,ex,at:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})},r||{ok:false,error:'لا يوجد رد.'});}
  catch(e){S.ai={code,ex,ok:false,error:'تعذّر الاتصال بالبرنامج.'};}
  finally{$('#aiRun').disabled=false;renderAiBox();}
}
function setupPlan(){
  if(!LOCAL)return;
  setupClaudePrefs();
  $('#aiRun').addEventListener('click',runClaude);
  $('#aiQ').addEventListener('keydown',e=>{if(e.key==='Enter')runClaude();});
  $('#aiGoSettings').addEventListener('click',e=>{e.preventDefault();location.hash='#prefs';setTimeout(()=>{const el=$('#claudePanel');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},60);});
  try{$('#aiWeb').checked=P.claude.web!==false;}catch(e){}
  $('#aiWeb').addEventListener('change',()=>{P.claude.web=$('#aiWeb').checked;savePrefs();});
  loadClaudeStatus().then(()=>{renderAiBox();renderClaudeState();});
}

/* settings panel */
function renderClaudeState(){
  const st=AI.status,dot=$('#clDot'),tx=$('#clState');if(!dot)return;
  if(!st){dot.className='tv-dot warn';tx.textContent='تعذّر قراءة حالة الربط.';return;}
  dot.className='tv-dot'+(st.hasKey?' ok':'');
  tx.innerHTML=st.hasKey?'مربوط بمفتاح ينتهي بـ <bdi>'+esc(st.hint)+'</bdi>'+(st.storage==='dpapi'?' · محفوظ بتشفير ويندوز':st.storage==='keychain'?' · محفوظ في سلسلة مفاتيح ماك':''):'غير مربوط';
  $('#clTest').hidden=!st.hasKey;$('#clDelete').hidden=!st.hasKey;$('#clSave').textContent=st.hasKey?'استبدال المفتاح':'حفظ المفتاح واختبار الاتصال';
}
function setupClaudePrefs(){
  const status=(t,bad)=>{const el=$('#clStatus');el.textContent=t;el.className='status'+(bad?' err':'');};
  $('#clWebPref').value=P.claude.web===false?'0':'1';
  $('#clWebPref').addEventListener('change',()=>{P.claude.web=$('#clWebPref').value==='1';$('#aiWeb').checked=P.claude.web;savePrefs();});
  $('#clModel').addEventListener('change',()=>renderAiBox());
  $('#clSave').addEventListener('click',async()=>{const key=$('#clKey').value.trim();if(!key){status('الصق المفتاح أولًا.',true);$('#clKey').focus();return;}
    status('جارٍ اختبار المفتاح…');const t=await apiPost('/api/claude',{action:'test',key,model:P.claude.model}).catch(()=>null);
    if(!t||!t.ok){status((t&&t.error)||'تعذّر الاتصال.',true);return;}
    const r=await apiPost('/api/claude',{action:'save',key}).catch(()=>null);
    if(!r||!r.ok){status((r&&r.error)||'تعذّر حفظ المفتاح.',true);return;}
    $('#clKey').value='';AI.status=r;renderClaudeState();renderAiBox();status(t.text);});
  $('#clTest').addEventListener('click',async()=>{status('جارٍ الاختبار…');const t=await apiPost('/api/claude',{action:'test',model:P.claude.model}).catch(()=>null);status(t&&t.ok?t.text:(t&&t.error)||'تعذّر الاتصال.',!(t&&t.ok));});
  $('#clDelete').addEventListener('click',async()=>{const r=await apiPost('/api/claude',{action:'delete'}).catch(()=>null);if(r){AI.status=r;renderClaudeState();renderAiBox();status('حُذف المفتاح من جهازك.');}});
  $$('a.ext').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();api('/api/open',{url:a.href}).catch(()=>{});}));
}
