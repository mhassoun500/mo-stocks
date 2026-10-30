/* ================= Saudi and Egyptian mutual funds (desktop app) ================= */
const FL={items:[],byId:{},stats:{},loaded:false,loading:null,sort:{k:'ytdN',dir:'desc'},statsRun:0};
const FCAT={money:'نقدي وسيولة',fixed:'دخل ثابت',metals:'ذهب ومعادن',equity:'أسهم',balanced:'متوازن',realestate:'عقاري',other:'متنوع'};
const FCOUNTRY={SA:'السعودية',EG:'مصر'};
const SHARIA_WHY={name:'اسم الصندوق أو نوعه ينص على توافقه مع الشريعة',sponsor:'صادر عن بنك إسلامي أو مدير صناديق متوافق مع الشريعة بالكامل'};
const parsePct=s=>{if(s==null)return null;const v=parseFloat(String(s).replace('%','').replace('٪',''));return isFinite(v)?v/100:null;};
const isYieldFund=c=>c==='money'||c==='fixed';

function loadFundList(force){
  if(!LOCAL)return Promise.resolve();
  if(FL.loaded&&!force)return Promise.resolve();
  if(FL.loading&&!force)return FL.loading;
  FL.loading=(async()=>{
    if(!FL.loaded)$('#fundsMeta').textContent='جارٍ تحميل قائمة الصناديق من مباشر… قد يستغرق ذلك دقيقة في المرة الأولى.';
    const j=await api('/api/funds').catch(()=>null);
    if(!j||!j.ok){$('#fundsMeta').textContent=(j&&j.error)||'تعذّر جلب قائمة الصناديق.';
      if(!FL.loaded)$('#fund').innerHTML='<option value="">تعذّر تحميل قائمة الصناديق</option>';return;}
    FL.items=j.items.map(f=>Object.assign(f,{country:f.country||'EG',catAr:FCAT[f.category]||'متنوع',ytdN:parsePct(f.ytd)}));
    FL.byId={};for(const f of FL.items)FL.byId[f.id]=f;FL.loaded=true;
    fillFundSelect();
    const cats=[...new Set(FL.items.map(f=>f.category))];
    $('#fCat').innerHTML='<option value="">الكل</option>'+cats.map(c=>'<option value="'+c+'">'+FCAT[c]+'</option>').join('');
    fundsMeta(j.offline);
    renderFunds();
  })();
  return FL.loading;
}
function fundsMeta(offline){
  const c=$('#fCountry').value,act=FL.items.filter(f=>(!c||f.country===c)&&!f.stale);
  $('#fundsMeta').textContent=(c?FCOUNTRY[c]+': ':'')+act.length+' صندوقًا نشطًا، منها '+act.filter(f=>f.sharia).length+' متوافقة مع الشريعة'+(offline?' · أسعار محفوظة':'');
}
function fillFundSelect(){
  const all=$('#fundAll').checked,cur=$('#fund').value,country=$('#fundCountry').value;
  const list=FL.items.filter(f=>f.country===country&&!f.stale&&(all||f.sharia));const groups={};
  for(const f of list)(groups[f.catAr]=groups[f.catAr]||[]).push(f);
  $('#fund').innerHTML=Object.keys(groups).map(g=>'<optgroup label="'+esc(g)+'">'+groups[g].sort((a,b)=>a.short.localeCompare(b.short,'ar'))
    .map(f=>'<option value="'+f.id+'">'+esc(f.short)+' — '+esc((f.manager||'').slice(0,30))+'</option>').join('')+'</optgroup>').join('');
  if(cur&&list.some(f=>String(f.id)===cur))$('#fund').value=cur;
}
async function selectFund(id){
  await loadFundList();
  const f=FL.byId[id];
  if(f&&f.country!==$('#fundCountry').value){$('#fundCountry').value=f.country;fillFundSelect();}
  if(f&&(!f.sharia||f.stale)&&!$('#fundAll').checked){$('#fundAll').checked=true;fillFundSelect();}
  if(f&&f.stale&&![...$('#fund').options].some(o=>o.value===String(id)))$('#fund').insertAdjacentHTML('beforeend','<option value="'+f.id+'">'+esc(f.short)+' (متوقف)</option>');
  $('#fund').value=String(id);
}

