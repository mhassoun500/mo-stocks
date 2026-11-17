/* ================= company file: nine checks before deciding, disclosures, insiders, record =================
   Each check is a fact from the data the app already has, with its source. "Worth a look" means there is
   something to read there, never a reason to buy or sell; a check without data says so instead of guessing. */
const NINE_Q={liquidity:'هل يسهل الدخول والخروج؟',volatility:'كم يتحرك عادةً؟',profit:'ماذا ربحت؟',valuation:'بكم تُسعَّر مقارنة بقطاعها؟',
  debt:'كم عليها من ديون؟',float:'كم من أسهمها متاح للتداول؟',insiders:'ماذا فعل مسؤولوها مؤخرًا؟',filings:'ماذا أفصحت مؤخرًا؟',coming:'ما القادم؟'};
const NINE_KEYS=Object.keys(NINE_Q);
const LIQ_MIN={SR:1e6,CA:1e6,US:5e6};
const medianN=a=>{const s=a.filter(x=>x!=null&&isFinite(x)).sort((x,y)=>x-y);if(!s.length)return null;const m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2;};
const BANK_RE=/financial|bank|insur|تمويل|بنوك|مصارف|تأمين|خدمات مالية/i;
function nineChecks(c){c=c||{};const D=c.data||[],now=c.now||Date.now(),f=c.fund&&c.fund.ok?c.fund.f||{}:{},p=c.profile&&c.profile.ok?c.profile:{},file=c.file&&c.file.ok?c.file:null;
  const out={},na=(k,why)=>out[k]={key:k,status:'na',facts:[],why};
  /* 1 liquidity: sessions with trading and the usual traded value, last 20 sessions */
  const L=D.slice(-20);
  if(L.length>=10){const traded=L.filter(d=>d.v>0).length,val=medianN(L.map(d=>d.v>0?d.v*d.c:null)),min=LIQ_MIN[c.ex]||1e6;
    out.liquidity={key:'liquidity',status:traded<L.length-2||(val!=null&&val<min)?'notable':'usual',facts:[['تداول في',traded+' / '+L.length],['القيمة المعتادة للجلسة',val,'money']],src:'أسعار وأحجام آخر 20 جلسة'};}
  else na('liquidity','سجل الأسعار أقصر من 20 جلسة.');
  /* 2 volatility: the usual daily move and the worst 20-session fall, last 250 sessions */
  const V=D.slice(-251);
  if(V.length>=60){const mv=[];for(let i=1;i<V.length;i++)if(V[i-1].c>0)mv.push(Math.abs(V[i].c/V[i-1].c-1));
    let worst=0;for(let i=1;i<V.length;i++){let hi=0;for(let j=Math.max(0,i-20);j<i;j++)hi=Math.max(hi,V[j].c);if(hi>0)worst=Math.min(worst,V[i].c/hi-1);}
    const typ=medianN(mv);out.volatility={key:'volatility',status:typ>0.03||worst<-0.2?'notable':'usual',facts:[['الحركة اليومية المعتادة',typ,'pct'],['أسوأ تراجع خلال 20 جلسة',worst,'pct']],src:'أسعار الإغلاق لآخر سنة'};}
  else na('volatility','سجل الأسعار أقصر من 60 جلسة.');
  /* 3 profit */
  const ni=f.net_income_ttm!=null?f.net_income_ttm:f.net_income_fy,eg=p.earningsGrowth;
  if(ni!=null||eg!=null)out.profit={key:'profit',status:(ni!=null&&ni<0)||(eg!=null&&eg<-0.25)?'notable':'usual',facts:[['صافي الربح (آخر 12 شهرًا)',ni,'money'],['نمو الأرباح',eg,'pct']],src:'القوائم المالية عبر',srcX:c.fund&&c.fund.source||'Yahoo Finance'};
  else na('profit','لا تتوفر أرقام الأرباح لهذه الشركة.');
  /* 4 valuation against the sector's median P/E */
  const pe=f.price_earnings_ttm!=null?f.price_earnings_ttm:p.trailingPE,spe=c.fund&&c.fund.sectorPE||c.fund&&c.fund.marketPE||null;
  if(pe!=null){const r=spe?pe/spe:null;out.valuation={key:'valuation',status:pe<=0||(r!=null&&(r>1.5||r<0.5))?'notable':'usual',facts:[['مكرر الربحية',pe,'x'],[c.fund&&c.fund.sectorPE?'وسيط القطاع':'وسيط السوق',spe,'x']],src:'الربح المعلن وسعر اليوم؛ الوسيط من شركات القطاع'};}
  else na('valuation','لا يتوفر مكرر الربحية.');
  /* 5 debt */
  const de=p.debtToEquity;
  if(BANK_RE.test((p.sector||'')+' '+(f.sector||'')))na('debt','للبنوك وشركات التمويل: الاقتراض جزء من نشاطها، فلا تُقارن ديونها بغيرها.');
  else if(de!=null)out.debt={key:'debt',status:de>150?'notable':'usual',facts:[['الدين إلى حقوق الملكية',de/100,'x']],src:'Yahoo Finance'};
  else na('debt','لا تتوفر نسبة الدين.');
  /* 6 free float: no source in the app */
  na('float','لا يتوفر في مصادر البرنامج المجانية.');
  /* 7 insiders, last 90 days */
  const d90=now-90*DAY;
  if(file&&file.insiders){const r=file.insiders.filter(x=>x.date>=d90),b=r.filter(x=>x.side==='buy'),s=r.filter(x=>x.side==='sell');
    out.insiders={key:'insiders',status:r.length?'notable':'usual',facts:[['شراء',b.length],['بيع',s.length]],src:'تقارير Form 4 في SEC، آخر 90 يومًا'};}
  else if(file&&file.insidersNeed==='contact')na('insiders','لعرضها أضف بريد التعريف لدى SEC في الإعدادات > مصادر البيانات.');
  else if(file&&file.watching){const r=(file.items||[]).filter(x=>x.type==='insider'&&x.date>=d90);
    out.insiders={key:'insiders',status:r.length?'notable':'usual',facts:[['إعلانات تعاملات',r.length]],src:'إعلانات الشركة منذ',srcX:fmtDate.format(file.since),partial:true};}
  else na('insiders','لا يتوفر مصدر لتعاملات الداخليين لهذا السوق بعد.');
  /* 8 filings */
  if(file&&(file.items||[]).length){const x=file.items[0];out.filings={key:'filings',status:x.date>=now-7*DAY?'notable':'usual',facts:[['آخر إفصاح',x.date,'date'],['',x.form?(SEC_FORM[x.form]||x.form)+(x.title?' — '+x.title:''):x.title,'text']],src:file.source,partial:!file.complete};}
  else if(file&&file.ok&&file.status&&file.status.blocked)na('filings','موقع السوق لا يسمح للبرامج بقراءة الإعلانات. افتحها من الزر في «ملف الشركة».');
  else na('filings',file&&file.ok&&!file.complete?'لم يُرصد إفصاح لهذه الشركة منذ بدأ البرنامج المتابعة.':'لا تتوفر الإفصاحات.');
  /* 9 coming: results date (announced, or estimated from past years) and dividend dates */
  const ev=[];for(const e of p.earningsDates||[])if(e*1000+DAY>now){ev.push(['إعلان النتائج',e*1000,'date']);break;}
  if(!ev.length&&file&&file.record&&file.record.due&&file.record.due.date>now)ev.push(['موعد النتائج المتوقع (تقدير)',file.record.due.date,'date']);
  if(p.exDividendDate&&p.exDividendDate*1000+DAY>now)ev.push(['آخر يوم شراء للتوزيع',p.exDividendDate*1000,'date']);
  if(ev.length)out.coming={key:'coming',status:ev.some(e=>e[1]<now+14*DAY)?'notable':'usual',facts:ev,src:file&&file.record&&file.record.due?'مواعيد الشركة وسجل إفصاحاتها':'مواعيد الشركة'};
  else na('coming','لا يوجد موعد معلن قريب.');
  return NINE_KEYS.map(k=>Object.assign({q:NINE_Q[k]},out[k]));}

