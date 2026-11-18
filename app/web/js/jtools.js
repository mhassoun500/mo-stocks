/* ================= trade journal: statistics and broker-statement import ================= */
const SETUPS=['ارتداد من منطقة الشراء','اختراق مقاومة بحجم','تقاطع المتوسطات','خروج RSI من التشبع','اتباع الاتجاه','شراء طويل الأجل','أخرى'];
/* a tag or setup saved while the interface was in one language must match the same one saved in the other */
const sameLabel=(a,b)=>a===b||_t(a)===_t(b);
const tradeRet=t=>t.exit&&t.entry>0?t.exit/t.entry-1:null;
function holdBucket(t){const d=Math.max(0,Math.round(((t.exitDate||Date.now())-t.date)/DAY));
  return d<=7?'أسبوع أو أقل':d<=31?'حتى شهر':d<=92?'حتى 3 أشهر':'أكثر من 3 أشهر';}
const STAT_GROUPS={setup:['الإعداد',t=>t.setup||'بلا إعداد'],market:['السوق',t=>({SR:'السعودية',CA:'مصر',US:'أمريكا',GOLD:'الذهب'})[t.ex]||t.ex],
  hold:['مدة الاحتفاظ',holdBucket],tag:['الوسم',null],stock:['السهم',t=>t.name||t.code]};
/* closed trades grouped by one key: count, success rate, average return and R; returns are unitless, so markets can be mixed */
function groupStats(trades,by){const g={},keyFn=(STAT_GROUPS[by]||STAT_GROUPS.setup)[1];
  for(const t of trades){if(!t.exit)continue;const r=tradeRet(t);if(r==null)continue;
    const keys=by==='tag'?((t.tags||[]).length?t.tags:['بلا وسم']):[keyFn(t)];
    for(const k0 of keys){const k=_t(k0),x=g[k]=g[k]||{key:k,n:0,wins:0,sum:0,Rs:[]};x.n++;if(r>0)x.wins++;x.sum+=r;const R=tradeR(t,t.exit);if(R!=null)x.Rs.push(R);}}
  return Object.values(g).map(x=>({key:x.key,n:x.n,win:x.wins/x.n,avg:x.sum/x.n,avgR:x.Rs.length?x.Rs.reduce((a,b)=>a+b,0)/x.Rs.length:null,nR:x.Rs.length}))
    .sort((a,b)=>b.avg-a.avg||b.n-a.n);}
/* best and worst groups, only among groups with enough trades to say anything */
function bestWorst(list,min){const ok=list.filter(x=>x.n>=(min||3));if(ok.length<2)return null;return{best:ok[0],worst:ok[ok.length-1]};}
/* realised profit for each currency on its own (adding riyals to dollars says nothing) */
function realisedByCur(trades){const by={};for(const t of trades){if(!t.exit)continue;const c=t.ex==='GOLD'?(String(t.code).split('-')[1]||'USD'):(PUR_CUR[t.ex]||t.ex);by[c]=(by[c]||0)+(t.exit-t.entry)*t.qty;}return by;}
/* what each recurring mistake cost: average return of the trades that carry it against those that do not */
function mistakeCost(trades,tags){const cl=trades.filter(t=>t.exit&&tradeRet(t)!=null);const avg=l=>l.length?l.reduce((s,t)=>s+tradeRet(t),0)/l.length:null;
  const has=(t,tag)=>(t.tags||[]).some(x=>sameLabel(x,tag));
  return tags.map(tag=>{const w=cl.filter(t=>has(t,tag)),wo=cl.filter(t=>!has(t,tag));
    return{tag,n:w.length,losses:w.filter(t=>tradeRet(t)<=0).length,avgWith:avg(w),avgWithout:avg(wo)};}).filter(x=>x.n).sort((a,b)=>b.n-a.n);}

