/* ================= assistant requests beyond one stock: compare, portfolio, news, hit rate (Phase 5, steps 3 and 4) ================= */
const AI_CMP_SYS='أنت محلل أسهم خبير. تصلك بيانات سهمين محسوبة آليًا من برنامج «Mo Stocks» بصيغة JSON. قارن بينهما بالعربية الفصحى البسيطة تحت هذه العناوين بالضبط: ## الخلاصة، ## الاتجاه والزخم، ## التقييم والسعر العادل، ## المخاطر، ## أيهما يناسب أي مستثمر. اعتمد على الأرقام المرسلة، واذكر ما ينقص منها، ولا تعطِ توصية قاطعة بالشراء أو البيع.';
const AI_PORT_SYS='أنت مستشار محافظ استثمارية. تصلك محفظة مستخدم من سجل صفقاته في برنامج «Mo Stocks» بصيغة JSON، وكل عملة على حدة. حلّلها بالعربية الفصحى البسيطة تحت هذه العناوين بالضبط: ## الصورة العامة، ## التركّز والتنويع، ## أفضل المراكز وأضعفها، ## إدارة المخاطر، ## ما يستحق المراجعة. لا تجمع مبالغ بعملات مختلفة، ولا تعطِ أوامر شراء أو بيع قاطعة.';
const AI_NEWS_SYS='أنت محرر أخبار مالية. تصلك عناوين أخبار حديثة عن أسهم قائمة المراقبة لمستخدم، جمعها برنامج «Mo Stocks» من مصادر الأخبار. لخّصها بالعربية الفصحى البسيطة: لكل سهم عنوان ## باسمه ثم نقطتان على الأكثر بأهم ما فيه وأثره المحتمل، مع ذكر المصدر والتاريخ. ثم ## ما يستحق المتابعة. لا تضف أخبارًا ليست في القائمة، وإذا لم توجد أخبار مهمة لسهم فقل ذلك في سطر.';

const round6=v=>v==null||!isFinite(v)?null:+(+v).toPrecision(6);
/* a compact description of one asset, the same for both sides of a comparison */
async function assetBrief(ex,code){
  const r=await analyzeAsset(ex,code,true);const A=r.A,j=r.j;
  const b={market:{SR:'Saudi',CA:'Egypt',US:'US',GOLD:'Gold'}[ex]||ex,code,name:j.name||code,currency:PUR_CUR[ex]||null,price:round6(A.close),
    change1d:round6(r.chg),verdict:A.stance,confidence:r.conf,trend:A.trend,rsi:round6(A.rsi),
    buyZone:A.buy?[round6(A.buy.lo),round6(A.buy.hi)]:null,sellZone:A.sell?[round6(A.sell.lo),round6(A.sell.hi)]:null,
    plan:{entry:round6(A.entry),stop:round6(A.stop),target1:round6(A.t1),rewardToRisk:A.rr!=null&&isFinite(A.rr)?+A.rr.toFixed(2):null},notable:A.notable||null};
  const D=r.D,c=D.map(d=>d.c),N=D.length;
  b.return3m=N>63?round6(c[N-1]/c[N-64]-1):null;b.return1y=N>240?round6(c[N-1]/c[0]-1):null;
  if(['SR','CA','US'].includes(ex)){const f=await api('/api/fundamentals',{code,ex}).catch(()=>null);
    if(f&&f.ok){const fv=fairValue(f,{ex});const F=f.f||{};
      b.fundamentals={pe:round6(F.price_earnings_ttm),sectorPE:round6(f.sectorPE),pb:round6(F.price_book_fq),dividendYield:round6(F.dividends_yield_current),roe:round6(F.return_on_equity_fq),
        fairValue:fv&&fv.fair?round6(fv.fair):null,fairValueConfidence:fv&&fv.conf?fv.conf.level:null,sector:F.sector||null};}
    const sh=typeof shariaInfo==='function'?shariaInfo(code,ex):null;b.sharia=sh?sh.s:null;}
  return b;
}
async function runCompare(){
  const code=($('#aiCmpCode').value||'').trim().toUpperCase(),ex=$('#aiCmpEx').value,out=$('#aiCmpOut');
  if(!S.code||!code){out.hidden=false;out.innerHTML='<p class="err">'+esc(_t('اكتب رمز السهم الثاني.'))+'</p>';return;}
  out.hidden=false;out.innerHTML='<p class="muted">'+esc(_t('جارٍ تجهيز بيانات السهمين…'))+'</p>';$('#aiCmpGo').disabled=true;
  try{const [a,b]=await Promise.all([assetBrief(S.ex,S.code),assetBrief(ex,code)]);
    const user=_t('قارن بين هذين السهمين. بيانات البرنامج (JSON):')+'\n'+JSON.stringify({first:a,second:b});
    await aiRunInto(out,{system:tplSystem(_t(AI_CMP_SYS)),user,kind:'compare'});}
  catch(e){out.innerHTML='<p class="err">'+esc(_t('تعذّر جلب بيانات السهم الثاني:'))+' '+esc(e.message||'')+'</p>';}
  finally{$('#aiCmpGo').disabled=false;}
}