function nineFactHTML(v,kind,cur){if(v==null||v==='')return'—';
  if(kind==='pct')return NUM(pct(v,1));if(kind==='x')return NUM((+v).toFixed(1)+'×');if(kind==='date')return NUM(fmtDate.format(v));if(kind==='text')return esc(v);
  if(typeof v==='number')return NUM(Math.abs(v)>=1e5?fmtVol.format(v):fmtMoney.format(v))+(kind==='money'&&cur?' <span class="small muted">'+esc(cur)+'</span>':'');return esc(v);}
function renderNine(){const box=$('#nineList');if(!box)return;
  const list=nineChecks({data:S.daily,fund:S.fund,profile:S.profile,file:S.cfile,ex:S.ex}),cur=S.meta&&S.meta.currency||'';
  const n=list.filter(x=>x.status==='notable').length;$('#nineNote').textContent=_t('يستحق القراءة:')+' '+n+' / 9';
  box.innerHTML=list.map(x=>'<li class="nine '+x.status+'"><span class="kind '+(x.status==='notable'?'n':x.status==='usual'?'s':'')+'">'+esc(_t(x.status==='notable'?'يستحق القراءة':x.status==='usual'?'عادي':'غير متوفر'))+'</span>'
    +'<div><b>'+esc(_t(x.q))+'</b><div class="small">'+(x.status==='na'?'<span class="muted">'+esc(_t(x.why))+'</span>':x.facts.map(([k,v,kind])=>(k?esc(_t(k))+': ':'')+nineFactHTML(v,kind,cur)).join(' · '))+'</div>'
    +(x.src?'<div class="small muted">'+esc(_t('المصدر'))+': '+esc(_t(x.src))+(x.srcX?' '+esc(x.srcX):'')+(x.partial?' · '+esc(_t('سجل جزئي')):'')+'</div>':'')+'</div></li>').join('');}

