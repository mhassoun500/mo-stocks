/* ================= AI assistant: answers as they are written, cost, chat, history, templates, hit rate (Phase 5) ================= */

/* ---------- one request, read as it arrives ---------- */
async function aiCall(body,onText){
  const b=Object.assign({action:'stream'},body);
  let r;try{r=await fetch('/api/ai',{method:'POST',headers:Object.assign({'Content-Type':'application/json'},API_H),body:JSON.stringify(b)});}
  catch(e){return{ok:false,error:_t('تعذّر الاتصال بالبرنامج.')};}
  if(!r.body||!r.body.getReader){const j=await apiPost('/api/ai',Object.assign({},b,{action:'ask'})).catch(()=>null);if(j&&j.ok&&onText)onText(j.text||'');return j||{ok:false,error:_t('لا يوجد رد.')};}
  const rd=r.body.getReader(),dec=new TextDecoder();let buf='',last=null;
  const line=l=>{if(!l.trim())return;let o;try{o=JSON.parse(l);}catch(e){return;}if(o.t!=null){if(onText)onText(o.t);}else if(o.done)last=o;};
  try{for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){line(buf.slice(0,i));buf=buf.slice(i+1);}}
    line(buf);}
  catch(e){return last||{ok:false,error:_t('انقطع الاتصال أثناء الرد.')};}
  return last||{ok:false,error:_t('انقطع الاتصال أثناء الرد.')};
}
/* the assistant to use outside the stock page: the chosen one if it has a key, else the first that has one */
function aiPick(){const pv=(AI.status&&AI.status.providers)||{};
  const prov=pv[P.ai.provider]&&pv[P.ai.provider].hasKey?P.ai.provider:Object.keys(pv).find(k=>pv[k].hasKey);
  return prov?{provider:prov,model:(P.ai.models||{})[prov]||'',base:prov==='custom'?P.ai.base:'',name:pv[prov].name,web:pv[prov].web}:null;}

/* the month's limit reached: said in the page's language with the numbers the server sent */
const capMsg=r=>r&&r.capped?_t('بلغ تقدير تكلفة المساعدين هذا الشهر')+' '+usd(r.capped.spent)+' '+_t('من حدك الشهري')+' '+usd(r.capped.cap)+'. '+_t('أكّد الطلب للمتابعة، أو ارفع الحد من الإعدادات.'):(r&&r.error)||_t('لا يوجد رد.');
/* tokens and estimated cost under an answer */
const usd=v=>v==null?'—':'$'+(v<0.01?v.toFixed(4):v.toFixed(v<1?3:2));
function aiUsageLine(r){if(!r||!r.ok)return'';const u=r.usage;
  return(u?NUM(fmtMoney.format(u.in))+' '+_t('رمزًا مُرسلًا')+' · '+NUM(fmtMoney.format(u.out))+' '+_t('رمزًا مستلمًا'):_t('لم تذكر الخدمة عدد الرموز'))
    +' · '+_t('التكلفة التقريبية')+' '+(r.cost!=null?NUM(usd(r.cost)):_t('غير معروفة لهذا النموذج'))+(r.monthCost!=null?' · '+_t('هذا الشهر')+' '+NUM(usd(r.monthCost)):'');}

/* a run in any assistant panel: shows the answer as it is written, the cost, and a button past the monthly limit */
async function aiRunInto(el,body,opt){
  opt=opt||{};let text='';const pk=aiPick();
  if(!pk){el.innerHTML='<p class="err">'+esc(_t('أضف مفتاح مساعد ذكي من الإعدادات أولًا.'))+'</p>';return null;}
  body=Object.assign({provider:pk.provider,model:pk.model,base:pk.base},body);
  el.hidden=false;el.innerHTML='<p class="muted">'+esc(pk.name)+' '+esc(_t('يكتب…'))+'</p>';
  const r=await aiCall(body,t=>{text+=t;el.innerHTML=mdLite(stripVerdict(text).text)+'<p class="muted small">…</p>';});
  if(!r||!r.ok){
    el.innerHTML=(text?mdLite(text):'')+'<p class="err">'+esc(capMsg(r))+'</p>'+(r&&r.capped?'<button class="btn sm" type="button" data-aiover>'+esc(_t('أرسل هذا الطلب رغم الحد'))+'</button>':'');
    const b=el.querySelector('[data-aiover]');if(b)b.addEventListener('click',()=>aiRunInto(el,Object.assign({},body,{override:true}),opt));
    return null;}
  r.text=r.text||text;const sv=stripVerdict(r.text);
  el.innerHTML=mdLite(sv.text)+'<p class="small muted"><bdi>'+esc(r.name||pk.name)+' · '+esc(r.model||'')+'</bdi> · '+aiUsageLine(r)+'</p>';
  if(opt.done)opt.done(r,sv);
  return r;
}