/* ---------- broker statement (CSV) ---------- */
function csvParse(text){text=String(text||'').replace(/^﻿/,'');
  const first=(text.split(/\r?\n/).find(l=>l.trim())||'');const d=[',',';','\t'].map(c=>[c,first.split(c).length]).sort((a,b)=>b[1]-a[1])[0][0];
  const rows=[];let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){cell+='"';i++;}else q=false;}else cell+=ch;continue;}
    if(ch==='"')q=true;else if(ch===d){row.push(cell);cell='';}
    else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(c=>c.trim()))rows.push(row.map(c=>c.trim()));row=[];cell='';}
    else cell+=ch;}
  row.push(cell);if(row.some(c=>c.trim()))rows.push(row.map(c=>c.trim()));return rows;}
const IMP_FIELDS=['date','code','side','qty','price','fee','name'];
const IMP_LABEL={date:'التاريخ',code:'الرمز',side:'نوع العملية',qty:'الكمية',price:'السعر',fee:'العمولة',name:'اسم الشركة'};
/* the words looked for inside the broker's file are written as \u codes so the build never translates them:
   an Arabic statement must be read the same way whatever the interface language is */
const IMP_HEAD={date:['date','trade date','\u062a\u0627\u0631\u064a\u062e','\u0627\u0644\u062a\u0627\u0631\u064a\u062e','\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u062a\u0646\u0641\u064a\u0630','\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0635\u0641\u0642\u0629'],code:['symbol','ticker','code','\u0631\u0645\u0632','\u0627\u0644\u0631\u0645\u0632','\u0631\u0645\u0632 \u0627\u0644\u0633\u0647\u0645','\u0643\u0648\u062f'],
  side:['side','type','action','buy/sell','transaction','\u0646\u0648\u0639','\u0627\u0644\u0646\u0648\u0639','\u0627\u0644\u0639\u0645\u0644\u064a\u0629','\u0646\u0648\u0639 \u0627\u0644\u0639\u0645\u0644\u064a\u0629','\u0646\u0648\u0639 \u0627\u0644\u0623\u0645\u0631','\u0634\u0631\u0627\u0621/\u0628\u064a\u0639'],qty:['qty','quantity','shares','units','\u0627\u0644\u0643\u0645\u064a\u0629','\u0643\u0645\u064a\u0629','\u0639\u062f\u062f \u0627\u0644\u0623\u0633\u0647\u0645','\u0627\u0644\u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u0646\u0641\u0630\u0629'],
  price:['price','avg price','execution price','\u0627\u0644\u0633\u0639\u0631','\u0633\u0639\u0631','\u0633\u0639\u0631 \u0627\u0644\u062a\u0646\u0641\u064a\u0630','\u0645\u062a\u0648\u0633\u0637 \u0627\u0644\u0633\u0639\u0631'],fee:['fee','fees','commission','\u0627\u0644\u0639\u0645\u0648\u0644\u0629','\u0639\u0645\u0648\u0644\u0629','\u0627\u0644\u0631\u0633\u0648\u0645'],name:['name','company','security','\u0627\u0644\u0634\u0631\u0643\u0629','\u0627\u0633\u0645 \u0627\u0644\u0634\u0631\u0643\u0629','\u0627\u0644\u0627\u0633\u0645','\u0627\u0633\u0645 \u0627\u0644\u0633\u0647\u0645']};
function impGuess(header){const h=header.map(x=>String(x||'').toLowerCase().replace(/\s+/g,' ').trim()),m={};
  for(const f of IMP_FIELDS){let i=h.findIndex(x=>IMP_HEAD[f].includes(x));if(i<0)i=h.findIndex(x=>IMP_HEAD[f].some(w=>w.length>3&&x.includes(w)));
    if(i>=0&&!Object.values(m).includes(i))m[f]=i;}
  return m;}
function impNum(s){let t=normDigits(String(s==null?'':s)).trim();if(!t)return null;const neg=/^\(.*\)$/.test(t)||/^-/.test(t);
  t=t.replace(/[^\d.,]/g,'');if(/,\d{1,2}$/.test(t)&&!/\./.test(t))t=t.replace(',','.');t=t.replace(/,/g,'');const v=parseFloat(t);return isFinite(v)?(neg?-v:v):null;}
