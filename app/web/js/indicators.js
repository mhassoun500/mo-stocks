/* ================= indicators (all causal: value at i uses bars <= i) ================= */
function sma(a,n){const o=new Array(a.length).fill(null);let s=0;for(let i=0;i<a.length;i++){s+=a[i];if(i>=n)s-=a[i-n];if(i>=n-1)o[i]=s/n;}return o;}
function ema(a,n){const o=new Array(a.length).fill(null);const k=2/(n+1);let e=null,s=0;
  for(let i=0;i<a.length;i++){if(a[i]==null)continue;if(e==null){s+=a[i];if(i===n-1){e=s/n;o[i]=e;}continue;}e=a[i]*k+e*(1-k);o[i]=e;}return o;}
function rsiCalc(c,n){const o=new Array(c.length).fill(null);let g=0,l=0;
  for(let i=1;i<c.length;i++){const d=c[i]-c[i-1],up=Math.max(d,0),dn=Math.max(-d,0);
    if(i<=n){g+=up;l+=dn;if(i===n){g/=n;l/=n;o[i]=l===0?100:100-100/(1+g/l);}}
    else{g=(g*(n-1)+up)/n;l=(l*(n-1)+dn)/n;o[i]=l===0?100:100-100/(1+g/l);}}
  return o;}
function atrCalc(D,n){const o=new Array(D.length).fill(null);let a=0;
  for(let i=0;i<D.length;i++){const tr=i===0?D[i].h-D[i].l:Math.max(D[i].h-D[i].l,Math.abs(D[i].h-D[i-1].c),Math.abs(D[i].l-D[i-1].c));
    if(i<n){a+=tr;if(i===n-1){a/=n;o[i]=a;}}else{a=(a*(n-1)+tr)/n;o[i]=a;}}
  return o;}
function macdCalc(c){const e12=ema(c,12),e26=ema(c,26);const m=c.map((_,i)=>e12[i]!=null&&e26[i]!=null?e12[i]-e26[i]:null);
  const firstIdx=m.findIndex(v=>v!=null);const sig=new Array(c.length).fill(null);
  if(firstIdx>=0){const s=ema(m.slice(firstIdx),9);for(let i=0;i<s.length;i++)sig[firstIdx+i]=s[i];}
  return{macd:m,signal:sig,hist:m.map((v,i)=>v!=null&&sig[i]!=null?v-sig[i]:null)};}
function bbCalc(c,n,k=2){const mid=sma(c,n);const up=new Array(c.length).fill(null),lo=new Array(c.length).fill(null);
  for(let i=n-1;i<c.length;i++){let s=0;for(let j=i-n+1;j<=i;j++)s+=(c[j]-mid[i])**2;const sd=Math.sqrt(s/n);up[i]=mid[i]+k*sd;lo[i]=mid[i]-k*sd;}
  return{mid,up,lo};}
function computeInd(D){
  const c=D.map(d=>d.c),v=D.map(d=>d.v||0),a=P.ana;
  const m=macdCalc(c),b=bbCalc(c,a.bb||20);
  return{ma1:sma(c,a.maFast),ma2:sma(c,a.maSlow),rsi:rsiCalc(c,a.rsi),atr:atrCalc(D,14),
    macd:m.macd,macdSig:m.signal,macdHist:m.hist,bbUp:b.up,bbLo:b.lo,bbMid:b.mid,volMa:sma(v,20)};
}

