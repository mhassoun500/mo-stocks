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

/* funds: no targets or stop (one price a day, bought at NAV); show performance instead */
function fundSummary(){
  if(!S.isFund||!S.daily||!S.daily.length||typeof fundStats!=='function')return null;
  return fundStats(S.daily.map(d=>[d.t,d.c,d.c,d.c,d.c,0]));
}
function renderFundPlan(){
  $('#planTitle').textContent=_t('أداء الصندوق ورأي الذكاء الاصطناعي');$('#planNote').textContent='';
  const st=fundSummary()||{n:0},D=S.daily||[],px=D.length?D[D.length-1].c:null,j=S.meta||{};
  const cell=(k,v,note,cls)=>'<div class="lad '+(cls||'')+'"><span class="k">'+k+'</span><span class="v">'+v+'</span><span class="p">&nbsp;</span><span class="n">'+(note||'&nbsp;')+'</span></div>';
  const rv=x=>x==null?'—':chgSpan(x,1);
  $('#ladder').innerHTML=cell('سعر الوحدة',NUM(fp(px)),esc(j.currency||''),'cur')+cell('شهر',rv(st.r1m))+cell('3 أشهر',rv(st.r3m))+cell('سنة',rv(st.r1y))+
    cell('أقصى تراجع خلال سنة',st.dd==null?'—':NUM(pct(st.dd)),'','stop')+cell('التذبذب السنوي',st.vol==null?'—':NUM((st.vol*100).toFixed(1)+'%'),st.vol==null?'':st.vol<0.05?'منخفض':st.vol<0.15?'متوسط':'مرتفع');
  $('#planScale').innerHTML='';$('#planScale').hidden=true;$('#planEdu').hidden=true;
  $('#fairBox').innerHTML='<b>'+_t('القيمة العادلة')+'</b><p class="muted small">'+_t('سعر الصندوق هو قيمة أصوله الصافية، فهو سعره العادل. لا توجد أهداف بيع ولا وقف خسارة للصناديق؛ قارن أداءها وتذبذبها بصناديق مشابهة.')+'</p>';
  renderAiBox();
}
function renderPlan(){
  const card=$('#planCard');const A=S.A;if(!card)return;
  if(S.isFund&&S.source==='live'&&S.daily&&S.daily.length){card.hidden=false;renderFundPlan();return;}
  $('#planTitle').textContent=_t('خطة السعر والقيمة العادلة');$('#planScale').hidden=false;$('#planEdu').hidden=false;
  card.hidden=!A;if(!A){S.ai=null;return;}
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

/* ---------- AI assistants: direct link by API key, or a prompt to paste into any chat ---------- */
const AI_SITES=[['Claude','https://claude.ai/new'],['ChatGPT','https://chatgpt.com/'],['Gemini','https://gemini.google.com/app'],['Grok','https://grok.com/'],
  ['DeepSeek','https://chat.deepseek.com/'],['Copilot','https://copilot.microsoft.com/'],['Perplexity','https://www.perplexity.ai/']];
const AI={status:null};
const AI_SYS_AR=`أنت محلل أسهم خبير. تصلك بيانات سهم واحد محسوبة آليًا من برنامج «Mo Stocks»: السعر، مناطق الدعم والمقاومة، خطة التداول (الدخول والوقف والأهداف الثلاثة)، المؤشرات الفنية، النماذج، بيانات الشركة المالية، تقديرات السعر العادل، وحكم التوافق الشرعي.
المطلوب: رأي ثانٍ مستقل ومختصر بالعربية الفصحى البسيطة، مرتب بهذه العناوين بالضبط (كل عنوان في سطر يبدأ بـ ## ):
## الخلاصة
جملتان: الوضع الآن، وما الأنسب لمن لا يملك السهم ولمن يملكه.
## الوضع الفني
## القيمة والأساسيات
## خطة التداول
اذكر الدخول والوقف والأهداف الثلاثة بالأرقام، وعدّلها إن رأيت أن الحساب الآلي أخطأ مع ذكر السبب.
## المخاطر
## ما يجب مراقبته
قواعد: اعتمد على الأرقام المرسلة ولا تخترع أرقامًا. إذا بحثت في الإنترنت فاذكر الخبر وتاريخه باختصار. استخدم نقاطًا قصيرة تبدأ بـ - . لا تزد عن 400 كلمة.
اختم بسطر واحد: «هذا رأي تحليلي وليس توصية استثمارية.»`;
const AI_SYS_EN=`You are an expert equity analyst. You receive machine-computed data for one stock from the "Mo Stocks" app: price, support/resistance zones, the trading plan (entry, stop and three targets), technical indicators, chart patterns, company financials, fair-value estimates and the Sharia-compliance verdict.
Give an independent, concise second opinion in plain English under exactly these headings (each on its own line starting with ## ):
## Summary
Two sentences: where it stands now, and what suits someone who doesn't own it and someone who does.
## Technical picture
## Value and fundamentals
## Trading plan
Give entry, stop and the three targets as numbers; adjust them if you think the machine got them wrong, and say why.
## Risks
## What to watch
Rules: rely on the numbers given and never invent figures. If you search the web, cite the news item and its date briefly. Use short bullets starting with - . At most 400 words.
End with one line: "This is analysis, not investment advice."`;
const AI_FUND_AR=`أنت مستشار استثمار خبير. تصلك بيانات صندوق استثمار واحد من برنامج «Mo Stocks»: سعر الوحدة، العوائد على فترات مختلفة، أقصى تراجع، التذبذب، الفئة، المدير، والتوافق الشرعي. الصناديق تُشترى وتُسترد بسعر الوحدة، فلا توجد أهداف بيع ولا وقف خسارة.
المطلوب رأي مختصر بالعربية البسيطة بهذه العناوين بالضبط (كل عنوان في سطر يبدأ بـ ## ):
## الخلاصة
## الأداء
## المخاطر والتذبذب
## لمن يناسب
## ما يجب مراقبته
قواعد: اعتمد على الأرقام المرسلة ولا تخترع أرقامًا. قارن بالصناديق المشابهة أو بالسوق إن عرفت. نقاط قصيرة تبدأ بـ - . لا تزد عن 350 كلمة.
اختم بسطر: «هذا رأي تحليلي وليس توصية استثمارية.»`;
const AI_FUND_EN=`You are an expert investment adviser. You receive data for one mutual fund from the "Mo Stocks" app: unit price, returns over several periods, maximum drawdown, volatility, category, manager and Sharia compliance. Funds are bought and redeemed at the unit price, so there are no sell targets or stop-loss.
Give a short opinion in plain English under exactly these headings (each on its own line starting with ## ):
## Summary
## Performance
## Risk and volatility
## Who it suits
## What to watch
Rules: rely on the numbers given and never invent figures. Compare with similar funds or the market if you know them. Short bullets starting with - . At most 350 words.
End with one line: "This is analysis, not investment advice."`;
function buildPrompt(forChat){
  if(S.isFund){const en=LANG==='en',q=($('#aiQ').value||'').trim();
    let user=(en?'Analyse this fund. Data from the app (JSON):\n':'حلّل هذا الصندوق. بيانات البرنامج (JSON):\n')+JSON.stringify(aiPayloadFund());
    if(forChat||$('#aiWeb').checked)user+=en?'\n\nSearch the web for recent news about this fund and its manager before you answer.':'\n\nابحث في الإنترنت عن آخر أخبار هذا الصندوق ومديره قبل أن تجيب.';
    if(q)user+=(en?'\n\nThe user also asks: ':'\n\nويسأل المستخدم أيضًا: ')+q;
    return{system:en?AI_FUND_EN:AI_FUND_AR,user};}
  const en=LANG==='en',q=($('#aiQ')&&$('#aiQ').value||'').trim(),web=forChat||$('#aiWeb').checked;
  let user=(en?'Analyse this stock. Data from the app (JSON):\n':'حلّل هذا السهم. بيانات البرنامج (JSON):\n')+JSON.stringify(aiPayload());
  if(web)user+=en?'\n\nSearch the web for the latest news, results and analyst views on this company before you answer.':'\n\nابحث في الإنترنت عن آخر أخبار الشركة ونتائجها وآراء المحللين قبل أن تجيب.';
  if(q)user+=(en?'\n\nThe user also asks: ':'\n\nويسأل المستخدم أيضًا: ')+q;
  return{system:en?AI_SYS_EN:AI_SYS_AR,user};
}
function promptText(){const p=buildPrompt(true);return p.system+'\n\n---\n\n'+p.user;}
async function copyText(t){
  try{await navigator.clipboard.writeText(t);return true;}catch(e){}
  try{const ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();const ok=document.execCommand('copy');ta.remove();return ok;}catch(e){return false;}
}
const aiConnected=()=>AI.status?Object.entries(AI.status.providers).filter(([k,v])=>v.hasKey):[];
async function loadAiStatus(){if(!LOCAL)return null;AI.status=await api('/api/ai').catch(()=>null);return AI.status;}
function renderAiBox(){
  const conn=aiConnected(),c=S.ai&&S.ai.code===S.code&&S.ai.ex===S.ex?S.ai:null,out=$('#aiOut');
  if(LOCAL){$('#aiSetup').hidden=conn.length>0;$('#aiControls').hidden=!conn.length;
    const sel=$('#aiProv'),cur=conn.some(([k])=>k===P.ai.provider)?P.ai.provider:(conn[0]||[''])[0];
    sel.innerHTML=conn.map(([k,v])=>'<option value="'+k+'"'+(k===cur?' selected':'')+'>'+esc(v.name)+'</option>').join('');
    const pv=conn.find(([k])=>k===cur);const canWeb=!!(pv&&pv[1].web);$('#aiWeb').disabled=!canWeb;$('#aiWebLbl').title=canWeb?'':_t('البحث في الأخبار متاح مع Claude وGemini فقط');}
  if(!c){out.hidden=true;$('#aiMeta').textContent='';return;}
  out.hidden=false;
  if(c.busy){out.innerHTML='<p class="muted">'+esc(c.name||'')+' '+_t('يقرأ بيانات السهم… قد يستغرق ذلك نصف دقيقة.')+'</p>';return;}
  if(!c.ok){out.innerHTML='<p class="err">'+esc(c.error)+'</p>';return;}
  out.innerHTML=mdLite(c.text||_t('لا يوجد رد.'));
  $('#aiMeta').innerHTML='<bdi>'+esc(c.name)+' · '+esc(c.model||'')+'</bdi>'+(c.searches?' · '+NUM(c.searches)+' بحث':'')+(c.noWeb?' · بدون بحث (غير مفعّل في حسابك)':'')+' · '+NUM(esc(c.at));
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
function aiPayloadFund(){
  const j=S.meta||{},st=fundSummary()||{},D=S.daily||[],r=v=>v==null||!isFinite(v)?null:+(+v).toPrecision(6);
  return{type:'mutual fund',name:S.name,fundId:S.code,country:j.country||null,manager:j.manager||null,category:(typeof FCAT!=='undefined'&&FCAT[S.fundCat])||S.fundCat,currency:j.currency||null,
    shariaCompliant:!!j.sharia,unitPrice:D.length?r(D[D.length-1].c):null,lastDate:D.length?new Date(D[D.length-1].t).toISOString().slice(0,10):null,ytd:j.ytd||null,
    returns:{w1:r(st.r1w),m1:r(st.r1m),m3:r(st.r3m),m6:r(st.r6m),y1:r(st.r1y),y3Annual:r(st.r3y),sinceStartAnnual:r(st.since)},maxDrawdown1y:r(st.dd),volatility1y:r(st.vol),
    comparison:S.fundCmp||null,history:D.length,last60Prices:D.slice(-60).map(d=>[new Date(d.t).toISOString().slice(0,10),r(d.c)])};
}
function aiPayload(){
  if(S.isFund)return aiPayloadFund();
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
async function runAi(){
  if(!S.A&&!S.isFund)return;const prov=$('#aiProv').value;if(!prov)return;const st=AI.status.providers[prov];
  const code=S.code,ex=S.ex,pr=buildPrompt(false);S.ai={code,ex,busy:true,name:st.name};renderAiBox();$('#aiRun').disabled=true;
  try{const r=await apiPost('/api/ai',{action:'ask',provider:prov,model:(P.ai.models||{})[prov]||'',base:prov==='custom'?P.ai.base:'',web:$('#aiWeb').checked&&st.web,system:pr.system,user:pr.user});
    if(S.code!==code||S.ex!==ex)return;
    S.ai=Object.assign({code,ex,name:st.name,at:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})},r||{ok:false,error:'لا يوجد رد.'});}
  catch(e){S.ai={code,ex,ok:false,error:'تعذّر الاتصال بالبرنامج.'};}
  finally{$('#aiRun').disabled=false;renderAiBox();}
}
function openExt(url){if(LOCAL)api('/api/open',{url}).catch(()=>{});else{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();a.remove();}}
function setupPlan(){
  /* copy-a-prompt works everywhere, even without the installed app */
  $('#aiSites').innerHTML=AI_SITES.map(([n,u])=>'<a class="btn xs ghost" href="'+u+'" target="_blank" rel="noopener" data-site="'+n+'"><bdi>'+n+'</bdi></a>').join('');
  const flash=t=>{const el=$('#aiCopyNote');el.textContent=t;el.hidden=false;clearTimeout(flash.t);flash.t=setTimeout(()=>{el.hidden=true;},6000);};
  $('#aiCopy').addEventListener('click',async()=>{if(!S.A&&!S.isFund)return;const t=promptText();$('#aiPrompt').value=t;flash(await copyText(t)?_t('نُسخ البرومبت. افتح موقع المساعد والصقه (Ctrl+V).'):_t('تعذّر النسخ التلقائي؛ افتح «عرض البرومبت» وانسخه يدويًا.'));});
  $('#aiSites').addEventListener('click',async e=>{const a=e.target.closest('a[data-site]');if(!a||(!S.A&&!S.isFund))return;e.preventDefault();const t=promptText();$('#aiPrompt').value=t;
    const ok=await copyText(t);openExt(a.href);flash(ok?_t('نُسخ البرومبت. الصقه في صفحة المساعد التي فُتحت (Ctrl+V).'):_t('تعذّر النسخ التلقائي؛ افتح «عرض البرومبت» وانسخه يدويًا.'));});
  $('#aiShow').addEventListener('toggle',()=>{if($('#aiShow').open&&(S.A||S.isFund))$('#aiPrompt').value=promptText();});
  if(!LOCAL)return;
  setupAiPrefs();
  $('#aiRun').addEventListener('click',runAi);
  $('#aiQ').addEventListener('keydown',e=>{if(e.key==='Enter'&&!$('#aiControls').hidden)runAi();});
  $('#aiProv').addEventListener('change',()=>{P.ai.provider=$('#aiProv').value;savePrefs();renderAiBox();});
  $('#aiGoSettings').addEventListener('click',e=>{e.preventDefault();location.hash='#prefs';setTimeout(()=>{const el=$('#aiPanel');if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},60);});
  $('#aiWeb').checked=P.ai.web!==false;
  $('#aiWeb').addEventListener('change',()=>{P.ai.web=$('#aiWeb').checked;savePrefs();});
  loadAiStatus().then(()=>{renderAiBox();renderAiPrefs();});
}

/* settings panel */
function renderAiPrefs(){
  const st=AI.status,prov=$('#aiPSel').value||'claude';if(!st||!$('#aiPanel'))return;
  $('#aiConnList').innerHTML=Object.entries(st.providers).map(([k,v])=>'<span class="tag '+(v.hasKey?'b':'')+'"><bdi>'+esc(v.name)+'</bdi> '+(v.hasKey?'✓':'—')+'</span>').join(' ');
  const v=st.providers[prov];
  $('#aiPState').innerHTML=v.hasKey?_t('مربوط بمفتاح ينتهي بـ ')+'<bdi>'+esc(v.hint)+'</bdi>'+(v.storage==='dpapi'?_t(' · محفوظ بتشفير ويندوز'):v.storage==='keychain'?_t(' · محفوظ في سلسلة مفاتيح ماك'):''):_t('غير مربوط');
  $('#aiPDot').className='tv-dot'+(v.hasKey?' ok':'');
  $('#aiBaseRow').hidden=prov!=='custom';$('#aiBase').value=P.ai.base||'';
  $('#aiKeyLink').hidden=!v.keysUrl;$('#aiKeyLink').href=v.keysUrl||'#';$('#aiKeyLink').innerHTML=_t('احصل على مفتاح من ')+'<bdi>'+esc((v.keysUrl||'').replace(/^https:\/\//,'').split('/')[0])+'</bdi>';
  $('#aiModel').value=(P.ai.models||{})[prov]||'';
  $('#aiPTest').hidden=!v.hasKey;$('#aiPDelete').hidden=!v.hasKey;$('#aiModelsBtn').hidden=!v.hasKey;
  $('#aiPSave').textContent=v.hasKey?_t('استبدال المفتاح'):_t('حفظ المفتاح واختبار الاتصال');
  $('#aiWebNote').textContent=v.web?_t('يستطيع البحث في الأخبار أثناء التحليل.'):_t('لا يبحث في الأخبار عبر الربط المباشر؛ يعتمد على بيانات البرنامج فقط.');
}
async function fillModels(prov,key){
  const r=await apiPost('/api/ai',{action:'models',provider:prov,key:key||'',base:prov==='custom'?P.ai.base:''}).catch(()=>null);
  if(!r||!r.ok)return r;
  $('#aiModelList').innerHTML=r.models.map(m=>'<option value="'+esc(m)+'">').join('');
  P.ai.models=P.ai.models||{};if(!P.ai.models[prov]&&r.suggested){P.ai.models[prov]=r.suggested;savePrefs();$('#aiModel').value=r.suggested;}
  return r;
}
function setupAiPrefs(){
  const status=(t,bad)=>{const el=$('#aiPStatus');el.textContent=t;el.className='status'+(bad?' err':'');};
  P.ai=Object.assign({provider:'claude',models:{},base:'',web:true},P.ai||{});
  if(P.claude&&P.claude.model&&!P.ai.models.claude)P.ai.models.claude=P.claude.model;
  $('#aiPSel').value=P.ai.provider||'claude';
  $('#aiPSel').addEventListener('change',()=>{$('#aiModelList').innerHTML='';renderAiPrefs();status('');const p=$('#aiPSel').value;if(AI.status&&AI.status.providers[p].hasKey)fillModels(p);});
  $('#aiModel').addEventListener('change',()=>{P.ai.models[$('#aiPSel').value]=$('#aiModel').value.trim();savePrefs();});
  $('#aiBase').addEventListener('change',()=>{P.ai.base=$('#aiBase').value.trim();savePrefs();});
  $('#aiPWeb').value=P.ai.web===false?'0':'1';
  $('#aiPWeb').addEventListener('change',()=>{P.ai.web=$('#aiPWeb').value==='1';$('#aiWeb').checked=P.ai.web;savePrefs();});
  $('#aiPSave').addEventListener('click',async()=>{const prov=$('#aiPSel').value,key=$('#aiKey').value.trim();if(!key){status(_t('الصق المفتاح أولًا.'),true);$('#aiKey').focus();return;}
    if(prov==='custom'&&!P.ai.base){status(_t('اكتب عنوان الخدمة أولًا.'),true);$('#aiBase').focus();return;}
    status(_t('جارٍ اختبار المفتاح…'));
    if(!P.ai.models[prov]){const m=await fillModels(prov,key);if(m&&!m.ok){status(m.error,true);return;}}
    const t=await apiPost('/api/ai',{action:'test',provider:prov,key,model:P.ai.models[prov]||'',base:prov==='custom'?P.ai.base:''}).catch(()=>null);
    if(!t||!t.ok){status((t&&t.error)||_t('تعذّر الاتصال.'),true);return;}
    const r=await apiPost('/api/ai',{action:'save',provider:prov,key}).catch(()=>null);
    if(!r||!r.ok){status((r&&r.error)||_t('تعذّر حفظ المفتاح.'),true);return;}
    $('#aiKey').value='';AI.status=r;if(!aiConnected().some(([k])=>k===P.ai.provider)||aiConnected().length===1){P.ai.provider=prov;savePrefs();}
    renderAiPrefs();renderAiBox();status(t.text);});
  $('#aiPTest').addEventListener('click',async()=>{const prov=$('#aiPSel').value;status(_t('جارٍ الاختبار…'));
    const t=await apiPost('/api/ai',{action:'test',provider:prov,model:P.ai.models[prov]||'',base:prov==='custom'?P.ai.base:''}).catch(()=>null);status(t&&t.ok?t.text:(t&&t.error)||_t('تعذّر الاتصال.'),!(t&&t.ok));});
  $('#aiModelsBtn').addEventListener('click',async()=>{const prov=$('#aiPSel').value;status(_t('جارٍ جلب قائمة النماذج…'));const r=await fillModels(prov);
    status(r&&r.ok?_t('القائمة جاهزة: اختر من خانة النموذج.')+' ('+r.models.length+')':(r&&r.error)||_t('تعذّر الاتصال.'),!(r&&r.ok));});
  $('#aiPDelete').addEventListener('click',async()=>{const r=await apiPost('/api/ai',{action:'delete',provider:$('#aiPSel').value}).catch(()=>null);if(r){AI.status=r;renderAiPrefs();renderAiBox();status(_t('حُذف المفتاح من جهازك.'));}});
  $('#aiKeyLink').addEventListener('click',e=>{e.preventDefault();openExt($('#aiKeyLink').href);});
}