/* the portfolio as the assistant sees it: every currency on its own */
function portfolioPayload(trades,now){
  now=now||Date.now();const s=weekSummary(trades,now),open=[];
  for(const t of trades||[])if(!t.exit){const c=curOf(t),tot=s.cur[c],v=t.last>0?t.last*t.qty:null;
    open.push({name:t.name||t.code,code:t.code,market:t.ex,currency:c,qty:t.qty,entry:t.entry,last:t.last||null,
      returnPct:t.last>0?round6((t.last/t.entry-1)*100):null,weightInCurrencyPct:v&&tot&&tot.value?round6(v/tot.value*100):null,
      daysHeld:Math.max(0,Math.round((now-t.date)/DAY)),stop:t.stop||null,target:t.target||null,setup:t.setup||null});}
  const closed=(trades||[]).filter(t=>t.exit&&t.exitDate>=now-365*DAY),rets=closed.map(t=>t.exit/t.entry-1);
  return{asOf:new Date(now).toISOString().slice(0,10),open,
    totalsByCurrency:Object.fromEntries(Object.entries(s.cur).map(([c,x])=>[c,{positions:x.n,cost:round6(x.cost),value:round6(x.value),unrealised:round6(x.pl),withoutPrice:x.noPrice}])),
    closedLast12Months:{count:closed.length,winners:rets.filter(r=>r>0).length,avgReturnPct:rets.length?round6(rets.reduce((a,b)=>a+b,0)/rets.length*100):null,
      realisedByCurrency:Object.fromEntries(Object.entries(realisedByCur(closed)).map(([k,v])=>[k,round6(v)]))}};
}
async function runPortfolioAi(){const out=$('#aiPortOut');out.hidden=false;out.innerHTML='<p class="muted">'+esc(_t('جارٍ تحديث الأسعار…'))+'</p>';
  $('#aiPortGo').disabled=true;
  try{await refreshJournalPrices();const p=portfolioPayload(J.trades);
    if(!p.open.length&&!p.closedLast12Months.count){out.innerHTML='<p class="err">'+esc(_t('لا توجد صفقات في سجلك بعد.'))+'</p>';return;}
    await aiRunInto(out,{system:tplSystem(_t(AI_PORT_SYS)),user:_t('حلّل محفظتي. بيانات البرنامج (JSON):')+'\n'+JSON.stringify(p),kind:'portfolio'});}
  finally{$('#aiPortGo').disabled=false;}
}

/* headlines for the watchlist, at most five per asset from the last fortnight */
function newsPayload(groups,now){now=now||Date.now();
  return groups.map(g=>({asset:g.name,code:g.code,market:g.ex,headlines:(g.items||[]).filter(n=>{const t=Date.parse(n.date);return !isFinite(t)||t>=now-14*DAY;}).slice(0,5)
    .map(n=>({title:n.title,source:n.source,date:n.date}))}));}