function impDate(s,fmt){const t=normDigits(String(s||'')).trim();let m=t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/),y,mo,d;
  if(m){y=+m[1];mo=+m[2];d=+m[3];}
  else{m=t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);if(!m)return null;let a=+m[1],b=+m[2];y=+m[3];if(y<100)y+=2000;
    const f=fmt==='mdy'||(fmt!=='dmy'&&b>12&&a<=12)?'mdy':'dmy';if(f==='mdy'){mo=a;d=b;}else{d=a;mo=b;}}
  if(!(mo>=1&&mo<=12&&d>=1&&d<=31&&y>1990&&y<2100))return null;return Date.UTC(y,mo-1,d,12);}
const IMP_BUY=['buy','b','bought','purchase','\u0634\u0631\u0627\u0621','\u0634\u0631\u0627\u0621\u064b','\u0627\u0634\u062a\u0631'],IMP_SELL=['sell','s','sold','sale','\u0628\u064a\u0639','\u0645\u0628\u064a\u0639'];
function impSide(s,qty){const t=String(s||'').toLowerCase().trim();if(IMP_SELL.some(w=>t===w||(w.length>2&&t.includes(w))))return'sell';
  if(IMP_BUY.some(w=>t===w||(w.length>2&&t.includes(w))))return'buy';if(!t&&qty!=null)return qty<0?'sell':'buy';return null;}
function impEx(code,ex){if(ex&&ex!=='auto')return ex;return /^\d{4}$/.test(code)?'SR':'US';}
/* rows of the file -> transactions, with every rejected line and its reason */
function impTx(rows,map,opt){opt=opt||{};const tx=[],bad=[];
  for(let i=0;i<rows.length;i++){const r=rows[i],get=f=>map[f]!=null?r[map[f]]:'';
    const code=String(get('code')||'').toUpperCase().replace(/\.(SR|CA)$/,'').trim(),q=impNum(get('qty')),price=impNum(get('price')),date=impDate(get('date'),opt.fmt),side=impSide(get('side'),q);
    const why=!code?'بلا رمز':!date?'تاريخ غير مفهوم':!side?'نوع العملية غير مفهوم':!(q&&Math.abs(q)>0)?'كمية غير صالحة':!(price>0)?'سعر غير صالح':'';
    if(why){bad.push({line:i+2,why});continue;}
    tx.push({date,code,side,qty:Math.abs(q),price,fee:Math.abs(impNum(get('fee'))||0),name:String(get('name')||'').trim(),ex:impEx(code,opt.ex)});}
  return{tx,bad};}
/* first in, first out: each sale closes the oldest shares bought; fees go into the prices; what is left stays open */
function impTrades(tx){const lots={},out=[],unmatched=[];
  const order=tx.map((t,i)=>Object.assign({i},t)).sort((a,b)=>a.date-b.date||(a.side===b.side?a.i-b.i:a.side==='buy'?-1:1));
  for(const t of order){const k=t.ex+'|'+t.code;lots[k]=lots[k]||[];
    if(t.side==='buy'){lots[k].push({qty:t.qty,cost:t.price+t.fee/t.qty,date:t.date,name:t.name,code:t.code,ex:t.ex});continue;}
    let left=t.qty;const px=t.price-t.fee/t.qty;
    while(left>1e-9&&lots[k].length){const l=lots[k][0],q=Math.min(l.qty,left);
      out.push({code:t.code,name:t.name||l.name,ex:t.ex,qty:q,entry:l.cost,date:l.date,exit:px,exitDate:t.date});l.qty-=q;left-=q;if(l.qty<=1e-9)lots[k].shift();}
    if(left>1e-9)unmatched.push({code:t.code,date:t.date,qty:left});}
  for(const k in lots)for(const l of lots[k])if(l.qty>1e-9)out.push({code:l.code,name:l.name,ex:l.ex,qty:l.qty,entry:l.cost,date:l.date,exit:null});
  return{trades:out.map(t=>Object.assign(t,{entry:+t.entry.toFixed(6),exit:t.exit!=null?+t.exit.toFixed(6):null,reason:'مستورد من كشف الوسيط',tags:[],imported:true})),unmatched};}
