/* ================= PDF report of the stock, and several stocks on one chart (Phase 6) ================= */
const txt=el=>el?(el.innerText||el.textContent).replace(/[⁦-⁩]/g,'').replace(/\s+/g,' ').trim():'';
/* the report's content, read from what the page shows, so it is in the page's language */
function reportData(){
  const name=S.name||S.code,date=fmtLocal.format(new Date());
  const pairs=$$('#view-analysis .metrics .metric').map(m=>[txt(m.querySelector('.k')),txt(m.querySelector('.v')),txt(m.querySelector('.s'))]).filter(p=>p[0]&&p[1]&&p[1]!=='—');
  const sections=[{title:_t('الملخص'),pairs,cols:2}];
  const A=S.A;
  if(A){const pl=[[_t('الدخول'),fp(A.entry)],[_t('وقف الخسارة'),fp(A.stop)],[_t('الهدف الأول'),fp(A.t1)],[_t('الهدف الثاني'),fp(A.t2)],[_t('الهدف الثالث'),fp(A.t3)],
      [_t('العائد إلى المخاطرة'),A.rr!=null&&isFinite(A.rr)?'1 : '+A.rr.toFixed(2):'—']].filter(p=>p[1]&&p[1]!=='NaN');
    sections.push({title:_t('خطة السعر'),pairs:pl,cols:3});}
  const fv=S.fv;
  if(fv&&fv.fair){sections.push({title:_t('السعر العادل'),pairs:[[_t('السعر العادل'),fp(fv.fair)],[_t('المدى'),fp(fv.lo)+' – '+fp(fv.hi)],[_t('عدد الطرق'),String(fv.n||'')]],cols:3,
    items:(fv.methods||[]).filter(m=>m.use).map(m=>_t(m.name)+': '+fp(m.v))});}
  const nine=$$('#nineList > li').map(li=>txt(li)).filter(Boolean);
  if(nine.length)sections.push({title:_t('تسعة أسئلة قبل القرار'),items:nine});
  const sh=[txt($('#shariaBadge')),txt($('#purBadge'))].filter(Boolean);
  if(sh.length)sections.push({title:_t('الضوابط الشرعية'),items:sh});
  const ai=S.ai&&S.ai.ok&&S.ai.code===S.code&&S.ai.ex===S.ex?S.ai:null;
  if(ai)sections.push({title:_t('رأي المساعد الذكي')+' ('+(ai.name||'')+')',text:ai.text});
  /* the chart on the page's own background colour (a see-through image turns black in a PDF) */
  let chart='';try{const cv=$('#cv'),o=document.createElement('canvas');o.width=cv.width;o.height=cv.height;const g=o.getContext('2d');
    g.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()||'#fff';g.fillRect(0,0,o.width,o.height);g.drawImage(cv,0,0);chart=o.toDataURL('image/png');}catch(e){}
  return{lang:LANG==='en'?'en':'ar',code:S.code,title:name+(S.code&&S.code!==name?' ('+S.code+')':'')+' — '+_t('تقرير السهم'),
    subtitle:date+(A?' · '+_t('السعر')+' '+fp(A.close)+(S.meta&&S.meta.currency?' '+_t(purCurLabel(PUR_CUR[S.ex]||S.meta.currency)):''):'')+' · '+_t('المصدر')+': '+txt($('#srcBadge')),
    chart,sections,disclaimer:txt($('.disclaimer'))||_t('هذه الأداة تحليل فني آلي وليست توصية استثمارية.'),footer:'Mo Stocks · '+date};
}
async function exportPdf(){
  if(!S.A&&!S.isFund){toast(_t('افتح سهمًا أولًا.'));return;}
  const b=$('#pdfBtn');b.disabled=true;
  try{const j=await apiPost('/api/report',{report:reportData()}).catch(()=>null);
    if(j&&j.ok)toast(_t('حُفظ التقرير في مجلد التنزيلات وفُتح.'));else toast((j&&j.error)||_t('تعذّر إنشاء التقرير.'));}
  finally{b.disabled=false;}
}

/* ---------- several assets on one chart: each rebased to 100 on the first common day ---------- */
const PERF_COLORS=['#2563eb','#dc2626','#16a34a','#d97706','#7c3aed'];
/* "SR:2222, US:AAPL, COMI" → [{ex,code}]; a code alone takes the market of the open stock */
function parsePerfList(t,defEx){const out=[],seen=new Set();
  for(const raw of String(t||'').split(/[,\s،]+/)){const s=raw.trim().toUpperCase();if(!s)continue;
    const m=/^(SR|CA|US|GOLD):(.+)$/.exec(s),x=m?{ex:m[1],code:m[2]}:{ex:defEx||'SR',code:s};const k=x.ex+':'+x.code;if(!seen.has(k)){seen.add(k);out.push(x);}}
  return out.slice(0,5);}
