/* ================= alert conditions (Phase 4, step 1) =================
   Pure checks on the last candle, so each alert fires once: its key carries the candle's time (or the level),
   and checkWatchlist only reports keys it has not seen before for that asset. */

/* the kinds a user can turn off per asset; 'k' is the group every flag belongs to */
const ALERT_KINDS=[
  {k:'zone',ar:'دخول منطقة الشراء أو البيع'},
  {k:'brk',ar:'اختراق أو كسر مؤكد بحجم'},
  {k:'pat',ar:'اكتمال نموذج فني'},
  {k:'ma',ar:'تقاطع المتوسطات'},
  {k:'rsi',ar:'خروج RSI من التشبع الشرائي أو البيعي'},
  {k:'fair',ar:'بلوغ السعر العادل'},
  {k:'ev',ar:'اقتراب إعلان النتائج أو التوزيع'},
  {k:'price',ar:'السعر الذي حددته'},
  {k:'trade',ar:'وقف الخسارة والهدف لصفقاتك'}];
const ALERT_DEFAULT_DAYS=3;

/* moving-average pairs: the long-term golden/death cross and the medium-term one */
const MA_PAIRS=[[50,200],[20,50]];

/* crosses and RSI exits on the last candle only */
function techAlerts(D,nm){
  const N=D.length,out=[];if(N<3)return out;
  const c=D.map(d=>d.c),t=D[N-1].t;
  for(const [f,s] of MA_PAIRS){if(N<s+1)continue;
    const a=sma(c,f),b=sma(c,s),p=a[N-2]-b[N-2],q=a[N-1]-b[N-1];
    if(p==null||q==null||!isFinite(p)||!isFinite(q))continue;
    if(p<=0&&q>0)out.push({g:'ma',k:'ma'+f+'-'+s+'-up-'+t,msg:nm+': '+_t('صعد المتوسط')+' '+f+' '+_t('فوق المتوسط')+' '+s+(f===50&&s===200?' ('+_t('تقاطع ذهبي')+')':'')});
    if(p>=0&&q<0)out.push({g:'ma',k:'ma'+f+'-'+s+'-dn-'+t,msg:nm+': '+_t('نزل المتوسط')+' '+f+' '+_t('تحت المتوسط')+' '+s+(f===50&&s===200?' ('+_t('تقاطع الموت')+')':'')});}
  const r=rsiCalc(c,14),r0=r[N-2],r1=r[N-1];
  if(r0!=null&&r1!=null){
    if(r0>70&&r1<=70)out.push({g:'rsi',k:'rsi-ob-'+t,msg:nm+': '+_t('خرج مؤشر RSI من منطقة التشبع الشرائي')+' ('+r1.toFixed(0)+')'});
    if(r0<30&&r1>=30)out.push({g:'rsi',k:'rsi-os-'+t,msg:nm+': '+_t('خرج مؤشر RSI من منطقة التشبع البيعي')+' ('+r1.toFixed(0)+')'});}
  return out;
}

/* the price met the fair value: crossed it on the last candle, or is within 1% of it. Keyed by the level, so it is said once */
function fairAlert(D,nm,fair){
  const N=D.length;if(!(fair>0)||N<2)return null;
  const p=D[N-2].c,c=D[N-1].c,near=Math.abs(c-fair)/fair<=0.01,up=p<fair&&c>=fair,dn=p>fair&&c<=fair;
  if(!near&&!up&&!dn)return null;
  const how=up?_t('صعد السعر إلى السعر العادل'):dn?_t('نزل السعر إلى السعر العادل'):_t('السعر عند السعر العادل');
  return{g:'fair',k:'fair-'+Math.round(fair*100),msg:nm+': '+how+' '+fp(fair)+' ('+_t('الآن')+' '+fp(c)+')'};
}

/* events within the chosen number of days */
function eventAlerts(events,nm,days,now){
  now=now||Date.now();const out=[];
  for(const e of events||[]){const d=Math.ceil((e.t-now)/DAY);
    if(d>=0&&d<=days)out.push({g:'ev',k:'ev-'+e.t,msg:nm+': '+_t(e.txt)+' '+(d===0?_t('اليوم'):d===1?_t('غدًا'):d===2?_t('بعد يومين'):_t('بعد')+' '+d+' '+_t('أيام'))});}
  return out;
}

/* keep only the kinds this asset still wants */
const alertWanted=(it,f)=>!(it.off||[]).includes(f.g);

/* the per-asset checklist shown in the watchlist */
function alertKindsHTML(it,i){const off=new Set(it.off||[]),n=ALERT_KINDS.length-off.size;
  return '<details class="al-kinds"><summary>'+esc(_t('أنواع التنبيه'))+' ('+NUM(n)+'/'+NUM(ALERT_KINDS.length)+')</summary><div class="al-pop">'
    +ALERT_KINDS.map(x=>'<label><input type="checkbox" data-ak="'+x.k+'" data-i="'+i+'"'+(off.has(x.k)?'':' checked')+'> '+esc(_t(x.ar))+'</label>').join('')+'</div></details>';}