const impKey=t=>[t.ex,purCode(t.code),Math.round(t.date/DAY),+(+t.qty).toFixed(4),+(+t.entry).toFixed(4),t.exit!=null?+(+t.exit).toFixed(4):'',t.exit!=null?Math.round(t.exitDate/DAY):''].join('|');
function impNew(trades,existing){const have=new Set(existing.map(impKey));return trades.filter(t=>!have.has(impKey(t)));}

/* ---------- the statistics card ---------- */
function renderStats(){if(!$('#stBody'))return;const by=$('#stBy').value||'setup',list=groupStats(J.trades,by),closed=J.trades.filter(t=>t.exit);
  const cell=(v,f)=>v==null?'—':f(v);
  $('#stHead').textContent=_t(STAT_GROUPS[by][0]);
  $('#stBody').innerHTML=list.length?list.map(x=>'<tr><td><b>'+esc(_t(x.key))+'</b></td><td>'+NUM(x.n)+'</td><td>'+NUM(Math.round(x.win*100)+'%')+'</td><td>'+chgSpan(x.avg,1)+'</td><td>'+cell(x.avgR,v=>NUM(v.toFixed(2)+'R'))+'</td></tr>').join('')
    :'<tr><td colspan="5" class="empty">'+esc(_t('أغلق بعض الصفقات لتظهر الإحصاءات.'))+'</td></tr>';
  const bw=bestWorst(list,3),warn=closed.length&&closed.length<20;
  $('#stBest').innerHTML=(bw?'<li><span class="kind s">'+esc(_t('الأفضل'))+'</span><span>'+esc(_t(bw.best.key))+' · '+NUM(bw.best.n)+' '+esc(_t('صفقات'))+' · '+chgSpan(bw.best.avg,1)+'</span><span></span></li>'
      +'<li><span class="kind r">'+esc(_t('الأسوأ'))+'</span><span>'+esc(_t(bw.worst.key))+' · '+NUM(bw.worst.n)+' '+esc(_t('صفقات'))+' · '+chgSpan(bw.worst.avg,1)+'</span><span></span></li>'
      :'<li class="plain"><p class="empty">'+esc(_t('يلزم مجموعتان على الأقل في كل منهما 3 صفقات مغلقة لتحديد الأفضل والأسوأ.'))+'</p></li>')
    +(warn?'<li class="plain"><p class="small muted">⚠ '+esc(_t('العينة أقل من 20 صفقة مغلقة، فالنتائج مؤشر أولي لا حكم.'))+'</p></li>':'');
  const mc=mistakeCost(J.trades,TAGS_BAD);
  $('#stMist').innerHTML=mc.length?mc.map(x=>'<li><span class="kind r">'+esc(_t(x.tag))+'</span><span>'+NUM(x.n)+' '+esc(_t('صفقات'))+'، '+NUM(x.losses)+' '+esc(_t('خاسرة'))+' · '+esc(_t('متوسطها'))+' '+chgSpan(x.avgWith,1)+(x.avgWithout!=null?' '+esc(_t('مقابل'))+' '+chgSpan(x.avgWithout,1)+' '+esc(_t('بدونه')):'')+'</span><span></span></li>').join('')
    :'<li class="plain"><p class="empty">'+esc(_t('وسّم صفقاتك المغلقة بالأخطاء ليظهر هنا أثر كل خطأ.'))+'</p></li>';}

/* ---------- the import card ---------- */
const IMP={rows:null,map:{},out:null};
async function impReadFile(f){const buf=await f.arrayBuffer();let t=new TextDecoder('utf-8').decode(buf);
  if((t.match(/�/g)||[]).length>3){try{t=new TextDecoder('windows-1256').decode(buf);}catch(e){}}return t;}