function rebase(series){
  const start=Math.max(...series.map(s=>s.rows[0][0]));
  return series.map(s=>{const r=s.rows.filter(x=>x[0]>=start);const b=r.length?r[0][4]:null;return Object.assign({},s,{pts:b?r.map(x=>[x[0],x[4]/b*100]):[],ret:b?r[r.length-1][4]/b-1:null});});
}
function drawPerf(cv,series){
  const dpr=window.devicePixelRatio||1,W=cv.clientWidth||700,Hh=cv.clientHeight||320;cv.width=W*dpr;cv.height=Hh*dpr;
  const c=cv.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.clearRect(0,0,W,Hh);
  const all=series.flatMap(s=>s.pts);if(!all.length)return;
  const t0=Math.min(...all.map(p=>p[0])),t1=Math.max(...all.map(p=>p[0])),v0=Math.min(...all.map(p=>p[1])),v1=Math.max(...all.map(p=>p[1]));
  const pad={l:48,r:12,t:12,b:24},X=t=>pad.l+(t-t0)/(t1-t0||1)*(W-pad.l-pad.r),Y=v=>Hh-pad.b-(v-v0)/(v1-v0||1)*(Hh-pad.t-pad.b);
  const cs=getComputedStyle(document.documentElement),ink=cs.getPropertyValue('--muted').trim()||'#888',line=cs.getPropertyValue('--line').trim()||'#ddd';
  c.font='11px sans-serif';c.fillStyle=ink;c.strokeStyle=line;c.lineWidth=1;
  for(let i=0;i<=4;i++){const v=v0+(v1-v0)*i/4,y=Y(v);c.beginPath();c.moveTo(pad.l,y);c.lineTo(W-pad.r,y);c.stroke();c.fillText(v.toFixed(0),4,y+4);}
  c.strokeStyle=ink;c.setLineDash([4,4]);c.beginPath();c.moveTo(pad.l,Y(100));c.lineTo(W-pad.r,Y(100));c.stroke();c.setLineDash([]);
  series.forEach((s,i)=>{c.strokeStyle=PERF_COLORS[i%PERF_COLORS.length];c.lineWidth=2;c.beginPath();s.pts.forEach((p,j)=>{j?c.lineTo(X(p[0]),Y(p[1])):c.moveTo(X(p[0]),Y(p[1]));});c.stroke();});
  c.fillStyle=ink;c.fillText(fmtDate.format(t0),pad.l,Hh-6);const e=fmtDate.format(t1);c.fillText(e,W-pad.r-c.measureText(e).width,Hh-6);
}
async function runPerf(){
  const list=parsePerfList($('#perfList').value,S.ex);if(S.code&&!list.some(x=>x.ex===S.ex&&x.code===S.code))list.unshift({ex:S.ex,code:S.code});
  const out=$('#perfLegend');if(list.length<2){out.textContent=_t('أضف رمزًا واحدًا على الأقل للمقارنة.');return;}
  out.textContent=_t('جارٍ جلب الأسعار…');const rng=$('#perfRange').value;
  const got=await Promise.all(list.slice(0,5).map(x=>api('/api/history',{code:x.code,ex:x.ex,range:rng}).then(j=>j&&j.ok&&j.rows.length>5?{ex:x.ex,code:x.code,name:j.name||x.code,rows:j.rows}:{ex:x.ex,code:x.code,err:true}).catch(()=>({ex:x.ex,code:x.code,err:true}))));
  const ok=got.filter(g=>!g.err),bad=got.filter(g=>g.err);
  if(ok.length<2){out.textContent=_t('لم تصل أسعار كافية للمقارنة.');return;}
  const ser=rebase(ok);drawPerf($('#perfCv'),ser);
  out.innerHTML=ser.map((s,i)=>'<span class="perf-key"><i style="background:'+PERF_COLORS[i]+'"></i><b>'+esc(s.code)+'</b> '+(s.ret!=null?chgSpan(s.ret):'')+'</span>').join('')
    +(bad.length?'<span class="small muted"> · '+esc(_t('تعذّر جلب'))+': '+esc(bad.map(b=>b.code).join('، '))+'</span>':'')
    +'<span class="small muted"> · '+esc(_t('كل سهم يبدأ من 100 في أول يوم مشترك، فالخط يبين نسبة التغير لا السعر.'))+'</span>';
}
function setupReport(){
  const b=$('#pdfBtn');if(b)b.addEventListener('click',exportPdf);
  const p=$('#perfGo');if(p){p.addEventListener('click',runPerf);$('#perfList').addEventListener('keydown',e=>{if(e.key==='Enter')runPerf();});}
}
