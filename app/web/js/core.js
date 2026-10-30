/* ================= core: helpers, formatting, storage, prefs, parsing ================= */
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

/* ---------- language: Arabic (default) or English ----------
   The build wraps every Arabic string literal in the scripts as _t('...'); static page text and
   messages coming from the local server are translated in the page itself (exact phrases only,
   so company and fund names are never altered). */
const I18N=(()=>{try{const d=JSON.parse(document.getElementById('i18n-data').textContent);d.re=(d.p||[]).map(([r,x])=>[new RegExp('^'+r+'$'),x]);return d;}catch(e){return{t:{},re:[]};}})();
const LANG=(()=>{try{return localStorage.getItem('mo-lang')==='en'?'en':'ar';}catch(e){return'ar';}})();
const EN=LANG==='en';
const HAS=Object.prototype.hasOwnProperty;
const _t=s=>{if(!EN||typeof s!=='string')return s;if(HAS.call(I18N.t,s))return I18N.t[s];const v=AR_RE.test(s)?trPhrase(s):null;return v==null?s:v;};
const AR_RE=/[\u0600-\u06FF]/;
function trPhrase(raw){
  const key=raw.replace(/\s+/g,' ').trim();if(!key||!AR_RE.test(key))return null;
  let v=HAS.call(I18N.t,key)?I18N.t[key]:null;
  if(v==null)for(const [re,x] of I18N.re){const m=key.match(re);if(m){v=x.replace(/\$(\d)/g,(_,i)=>m[+i]||'');break;}}
  if(v==null)return null;
  const lead=raw.match(/^\s*/)[0],trail=raw.match(/\s*$/)[0];return lead+v+trail;
}
function trTree(root){
  if(!EN||!root)return;
  if(root.nodeType===3){const v=trPhrase(root.nodeValue);if(v!=null&&v!==root.nodeValue)root.nodeValue=v;return;}
  if(root.nodeType!==1||root.closest&&root.closest('[translate="no"],script,style'))return;
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let n=root;
  do{if(n.nodeType===3){if(AR_RE.test(n.nodeValue)){const v=trPhrase(n.nodeValue);if(v!=null&&v!==n.nodeValue)n.nodeValue=v;}}
     else for(const a of ['placeholder','title','aria-label','label']){const x=n.getAttribute&&n.getAttribute(a);if(x&&AR_RE.test(x)){const v=trPhrase(x);if(v!=null&&v!==x)n.setAttribute(a,v);}}
  }while((n=w.nextNode()));
}
function setupLanguage(){
  const app=$('.app');
  if(EN){document.documentElement.lang='en';document.documentElement.dir='ltr';if(app){app.lang='en';app.dir='ltr';}
    trTree(document.body);
    new MutationObserver(ms=>{for(const m of ms){if(m.type==='characterData')trTree(m.target);else m.addedNodes.forEach(trTree);}})
      .observe(document.body,{childList:true,subtree:true,characterData:true});}
  else{document.documentElement.lang='ar';document.documentElement.dir='rtl';}
  const b=$('#langBtn');if(b){b.textContent=EN?'العربية':'English';b.lang=EN?'ar':'en';
    b.addEventListener('click',()=>switchLanguage(EN?'ar':'en'));}
}
function switchLanguage(l){try{localStorage.setItem('mo-lang',l);}catch(e){}
  if(typeof P!=='undefined'){P.lang=l;Store.set('prefs',P).finally(()=>location.reload());}else location.reload();}
setupLanguage();
const LOCAL=window.LOCAL_API||null;
const LS_KEY='stock-zones-v2';
const DAY=864e5;