/* ---------- templates: the reader the assistant writes for ---------- */
const AI_TPL={
  general:{ar:'عام',text:''},
  trader:{ar:'مضارب',text:'القارئ مضارب قصير المدى (أيام إلى أسابيع). ركّز على نقاط الدخول والوقف والأهداف القريبة، والزخم وحجم التداول، والأحداث القريبة. لا تطل في التقييم طويل الأجل إلا إذا كان حاسمًا.'},
  investor:{ar:'مستثمر طويل الأجل',text:'القارئ مستثمر طويل الأجل (سنة فأكثر). ركّز على جودة الشركة وأرباحها ونموها وديونها وسعرها العادل، واعتبر التذبذب القصير ضجيجًا. اذكر ما قد يغيّر الصورة على المدى البعيد.'},
  income:{ar:'دخل من التوزيعات',text:'القارئ يبحث عن دخل ثابت من التوزيعات. ركّز على عائد التوزيع واستقراره وتاريخه، ونسبة التوزيع من الأرباح والتدفق النقدي، وخطر خفض التوزيع.'}};
const tplText=k=>{const own=((P.aiTpl||{}).texts||{})[k];return own!=null&&own!==''?own:_t(AI_TPL[k]?AI_TPL[k].text:'');};
function tplSystem(base,k){const t=tplText(k||((P.aiTpl||{}).sel)||'general');return base+(t?'\n\n'+_t('منظور القارئ')+': '+t:'');}