/* ---------- statistics from a price record ---------- */
function fundStats(rows){
  const n=rows.length;if(!n)return{n:0};
  const lt=rows[n-1][0],lc=rows[n-1][4];
  const at=days=>{const target=lt-days*DAY;if(rows[0][0]>target+4*DAY)return null;let lo=0,hi=n-1;
    while(hi-lo>1){const m=(lo+hi)>>1;if(rows[m][0]<=target)lo=m;else hi=m;}const p=rows[rows[hi][0]<=target?hi:lo];
    return target-p[0]>25*DAY?null:p[4];};
  const r=d=>{const p=at(d);return p?lc/p-1:null;};
  const p3=at(1095);
  const yr=rows.filter(x=>x[0]>=lt-365*DAY);
  let peak=-Infinity,dd=0;for(const x of yr){peak=Math.max(peak,x[4]);dd=Math.min(dd,x[4]/peak-1);}
  const rets=[];for(let i=1;i<yr.length;i++){if((yr[i][0]-yr[i-1][0])/DAY>5)continue;rets.push(Math.log(yr[i][4]/yr[i-1][4]));}
  let vol=null;if(rets.length>20){const m=rets.reduce((a,b)=>a+b,0)/rets.length;vol=Math.sqrt(rets.reduce((a,b)=>a+(b-m)**2,0)/(rets.length-1))*Math.sqrt(252);}
  const yrsAll=(lt-rows[0][0])/(365*DAY);
  return{n,lastT:lt,firstT:rows[0][0],r1w:r(7),r1m:r(30),r3m:r(91),r6m:r(182),r1y:r(365),r3y:p3?Math.pow(lc/p3,1/3)-1:null,
    since:yrsAll>=1?Math.pow(lc/rows[0][4],1/yrsAll)-1:null,dd:yr.length>20?dd:null,vol};
}
const annualize=(r,days)=>r==null?null:Math.pow(1+r,365/days)-1;
function coverage(j,st){
  if(!st.n||st.n<30)return{k:'n',t:'جديد'};
  const recentGap=(j.gaps||[]).some(g=>g[1]>Date.now()-400*DAY);
  return recentGap?{k:'in',t:'به فجوة'}:{k:'b',t:'كامل'};
}

/* ---------- funds table ---------- */
function fundsFiltered(){
  const sh=$('#fShariaOnly').checked,cat=$('#fCat').value,q=$('#fSearch').value.trim(),c=$('#fCountry').value,stale=$('#fStale').checked;
  return FL.items.filter(f=>(!c||f.country===c)&&(stale||!f.stale)&&(!sh||f.sharia)&&(!cat||f.category===cat)&&(!q||(f.name+' '+f.manager+' '+f.owner).includes(q)));
}
function renderFunds(){
  if(!FL.loaded)return;
  const rows=fundsFiltered().map(f=>Object.assign({},f,FL.stats[f.id]||{}));
  const {k,dir}=FL.sort,m=dir==='asc'?1:-1;
  rows.sort((a,b)=>{const x=a[k],y=b[k];if(x==null&&y==null)return 0;if(x==null)return 1;if(y==null)return -1;return(typeof x==='string'?x.localeCompare(y,'ar'):x-y)*m;});
  $$('#fundsTable th button').forEach(b=>{if(b.dataset.fsort===k)b.dataset.dir=dir;else delete b.dataset.dir;});
  const cell=v=>v==null?'<td class="muted">—</td>':'<td>'+chgSpan(v,1)+'</td>';
  $('#fundsBody').innerHTML=rows.length?rows.map(f=>{const st=FL.stats[f.id];
    return '<tr class="clickable" data-fid="'+f.id+'"><td><b>'+esc(f.short)+'</b>'+(f.sharia?'<span class="tag b" title="'+esc(SHARIA_WHY[f.sharia])+'">شرعي</span>':'')+(f.stale?'<span class="tag in">متوقف</span>':'')+
      '<br><span class="small muted">'+(!$('#fCountry').value?FCOUNTRY[f.country]+' · ':'')+esc((f.manager||'').slice(0,40))+'</span></td><td>'+f.catAr+'</td>'+
      '<td>'+(f.price?NUM(fp(f.price)):'—')+'<br><span class="small muted">'+(f.date?fmtDate.format(f.date):'')+'</span></td>'+
      (f.ytdN!=null?'<td>'+chgSpan(f.ytdN,1)+'</td>':'<td class="muted">—</td>')+
      (st?cell(st.r1m)+cell(st.r3m)+cell(st.r1y)+(st.dd!=null?'<td>'+NUM(pct(st.dd))+'</td>':'<td class="muted">—</td>')+(st.vol!=null?'<td>'+NUM((st.vol*100).toFixed(1)+'%')+'</td>':'<td class="muted">—</td>')+
        '<td><span class="tag '+st.cov.k+'">'+st.cov.t+'</span></td>':'<td colspan="6" class="small muted">'+(st===undefined?'جارٍ الحساب…':'')+'</td>')+'</tr>';}).join('')
    :'<tr><td colspan="10" class="empty">لا توجد صناديق تطابق التصفية.</td></tr>';
}
async function loadFundStats(){
  const run=++FL.statsRun;const todo=fundsFiltered().filter(f=>!(f.id in FL.stats));if(!todo.length)return;
  let done=0;$('#fundsProg').hidden=false;
  const worker=async()=>{while(todo.length&&run===FL.statsRun){const f=todo.shift();
      const j=await api('/api/history',{code:f.id,ex:'FUND',range:'5y'}).catch(()=>null);
      if(j&&j.ok){const st=fundStats(j.rows);st.cov=coverage(j,st);FL.stats[f.id]=st;}else FL.stats[f.id]=null;
      done++;$('#fundsProg i').style.width=(done/(done+todo.length)*100).toFixed(0)+'%';if(done%5===0)renderFunds();}};
  await Promise.all([worker(),worker(),worker(),worker()]);
  $('#fundsProg').hidden=true;renderFunds();
}

