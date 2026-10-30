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
/* weekly bars from daily bars (weeks start Sunday, matching Gulf and Egyptian trading weeks) */
function aggregateWeekly(D){
  const out=[];let cur=null,key=null;
  for(const d of D){const day=new Date(d.t).getUTCDay();const wk=d.t-day*DAY;
    if(wk!==key){if(cur)out.push(cur);key=wk;cur={t:d.t,o:d.o,h:d.h,l:d.l,c:d.c,v:d.v||0};}
    else{cur.h=Math.max(cur.h,d.h);cur.l=Math.min(cur.l,d.l);cur.c=d.c;cur.v+=d.v||0;}}
  if(cur)out.push(cur);return out;
}