/* ---------- the verdict line, for the hit rate ---------- */
const VERDICT_RULE='في آخر سطر من ردك اكتب سطرًا واحدًا بالإنجليزية بهذا الشكل تمامًا: VERDICT: up|down|flat; DAYS: N — حيث up تعني أنك تتوقع ارتفاع السعر أكثر من 3% خلال N يومًا، وdown انخفاضه أكثر من 3%، وflat ما بينهما، وN بين 5 و365.';
const VERDICT_PCT=0.03;
function stripVerdict(text){
  const m=/^[ \t>*_`-]*VERDICT\s*[:：]\s*(up|down|flat)\b[^\n]*?DAYS\s*[:：]\s*(\d{1,3})[^\n]*$/im.exec(text||'');
  if(!m)return{text:String(text||'').trim(),verdict:null};
  const days=Math.min(365,Math.max(5,+m[2]));
  return{text:(text.slice(0,m.index)+text.slice(m.index+m[0].length)).trim(),verdict:{dir:m[1].toLowerCase(),days}};
}
/* what happened after the verdict's days: the first close on or after that day against the price on the day of the answer */
function evalVerdict(e,rows){
  if(!e||!e.verdict||!(e.price>0))return null;const due=e.t+e.verdict.days*DAY;
  const bar=(rows||[]).find(r=>r[0]>=due);if(!bar)return{done:false,due};
  const chg=bar[4]/e.price-1,dir=chg>VERDICT_PCT?'up':chg<-VERDICT_PCT?'down':'flat';
  return{done:true,due,chg,actual:dir,hit:dir===e.verdict.dir};
}
const HIT_MIN=5;   /* fewer judged answers than this: the rate is not shown, it would mislead */
function hitRates(entries){const by={};
  for(const e of entries||[]){if(!e.verdict)continue;const k=e.name||e.prov,x=by[k]=by[k]||{name:k,n:0,hits:0,pending:0};
    if(e.judged&&e.judged.done){x.n++;if(e.judged.hit)x.hits++;}else x.pending++;}
  return Object.values(by).map(x=>Object.assign(x,{rate:x.n>=HIT_MIN?x.hits/x.n:null})).sort((a,b)=>b.n-a.n);}

/* ---------- history of analyses, per asset ---------- */
const AIH={key:()=>S.ex+':'+S.code,max:30};
async function aiHistAll(){return await Store.get('aiHistory',{});}
async function aiHistAdd(k,entry){const all=await aiHistAll();const l=all[k]=all[k]||[];l.unshift(entry);all[k]=l.slice(0,AIH.max);await Store.set('aiHistory',all);return entry;}
async function aiHistUpdate(k,id,patch){const all=await aiHistAll();const e=(all[k]||[]).find(x=>x.id===id);if(e){Object.assign(e,patch);await Store.set('aiHistory',all);}return e;}
function aiHistHTML(list,now){
  if(!list.length)return '<p class="small muted">'+esc(_t('لا توجد تحليلات محفوظة لهذا الأصل بعد.'))+'</p>';
  return '<ul class="list">'+list.map(e=>{const ch=now&&e.price>0?now/e.price-1:null,v=e.verdict;
    const vd=v?' · '+esc(_t({up:'صعود',down:'هبوط',flat:'حياد'}[v.dir]))+' '+NUM(v.days)+' '+esc(_t('يومًا'))
      +(e.judged&&e.judged.done?' · <b style="color:'+(e.judged.hit?'var(--up)':'var(--down)')+'">'+esc(_t(e.judged.hit?'أصاب':'لم يصب'))+'</b>':''):'';
    return '<li class="plain"><a href="#" data-aih="'+esc(e.id)+'">'+NUM(fmtLocalTime.format(new Date(e.t)))+'</a> · <bdi>'+esc(e.name||e.prov)+'</bdi>'
      +(e.tpl&&e.tpl!=='general'?' · '+esc(_t(AI_TPL[e.tpl]?AI_TPL[e.tpl].ar:e.tpl)):'')
      +' · '+esc(_t('السعر وقتها'))+' '+NUM(fp(e.price))+(ch!=null?' ('+NUM((ch>=0?'+':'')+(ch*100).toFixed(1)+'%')+' '+esc(_t('حتى الآن'))+')':'')
      +vd+(e.cost!=null?' · '+NUM(usd(e.cost)):'')+(e.chat&&e.chat.length?' · '+NUM(e.chat.length)+' '+esc(_t('سؤال متابعة')):'')+'</li>';}).join('')+'</ul>';
}

/* ---------- the stock page: analysis, follow-up chat, history ---------- */
async function runAi(){
  if(!S.A&&!S.isFund)return;const prov=$('#aiProv').value;if(!prov)return;const st=AI.status.providers[prov];
  const code=S.code,ex=S.ex,k=AIH.key(),pr=buildPrompt(false),tpl=$('#aiTpl')?$('#aiTpl').value:'general';
  const system=tplSystem(pr.system,tpl)+'\n\n'+_t(VERDICT_RULE);
  const price=S.A?S.A.close:(S.daily&&S.daily.length?S.daily[S.daily.length-1].c:null);
  S.ai={code,ex,busy:true,name:st.name,text:'',system,messages:[{role:'user',content:pr.user}],chat:[]};renderAiBox();$('#aiRun').disabled=true;
  const body={provider:prov,model:(P.ai.models||{})[prov]||'',base:prov==='custom'?P.ai.base:'',web:$('#aiWeb').checked&&st.web,system,user:pr.user,kind:'analysis'};
  await aiStockRun(body,{code,ex,k,price,tpl,st});
}
async function aiStockRun(body,c){
  let r;
  try{r=await aiCall(body,t=>{if(S.code!==c.code||S.ex!==c.ex||!S.ai)return;S.ai.text+=t;S.ai.streaming=true;renderAiBox();});}
  finally{$('#aiRun').disabled=false;}
  if(S.code!==c.code||S.ex!==c.ex)return;
  if(!r||!r.ok){S.ai=Object.assign(S.ai||{},{busy:false,streaming:false,ok:false,error:capMsg(r),capped:r&&r.capped,retry:body});renderAiBox();return;}
  const sv=stripVerdict(r.text||S.ai.text);
  S.ai=Object.assign(S.ai,r,{busy:false,streaming:false,ok:true,text:sv.text,verdict:sv.verdict,at:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})});
  S.ai.messages.push({role:'assistant',content:r.text});
  const e=await aiHistAdd(c.k,{id:'a'+Date.now().toString(36),t:Date.now(),prov:body.provider,name:r.name||c.st.name,model:r.model,price:c.price,tpl:c.tpl,
    text:sv.text,verdict:sv.verdict,usage:r.usage||null,cost:r.cost,system:body.system,user:body.user,raw:r.text,chat:[]});
  S.ai.histId=e.id;renderAiBox();renderAiHist();
}
async function aiFollowUp(){
  const q=($('#aiChatQ').value||'').trim(),c=S.ai;if(!q||!c||!c.ok||c.code!==S.code||c.ex!==S.ex||c.busy)return;
  $('#aiChatQ').value='';const pv=AI.status.providers[$('#aiProv').value]||{};
  c.chat=c.chat||[];const turn={q,a:''};c.chat.push(turn);c.busy=true;renderAiChat();
  c.messages.push({role:'user',content:q});
  const body={provider:$('#aiProv').value,model:(P.ai.models||{})[$('#aiProv').value]||'',base:$('#aiProv').value==='custom'?P.ai.base:'',web:false,system:c.system,messages:c.messages,kind:'chat'};
  const r=await aiCall(body,t=>{turn.a+=t;renderAiChat();});
  c.busy=false;
  if(!r||!r.ok){turn.err=capMsg(r);turn.capped=r&&r.capped;c.messages.pop();renderAiChat();return;}
  turn.a=stripVerdict(r.text||turn.a).text;turn.usage=aiUsageLine(r);c.messages.push({role:'assistant',content:r.text||turn.a});renderAiChat();
  if(c.histId){const all=await aiHistAll(),e=(all[AIH.key()]||[]).find(x=>x.id===c.histId);
    if(e){e.chat=(e.chat||[]).concat([{q,a:turn.a,cost:r.cost}]);e.cost=(e.cost||0)+(r.cost||0);await Store.set('aiHistory',all);renderAiHist();}}
  void pv;
}
function renderAiChat(){const box=$('#aiChat');if(!box)return;const c=S.ai;
  const show=!!(c&&c.ok&&c.code===S.code&&c.ex===S.ex);$('#aiChatBox').hidden=!show;if(!show)return;
  box.innerHTML=(c.chat||[]).map(t=>'<div class="ai-turn ai-out"><p class="ai-q-line"><b>'+esc(_t('سؤالك'))+':</b> '+esc(t.q)+'</p>'
    +(t.a?mdLite(t.a):'<p class="muted small">'+esc(_t('يكتب…'))+'</p>')+(t.err?'<p class="err">'+esc(t.err)+'</p>':'')+(t.usage?'<p class="small muted">'+t.usage+'</p>':'')+'</div>').join('');
  $('#aiChatGo').disabled=!!c.busy;}
function aiHistMaybe(){if(LOCAL&&S.code&&AIH.last!==AIH.key()){AIH.last=AIH.key();renderAiHist();}}
async function renderAiHist(){const el=$('#aiHistList');if(!el||!S.code)return;
  const list=(await aiHistAll())[AIH.key()]||[];$('#aiHistN').textContent=list.length;
  el.innerHTML=aiHistHTML(list,S.A?S.A.close:null);}
async function openAiHist(id){const e=((await aiHistAll())[AIH.key()]||[]).find(x=>x.id===id);if(!e)return;
  S.ai={code:S.code,ex:S.ex,ok:true,name:e.name,model:e.model,text:e.text,verdict:e.verdict,usage:e.usage,cost:e.cost,histId:e.id,old:e.t,
    at:fmtLocalTime.format(new Date(e.t)),system:e.system||'',messages:[{role:'user',content:e.user||''},{role:'assistant',content:e.raw||e.text}].concat(...(e.chat||[]).map(t=>[{role:'user',content:t.q},{role:'assistant',content:t.a}])),
    chat:(e.chat||[]).map(t=>({q:t.q,a:t.a}))};
  renderAiBox();}

/* ---------- settings: cost, limit, prices, templates ---------- */
async function renderAiUsage(){const box=$('#aiUsageBox');if(!box)return;
  const u=await apiPost('/api/ai',{action:'usage'}).catch(()=>null);if(!u||!u.ok){box.textContent=_t('تعذّر قراءة الاستهلاك.');return;}
  const m=u.months[u.month]||{cost:0,in:0,out:0,n:0,unknown:0,byProv:{}};
  const prov=Object.entries(m.byProv||{}).map(([k,v])=>'<bdi>'+esc(((AI.status||{}).providers||{})[k]?AI.status.providers[k].name:k)+'</bdi> '+NUM(usd(v))).join(' · ');
  const past=Object.keys(u.months).sort().reverse().slice(1,7).map(k=>NUM(k)+': '+NUM(usd(u.months[k].cost))).join(' · ');
  box.innerHTML='<div class="metric"><span class="k">'+esc(_t('تقدير هذا الشهر'))+'</span><span class="v">'+NUM(usd(m.cost))+'</span><span class="s">'
    +NUM(m.n)+' '+esc(_t('طلبًا'))+' · '+NUM(fmtMoney.format(m.in))+' / '+NUM(fmtMoney.format(m.out))+' '+esc(_t('رمز مُرسل / مستلم'))+(u.cap?' · '+esc(_t('الحد'))+' '+NUM(usd(u.cap)):'')+'</span></div>'
    +(prov?'<p class="small">'+prov+'</p>':'')+(m.unknown?'<p class="small muted">'+NUM(m.unknown)+' '+esc(_t('طلبات بنماذج ليس لها سعر في الجدول، فلم تدخل في التقدير. أضف سعرها أدناه.'))+'</p>':'')
    +(past?'<p class="small muted">'+esc(_t('الأشهر السابقة'))+': '+past+'</p>':'')
    +'<details><summary class="small">'+esc(_t('آخر الطلبات'))+'</summary><ul class="list small">'+(u.recent||[]).slice(0,15).map(x=>'<li class="plain">'+NUM(fmtLocalTime.format(new Date(x.t)))+' · <bdi>'+esc(x.model||x.prov)+'</bdi> · '+esc(_t(AI_KIND[x.kind]||x.kind))+' · '+NUM(fmtMoney.format(x.in||0))+'/'+NUM(fmtMoney.format(x.out||0))+' · '+NUM(usd(x.cost))+'</li>').join('')+'</ul></details>'
    +'<p class="small muted">'+esc(_t('الأسعار المعتمدة بتاريخ'))+' '+NUM(esc(u.checked||'—'))+'. '+esc(_t('التكلفة تقريبية: الأسعار تتغير، وبعض الخدمات تحسب أشياء إضافية.'))+' '
    +Object.entries(u.sources||{}).map(([k,v])=>'<a href="#" data-url="'+esc(v)+'">'+esc(k)+'</a>').join(' · ')+'</p>';
}
const AI_KIND={analysis:'تحليل سهم',chat:'سؤال متابعة',ask:'طلب',fill:'ملء الناقص',compare:'مقارنة سهمين',portfolio:'تحليل المحفظة',news:'ملخص الأخبار',report:'ملخص تقرير'};
/* the user's own prices: one model per line, "model input output" in dollars per million tokens */
function parsePrices(t){const o={};for(const l of String(t||'').split('\n')){const p=l.trim().split(/[\s=:,]+/).filter(Boolean);
  if(p.length>=3&&isFinite(+p[1])&&isFinite(+p[2])&&+p[1]>=0&&+p[2]>=0)o[p[0].toLowerCase()]=[+p[1],+p[2]];}return o;}
const pricesText=o=>Object.entries(o||{}).map(([k,v])=>k+' '+v[0]+' '+v[1]).join('\n');
function renderAiTplPrefs(){const box=$('#aiTplEdit');if(!box)return;const own=(P.aiTpl||{}).texts||{};
  box.innerHTML=Object.keys(AI_TPL).filter(k=>k!=='general').map(k=>'<label class="field"><span>'+esc(_t(AI_TPL[k].ar))+'</span><textarea rows="3" data-tpl="'+k+'">'+esc(own[k]!=null&&own[k]!==''?own[k]:_t(AI_TPL[k].text))+'</textarea></label>'
    +'<button class="btn xs ghost" type="button" data-tplreset="'+k+'">'+esc(_t('أرجع النص الأصلي'))+'</button>').join('');}
function fillTplSelect(){const s=$('#aiTpl');if(!s)return;const cur=(P.aiTpl||{}).sel||'general';
  s.innerHTML=Object.keys(AI_TPL).map(k=>'<option value="'+k+'"'+(k===cur?' selected':'')+'>'+esc(_t(AI_TPL[k].ar))+'</option>').join('');}
function setupAiExtras(){
  if(!LOCAL)return;
  fillTplSelect();renderAiTplPrefs();
  const tp=$('#aiTpl');if(tp)tp.addEventListener('change',()=>{P.aiTpl=Object.assign({},P.aiTpl,{sel:tp.value});savePrefs();});
  const te=$('#aiTplEdit');
  if(te){te.addEventListener('change',e=>{const a=e.target.closest('[data-tpl]');if(!a)return;const t=Object.assign({},(P.aiTpl||{}).texts);
      t[a.dataset.tpl]=a.value.trim()===_t(AI_TPL[a.dataset.tpl].text)?'':a.value.trim();P.aiTpl=Object.assign({},P.aiTpl,{texts:t});savePrefs();});
    te.addEventListener('click',e=>{const b=e.target.closest('[data-tplreset]');if(!b)return;const t=Object.assign({},(P.aiTpl||{}).texts);delete t[b.dataset.tplreset];
      P.aiTpl=Object.assign({},P.aiTpl,{texts:t});savePrefs();renderAiTplPrefs();});}
  const pp=$('#aiPrices');if(pp){pp.value=pricesText(P.aiPrices);pp.addEventListener('change',()=>{P.aiPrices=parsePrices(pp.value);savePrefs();pp.value=pricesText(P.aiPrices);toast(_t('حُفظت أسعارك.'));});}
  const ub=$('#aiUsageBox');if(ub){ub.addEventListener('click',e=>{const a=e.target.closest('a[data-url]');if(a){e.preventDefault();openExt(a.dataset.url);}});
    const go=()=>{if(location.hash==='#prefs')renderAiUsage();};addEventListener('hashchange',go);go();$('#aiUsageRefresh').addEventListener('click',renderAiUsage);}
  $('#aiChatGo').addEventListener('click',aiFollowUp);
  $('#aiChatQ').addEventListener('keydown',e=>{if(e.key==='Enter')aiFollowUp();});
  $('#aiHistList').addEventListener('click',e=>{const a=e.target.closest('a[data-aih]');if(a){e.preventDefault();openAiHist(a.dataset.aih);}});
  $('#aiHist').addEventListener('toggle',()=>{if($('#aiHist').open)renderAiHist();});
  $('#aiOut').addEventListener('click',e=>{const b=e.target.closest('[data-aiover]');if(!b||!S.ai||!S.ai.retry)return;
    const body=Object.assign({},S.ai.retry,{override:true});const st=AI.status.providers[body.provider]||{};
    S.ai=Object.assign(S.ai,{busy:true,ok:undefined,error:'',text:''});renderAiBox();
    aiStockRun(body,{code:S.code,ex:S.ex,k:AIH.key(),price:S.A?S.A.close:null,tpl:$('#aiTpl')?$('#aiTpl').value:'general',st});});
}
