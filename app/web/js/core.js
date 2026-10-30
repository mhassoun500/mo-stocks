/* ================= core: helpers, formatting, storage, prefs, parsing ================= */
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const LOCAL=window.LOCAL_API||null;
const LS_KEY='stock-zones-v2';
const DAY=864e5;

const LOC='ar-EG-u-nu-latn-ca-gregory';
const fmtDate=new Intl.DateTimeFormat(LOC,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const fmtDateTime=new Intl.DateTimeFormat(LOC,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const fmtMon=new Intl.DateTimeFormat(LOC,{month:'short',year:'2-digit',timeZone:'UTC'});
const fmtDay=new Intl.DateTimeFormat(LOC,{day:'numeric',month:'short',timeZone:'UTC'});
const fmtLocal=new Intl.DateTimeFormat(LOC,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const fmtLocalTime=new Intl.DateTimeFormat(LOC,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const fmtVol=new Intl.NumberFormat('ar-EG-u-nu-latn',{notation:'compact',maximumFractionDigits:1});
const fmtMoney=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const dec=p=>p<1?4:p<10?3:2;
const fp=p=>(p==null||!isFinite(p))?'—':p.toFixed(dec(Math.abs(p)));
const pct=(x,d=1)=>(x==null||!isFinite(x))?'—':(x>0?'+':'')+(x*100).toFixed(d)+'%';
const NUM=t=>'<span class="num">'+t+'</span>';
const RANGE=(a,b)=>NUM(fp(a)+' – '+fp(b));
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const chgSpan=(x,d=2)=>'<span class="chg '+(x>=0?'up':'dn')+'">'+pct(x,d)+'</span>';
const todayKey=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ---------- toasts ---------- */
function toast(msg,ms=4200){const t=document.createElement('div');t.className='toast';t.textContent=msg;$('#toasts').appendChild(t);setTimeout(()=>t.remove(),ms);}

/* ---------- server API (desktop app only) ---------- */
async function api(path,params){const r=await fetch(path+(params?'?'+new URLSearchParams(params):''));return r.json();}
async function apiPost(path,body){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});return r.json();}
function openExternal(url){if(LOCAL)api('/api/open',{url}).catch(()=>{});else window.open(url,'_blank','noopener');}

/* ---------- storage: server file in the app, browser storage on the web ---------- */
const Store={
  async get(key,def){
    if(LOCAL){try{const j=await api('/api/store',{key});return j.value==null?def:j.value;}catch(e){return def;}}
    try{const v=localStorage.getItem(LS_KEY+':'+key);return v==null?def:JSON.parse(v);}catch(e){return def;}
  },
  async set(key,value){
    if(LOCAL){try{await apiPost('/api/store',{key,value});}catch(e){}return;}
    try{localStorage.setItem(LS_KEY+':'+key,JSON.stringify(value));}catch(e){}
  }
};

/* ---------- preferences ---------- */
const PREF_DEFAULTS={
  theme:'system',edu:false,font:'Cairo',numFont:'same',background:false,dataSource:'tv',updateRepo:'mhassoun500/mo-stocks',
  ana:{maFast:20,maSlow:50,rsi:14,bb:20,stopMult:0.5,tf:'D'},
  alerts:{enabled:true,interval:15,desktop:true,telegram:true},
  telegram:{enabled:false,token:'',chatId:''},
  report:{enabled:false,time:'09:30',days:[0,1,2,3,4]},
  sharia:{ok:'',no:'',asOf:''},
  calc:{capital:100000,risk:1,fee:0.15},
  egpLocal:{},
};
let P=JSON.parse(JSON.stringify(PREF_DEFAULTS));
function deepMerge(a,b){for(const k in b){if(b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])&&a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k]))deepMerge(a[k],b[k]);else if(b[k]!==undefined)a[k]=b[k];}return a;}
function getPref(path){return path.split('.').reduce((o,k)=>o==null?undefined:o[k],P);}
function setPref(path,val){const ks=path.split('.');let o=P;for(let i=0;i<ks.length-1;i++){o[ks[i]]=o[ks[i]]||{};o=o[ks[i]];}o[ks[ks.length-1]]=val;savePrefs();}
let prefTimer=null;
function savePrefs(){clearTimeout(prefTimer);prefTimer=setTimeout(()=>Store.set('prefs',P),300);}
async function loadPrefs(){const saved=await Store.get('prefs',null);if(saved)deepMerge(P,saved);
  if(P.updateRepo==='mhassoun500/stock-zones'){P.updateRepo=PREF_DEFAULTS.updateRepo;savePrefs();}}  /* renamed to Mo Stocks in 2.4 */

/* ---------- Sharia list ---------- */
function shariaTokens(s){return new Set(String(s||'').toUpperCase().split(/[\s,،;]+/).map(x=>x.replace(/\.(SR|CA)$/,'')).filter(Boolean));}
function shariaStatus(code){
  if(!code)return null;const c=String(code).toUpperCase().replace(/\.(SR|CA)$/,'');
  if(shariaTokens(P.sharia.ok).has(c))return 'ok';
  if(shariaTokens(P.sharia.no).has(c))return 'no';
  return null;
}

