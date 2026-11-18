/* ================= historical test of the scanner's conditions (2.18) =================
   The conditions are applied to every past day; each time they start to hold is a signal, and what the price did
   5, 20 and 60 trading days later is compared with an ordinary day of the same stocks (the baseline). */
const BT_FIELDS=new Set(['rsi','chgP','ma50P','ma200P']);   /* the ones that can be worked out for any past day */
const BT_H=[5,20,60];
function btSeries(D){const c=D.map(d=>d.c),r=rsiCalc(c,14),m50=sma(c,50),m200=sma(c,200);
  return c.map((v,i)=>({rsi:r[i],chgP:i?(v/c[i-1]-1)*100:null,ma50P:m50[i]?(v/m50[i]-1)*100:null,ma200P:m200[i]?(v/m200[i]-1)*100:null}));}
const quant=(a,q)=>{if(!a.length)return null;const s=a.slice().sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(q*s.length))];};
function backtestRules(stocks,rules,opt){
  opt=opt||{};const use=(rules||[]).filter(r=>BT_FIELDS.has(r.f)),skipped=(rules||[]).filter(r=>!BT_FIELDS.has(r.f)).map(r=>r.f);
  const sig={},base={},per={};for(const h of BT_H){sig[h]=[];base[h]=[];}
  if(!use.length)return{use,skipped,n:0,sig,base,per,stats:null};
  let n=0;
  for(const s of stocks){const D=s.D,N=D.length;if(N<210)continue;const X=btSeries(D);let was=false,cnt=0;
    for(let i=200;i<N;i++){const ok=scanPass(X[i],use);
      for(const h of BT_H)if(i+h<N&&i%5===0)base[h].push(D[i+h].c/D[i].c-1);   /* an ordinary day: one in five, so each stock weighs the same */
      if(ok&&!was){cnt++;n++;for(const h of BT_H)if(i+h<N)sig[h].push(D[i+h].c/D[i].c-1);}
      was=ok;}
    if(cnt)per[s.code]=cnt;}
  const st=a=>a.length?{n:a.length,avg:a.reduce((x,y)=>x+y,0)/a.length,med:quant(a,.5),win:a.filter(x=>x>0).length/a.length}:null;
  const stats={};for(const h of BT_H)stats[h]={sig:st(sig[h]),base:st(base[h])};
  return{use,skipped,n,stats,per};
}
function btHTML(r,meta){
  const fld=k=>_t((SCAN_FIELDS.find(f=>f.k===k)||{}).ar||k);
  if(!r.use.length)return '<p class="err">'+esc(_t('لا يوجد بين شروطك شرط يمكن اختباره تاريخيًا. المتاح: RSI، وتغير اليوم، والبعد عن المتوسطين 50 و200.'))+'</p>';
  const pct=v=>v==null?'—':NUM((v>=0?'+':'')+(v*100).toFixed(1)+'%'),w=v=>v==null?'—':NUM((v*100).toFixed(0)+'%');
  let h='<p class="small">'+esc(_t('عدد الإشارات'))+': <b>'+NUM(r.n)+'</b> '+esc(_t('في'))+' '+NUM(meta.stocks)+' '+esc(_t('شركة'))+' · '+esc(meta.range)+'</p>';
  if(r.n){h+='<div class="tbl-wrap"><table><thead><tr><th>'+esc(_t('بعد'))+'</th><th>'+esc(_t('متوسط العائد بعد الإشارة'))+'</th><th>'+esc(_t('الوسيط'))+'</th><th>'+esc(_t('نسبة الإيجابية'))+'</th><th>'+esc(_t('يوم عادي (للمقارنة)'))+'</th></tr></thead><tbody>'
    +BT_H.map(d=>{const x=r.stats[d];return '<tr><td>'+NUM(d)+' '+esc(_t('يوم تداول'))+'</td><td><b>'+pct(x.sig&&x.sig.avg)+'</b></td><td>'+pct(x.sig&&x.sig.med)+'</td><td>'+w(x.sig&&x.sig.win)+'</td><td class="small muted">'+pct(x.base&&x.base.avg)+' · '+w(x.base&&x.base.win)+'</td></tr>';}).join('')+'</tbody></table></div>';
    const top=Object.entries(r.per).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([c,k])=>c+' ('+k+')').join('، ');
    h+='<p class="small muted">'+esc(_t('أكثر الشركات إشارات'))+': '+NUM(esc(top))+'</p>';}
  if(r.skipped.length)h+='<p class="small muted">'+esc(_t('شروط لم تدخل الاختبار لأن قيمها القديمة غير متوفرة'))+': '+esc([...new Set(r.skipped)].map(fld).join('، '))+'.</p>';
  if(r.n&&r.n<30)h+='<p class="small err">'+esc(_t('عدد الإشارات قليل، فالنتيجة غير موثوقة.'))+'</p>';
  return h+'<p class="small muted">'+esc(_t('الإشارة هي اليوم الذي تبدأ فيه كل الشروط بالتحقق. العائد من سعر إغلاق ذلك اليوم، بلا عمولات. الأداء السابق لا يضمن المستقبل.'))+'</p>';
}
const SBT={busy:false};
async function runScanBacktest(){
  const out=$('#scanBtOut');out.hidden=false;
  if(SBT.busy){SBT.stop=true;return;}
  if(!SC.rows||!SC.rows.length){out.innerHTML='<p class="err">'+esc(_t('شغّل الفحص مرة أولًا لتُختار الشركات.'))+'</p>';return;}
  const rng=$('#scanBtRange').value,sh=shariaChoice(),seg=SC.ex==='SR'?segChoice():null;
  const list=SC.rows.filter(r=>(!seg||seg.has(r.segment))&&(!sh||sh.has(shariaCat(r)))&&(!SC.sector||sectorAr(r.sector)===SC.sector)).slice(0,600);
  SBT.busy=true;SBT.stop=false;$('#scanBtGo').textContent=_t('إيقاف');const stocks=[];let idx=0,done=0;
  const worker=async()=>{while(!SBT.stop&&idx<list.length){const r=list[idx++];
    const j=await api('/api/history',{code:r.symbol,ex:SC.ex==='US'?'US':'XX',range:rng,lite:'1'}).catch(()=>null);
    if(j&&j.ok&&j.rows.length>210)stocks.push({code:r.code,D:rowsToData(j.rows)});
    done++;out.innerHTML='<p class="muted">'+esc(_t('جارٍ جلب الأسعار…'))+' '+NUM(done+' / '+list.length)+'</p>';}};
  try{await Promise.all([worker(),worker(),worker(),worker()]);
    const r=backtestRules(stocks,SCR.rules);out.innerHTML=btHTML(r,{stocks:stocks.length,range:rng==='5y'?_t('آخر 5 سنوات'):_t('آخر سنتين')});}
  finally{SBT.busy=false;$('#scanBtGo').textContent=_t('اختبر الشروط تاريخيًا');}
}
function setupScanBt(){const b=$('#scanBtGo');if(b)b.addEventListener('click',runScanBacktest);}