function impBuild(){if(!IMP.rows)return;const map={};$$('#impMap select').forEach(s=>{if(s.value!=='')map[s.dataset.f]=+s.value;});IMP.map=map;
  const {tx,bad}=impTx(IMP.rows.slice(1),map,{fmt:$('#impFmt').value,ex:$('#impEx').value}),{trades,unmatched}=impTrades(tx),fresh=impNew(trades,J.all);
  IMP.out=fresh;const money=v=>NUM(fp(v));
  $('#impSum').innerHTML=esc(_t('عمليات مقروءة:'))+' '+NUM(tx.length)+' · '+esc(_t('أسطر مرفوضة:'))+' '+NUM(bad.length)+' · '+esc(_t('صفقات ناتجة:'))+' '+NUM(trades.length)
    +(trades.length-fresh.length?' · '+esc(_t('موجودة مسبقًا ولن تُكرّر:'))+' '+NUM(trades.length-fresh.length):'')
    +(unmatched.length?'<br>⚠ '+esc(_t('بيع بلا شراء سابق في الملف (لم يُستورد):'))+' '+unmatched.map(u=>esc(u.code)+' ('+NUM(fmtMoney.format(u.qty))+')').join('، '):'')
    +(bad.length?'<br>'+bad.slice(0,8).map(b=>esc(_t('سطر'))+' '+NUM(b.line)+': '+esc(_t(b.why))).join(' · ')+(bad.length>8?' …':''):'');
  $('#impPrev').innerHTML=fresh.length?fresh.slice(0,60).map(t=>'<tr><td><b>'+esc(t.name||t.code)+'</b> <span class="small muted num">'+esc(t.code)+'</span></td><td>'+esc(t.ex)+'</td><td>'+NUM(fmtMoney.format(t.qty))+'</td><td>'+money(t.entry)+'<br><span class="small muted">'+fmtDate.format(t.date)+'</span></td><td>'+(t.exit!=null?money(t.exit)+'<br><span class="small muted">'+fmtDate.format(t.exitDate)+'</span>':'<span class="tag">'+esc(_t('مفتوحة'))+'</span>')+'</td></tr>').join('')
    :'<tr><td colspan="5" class="empty">'+esc(_t('لا توجد صفقات جديدة في الملف.'))+'</td></tr>';
  $('#impGo').disabled=!fresh.length;$('#impGo').textContent=_t('أضف إلى السجل')+' ('+fresh.length+')';}
function impShowMap(){const h=IMP.rows[0],g=impGuess(h);
  $('#impMap').innerHTML=IMP_FIELDS.map(f=>'<label class="field"><span>'+esc(_t(IMP_LABEL[f]))+'</span><select data-f="'+f+'"><option value="">'+esc(_t('— لا يوجد —'))+'</option>'+h.map((c,i)=>'<option value="'+i+'"'+(g[f]===i?' selected':'')+'>'+esc(c||('#'+(i+1)))+'</option>').join('')+'</select></label>').join('');
  $('#impBox').hidden=false;impBuild();}
function setupJTools(){
  const sel=$('#fSetupList');if(sel)sel.innerHTML=SETUPS.map(s=>'<option value="'+esc(_t(s))+'">').join('');
  $('#stBy').addEventListener('change',renderStats);
  $('#impFile').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;
    if(f.size>5*1024*1024){toast(_t('الملف أكبر من 5 ميجابايت.'));return;}
    if(!/\.(csv|txt)$/i.test(f.name)){toast(_t('اختر ملف CSV. احفظ ملف Excel بصيغة CSV أولًا.'));return;}
    const rows=csvParse(await impReadFile(f));if(rows.length<2){toast(_t('لم أجد صفوفًا في الملف.'));return;}IMP.rows=rows;impShowMap();});
  ['#impFmt','#impEx'].forEach(s=>$(s).addEventListener('change',impBuild));
  $('#impMap').addEventListener('change',impBuild);
  $('#impGo').addEventListener('click',async()=>{if(!IMP.out||!IMP.out.length)return;const n=IMP.out.length;
    for(const t of IMP.out)jAdd(Object.assign({id:Date.now().toString(36)+Math.random().toString(36).slice(2,8)},t));
    await saveJournal();IMP.out=null;IMP.rows=null;$('#impBox').hidden=true;$('#impFile').value='';renderJournal();refreshJournalPrices();toast(_t('أُضيفت صفقات من الكشف:')+' '+n);});
  $('#impCancel').addEventListener('click',()=>{IMP.rows=null;IMP.out=null;$('#impBox').hidden=true;$('#impFile').value='';});}