/* ---------- fund card in the analysis view ---------- */
function setFundSections(isFund,shortRecord){
  $('#fundCard').hidden=!isFund;
  for(const id of ['verdictSec','chartCard','levelsRow','calcRow'])$('#'+id).hidden=!!(isFund&&shortRecord);
}
function renderFundCard(){
  const j=S.meta;if(!S.isFund||!j){setFundSections(false);return;}
  const rows=(S.daily||[]).map(d=>[d.t,d.c,d.c,d.c,d.c,0]);
  const st=rows.length?fundStats(rows):{n:0};const li=FL.byId[j.fundId]||{};
  const cat=j.category;$('#fundCat').textContent=FCAT[cat]||'';
  const sb=$('#fundSharia');sb.hidden=!j.sharia;if(j.sharia){sb.textContent='متوافق مع الشريعة';sb.className='badge ok';sb.title=SHARIA_WHY[j.sharia];}
  const ytd=parsePct(j.ytd);const kv=[];
  const lastT=Math.max(st.lastT||0,j.listDate||0);
  kv.push(['آخر سعر',(li.price?fp(li.price):st.n?fp(rows[rows.length-1][4]):'—')+' '+(j.currency||'')]);
  kv.push(['تاريخ آخر سعر',lastT?fmtDate.format(lastT):'—',true]);
  if(ytd!=null)kv.push(['منذ بداية العام',pct(ytd)]);
  if(isYieldFund(cat)){
    if(st.r1m!=null)kv.push(['العائد السنوي المكافئ (آخر شهر)',pct(annualize(st.r1m,30))]);
    if(st.r3m!=null)kv.push(['العائد السنوي المكافئ (3 أشهر)',pct(annualize(st.r3m,91))]);
  }
  for(const [k,v] of [['أسبوع','r1w'],['شهر','r1m'],['3 أشهر','r3m'],['6 أشهر','r6m'],['سنة','r1y']])if(st[v]!=null)kv.push([k,pct(st[v])]);
  if(st.r3y!=null)kv.push(['3 سنوات (سنويًا)',pct(st.r3y)]);
  if(st.since!=null)kv.push(['منذ بداية السجل (سنويًا)',pct(st.since)]);
  if(st.dd!=null)kv.push(['أقصى تراجع خلال سنة',pct(st.dd)]);
  if(st.vol!=null)kv.push(['التذبذب السنوي',(st.vol*100).toFixed(1)+'%']);
  if(S.fundCmp)for(const c of S.fundCmp)kv.push([c[0],c[1]]);
  if(j.manager)kv.push(['مدير الصندوق',j.manager,true]);
  if(j.owner&&j.owner!==j.manager)kv.push(['الجهة المؤسسة',j.owner,true]);
  $('#fundKv').innerHTML=kv.map(([k,v,t])=>'<div><span>'+k+'</span><b'+(t||/[ء-ي]/.test(String(v))?' class="txt"':'')+'>'+esc(v)+'</b></div>').join('');
  const notes=[];
  if(st.n)notes.push('السجل المتاح من '+fmtDate.format(st.firstT)+' ('+st.n+' سعرًا).');
  if((j.gaps||[]).length){const g=j.gaps[j.gaps.length-1];notes.push('توجد فجوة في السجل من '+fmtDate.format(g[0])+' إلى '+fmtDate.format(g[1])+'، ويكتمل السجل يوميًا من الآن أو بالاستيراد.');}
  if(st.n<30)notes.push('السجل قصير، لذلك يظهر الأداء فقط دون تحليل فني. يحفظ البرنامج السعر يوميًا، أو استورد سجل الصندوق.');
  if(isYieldFund(cat)&&st.n>=30)notes.push('صندوق '+FCAT[cat]+': سعره يرتفع تدريجيًا بالعائد، والأهم فيه هو العائد السنوي وثباته وليس مناطق الشراء والبيع.');
  if(j.sharia)notes.push('التصنيف الشرعي: '+SHARIA_WHY[j.sharia]+'.');
  $('#fundNote').textContent=notes.join(' ');
  setFundSections(true,st.n<30);
  if(st.n>=30&&isYieldFund(cat)&&S.A){
    $('#stance').className='stance';$('#stanceText').textContent='صندوق '+FCAT[cat];
    $('#stanceSub').textContent='لا ينطبق عليه التحليل الفني؛ قارن العائد السنوي المكافئ بين الصناديق وبعائد '+(j.country==='SA'?'الودائع البنكية.':'الشهادات.');
    $('#reasons').innerHTML=[['n','العائد السنوي المكافئ لآخر شهر '+NUM(pct(annualize(st.r1m,30)))+'.'],['n','العائد منذ بداية العام '+NUM(pct(ytd))+'.']]
      .filter(r=>!r[1].includes('—')).map(r=>'<li class="'+r[0]+'"><span class="dot"></span><span>'+r[1]+'</span></li>').join('');
    $('#confVal').textContent='—';$('#confBar').style.width='0%';$('#confNote').textContent='';
  }
}
async function loadFundCompare(seq){
  S.fundCmp=null;const cat=S.fundCat;
  let j=null;
  const sa=(S.meta&&S.meta.country)==='SA';
  if(cat==='metals'){j=await api('/api/history',{code:sa?'XAU-SAR-24':'XAU-EGP-24',ex:'GOLD',range:'5y'}).catch(()=>null);if(j&&j.ok)j.label=sa?'جرام الذهب ٢٤ بالريال':'جرام الذهب ٢٤ بالجنيه';}
  else if(cat==='equity'||cat==='balanced'||cat==='other'||cat==='realestate'){j=await api('/api/index',{ex:sa?'SR':'CA',range:'5y'}).catch(()=>null);}
  if(seq!==S.loadSeq||!j||!j.ok)return;
  S.cmpRaw=j.rows;S.cmpLabel=j.label||'مؤشر السوق';$('#cmpChipLabel').textContent='مقارنة بـ'+S.cmpLabel;alignCompare();
  const fs=fundStats(S.daily.map(d=>[d.t,d.c,d.c,d.c,d.c,0])),cs=fundStats(j.rows);
  S.fundCmp=[];for(const [k,v] of [['شهر','r1m'],['3 أشهر','r3m'],['سنة','r1y']])if(fs[v]!=null&&cs[v]!=null)S.fundCmp.push([(cat==='metals'?'الذهب':'مؤشر السوق')+' خلال '+k,pct(cs[v])]);
  renderCompareMetric();renderFundCard();draw();
}
async function importFundHistory(text){
  const id=$('#fund').value;if(!id){setStatus('اختر الصندوق أولًا.',true);return;}
  try{const D=parseData(text);const j=await apiPost('/api/fundimport',{id,rows:D.map(d=>[d.t,d.c])});
    if(!j.ok)throw new Error(j.error);toast('أُضيف '+j.added+' سعرًا إلى سجل الصندوق.');fetchSymbol(id,'FUND');}
  catch(e){setStatus(e.message||'تعذّر استيراد السجل.',true);}
}
function setupFunds(){
  if(!LOCAL)return;
  $('#fundAll').addEventListener('change',fillFundSelect);
  $('#fundCountry').addEventListener('change',()=>{fillFundSelect();Store.set('fundCountry',$('#fundCountry').value);});
  Store.get('fundCountry','SA').then(c=>{$('#fundCountry').value=c;$('#fCountry').value=c;if(FL.loaded){fillFundSelect();fundsMeta();renderFunds();}});
  $('#fund').addEventListener('change',()=>{if($('#fund').value)fetchSymbol($('#fund').value,'FUND');});
  ['fShariaOnly','fCat','fSearch','fCountry','fStale'].forEach(id=>$('#'+id).addEventListener('input',()=>{fundsMeta();renderFunds();loadFundStats();}));
  $('#fCountry').addEventListener('change',()=>{if($('#fCountry').value){$('#fundCountry').value=$('#fCountry').value;fillFundSelect();Store.set('fundCountry',$('#fCountry').value);}});
  $('#fundsReload').addEventListener('click',async()=>{FL.stats={};await loadFundList(true);loadFundStats();});
  $('#fundsTable thead').addEventListener('click',e=>{const b=e.target.closest('button[data-fsort]');if(!b)return;const k=b.dataset.fsort;
    FL.sort={k,dir:FL.sort.k===k&&FL.sort.dir==='desc'?'asc':'desc'};renderFunds();});
  $('#fundsBody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-fid]');if(!tr)return;location.hash='#analysis';applySource('FUND',tr.dataset.fid);fetchSymbol(tr.dataset.fid,'FUND');});
}