/* ---------- markets ---------- */
const EX={SR:{tv:'TADAWUL',ph:'مثال: 1120 أو 2222',idx:'مؤشر تاسي',region:'SR'},CA:{tv:'EGX',ph:'مثال: COMI أو TMGH',idx:'مؤشر إي جي إكس 30',region:'CA'},
  US:{tv:'',ph:'مثال: AAPL أو MSFT',idx:'مؤشر إس آند بي 500',region:'SR'},XX:{tv:'',ph:'مثال: EMAAR.AE',idx:'',region:'SR'},GOLD:{tv:'TVC',ph:'',idx:'مؤشر الدولار',region:'SR'}};
/* Federal Reserve (FOMC) decision days, from federalreserve.gov */
const FOMC=['2026-01-28','2026-03-18','2026-04-29','2026-06-17','2026-07-29','2026-09-16','2026-10-28','2026-12-09',
  '2027-01-27','2027-03-17','2027-04-28','2027-06-09','2027-07-28','2027-09-15','2027-10-27','2027-12-08'].map(s=>Date.parse(s+'T00:00:00Z'));
const SECTOR_AR={'Financial Services':'الخدمات المالية','Basic Materials':'المواد الأساسية','Energy':'الطاقة','Industrials':'الصناعة',
  'Consumer Cyclical':'السلع الكمالية','Consumer Defensive':'السلع الأساسية','Healthcare':'الرعاية الصحية','Real Estate':'العقارات',
  'Utilities':'المرافق','Communication Services':'الاتصالات والإعلام','Technology':'التقنية','':'غير مصنّف'};
const sectorAr=s=>SECTOR_AR[s||'']||s||'غير مصنّف';
/* Tadawul: 9xxx codes trade on Nomu (the parallel market); 4330-4349 are REIT funds on the main market */
function saSegment(code){const c=String(code||'').split('.')[0];if(!/^\d{4}$/.test(c))return'';const n=+c;return n>=9000?'nomu':n>=4330&&n<=4349?'reit':'main';}
const SEG_LABEL={main:'السوق الرئيسية',nomu:'نمو — السوق الموازية',reit:'صندوق ريت · السوق الرئيسية'};
const SEG_TIP={main:'مدرج في السوق الرئيسية لتداول السعودية.',nomu:'مدرج في نمو: سوق موازية بمتطلبات إدراج أخف، وسيولة أقل وتذبذب أعلى عادةً.',reit:'صندوق استثمار عقاري متداول (ريت) في السوق الرئيسية.'};