const LOC=EN?'en-GB-u-ca-gregory':'ar-EG-u-nu-latn-ca-gregory';
const fmtDate=new Intl.DateTimeFormat(LOC,{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const fmtDateTime=new Intl.DateTimeFormat(LOC,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
const fmtMon=new Intl.DateTimeFormat(LOC,{month:'short',year:'2-digit',timeZone:'UTC'});
const fmtDay=new Intl.DateTimeFormat(LOC,{day:'numeric',month:'short',timeZone:'UTC'});
const fmtLocal=new Intl.DateTimeFormat(LOC,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
const fmtLocalTime=new Intl.DateTimeFormat(LOC,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const fmtVol=new Intl.NumberFormat(EN?'en-US':'ar-EG-u-nu-latn',{notation:'compact',maximumFractionDigits:1});
const fmtMoney=new Intl.NumberFormat('en-US',{maximumFractionDigits:2});
const dec=p=>p<1?4:p<10?3:2;
const fp=p=>(p==null||!isFinite(p))?'—':p.toFixed(dec(Math.abs(p)));
const pct=(x,d=1)=>(x==null||!isFinite(x))?'—':(x>0?'+':'')+(x*100).toFixed(d)+'%';
const NUM=t=>'<span class="num">\u2066'+t+'\u2069</span>';  /* LRI…PDI keep a minus sign before the number in right-to-left text */
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
  if(P.lang&&P.lang!==LANG){try{localStorage.setItem('mo-lang',P.lang);if(localStorage.getItem('mo-lang')===P.lang){location.reload();return;}}catch(e){}}
  if(P.updateRepo==='mhassoun500/stock-zones'){P.updateRepo=PREF_DEFAULTS.updateRepo;savePrefs();}}  /* renamed to Mo Stocks in 2.4 */

/* ---------- Sharia list ---------- */
function shariaTokens(s){return new Set(String(s||'').toUpperCase().split(/[\s,،;]+/).map(x=>x.replace(/\.(SR|CA)$/,'')).filter(Boolean));}
function shariaStatus(code){
  if(!code)return null;const c=String(code).toUpperCase().replace(/\.(SR|CA)$/,'');
  if(shariaTokens(P.sharia.ok).has(c))return 'ok';
  if(shariaTokens(P.sharia.no).has(c))return 'no';
  return null;
}
/* Yaqeen (yaaqen.com) classification of US stocks: شرعي / غير شرعي / محل نظر.
   A copy is built into the page; the desktop app refreshes it from the site every two weeks. */
const YQ={date:'',url:'',ok:new Set(),no:new Set(),doubt:new Set()};
function loadYaaqen(d){if(!d||!d.ok)return;YQ.date=d.date||'';YQ.url=d.url||'';for(const k of ['ok','no','doubt'])YQ[k]=new Set(d[k]||[]);}
try{loadYaaqen(JSON.parse(document.getElementById('sharia-us').textContent));}catch(e){}
function yaaqenStatus(code){const c=String(code||'').toUpperCase();if(!c||/\.(SR|CA)$/.test(c))return null;
  return YQ.ok.has(c)?'ok':YQ.no.has(c)?'no':YQ.doubt.has(c)?'doubt':null;}
const YQ_LABEL={ok:'شرعي (يقين)',no:'غير شرعي (يقين)',doubt:'محل نظر (يقين)'};
/* Saudi lists (Argaam: Al Rajhi Capital, Dr. Al-Osaimi, Albilad Capital) and Egyptian lists
   (about ten sources aggregated by stocks.templatesnippet.com). Built into the page, refreshed weekly by the app. */
const SHL={sa:null,eg:null,spus:null,bitarabi:null};
try{const b=JSON.parse(document.getElementById('sharia-bitarabi').textContent);if(b&&b.rows)SHL.bitarabi=b;}catch(e){}
function loadShariaLists(sa,eg,spus){if(sa&&sa.main)SHL.sa=sa;if(eg&&eg.rows)SHL.eg=eg;if(spus&&spus.tickers)SHL.spus=Object.assign({},spus,{set:new Set(spus.tickers)});}
try{loadShariaLists(JSON.parse($('#sharia-sa').textContent),JSON.parse($('#sharia-eg').textContent),JSON.parse($('#sharia-spus').textContent));}catch(e){}
const VMARK={'1':'✔','0':'✘','2':'؟','-':'—'};
const VWORD={'1':'أجاز','0':'لم يجز','2':'محل نظر','-':'لم يقيّم'};
const SH_WORD={ok:'متوافق',doubt:'مختلف فيه',no:'غير متوافق'};
/* every verdict carries: s (ok/doubt/no), word, count ("2/3"), head (source and date) and refs ([name, '1'|'0'|'2'|'-']) */
function saSharia(code){const c=String(code||'').toUpperCase().replace(/\.SR$/,'');if(!SHL.sa||!/^\d{4}$/.test(c))return null;
  const r=SHL.sa.main[c]||SHL.sa.nomu[c];if(!r)return null;const yes=[...r.v].filter(x=>x==='1').length,n=r.v.length;
  if(!yes&&/^94/.test(c))return null;  /* exchange-traded funds are listed but not rated */
  const s=yes>=2?'ok':yes===1?'doubt':'no';
  return{s,src:'argaam',word:SH_WORD[s],count:yes+'/'+n,head:'أرقام · '+SHL.sa.date,refs:SHL.sa.refs.map((x,i)=>[x[0],r.v[i]||'-'])};}
function egSharia(code){const c=String(code||'').toUpperCase().replace(/\.CA$/,'');const r=SHL.eg&&SHL.eg.rows[c];if(!r)return null;
  const votes=[...r.v].slice(1,-1).filter(x=>x!=='-'),yes=votes.filter(x=>x==='1').length,n=votes.length,egx33=r.v[0]==='1';
  const s=!n?null:yes===0?'no':yes/n>=0.5?'ok':'doubt';
  return{s,src:'eg',egx33,word:s?SH_WORD[s]:'',count:n?yes+'/'+n:'',head:'مصادر مصرية · '+SHL.eg.date,refs:SHL.eg.refs.map((x,i)=>[x,r.v[i]||'-'])};}
function usSharia(code){const c=String(code||'').toUpperCase();const y=yaaqenStatus(c),sp=!!(SHL.spus&&SHL.spus.set.has(c));
  const bt=SHL.bitarabi&&SHL.bitarabi.rows[c]||'-';
  if(!y&&!sp&&bt==='-')return null;
  const refs=[['موقع يقين',y==='ok'?'1':y==='no'?'0':y==='doubt'?'2':'-'],['مؤشر S&P 500 الشرعي (SPUS)',sp?'1':'-'],
      ['البيت العربي · معيار الراجحي',bt]];
  /* majority of the references that cover the stock: more than half approve -> compliant, some approve or doubt -> disputed */
  const vs=refs.map(r=>r[1]).filter(v=>v!=='-'),yes=vs.filter(v=>v==='1').length,n=vs.length;
  const s=yes*2>n?'ok':(yes||vs.includes('2'))?'doubt':'no';
  return{s,src:'us',spus:sp,word:n===1&&y?YQ_LABEL[y]:SH_WORD[s],count:n>1?yes+'/'+n:'',head:'الأسهم الأمريكية',refs};}
/* the verdict for one stock: your own pasted list first, then the market's built-in lists */
function shariaInfo(code,ex){const u=shariaStatus(code);
  if(u)return{s:u,src:'list',word:SH_WORD[u],count:'',head:P.sharia.asOf?'قائمتك · '+P.sharia.asOf:'قائمتك في الإعدادات',refs:[['قائمتك',u==='ok'?'1':'0']]};
  if(ex==='SR'||/\.SR$/i.test(code))return saSharia(code);
  if(ex==='CA'||/\.CA$/i.test(code)){const e=egSharia(code);return e&&e.s?e:null;}
  if(ex==='US')return usSharia(code);
  return null;}
/* a tag with the verdict; hovering it lists every reference and what it said */
function shariaPopHTML(i){return '<span class="sh-pop" hidden><b class="sh-head">'+esc(i.head||'')+'</b>'+(i.note?'<span class="sh-note">'+esc(i.note)+'</span>':'')+
  (i.refs&&i.refs.length?'<span class="sh-list">'+i.refs.map(([n,v])=>'<span class="sh-r v'+(v==='-'?'u':v)+'"><i>'+VMARK[v]+'</i><span>'+esc(n)+'</span><em>'+VWORD[v]+'</em></span>').join('')+'</span>':'')+'</span>';}
function shariaTagHTML(i,cls){if(!i||!i.s)return'';const k=i.s==='ok'||i.s==='auto_ok'?'b':i.s==='doubt'?'in':'x';
  return '<span class="tag sh-tag '+k+(cls?' '+cls:'')+'" tabindex="0">'+esc(i.word||'')+(i.count?' '+NUM(esc(i.count)):'')+shariaPopHTML(i)+'</span>';}
function setupShariaPop(){
  const pop=document.createElement('div');pop.id='shPop';pop.className='sh-float';pop.hidden=true;document.body.appendChild(pop);let cur=null;
  const show=el=>{const src=el.querySelector('.sh-pop');if(!src)return;cur=el;pop.innerHTML=src.innerHTML;pop.hidden=false;
    const r=el.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight,vw=innerWidth,vh=innerHeight;
    let x=document.documentElement.dir==='ltr'?r.left:r.right-w;x=Math.max(8,Math.min(x,vw-w-8));let y=r.bottom+6;if(y+h>vh-8)y=Math.max(8,r.top-h-6);
    pop.style.left=x+'px';pop.style.top=y+'px';};
  const hide=()=>{cur=null;pop.hidden=true;};
  document.addEventListener('mouseover',e=>{const el=e.target.closest&&e.target.closest('.sh-tag');if(el&&el!==cur)show(el);else if(!el&&cur)hide();});
  document.addEventListener('focusin',e=>{const el=e.target.closest&&e.target.closest('.sh-tag');if(el)show(el);});
  document.addEventListener('focusout',hide);window.addEventListener('scroll',hide,{passive:true});
  document.addEventListener('click',e=>{const el=e.target.closest&&e.target.closest('.sh-tag');if(el){e.stopPropagation();if(cur===el)hide();else show(el);}},true);}

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
function saSegment(code){const c=String(code||'').split('.')[0];if(!/^\d{4}$/.test(c))return'';const n=+c;const reit=n>=4330&&n<=4349;
  if(SHL.sa){if(SHL.sa.nomu[c])return'nomu';if(SHL.sa.main[c])return reit?'reit':'main';}  /* Argaam's market lists */
  return n>=9400&&n<=9499?'main':n>=9000?'nomu':reit?'reit':'main';}
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
