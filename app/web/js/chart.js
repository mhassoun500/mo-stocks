/* ================= chart rendering & interaction ================= */
const CH={from:0,to:0,hover:-1,hy:null,L:null,drawMode:null,pending:null,drag:null};
let FN,FA,FA_S,FB='sans-serif';
function canvasFonts(){const cs=getComputedStyle(document.documentElement);FB=cs.getPropertyValue('--f-body').trim()||'sans-serif';
  const n=cs.getPropertyValue('--f-num').trim()||FB;FN='500 11px '+n;FA='600 11.5px '+FB;FA_S='600 10.5px '+FB;}
canvasFonts();

function colors(){const cs=getComputedStyle(document.documentElement);const g=n=>cs.getPropertyValue(n).trim();
  const k=['ink','muted','line','grid','surface','up','down','buy','sell','buy-soft','sell-soft','buy-zone','sell-zone','ma1','ma2','fib','bb','cmp','vp','trend','vol-up','vol-down','label-bg','accent','accent-ink','neutral'];
  const o={};for(const n of k)o[n.replace(/-(\w)/g,(_,c)=>c.toUpperCase())]=g('--'+n);return o;}
function ticks(min,max,count){const span=max-min;if(span<=0)return[min];const s0=span/count;const mag=Math.pow(10,Math.floor(Math.log10(s0)));const nm=s0/mag;
  const step=(nm<1.5?1:nm<3?2:nm<7?5:10)*mag;const out=[];for(let v=Math.ceil(min/step)*step;v<=max+1e-9;v+=step)out.push(+v.toFixed(10));return out;}
function rrect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function idxAtTime(t){const D=S.data;let lo=0,hi=D.length-1;if(!D.length)return -1;if(t<=D[0].t)return 0;if(t>=D[hi].t)return hi;
  while(hi-lo>1){const m=(lo+hi)>>1;if(D[m].t<=t)lo=m;else hi=m;}return lo;}

function resetView(){const N=S.data.length;CH.to=N;CH.from=Math.max(0,N-(S.A?S.A.span:Math.min(N,250)));}
function zoomBy(f,center){const N=S.data.length,n=CH.to-CH.from;const nn=clamp(Math.round(n*f),20,N);
  const c=center!=null&&center>=0?center:CH.from+n/2;const ratio=(c-CH.from)/n;const from=clamp(Math.round(c-ratio*nn),0,N-nn);
  CH.from=from;CH.to=from+nn;draw();}

function chartEvents(){
  const ev=[];if(!S.data.length)return ev;
  const first=S.data[0].t,last=S.data[S.data.length-1].t;
  for(const d of (S.meta&&S.meta.dividends)||[])if(d[0]>=first&&d[0]<=last)ev.push({t:d[0],k:'ت',c:'buy',txt:'توزيع أرباح '+(d[1]!=null?NUM(fp(d[1])):'')});
  for(const s of (S.meta&&S.meta.splits)||[])if(s[0]>=first&&s[0]<=last)ev.push({t:s[0],k:'م',c:'neutral',txt:'تجزئة أو أسهم منحة '+esc(s[1]||'')});
  if(S.profile&&S.profile.ok)for(const e of S.profile.earningsDates||[]){const t=e*1000;if(t>=first&&t<=last+DAY)ev.push({t,k:'ن',c:'accent',txt:'إعلان النتائج'});}
  if(S.ex==='GOLD')for(const t of FOMC)if(t>=first&&t<=last+DAY)ev.push({t,k:'ف',c:'accent',txt:'قرار الفيدرالي الأمريكي'});
  return ev;
}