const FILE_TYPE={insider:'تعاملات الداخليين',results:'نتائج مالية',dividend:'توزيعات',assembly:'جمعيات عامة',halt:'إيقاف التداول',resume:'إعادة التداول',capital:'رأس المال',board:'مجلس الإدارة',contract:'عقود واتفاقيات',other:'أخرى'};
const SEC_FORM={'8-K':'إفصاح عن حدث جوهري','10-Q':'القوائم المالية الربعية','10-K':'التقرير السنوي','4':'تعامل أحد الداخليين','DEF 14A':'دعوة الجمعية العامة','S-3':'تسجيل طرح أسهم','SC 13G':'ملكية كبيرة','SC 13D':'ملكية كبيرة','6-K':'إفصاح شركة أجنبية','20-F':'التقرير السنوي لشركة أجنبية'};
/* a US filing reads as its form's name, then the company's own description (in English, as filed) */
const fileTitle=x=>x.form?esc(_t(SEC_FORM[x.form]||x.form))+(x.title?' — <bdi dir="ltr">'+esc(x.title)+'</bdi>':'')+(x.items?' <span class="small muted" dir="ltr">('+esc(x.items)+')</span>':''):esc(x.title);
const ROLE={director:'عضو مجلس إدارة',officer:'مسؤول تنفيذي',ten:'مالك 10% أو أكثر',other:'داخلي'};
async function loadCompanyFile(seq){S.cfile=null;const row=$('#fileRow');if(!row)return;
  if(!LOCAL||S.source!=='live'||S.isFund||!['SR','CA','US'].includes(S.ex)){row.hidden=true;return;}
  row.hidden=false;$('#fileNote').textContent=_t('جارٍ التحميل…');$('#fileList').innerHTML='';$('#fileIns').innerHTML='';$('#fileRec').innerHTML='';renderNine();
  const j=await api('/api/filings',{code:purCode(S.code),ex:S.ex}).catch(()=>null);if(seq!==S.loadSeq)return;
  S.cfile=j&&j.ok?j:{ok:false,error:j&&j.error||'تعذّر جلب ملف الشركة.'};renderCompanyFile();renderNine();}
/* Saudi and Egyptian markets give only the newest announcements of the whole market, so the app reads them every
   10 minutes and keeps them. This line says plainly whether the last reading worked, so an empty list is understood. */
function feedStatusHTML(j){const st=j.status,site=_t(j.ex==='SR'?'موقع تداول':'موقع البورصة المصرية');
  if(!st)return esc(_t('يبدأ البرنامج قراءة إعلانات السوق بعد دقيقة من فتحه، ثم كل 10 دقائق.'));
  if(st.blocked)return '<b>'+esc(site)+' '+esc(_t('لا يسمح للبرامج بقراءة الإعلانات.'))+'</b> '+esc(_t('اضغط الزر لفتح إعلانات الشركة في متصفحك. يحاول البرنامج مرة واحدة في اليوم.'))
    +'<br><a class="btn sm" href="'+esc(j.link)+'" data-url="'+esc(j.link)+'">'+esc(_t(j.ex==='SR'?'افتح إعلانات الشركة في موقع تداول':'افتح إفصاحات الشركة في موقع البورصة المصرية'))+'</a>';
  if(!st.ok)return '<b>'+esc(_t('تعذّرت قراءة إعلانات السوق'))+'</b> ('+NUM(fmtLocalTime.format(st.at))+'). '+esc(_t('سيحاول البرنامج مرة أخرى بعد 10 دقائق.'));
  return esc(_t('آخر قراءة لإعلانات السوق'))+': '+NUM(fmtLocalTime.format(st.at))+' ('+NUM(st.n)+' '+esc(_t('إعلانًا للسوق كله'))+'). '
    +esc(site)+' '+esc(_t('لا يعطي الإعلانات القديمة، لذلك تظهر هنا الإعلانات منذ'))+' '+NUM(fmtDate.format(j.since||st.at))+' '+esc(_t('فقط.'));}
/* When the official site refuses, the company's news (from the news sources the app already uses) stands in, marked as news. */
function newsAsFileHTML(items){return (items||[]).slice(0,5).map(n=>{const t=Date.parse(n.date);
  return '<li><span class="kind">'+esc(_t('خبر'))+'</span><span><a href="'+esc(n.link)+'" data-url="'+esc(n.link)+'">'+esc(n.title)+'</a> <span class="small muted">'+esc(n.source||'')+'</span></span><span class="small muted">'+(isFinite(t)?fmtDate.format(t):'')+'</span></li>';}).join('');}
