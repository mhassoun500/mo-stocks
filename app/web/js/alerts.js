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

/* ---------- 2.18: an alert remembers which of its pieces are words, so the log shows it in the language now chosen ---------- */
const AW=s=>({p:s});
function AM(...xs){return{msg:xs.map(x=>x&&x.p!=null?x.p:String(x)).join(''),parts:xs.map(x=>x&&x.p!=null?{p:x.p}:String(x))};}
const I18R={m:null};
function i18nRev(){if(I18R.m)return I18R.m;const m={};let t=EN?I18N.t:null;
  if(!t)try{t=JSON.parse(document.getElementById('i18n-data').textContent).t;}catch(e){t={};}
  for(const [ar,en] of Object.entries(t||{}))if(typeof en==='string'&&!(en in m))m[en]=ar;return I18R.m=m;}
/* one piece in the language now chosen, whichever language it was saved in */
function trAny(s){s=String(s==null?'':s);if(EN)return AR_RE.test(s)?_t(s):s;if(AR_RE.test(s))return s;
  const m=i18nRev();if(HAS.call(m,s))return m[s];const k=s.trim();if(k&&HAS.call(m,k)){const lead=s.match(/^\s*/)[0],trail=s.match(/\s*$/)[0];return lead+m[k]+trail;}return s;}
function alertText(l){return l&&Array.isArray(l.parts)?l.parts.map(x=>x&&typeof x==='object'?trAny(x.p):x).join(''):trAny(l&&l.msg);}

/* moving-average pairs: the long-term golden/death cross and the medium-term one */
const MA_PAIRS=[[50,200],[20,50]];

/* crosses and RSI exits on the last candle only */
function techAlerts(D,nm){
  const N=D.length,out=[];if(N<3)return out;
  const c=D.map(d=>d.c),t=D[N-1].t;
  for(const [f,s] of MA_PAIRS){if(N<s+1)continue;
    const a=sma(c,f),b=sma(c,s),p=a[N-2]-b[N-2],q=a[N-1]-b[N-1];
    if(p==null||q==null||!isFinite(p)||!isFinite(q))continue;
    if(p<=0&&q>0)out.push(Object.assign({g:'ma',k:'ma'+f+'-'+s+'-up-'+t},AM(nm,': ',AW(_t('صعد المتوسط')),' '+f+' ',AW(_t('فوق المتوسط')),' '+s,...(f===50&&s===200?[' (',AW(_t('تقاطع ذهبي')),')']:[]))));
    if(p>=0&&q<0)out.push(Object.assign({g:'ma',k:'ma'+f+'-'+s+'-dn-'+t},AM(nm,': ',AW(_t('نزل المتوسط')),' '+f+' ',AW(_t('تحت المتوسط')),' '+s,...(f===50&&s===200?[' (',AW(_t('تقاطع الموت')),')']:[]))));}
  const r=rsiCalc(c,14),r0=r[N-2],r1=r[N-1];
  if(r0!=null&&r1!=null){
    if(r0>70&&r1<=70)out.push(Object.assign({g:'rsi',k:'rsi-ob-'+t},AM(nm,': ',AW(_t('خرج مؤشر RSI من منطقة التشبع الشرائي')),' ('+r1.toFixed(0)+')')));
    if(r0<30&&r1>=30)out.push(Object.assign({g:'rsi',k:'rsi-os-'+t},AM(nm,': ',AW(_t('خرج مؤشر RSI من منطقة التشبع البيعي')),' ('+r1.toFixed(0)+')')));}
  return out;
}

/* the price met the fair value: crossed it on the last candle, or is within 1% of it. Keyed by the level, so it is said once */
function fairAlert(D,nm,fair){
  const N=D.length;if(!(fair>0)||N<2)return null;
  const p=D[N-2].c,c=D[N-1].c,near=Math.abs(c-fair)/fair<=0.01,up=p<fair&&c>=fair,dn=p>fair&&c<=fair;
  if(!near&&!up&&!dn)return null;
  const how=up?_t('صعد السعر إلى السعر العادل'):dn?_t('نزل السعر إلى السعر العادل'):_t('السعر عند السعر العادل');
  return Object.assign({g:'fair',k:'fair-'+Math.round(fair*100)},AM(nm,': ',AW(how),' '+fp(fair)+' (',AW(_t('الآن')),' '+fp(c)+')'));
}

/* events within the chosen number of days */
function eventAlerts(events,nm,days,now){
  now=now||Date.now();const out=[];
  for(const e of events||[]){const d=Math.ceil((e.t-now)/DAY);
    if(d>=0&&d<=days)out.push(Object.assign({g:'ev',k:'ev-'+e.t},AM(nm,': ',AW(_t(e.txt)),' ',...(d===0?[AW(_t('اليوم'))]:d===1?[AW(_t('غدًا'))]:d===2?[AW(_t('بعد يومين'))]:[AW(_t('بعد')),' '+d+' ',AW(_t('أيام'))]))));}
  return out;
}

/* keep only the kinds this asset still wants */
const alertWanted=(it,f)=>!(it.off||[]).includes(f.g);

/* the per-asset checklist shown in the watchlist */
function alertKindsHTML(it,i){const off=new Set(it.off||[]),n=ALERT_KINDS.length-off.size;
  return '<details class="al-kinds"><summary>'+esc(_t('أنواع التنبيه'))+' ('+NUM(n)+'/'+NUM(ALERT_KINDS.length)+')</summary><div class="al-pop">'
    +ALERT_KINDS.map(x=>'<label><input type="checkbox" data-ak="'+x.k+'" data-i="'+i+'"'+(off.has(x.k)?'':' checked')+'> '+esc(_t(x.ar))+'</label>').join('')+'</div></details>';}