function draw(){
  const cv=$('#cv'),box=$('#chartBox');const W=box.clientWidth,H=box.clientHeight;if(!W||!H)return;
  const dpr=window.devicePixelRatio||1;
  if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);}
  const ctx=cv.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  canvasFonts();
  const A=S.A;if(!A||!S.data.length)return;const C=colors(),D=S.data,I=S.ind,show=S.show;
  CH.to=clamp(CH.to,Math.min(20,D.length),D.length);CH.from=clamp(CH.from,0,CH.to-Math.min(20,D.length));
  const narrow=W<560;
  const padL=6,padR=narrow?56:68,padT=8,padB=24;
  const plotW=W-padL-padR,totalH=H-padT-padB;
  const subH=Math.max(70,Math.round(totalH*0.2)),gap=16,priceH=totalH-subH-gap;
  const pTop=padT,pBot=pTop+priceH,rTop=pBot+gap,rBot=rTop+subH;
  const st=CH.from,end=CH.to,n=end-st,bw=plotW/n;
  const X=i=>padL+(i-st+0.5)*bw;
  let mn=Infinity,mx=-Infinity;for(let i=st;i<end;i++){if(D[i].l<mn)mn=D[i].l;if(D[i].h>mx)mx=D[i].h;}
  const pad=(mx-mn)*0.06||mx*0.02;mx+=pad;mn-=pad;const vis=mn;mn-=(mx-mn)*(show.vol?0.14:0);
  const Y=p=>pTop+(mx-p)/(mx-mn)*priceH;
  CH.L={padL,padR,bw,st,end,pTop,pBot,rTop,rBot,mn,mx,W,priceH,X,Y};

  /* grid + axis */
  ctx.font=FN;ctx.textBaseline='middle';ctx.textAlign='left';ctx.direction='ltr';
  for(const v of ticks(vis,mx,narrow?4:6)){const y=Math.round(Y(v))+0.5;
    ctx.strokeStyle=C.grid;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();
    ctx.fillStyle=C.muted;ctx.fillText(fp(v),W-padR+6,y);}
  ctx.strokeStyle=C.line;ctx.beginPath();ctx.moveTo(W-padR+0.5,pTop);ctx.lineTo(W-padR+0.5,rBot);ctx.stroke();

  ctx.save();ctx.beginPath();ctx.rect(padL,pTop,plotW,priceH);ctx.clip();
  const labels=[];
  /* volume profile */
  if(show.vp&&A.vp){const vp=A.vp,maxv=Math.max(...vp.vol),wMax=plotW*0.22;
    for(let j=0;j<vp.vol.length;j++){const y1=Y(vp.lo+(j+1)*vp.step),y2=Y(vp.lo+j*vp.step),w=vp.vol[j]/maxv*wMax;
      ctx.fillStyle=j===vp.poc?C.accent:C.vp;ctx.globalAlpha=j===vp.poc?0.45:1;ctx.fillRect(W-padR-w,y1+0.5,w,Math.max(1,y2-y1-1));}
    ctx.globalAlpha=1;}
  /* zones */
  if(show.zones){
    for(const z of A.zones){const y1=Y(z.hi),y2=Y(z.lo);const isS=z.kind==='s',strong=!!z.role;
      ctx.fillStyle=strong?(isS?C.buyZone:C.sellZone):(isS?C.buySoft:C.sellSoft);ctx.fillRect(padL,y1,plotW,y2-y1);
      ctx.strokeStyle=isS?C.buy:C.sell;ctx.lineWidth=strong?1.2:0.8;ctx.globalAlpha=strong?0.9:0.45;
      ctx.beginPath();ctx.moveTo(padL,Math.round(y1)+0.5);ctx.lineTo(W-padR,Math.round(y1)+0.5);ctx.moveTo(padL,Math.round(y2)+0.5);ctx.lineTo(W-padR,Math.round(y2)+0.5);ctx.stroke();
      ctx.globalAlpha=1;
      const name=z.role==='buy'?'منطقة الشراء':z.role==='sell'?'منطقة البيع':(isS?'دعم':'مقاومة');
      const tags=(z.htf?' · أسبوعي':'')+(z.vpStrong||z.hvn?' · حجم':'');
      labels.push({y:(y1+y2)/2,txt:name+'  \u2066'+fp(z.lo)+' – '+fp(z.hi)+'\u2069'+(z.touches?'  · '+z.touches+' لمسات':'')+tags,short:name+'  '+fp(z.mid),col:isS?C.buy:C.sell,strong});}
    const ys=Y(A.stop);ctx.setLineDash([6,4]);ctx.strokeStyle=C.sell;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(padL,Math.round(ys)+0.5);ctx.lineTo(W-padR,Math.round(ys)+0.5);ctx.stroke();ctx.setLineDash([]);
    labels.push({y:ys,txt:'وقف الخسارة  '+fp(A.stop),short:'الوقف  '+fp(A.stop),col:C.sell,strong:false});
  }
  /* gaps */
  if(show.gaps)for(const g of A.gaps||[]){if(g.i>=end)continue;const x=Math.max(padL,X(g.i)-bw/2);
    ctx.fillStyle=C.neutral;ctx.globalAlpha=0.13;ctx.fillRect(x,Y(g.hi),W-padR-x,Y(g.lo)-Y(g.hi));ctx.globalAlpha=1;
    ctx.font=FA_S;ctx.direction='rtl';ctx.textAlign='left';ctx.fillStyle=C.neutral;ctx.fillText('فجوة',x+3,Y(g.hi)-6);ctx.direction='ltr';}
  /* fib */
  if(show.fib){const hi=A.perf.hi,lo=A.perf.lo;ctx.font=FN;
    for(const r of [0,0.236,0.382,0.5,0.618,0.786,1]){const v=hi-(hi-lo)*r,y=Math.round(Y(v))+0.5;
      ctx.strokeStyle=C.fib;ctx.globalAlpha=0.7;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
      ctx.fillStyle=C.fib;ctx.textAlign='right';ctx.textBaseline='bottom';ctx.fillText((r*100).toFixed(1)+'%  '+fp(v),W-padR-4,y-2);}
    ctx.textBaseline='middle';}
  /* Bollinger */
  if(show.bb){const line=(arr)=>{ctx.beginPath();let on=false;for(let i=st;i<end;i++){if(arr[i]==null){on=false;continue;}const x=X(i),y=Y(arr[i]);if(!on){ctx.moveTo(x,y);on=true;}else ctx.lineTo(x,y);}ctx.stroke();};
    ctx.strokeStyle=C.bb;ctx.lineWidth=1;ctx.setLineDash([4,3]);line(I.bbUp);line(I.bbLo);ctx.setLineDash([]);}
  /* volume */
  if(show.vol){let mv=0;for(let i=st;i<end;i++)mv=Math.max(mv,D[i].v||0);
    if(mv>0){const vh=priceH*0.15;for(let i=st;i<end;i++){const h=(D[i].v||0)/mv*vh;ctx.fillStyle=D[i].c>=D[i].o?C.volUp:C.volDown;
      ctx.fillRect(X(i)-Math.max(0.5,bw*0.35),pBot-h,Math.max(1,bw*0.7),h);}}}
  /* candles */
  const bodyW=Math.max(1,bw*0.66);
  if(S.isFund){ /* funds have one price per day: draw a line with a soft area */
    ctx.beginPath();for(let i=st;i<end;i++){const x=X(i),y=Y(D[i].c);if(i===st)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
    ctx.strokeStyle=C.accent;ctx.lineWidth=1.8;ctx.stroke();
    ctx.lineTo(X(end-1),pBot);ctx.lineTo(X(st),pBot);ctx.closePath();ctx.fillStyle=C.accent;ctx.globalAlpha=0.08;ctx.fill();ctx.globalAlpha=1;
  }
  for(let i=st;i<end&&!S.isFund;i++){const d=D[i],up=d.c>=d.o,col=up?C.up:C.down,x=X(i);
    ctx.strokeStyle=col;ctx.fillStyle=col;ctx.lineWidth=1;
    const xx=Math.round(x)+0.5;ctx.beginPath();ctx.moveTo(xx,Y(d.h));ctx.lineTo(xx,Y(d.l));ctx.stroke();
    if(bw>=3){const y1=Y(Math.max(d.o,d.c)),y2=Y(Math.min(d.o,d.c));ctx.fillRect(x-bodyW/2,y1,bodyW,Math.max(1,y2-y1));}}
  /* moving averages */
  if(show.ma){for(const [arr,col] of [[I.ma1,C.ma1],[I.ma2,C.ma2]]){ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.beginPath();let on=false;
      for(let i=st;i<end;i++){if(arr[i]==null){on=false;continue;}const x=X(i),y=Y(arr[i]);if(!on){ctx.moveTo(x,y);on=true;}else ctx.lineTo(x,y);}ctx.stroke();}}
  /* comparison line */
  if(show.cmp&&S.cmp){const base=S.cmp[st]!=null?S.cmp[st]:S.cmp.find((v,i)=>i>=st&&v!=null);
    if(base){const k=D[st].c/base;ctx.strokeStyle=C.cmp;ctx.lineWidth=1.4;ctx.beginPath();let on=false;
      for(let i=st;i<end;i++){const v=S.cmp[i];if(v==null){on=false;continue;}const x=X(i),y=Y(v*k);if(!on){ctx.moveTo(x,y);on=true;}else ctx.lineTo(x,y);}ctx.stroke();
      labels.push({y:Y((S.cmp[end-1]||base)*k),txt:S.cmpLabel,short:S.cmpLabel,col:C.cmp,strong:false});}}
  /* trendlines */
  if(show.trend&&A.tl){for(const t of [A.tl.sup,A.tl.res]){if(!t)continue;
    const x1=X(t.a.i),y1=Y(t.a.p),xe=X(A.N-1+3),ye=Y(t.a.p+t.slope*(A.N-1+3-t.a.i));
    ctx.strokeStyle=C.trend;ctx.lineWidth=1.6;if(t.broken)ctx.setLineDash([5,4]);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(xe,ye);ctx.stroke();ctx.setLineDash([]);
    for(const p of [t.a,t.b]){ctx.fillStyle=C.trend;ctx.beginPath();ctx.arc(X(p.i),Y(p.p),2.6,0,Math.PI*2);ctx.fill();}}}
  /* patterns */
  if(show.pat&&A.pats){ctx.font=FA;ctx.direction='rtl';
    for(const p of A.pats){
      if(p.tri){const t=A.tl.res||A.tl.sup;if(!t)continue;const y=Y(t.now);ctx.fillStyle=C.trend;ctx.textAlign='right';ctx.fillText(p.name,W-padR-6,y-10);continue;}
      const col=p.dir>0?C.buy:C.sell;ctx.strokeStyle=col;ctx.fillStyle=col;
      for(const i of p.pts){const d=D[i];const y=p.dir<0?Y(d.h)-14:Y(d.l)+14;ctx.beginPath();ctx.arc(X(i),y,3,0,Math.PI*2);ctx.fill();}
      const lx=X(p.pts[0]),ly=p.dir<0?Y(p.price)-24:Y(p.price)+24;ctx.textAlign='center';ctx.fillText(p.name+(p.confirmed?' ✓':''),clamp(lx,padL+40,W-padR-40),ly);
      if(p.neck!=null){const yN=Math.round(Y(p.neck))+0.5;ctx.setLineDash([3,3]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(X(p.pts[0]),yN);ctx.lineTo(W-padR,yN);ctx.stroke();ctx.setLineDash([]);}}
    ctx.direction='ltr';}
  /* user drawings */
  const myDraw=S.drawings||[];ctx.strokeStyle=C.accent;ctx.lineWidth=1.4;
  for(const d of myDraw){if(d.type==='h'){const y=Math.round(Y(d.p))+0.5;ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();labels.push({y,txt:'خطي  '+fp(d.p),short:fp(d.p),col:C.accent,strong:false});}
    else{const i1=idxAtTime(d.t1),i2=idxAtTime(d.t2);if(i1<0||i2<=i1)continue;const sl=(d.p2-d.p1)/(i2-i1);
      ctx.beginPath();ctx.moveTo(X(i1),Y(d.p1));ctx.lineTo(X(end-1+2),Y(d.p1+sl*(end-1+2-i1)));ctx.stroke();}}
  if(CH.pending&&CH.hover>=0){ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(X(idxAtTime(CH.pending.t)),Y(CH.pending.p));ctx.lineTo(X(CH.hover),CH.hy);ctx.stroke();ctx.setLineDash([]);}
  /* signals */
  if(show.sig){for(const s of A.sig){if(s.i<st||s.i>=end||s.minor&&bw<4)continue;const d=D[s.i],x=X(s.i);
      if(s.t==='b'){const y=Y(d.l)+7;ctx.fillStyle=C.buy;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5,y+8);ctx.lineTo(x+5,y+8);ctx.closePath();ctx.fill();}
      else{const y=Y(d.h)-7;ctx.fillStyle=C.sell;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-5,y-8);ctx.lineTo(x+5,y-8);ctx.closePath();ctx.fill();}}}
  /* events */
  if(show.events){ctx.font=FA_S;ctx.textAlign='center';ctx.textBaseline='middle';
    for(const e of chartEvents()){const i=idxAtTime(e.t);if(i<st||i>=end)continue;const x=X(i),y=pBot-9;
      ctx.fillStyle=C[e.c]||C.accent;ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.fill();ctx.fillStyle=C.surface;ctx.direction='rtl';ctx.fillText(e.k,x,y+0.5);ctx.direction='ltr';}}
  /* last price line */
  const yc=Math.round(Y(A.close))+0.5;
  if(end===D.length){ctx.strokeStyle=C.accent;ctx.setLineDash([3,3]);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(padL,yc);ctx.lineTo(W-padR,yc);ctx.stroke();ctx.setLineDash([]);}
  ctx.restore();

  /* labels with collision avoidance */
  if(labels.length){ctx.font=FA;ctx.direction='rtl';ctx.textBaseline='middle';
    labels.sort((a,b)=>a.y-b.y);let lastY=-Infinity;const lh=19;
    for(const l of labels){let y=Math.max(l.y,lastY+lh);y=Math.min(Math.max(y,pTop+10),pBot-10);lastY=y;
      const txt=narrow?l.short:l.txt;const w=ctx.measureText(txt).width+14;const x=padL+6;
      ctx.fillStyle=C.labelBg;rrect(ctx,x,y-9,w,18,5);ctx.fill();ctx.strokeStyle=l.col;ctx.lineWidth=l.strong?1.2:0.8;ctx.stroke();
      ctx.fillStyle=l.col;ctx.textAlign='right';ctx.fillText(txt,x+w-7,y+0.5);}
    ctx.direction='ltr';}
  ctx.font=FN;ctx.textAlign='left';ctx.textBaseline='middle';
  const tagW=padR-4;
  if(yc>=pTop&&yc<=pBot){ctx.fillStyle=C.accent;rrect(ctx,W-padR+2,yc-9,tagW,18,4);ctx.fill();ctx.fillStyle=C.accentInk;ctx.fillText(fp(A.close),W-padR+7,yc+0.5);}

  /* lower pane */
  ctx.strokeStyle=C.line;ctx.lineWidth=1;ctx.strokeRect(padL+0.5,rTop+0.5,plotW-1,subH-1);
  ctx.save();ctx.beginPath();ctx.rect(padL,rTop,plotW,subH);ctx.clip();
  let paneLabel='';
  if(S.pane==='macd'){
    let m=0;for(let i=st;i<end;i++)for(const v of [I.macd[i],I.macdSig[i],I.macdHist[i]])if(v!=null)m=Math.max(m,Math.abs(v));m=m||1;
    const MY=v=>rTop+subH/2-v/m*(subH/2-6);
    ctx.strokeStyle=C.grid;ctx.beginPath();ctx.moveTo(padL,Math.round(MY(0))+0.5);ctx.lineTo(W-padR,Math.round(MY(0))+0.5);ctx.stroke();
    for(let i=st;i<end;i++){const h=I.macdHist[i];if(h==null)continue;ctx.fillStyle=h>=0?C.volUp:C.volDown;const y0=MY(0),y1=MY(h);ctx.fillRect(X(i)-Math.max(0.5,bw*0.35),Math.min(y0,y1),Math.max(1,bw*0.7),Math.abs(y1-y0));}
    for(const [arr,col] of [[I.macd,C.ma1],[I.macdSig,C.ma2]]){ctx.strokeStyle=col;ctx.lineWidth=1.3;ctx.beginPath();let on=false;
      for(let i=st;i<end;i++){const v=arr[i];if(v==null){on=false;continue;}const x=X(i),y=MY(v);if(!on){ctx.moveTo(x,y);on=true;}else ctx.lineTo(x,y);}ctx.stroke();}
    paneLabel='الماكد '+(I.macd[end-1]!=null?I.macd[end-1].toFixed(3):'');
  }else{
    const RY=v=>rTop+(100-v)/100*subH;
    ctx.fillStyle=C.sellSoft;ctx.fillRect(padL,RY(100),plotW,RY(70)-RY(100));
    ctx.fillStyle=C.buySoft;ctx.fillRect(padL,RY(30),plotW,RY(0)-RY(30));
    ctx.setLineDash([3,3]);for(const v of [30,70]){const y=Math.round(RY(v))+0.5;ctx.strokeStyle=v===70?C.sell:C.buy;ctx.globalAlpha=0.6;ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();ctx.globalAlpha=1;}ctx.setLineDash([]);
    ctx.strokeStyle=C.ma1;ctx.lineWidth=1.4;ctx.beginPath();let on=false;
    for(let i=st;i<end;i++){const v=I.rsi[i];if(v==null){on=false;continue;}const x=X(i),y=RY(v);if(!on){ctx.moveTo(x,y);on=true;}else ctx.lineTo(x,y);}ctx.stroke();
    paneLabel='القوة النسبية '+(I.rsi[end-1]!=null?I.rsi[end-1].toFixed(1):'');
  }
  ctx.restore();
  if(S.pane!=='macd'){ctx.font=FN;ctx.fillStyle=C.muted;ctx.textAlign='left';const RY=v=>rTop+(100-v)/100*subH;for(const v of [30,70])ctx.fillText(String(v),W-padR+6,RY(v));}
  ctx.font=FA;ctx.direction='rtl';ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillStyle=C.muted;ctx.fillText(paneLabel,W-padR-6,rTop+11);ctx.direction='ltr';

  /* time axis */
  ctx.font=FA;ctx.direction='rtl';ctx.fillStyle=C.muted;ctx.textBaseline='top';ctx.textAlign='center';
  const nl=Math.max(2,Math.floor(plotW/(narrow?90:120)));const step=Math.max(1,Math.ceil(n/nl));
  const spanMs=D[end-1].t-D[st].t,fmt=S.tf==='H'?(spanMs<40*DAY?fmtDateTime:fmtDay):(spanMs<200*DAY?fmtDay:fmtMon);
  for(let i=st+Math.floor(step/2);i<end;i+=step){const x=X(i);ctx.fillText(fmt.format(D[i].t),x,rBot+6);
    ctx.strokeStyle=C.grid;ctx.beginPath();ctx.moveTo(Math.round(x)+0.5,rBot);ctx.lineTo(Math.round(x)+0.5,rBot+4);ctx.stroke();}
  ctx.direction='ltr';

  /* crosshair */
  if(CH.hover>=st&&CH.hover<end){const x=Math.round(X(CH.hover))+0.5;ctx.strokeStyle=C.muted;ctx.globalAlpha=0.6;ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(x,pTop);ctx.lineTo(x,rBot);ctx.stroke();
    if(CH.hy!=null&&CH.hy>=pTop&&CH.hy<=pBot){const y=Math.round(CH.hy)+0.5;ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(W-padR,y);ctx.stroke();
      ctx.setLineDash([]);ctx.globalAlpha=1;const pv=mx-(CH.hy-pTop)/priceH*(mx-mn);
      ctx.font=FN;ctx.fillStyle=C.ink;rrect(ctx,W-padR+2,y-9,tagW,18,4);ctx.fill();ctx.fillStyle=C.surface;ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText(fp(pv),W-padR+7,y+0.5);}
    ctx.setLineDash([]);ctx.globalAlpha=1;}
}

