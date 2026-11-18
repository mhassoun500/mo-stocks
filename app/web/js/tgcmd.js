/* ================= Telegram commands (2.18): answered by the page with the same engine as the screen ================= */
/* what the message asks: help, portfolio, watchlist, an alert, or one asset */
function parseTgCommand(text){
  const t=normDigits(String(text||'')).trim().replace(/^\/+/,'').replace(/@\w+$/,''),low=t.toLowerCase();
  if(!t||/^(start|help|مساعدة|مساعده|الأوامر|اوامر|الاوامر)$/i.test(low))return{k:'help'};
  if(/^(محفظتي|المحفظة|محفظه|portfolio|my portfolio)$/i.test(low))return{k:'port'};
  if(/^(مراقبة|المراقبة|مراقبه|watch|watchlist)$/i.test(low))return{k:'watch'};
  let m=/^(?:تنبيه|نبهني|alert)\s+(?:(SR|CA|US):)?([A-Za-z0-9.\-]{1,12})\s+(فوق|أعلى|اعلى|تحت|أدنى|ادنى|above|below|over|under)\s+([0-9]+(?:\.[0-9]+)?)$/i.exec(t);
  if(m)return{k:'alert',ex:m[1]?m[1].toUpperCase():null,code:m[2].toUpperCase(),dir:/^(فوق|أعلى|اعلى|above|over)$/i.test(m[3])?'above':'below',price:+m[4]};
  if(/^(ذهب|الذهب|gold|xau)$/i.test(low))return{k:'asset',ex:'GOLD',code:'XAU-USD-OZ'};
  if(/^(فضة|الفضة|silver|xag)$/i.test(low))return{k:'asset',ex:'GOLD',code:'XAG-USD-OZ'};
  m=/^(?:(SR|CA|US):)?([A-Za-z0-9.\-]{1,12})$/i.exec(t);
  if(m)return{k:'asset',ex:m[1]?m[1].toUpperCase():null,code:m[2].toUpperCase()};
  return{k:'unknown'};
}
const TG_HELP=()=>[_t('أوامر Mo Stocks:'),'• 1120 '+_t('أو')+' COMI '+_t('أو')+' AAPL '+_t('أو')+' '+_t('ذهب')+' — '+_t('السعر والحكم والمناطق'),
  '• '+_t('محفظتي')+' — '+_t('ملخص المحفظة لكل عملة'),'• '+_t('مراقبة')+' — '+_t('حالة قائمة المراقبة'),
  '• '+_t('تنبيه 1120 فوق 65')+' — '+_t('يضيف تنبيهًا سعريًا'),'• '+_t('مساعدة')+' — '+_t('هذه القائمة'),'',_t('يجيب البرنامج ما دام مفتوحًا أو مصغّرًا على جهازك.')].join('\n');