async function fileNews(j){const seq=S.loadSeq,q=($('#newsQ')&&$('#newsQ').value)||((S.name||S.code)+' سهم');
  const r=await api('/api/news',{q,region:EX[S.ex]?EX[S.ex].region:'SR'}).catch(()=>null);
  if(seq!==S.loadSeq||S.cfile!==j||!r||!r.ok||!r.items.length)return;
  $('#fileList').innerHTML='<li class="plain"><p class="small muted">'+esc(_t('أخبار عن الشركة من مصادر الأخبار، وليست إفصاحات رسمية:'))+'</p></li>'+newsAsFileHTML(r.items);}
function renderCompanyFile(){const j=S.cfile;if(!j)return;
  if(!j.ok){$('#fileNote').textContent=_t(j.error||'');return;}
  $('#fileNote').innerHTML=esc(_t('المصدر'))+': <a href="'+esc(j.link)+'" data-url="'+esc(j.link)+'">'+esc(_t(j.source))+'</a>';
  $('#fileWatch').hidden=j.complete;
  if(!j.complete)$('#fileWatch').innerHTML=feedStatusHTML(j);
  $('#fileList').innerHTML=(j.items||[]).slice(0,15).map(x=>'<li><span class="kind n">'+esc(_t(FILE_TYPE[x.type]||FILE_TYPE.other))+'</span><span><a href="'+esc(x.url)+'" data-url="'+esc(x.url)+'">'+fileTitle(x)+'</a></span><span class="small muted">'+(x.date?(x.dated?'':esc(_t('رُصد في'))+' ')+fmtDate.format(x.date):'')+'</span></li>').join('')
    ||'<li class="plain"><p class="empty">'+esc(_t(j.complete?'لا توجد إفصاحات.':'لا يوجد إعلان لهذه الشركة منذ بدأ البرنامج المتابعة.'))+'</p></li>';
  if(!j.complete&&!(j.items||[]).length&&j.status&&j.status.blocked)fileNews(j);
  const ins=j.insiders;
  $('#fileInsBox').hidden=!ins&&j.insidersNeed!=='contact';
  if(!ins&&j.insidersNeed==='contact')$('#fileIns').innerHTML='<tr><td colspan="6" class="empty">'+esc(_t('لعرضها أضف بريد التعريف لدى SEC في الإعدادات > مصادر البيانات.'))+'</td></tr>';
  if(ins){const cur=S.meta&&S.meta.currency||'';
    $('#fileIns').innerHTML=ins.length?ins.slice(0,12).map(x=>'<tr><td>'+fmtDate.format(x.date)+'</td><td>'+esc(_t(ROLE[x.role]||ROLE.other))+(x.title?' <span class="small muted" dir="ltr">'+esc(x.title)+'</span>':'')+'</td><td><span class="kind '+(x.side==='buy'?'s':'r')+'">'+esc(_t(x.side==='buy'?'شراء':'بيع'))+'</span></td><td>'+NUM(fmtMoney.format(x.shares))+'</td><td>'+(x.price?NUM(fp(x.price)):'—')+'</td><td>'+(x.value?NUM(fmtVol.format(x.value))+' '+esc(cur):'—')+'</td></tr>').join('')
      :'<tr><td colspan="6" class="empty">'+esc(_t('لا شراء ولا بيع من السوق في تقارير آخر سنة.'))+'</td></tr>';}
  const r=j.record||{},by=r.byType||{};
  $('#fileRec').innerHTML=r.n?'<p class="small">'+NUM(r.n)+' '+esc(_t('إفصاحًا'))+(r.first?' '+esc(_t('في الفترة من'))+' '+fmtDate.format(r.first)+' '+esc(_t('إلى'))+' '+fmtDate.format(r.last):'')+(j.complete?'':' ('+esc(_t('ما رصده البرنامج'))+')')+':</p><p class="small">'
      +Object.keys(by).sort((a,b)=>by[b]-by[a]).map(k=>esc(_t(FILE_TYPE[k]||k))+' '+NUM(by[k])).join(' · ')+'</p>'
      +(r.due?'<p class="small"><b>'+esc(_t('موعد النتائج المتوقع'))+':</b> '+NUM(fmtDate.format(r.due.date))+' <span class="muted">('+esc(_t('تقدير'))+': '+esc(_t(r.due.basis))+'، '+NUM(r.due.from)+' '+esc(_t('مواعيد'))+')</span></p>':''):'';}
function setupCompanyFile(){const b=$('#fileRow');if(!b)return;b.addEventListener('click',e=>{const a=e.target.closest('a[data-url]');if(a){e.preventDefault();openExternal(a.dataset.url);}});}