async function runNewsAi(){const out=$('#aiNewsOut');out.hidden=false;$('#aiNewsGo').disabled=true;
  try{const items=W.items.slice(0,15);if(!items.length){out.innerHTML='<p class="err">'+esc(_t('قائمة المراقبة فارغة.'))+'</p>';return;}
    out.innerHTML='<p class="muted">'+esc(_t('جارٍ جمع الأخبار…'))+'</p>';
    const groups=await Promise.all(items.map(async it=>{const nm=it.short||it.name||it.code;
      const q=it.ex==='GOLD'?(String(it.code).startsWith('XAG')?'أسعار الفضة':'أسعار الذهب'):nm.replace(/\(.*?\)/g,'').trim()+' سهم';
      const j=await api('/api/news',{q,region:EX[it.ex]?EX[it.ex].region:'SR'}).catch(()=>null);return{name:nm,code:it.code,ex:it.ex,items:j&&j.ok?j.items:[]};}));
    const p=newsPayload(groups);if(!p.some(g=>g.headlines.length)){out.innerHTML='<p class="err">'+esc(_t('لم أجد أخبارًا حديثة لأسهم المراقبة.'))+'</p>';return;}
    await aiRunInto(out,{system:_t(AI_NEWS_SYS),user:_t('لخّص هذه الأخبار. البيانات (JSON):')+'\n'+JSON.stringify(p),kind:'news'});}
  finally{$('#aiNewsGo').disabled=false;}
}

/* ---------- hit rate: judge the answers whose time has come ---------- */
async function aiJudgeAll(){
  const all=await aiHistAll(),now=Date.now();let changed=false;
  for(const k of Object.keys(all)){const due=(all[k]||[]).filter(e=>e.verdict&&!(e.judged&&e.judged.done)&&e.t+e.verdict.days*DAY<=now);if(!due.length)continue;
    const i=k.indexOf(':'),ex=k.slice(0,i),code=k.slice(i+1);
    const j=await api('/api/history',{code,ex,range:'2y'}).catch(()=>null);if(!j||!j.ok)continue;
    for(const e of due){const r=evalVerdict(e,j.rows);if(r&&r.done){e.judged=r;changed=true;}}}
  if(changed)await Store.set('aiHistory',all);
  return Object.values(all).flat();
}
function hitHTML(rates){
  if(!rates.length)return '<p class="small muted">'+esc(_t('لا توجد تحليلات فيها خلاصة بعد. كل تحليل جديد يُقارن بما حدث بعد انتهاء مدته.'))+'</p>';
  return '<div class="tbl-wrap"><table><thead><tr><th>'+esc(_t('المساعد'))+'</th><th>'+esc(_t('حُكم عليها'))+'</th><th>'+esc(_t('أصاب'))+'</th><th>'+esc(_t('نسبة الإصابة'))+'</th><th>'+esc(_t('تنتظر انتهاء مدتها'))+'</th></tr></thead><tbody>'
    +rates.map(x=>'<tr><td><bdi>'+esc(x.name)+'</bdi></td><td>'+NUM(x.n)+'</td><td>'+NUM(x.hits)+'</td><td>'+(x.rate!=null?'<b>'+NUM((x.rate*100).toFixed(0)+'%')+'</b>':'<span class="small muted">'+esc(_t('تظهر بعد'))+' '+NUM(HIT_MIN)+' '+esc(_t('تحليلات'))+'</span>')+'</td><td>'+NUM(x.pending)+'</td></tr>').join('')+'</tbody></table></div>';
}
async function renderHitRate(){const box=$('#aiHitBox');if(!box)return;box.innerHTML='<p class="small muted">'+esc(_t('جارٍ الحساب…'))+'</p>';
  box.innerHTML=hitHTML(hitRates(await aiJudgeAll()))+'<p class="small muted">'+esc(_t('يُطلب من المساعد في آخر كل تحليل خلاصة: صعود أو هبوط أو حياد خلال عدد من الأيام. بعد انتهاء المدة يُقارن سعر الإغلاق بسعر يوم التحليل: أكثر من 3% صعود، وأقل من 3%- هبوط، وما بينهما حياد. هذا قياس لرأي المساعد، لا لجودة قرارك.'))+'</p>';}

function setupAiTools(){
  if(!LOCAL)return;
  const g=(id,f)=>{const el=$(id);if(el)el.addEventListener('click',f);};
  g('#aiCmpGo',runCompare);g('#aiPortGo',runPortfolioAi);g('#aiNewsGo',runNewsAi);g('#aiHitGo',renderHitRate);
  const c=$('#aiCmpCode');if(c)c.addEventListener('keydown',e=>{if(e.key==='Enter')runCompare();});
  const go=()=>{if(location.hash==='#prefs'&&$('#aiHitBox')&&!$('#aiHitBox').dataset.done){$('#aiHitBox').dataset.done='1';renderHitRate();}};addEventListener('hashchange',go);go();
}