/* digits are Saudi; a code in the Egyptian market list is Egyptian; anything else is US */
const TGM={eg:null};
async function guessMarket(code){
  if(/^\d{4}$/.test(code))return'SR';
  if(!TGM.eg){const j=await api('/api/universe',{ex:'CA'}).catch(()=>null);TGM.eg=new Set(((j&&j.items)||[]).map(x=>String(x.symbol||'').split('.')[0].toUpperCase()));}
  return TGM.eg.has(code)?'CA':'US';
}
function assetReply(r,code){
  const A=r.A,j=r.j,nm=j.name||code,L=['📈 '+nm+(code&&!nm.includes(code)?' ('+code+')':''),
    _t('السعر')+': '+fp(A.close)+(r.chg!=null?' ('+(r.chg>=0?'+':'')+(r.chg*100).toFixed(2)+'%)':''),
    _t('الحكم')+': '+_t(STANCE_AR[A.stance]||A.stance||'')+(r.conf!=null?' · '+_t('الثقة')+' '+r.conf+'%':'')];
  if(A.buy)L.push(_t('منطقة الشراء')+': '+fp(A.buy.lo)+' – '+fp(A.buy.hi));
  if(A.sell)L.push(_t('منطقة البيع')+': '+fp(A.sell.lo)+' – '+fp(A.sell.hi));
  if(A.stop&&A.t1)L.push(_t('الوقف')+' '+fp(A.stop)+' · '+_t('الهدف الأول')+' '+fp(A.t1)+(A.rr!=null&&isFinite(A.rr)?' · '+_t('العائد إلى المخاطرة')+' 1 : '+A.rr.toFixed(1):''));
  if(A.rsi!=null)L.push('RSI '+A.rsi.toFixed(0)+' · '+_t('الاتجاه')+': '+_t(A.trend||''));
  L.push('',_t('تحليل فني آلي وليس توصية استثمارية.'));return L.join('\n');
}
function watchReply(items,res){
  if(!items.length)return _t('قائمة المراقبة فارغة.');
  const L=['👀 '+_t('قائمة المراقبة')];
  for(const it of items.slice(0,25)){const r=res[it.ex+':'+it.code],nm=it.short||it.name||it.code;
    if(!r||!r.A){L.push('• '+nm+': '+_t('لم يُفحص بعد'));continue;}
    const A=r.A,d=A.buy?(A.close/A.buy.hi-1)*100:null;
    L.push('• '+nm+': '+fp(A.close)+' · '+_t(STANCE_AR[A.stance]||'')+(d!=null?' · '+_t('إلى منطقة الشراء')+' '+(d<=0?_t('داخلها'):d.toFixed(1)+'%'):''));}
  return L.join('\n');
}
async function tgAnswer(cmd){
  if(cmd.k==='help'||cmd.k==='unknown')return(cmd.k==='unknown'?_t('لم أفهم الأمر.')+'\n\n':'')+TG_HELP();
  if(cmd.k==='port'){if(!J.loaded)await loadJournal();await refreshJournalPrices().catch(()=>{});
    const s=weekSummary(J.all);if(!Object.keys(s.cur).length)return _t('لا توجد صفقات مفتوحة.');
    return weeklyText(s,{pur:{},zak:{}}).split('\n').filter(l=>!/^(🤲|🕌)/.test(l)).join('\n');}
  if(cmd.k==='watch'){if(!W.items.length)await loadWatch();return watchReply(W.items,W.res);}
  const ex=cmd.ex||await guessMarket(cmd.code);
  if(cmd.k==='alert'){
    let it=W.items.find(x=>x.ex===ex&&x.code===cmd.code);
    if(!it){const r=await analyzeAsset(ex,cmd.code,true).catch(()=>null);if(!r)return _t('لم أجد السهم')+' '+cmd.code+'.';
      it={ex,code:cmd.code,name:r.j.name||cmd.code,short:'',above:null,below:null};W.items.push(it);}
    it[cmd.dir]=cmd.price;await saveWatch();if(typeof renderWatch==='function')renderWatch();
    return '🔔 '+_t('أُضيف التنبيه')+': '+(it.short||it.name||it.code)+' '+_t(cmd.dir==='above'?'فوق':'تحت')+' '+fp(cmd.price)+'.\n'+_t('يُفحص مع قائمة المراقبة كل')+' '+(P.alerts.interval||15)+' '+_t('دقيقة')+'.';}
  const r=await analyzeAsset(ex,cmd.code,true).catch(()=>null);
  return r&&r.A?assetReply(r,cmd.code):_t('لم أجد السهم')+' '+cmd.code+'. '+_t('اكتب السوق قبل الرمز إن لزم، مثل CA:COMI.');
}
const TGQ={busy:false};
async function tgTick(){
  if(!LOCAL||!P.telegram||!P.telegram.enabled||!P.telegram.commands||TGQ.busy)return;TGQ.busy=true;
  try{const j=await api('/api/tgbot').catch(()=>null);if(!j||!j.ok)return;
    for(const m of j.items||[]){let text;try{text=await tgAnswer(parseTgCommand(m.text));}catch(e){text=_t('تعذّر تنفيذ الأمر:')+' '+(e.message||e);}
      await apiPost('/api/notify',{telegram:true,desktop:false,text}).catch(()=>null);}}
  finally{TGQ.busy=false;}
}
function setupTgCmd(){if(LOCAL)setInterval(tgTick,4000);}