/* ---------- optional extra indicators (Phase 2, step 4): trend strength, volume flow, divergence, relative volume ---------- */
/* ADX with +DI and -DI (Wilder smoothing): how strong the trend is, whatever its direction */
function adxCalc(D,n){
  n=n||14;const N=D.length,adx=new Array(N).fill(null),pdi=new Array(N).fill(null),mdi=new Array(N).fill(null);
  if(N<2*n+1)return{adx,pdi,mdi};
  let trS=0,pS=0,mS=0;const dx=new Array(N).fill(null);
  for(let i=1;i<N;i++){
    const up=D[i].h-D[i-1].h,dn=D[i-1].l-D[i].l,pm=up>dn&&up>0?up:0,mm=dn>up&&dn>0?dn:0;
    const tr=Math.max(D[i].h-D[i].l,Math.abs(D[i].h-D[i-1].c),Math.abs(D[i].l-D[i-1].c));
    if(i<=n){trS+=tr;pS+=pm;mS+=mm;if(i<n)continue;}else{trS+=tr-trS/n;pS+=pm-pS/n;mS+=mm-mS/n;}
    const p=trS?100*pS/trS:0,m=trS?100*mS/trS:0;pdi[i]=p;mdi[i]=m;dx[i]=(p+m)?100*Math.abs(p-m)/(p+m):0;}
  let a=0;for(let i=n;i<2*n;i++)a+=dx[i];a/=n;adx[2*n-1]=a;
  for(let i=2*n;i<N;i++){a=(a*(n-1)+dx[i])/n;adx[i]=a;}
  return{adx,pdi,mdi};
}
/* on-balance volume: running total of volume, added on up days and subtracted on down days */
function obvCalc(D){const o=new Array(D.length).fill(0);for(let i=1;i<D.length;i++){const d=D[i].c-D[i-1].c;o[i]=o[i-1]+(d>0?1:d<0?-1:0)*(D[i].v||0);}return o;}
/* does volume flow agree with price over the last n candles? flow = OBV change as a share of the volume traded */
function obvRead(D,n){
  n=n||20;const N=D.length;if(N<n+2)return null;const ob=obvCalc(D);let vol=0;for(let i=N-n;i<N;i++)vol+=D[i].v||0;
  if(!(vol>0))return null;
  const flow=(ob[N-1]-ob[N-1-n])/vol,pc=D[N-1].c/D[N-1-n].c-1;
  const fd=flow>0.1?1:flow<-0.1?-1:0,pd=pc>0.01?1:pc<-0.01?-1:0;
  return{flow,pc,fd,pd,state:fd===pd?(fd===0?'flat':'confirm'):(pd>0&&fd<0)?'bear':(pd<0&&fd>0)?'bull':'mixed'};
}
/* classic RSI divergence on swing points confirmed by k candles on each side (so it never uses candles after the point) */
function rsiDivergence(D,rsi,o){
  o=o||{};const k=o.k||3,look=o.look||80,N=D.length,from=Math.max(k,N-look),lows=[],highs=[];
  for(let i=from;i<=N-1-k;i++){
    let lo=true,hi=true;for(let j=1;j<=k;j++){if(!(D[i].l<D[i-j].l&&D[i].l<=D[i+j].l))lo=false;if(!(D[i].h>D[i-j].h&&D[i].h>=D[i+j].h))hi=false;}
    if(lo&&rsi[i]!=null)lows.push(i);if(hi&&rsi[i]!=null)highs.push(i);}
  const last2=a=>{for(let x=a.length-1;x>0;x--)if(a[x]-a[x-1]>=5)return[a[x-1],a[x]];return null;};
  const L=last2(lows),H=last2(highs),out=[];
  if(L&&D[L[1]].l<D[L[0]].l&&rsi[L[1]]>rsi[L[0]]+2)out.push({type:'bull',i1:L[0],i2:L[1],ago:N-1-L[1]});
  if(H&&D[H[1]].h>D[H[0]].h&&rsi[H[1]]<rsi[H[0]]-2)out.push({type:'bear',i1:H[0],i2:H[1],ago:N-1-H[1]});
  out.sort((a,b)=>a.ago-b.ago);return out[0]||null;
}
/* today's volume as a multiple of the previous n candles' average (null when the market gives no volume) */
function relVol(D,i,n){
  n=n||20;if(i==null)i=D.length-1;if(i<n||!(D[i].v>0))return null;let s=0;for(let j=i-n;j<i;j++)s+=D[j].v||0;
  return s>0?D[i].v/(s/n):null;
}
/* weekly bars from daily bars (weeks start Sunday, matching Gulf and Egyptian trading weeks) */
function aggregateWeekly(D){
  const out=[];let cur=null,key=null;
  for(const d of D){const day=new Date(d.t).getUTCDay();const wk=d.t-day*DAY;
    if(wk!==key){if(cur)out.push(cur);key=wk;cur={t:d.t,o:d.o,h:d.h,l:d.l,c:d.c,v:d.v||0};}
    else{cur.h=Math.max(cur.h,d.h);cur.l=Math.min(cur.l,d.l);cur.c=d.c;cur.v+=d.v||0;}}
  if(cur)out.push(cur);return out;
}