/* ---------- pointer interaction ---------- */
function priceAtY(y){const L=CH.L;return L.mx-(y-L.pTop)/L.priceH*(L.mx-L.mn);}
function setupChartInteraction(){
  const box=$('#chartBox'),cv=$('#cv');
  const idxAtX=x=>{const L=CH.L;return clamp(L.st+Math.floor((x-L.padL)/L.bw),L.st,L.end-1);};
  box.addEventListener('pointerdown',e=>{if(!CH.L||!S.data.length)return;const r=box.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    if(CH.drawMode){if(y<CH.L.pTop||y>CH.L.pBot)return;const i=idxAtX(x),p=priceAtY(y);
      if(CH.drawMode==='h'){addDrawing({type:'h',p});setDrawMode(null);}
      else if(!CH.pending){CH.pending={t:S.data[i].t,p};}
      else{const a=CH.pending;CH.pending=null;if(S.data[i].t!==a.t){const first=a.t<S.data[i].t?a:{t:S.data[i].t,p},second=a.t<S.data[i].t?{t:S.data[i].t,p}:a;addDrawing({type:'t',t1:first.t,p1:first.p,t2:second.t,p2:second.p});}setDrawMode(null);}
      draw();return;}
    if(e.pointerType==='mouse'&&e.button!==0)return;
    CH.drag={x0:x,from0:CH.from,to0:CH.to,moved:false};box.setPointerCapture(e.pointerId);});
  box.addEventListener('pointermove',e=>{const L=CH.L;if(!L)return;const r=box.getBoundingClientRect();const x=e.clientX-r.left,y=e.clientY-r.top;
    if(CH.drag){const dBars=Math.round((CH.drag.x0-x)/L.bw);if(Math.abs(CH.drag.x0-x)>3){CH.drag.moved=true;box.classList.add('panning');}
      const n=CH.drag.to0-CH.drag.from0,f=clamp(CH.drag.from0+dBars,0,S.data.length-n);CH.from=f;CH.to=f+n;}
    if(x<L.padL||x>L.W-L.padR){if(CH.hover!==-1){CH.hover=-1;updateReadout(S.data.length-1);draw();}return;}
    CH.hover=idxAtX(x);CH.hy=y;updateReadout(CH.hover);draw();});
  const endDrag=()=>{CH.drag=null;box.classList.remove('panning');};
  box.addEventListener('pointerup',endDrag);box.addEventListener('pointercancel',endDrag);
  box.addEventListener('pointerleave',()=>{if(CH.drag)return;CH.hover=-1;CH.hy=null;updateReadout(S.data.length-1);draw();});
  box.addEventListener('wheel',e=>{if(!CH.L||!(LOCAL||e.ctrlKey))return;e.preventDefault();zoomBy(e.deltaY>0?1.15:0.87,CH.hover);},{passive:false});
  box.addEventListener('dblclick',()=>{resetView();draw();});
  $('#zoomIn').addEventListener('click',()=>zoomBy(0.75));
  $('#zoomOut').addEventListener('click',()=>zoomBy(1.35));
  $('#zoomReset').addEventListener('click',()=>{resetView();draw();});
  $$('[data-draw]').forEach(b=>b.addEventListener('click',()=>setDrawMode(CH.drawMode===b.dataset.draw?null:b.dataset.draw)));
  $('#drawClear').addEventListener('click',()=>{S.drawings=[];saveDrawings();draw();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&CH.drawMode){setDrawMode(null);draw();}});
  if(window.ResizeObserver)new ResizeObserver(()=>draw()).observe(box);else window.addEventListener('resize',draw);
  try{window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',draw);}catch(e){}
  new MutationObserver(draw).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(draw);
}
function setDrawMode(m){CH.drawMode=m;CH.pending=null;$$('[data-draw]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.draw===m)));
  $('#chartBox').classList.toggle('drawing',!!m);if(m)setStatus(m==='h'?'اضغط على الشارت عند السعر المطلوب لرسم خط أفقي.':'اضغط على نقطتين في الشارت لرسم خط الاتجاه. اضغط Esc للإلغاء.');}
function drawKey(){return (S.ex||'')+':'+(S.code||S.name||'');}
async function loadDrawings(){const all=await Store.get('drawings',{});S.drawings=all[drawKey()]||[];}
async function saveDrawings(){const all=await Store.get('drawings',{});all[drawKey()]=S.drawings;Store.set('drawings',all);}
function addDrawing(d){S.drawings=(S.drawings||[]).concat(d);saveDrawings();setStatus('تم حفظ الرسم. يظهر كلما فتحت هذا الأصل.');}

/* ---------- export analysis as an image ---------- */
async function exportImage(){
  if(!S.A)return;const C=colors(),A=S.A,src=$('#cv');
  const W=1400,chartH=Math.round(src.height/src.width*W),H=210+chartH+60;
  const c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d');
  x.fillStyle=getComputedStyle(document.body).backgroundColor||C.surface;x.fillRect(0,0,W,H);
  try{const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent($('.brand .logo').outerHTML.replace('<svg ','<svg xmlns="http://www.w3.org/2000/svg" '));await img.decode();x.drawImage(img,W-90,24,64,64);}catch(e){}
  x.direction='rtl';x.textAlign='right';x.fillStyle=C.ink;canvasFonts();x.font='700 30px '+FB;x.fillText(S.name||'',W-110,58);
  x.font='500 16px '+FB;x.fillStyle=C.muted;x.fillText('Mo Stocks · '+fmtLocal.format(new Date())+' · الإطار '+({D:'اليومي',W:'الأسبوعي',H:'الساعي'}[S.tf]),W-110,86);
  const stTxt={buy:'منطقة شراء محتملة',sell:'منطقة بيع أو جني أرباح',neutral:'انتظار حتى تتضح الإشارة'}[A.stance];
  x.font='700 24px '+FB;x.fillStyle=A.stance==='buy'?C.buy:A.stance==='sell'?C.sell:C.neutral;x.fillText(stTxt,W-30,134);
  x.font='500 17px '+FB;x.fillStyle=C.ink;
  const items=['آخر سعر '+fp(A.close),A.buy?'الشراء '+fp(A.buy.lo)+' – '+fp(A.buy.hi):'',A.sell?'البيع '+fp(A.sell.lo)+' – '+fp(A.sell.hi):'','الوقف '+fp(A.stop),A.rr!=null?'العائد/المخاطرة 1:'+A.rr.toFixed(2):'',S.confText||''].filter(Boolean);
  x.fillText(items.join('   ·   '),W-30,176);
  x.drawImage(src,0,0,src.width,src.height,0,200,W,chartH);
  x.font='500 13px '+FB;x.fillStyle=C.muted;x.fillText('تحليل فني آلي للمساعدة والتعلّم وليس توصية استثمارية.',W-30,H-24);
  const name=('تحليل '+(S.code||S.name||'')+' '+todayKey()).replace(/\s+/g,' ')+'.png';
  const dataUrl=c.toDataURL('image/png');
  if(LOCAL){const j=await apiPost('/api/save',{filename:name,dataUrl});if(j.ok){toast('حُفظت الصورة في مجلد التنزيلات.');api('/api/reveal',{path:j.path});}else toast(j.error||'تعذّر حفظ الصورة.');return;}
  try{const dl=window.claude&&await window.claude.use('downloads');if(!dl){toast('حفظ الملفات غير متاح هنا.');return;}
    const blob=await (await fetch(dataUrl)).blob();await dl.save({filename:name,data:blob});}
  catch(e){if(e&&e.code!=='declined')toast('تعذّر حفظ الصورة.');}
}