/* ---------- parsing uploaded / pasted data ---------- */
function normDigits(t){return t.replace(/[٠-٩]/g,d=>String(d.charCodeAt(0)-1632)).replace(/[۰-۹]/g,d=>String(d.charCodeAt(0)-1776)).replace(/٫/g,'.').replace(/٬/g,',');}
function splitLine(line,d){const out=[];let cur='',q=false;
  for(let i=0;i<line.length;i++){const ch=line[i];
    if(q){if(ch==='"'){if(line[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=ch;}
    else if(ch==='"')q=true;else if(ch===d){out.push(cur);cur='';}else cur+=ch;}
  out.push(cur);return out.map(s=>s.trim());}
function num(s,decComma){if(s==null)return NaN;s=String(s).replace(/["\s ]/g,'');if(!s||s==='-')return NaN;
  let mult=1;const m=s.match(/([kmb])$/i);if(m){mult={k:1e3,m:1e6,b:1e9}[m[1].toLowerCase()];s=s.slice(0,-1);}
  if(decComma)s=s.replace(/\./g,'').replace(',','.');else s=s.replace(/,/g,'');
  const v=parseFloat(s);return isNaN(v)?NaN:v*mult;}
function dateParser(samples){
  let order=null;
  for(const s of samples){const m=s.match(/^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})/);if(!m)continue;
    if(m[1].length===4){order='ymd';break;} if(+m[1]>12){order='dmy';break;} if(+m[2]>12){order='mdy';break;}}
  if(!order)order=samples.some(s=>/^\d{1,2}\.\d{1,2}\./.test(s))?'dmy':'mdy';
  return s=>{const m=s.match(/^(\d{1,4})[\/.\-](\d{1,2})[\/.\-](\d{1,4})/);
    if(m){let y,mo,d;
      if(m[1].length===4){y=+m[1];mo=+m[2];d=+m[3];}
      else if(order==='dmy'){d=+m[1];mo=+m[2];y=+m[3];} else {mo=+m[1];d=+m[2];y=+m[3];}
      if(y<100)y+=2000; const t=Date.UTC(y,mo-1,d); return isNaN(t)?NaN:t;}
    const t=Date.parse(s);if(isNaN(t))return NaN;const dt=new Date(t);return Date.UTC(dt.getFullYear(),dt.getMonth(),dt.getDate());};
}
function parseData(text){
  text=normDigits(String(text).replace(/^﻿/,''));
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  if(lines.length<2)throw new Error('الملف فارغ أو يحتوي على سطر واحد فقط.');
  const cnt=(l,d)=>splitLine(l,d).length;
  const delim=['\t',';',','].map(d=>[d,cnt(lines[0],d)]).sort((a,b)=>b[1]-a[1])[0][0];
  const decComma=delim===';';
  const head=splitLine(lines[0],delim).map(h=>h.toLowerCase().replace(/["'‏‎]/g,'').trim());
  const avoid=/%|change|chg|تغي|التغ/;
  const find=re=>head.findIndex(h=>re.test(h)&&!avoid.test(h));
  let ix={d:find(/date|time|تاريخ|التاريخ/),o:find(/^open|افتتاح|الافتتاح|فتح/),h:find(/^high|أعلى|اعلى|الأعلى|الاعلى/),
    l:find(/^low|أدنى|ادنى|الأدنى|الادنى/),v:find(/vol|حجم|الحجم|كمية|الكمية/)};
  ix.c=head.findIndex(h=>/close|price|last|إغلاق|اغلاق|الإغلاق|الاغلاق|أخير|الأخير|اخير|الاخير|السعر/.test(h)&&!/adj/.test(h)&&!avoid.test(h));
  if(ix.c<0)ix.c=find(/adj|close/);
  let body=lines.slice(1);
  if(ix.d<0||ix.c<0){
    const first=splitLine(lines[0],delim);
    if(/\d/.test(first[0])&&first.length>=2){body=lines;const n=first.length;
      ix=n>=6?{d:0,o:1,h:2,l:3,c:4,v:5}:n>=5?{d:0,o:1,h:2,l:3,c:4,v:-1}:{d:0,o:-1,h:-1,l:-1,c:1,v:-1};}
    else throw new Error('لم أجد عمودي التاريخ والإغلاق. تأكد أن السطر الأول يحتوي على عناوين الأعمدة.');
  }
  const rows=body.map(l=>splitLine(l,delim));
  const pd=dateParser(rows.slice(0,200).map(r=>r[ix.d]||''));
  const out=[];
  for(const r of rows){const t=pd(r[ix.d]||'');const c=num(r[ix.c],decComma);if(!isFinite(t)||!isFinite(c)||c<=0)continue;
    out.push({t,o:ix.o>=0?num(r[ix.o],decComma):NaN,h:ix.h>=0?num(r[ix.h],decComma):NaN,l:ix.l>=0?num(r[ix.l],decComma):NaN,c,v:ix.v>=0?num(r[ix.v],decComma):NaN});}
  return finalize(out);
}
function finalize(out){
  out=out.filter(d=>isFinite(d.t)&&isFinite(d.c)&&d.c>0);
  out.sort((a,b)=>a.t-b.t);
  out=out.filter((d,i)=>i===0||d.t!==out[i-1].t);
  for(let i=0;i<out.length;i++){const d=out[i];
    if(!isFinite(d.o)||d.o<=0)d.o=i?out[i-1].c:d.c;
    d.h=Math.max(isFinite(d.h)?d.h:-Infinity,d.o,d.c);
    d.l=Math.min(isFinite(d.l)&&d.l>0?d.l:Infinity,d.o,d.c);
    if(!isFinite(d.v))d.v=0;}
  if(out.length<30)throw new Error('عدد الشموع الصالحة '+out.length+' فقط. تحتاج الأداة 30 شمعة على الأقل، ويُفضّل سنة كاملة.');
  return out;
}
const rowsToData=rows=>finalize(rows.map(a=>({t:a[0],o:a[1]==null?NaN:a[1],h:a[2]==null?NaN:a[2],l:a[3]==null?NaN:a[3],c:a[4],v:a[5]==null?NaN:a[5]})));

/* ---------- fictional sample data ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function sampleData(){
  const rnd=mulberry32(20261028);const g=()=>{let u=0;for(let i=0;i<6;i++)u+=rnd();return u-3;};
  const segs=[{n:110,lo:38.2,hi:45.8},{n:40,lo:44.5,hi:52.6},{n:95,lo:46.8,hi:53.4},{n:45,lo:43.6,hi:48.4},{n:90,lo:45.9,hi:51.2}];
  const total=segs.reduce((s,x)=>s+x.n,0);
  const dates=[];let dt=Date.UTC(2026,9,27);
  while(dates.length<total){const wd=new Date(dt).getUTCDay();if(wd!==5&&wd!==6)dates.push(dt);dt-=DAY;}
  dates.reverse();
  const out=[];let p=40.5,ph=0,k=0;
  for(const sg of segs){const mid=(sg.lo+sg.hi)/2,half=(sg.hi-sg.lo)/2;
    for(let j=0;j<sg.n;j++){ph+=2*Math.PI/(22+rnd()*16);
      const target=mid+half*0.92*Math.sin(ph);
      const o=p*(1+g()*0.003);
      const c=Math.max(1,p+(target-p)*0.22+g()*p*0.008);
      const h=Math.max(o,c)*(1+Math.abs(g())*0.005);
      const l=Math.min(o,c)*(1-Math.abs(g())*0.005);
      const v=Math.round(900000*(1+Math.abs(c-p)/p*60)*(0.6+rnd()*0.8));
      out.push({t:dates[k++],o,h,l,c,v});p=c;}}
  return out;
}
