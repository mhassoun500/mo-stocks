/* ---------- advanced tools: EMA cloud, long EMAs, Supertrend, ATR buy zone, yearly Fibonacci,
   Smart Money Concepts (structure, order blocks, fair value gaps), ZigZag, Ichimoku, Nadaraya-Watson.
   All calculations use only past and current bars, so nothing repaints. ---------- */
const ADV_DEF={cloudFast:9,cloudSlow:21,stLen:10,stMult:3,swing:5,nwBand:8,nwMult:2.5};
const advP=()=>Object.assign({},ADV_DEF,P.adv||{});

function supertrendCalc(D,n,m){
  const N=D.length,atr=atrCalc(D,n),up=new Array(N).fill(null),dn=new Array(N).fill(null),line=new Array(N).fill(null),dir=new Array(N).fill(0),flips=[];
  let fu=null,fd=null,d=1;
  for(let i=0;i<N;i++){if(atr[i]==null)continue;const hl2=(D[i].h+D[i].l)/2,bu=hl2+m*atr[i],bd=hl2-m*atr[i],pc=i>0?D[i-1].c:D[i].c;
    fu=fu==null||bu<fu||pc>fu?bu:fu;fd=fd==null||bd>fd||pc<fd?bd:fd;
    const pd=d;if(d===1&&D[i].c<fd)d=-1;else if(d===-1&&D[i].c>fu)d=1;
    if(line[i-1]!=null&&d!==pd)flips.push({i,dir:d,p:D[i].c});
    up[i]=fu;dn[i]=fd;dir[i]=d;line[i]=d===1?fd:fu;}
  return{line,dir,flips};
}
/* highest high / lowest low over the last n bars */
function hhll(D,i,n){let h=-Infinity,l=Infinity;for(let j=Math.max(0,i-n+1);j<=i;j++){if(D[j].h>h)h=D[j].h;if(D[j].l<l)l=D[j].l;}return[h,l];}
function ichimokuCalc(D){
  const N=D.length,mid=(i,n)=>{if(i<n-1)return null;const[h,l]=hhll(D,i,n);return(h+l)/2;};
  const ten=D.map((_,i)=>mid(i,9)),kij=D.map((_,i)=>mid(i,26)),sa=new Array(N).fill(null),sb=new Array(N).fill(null);
  /* the cloud plotted at bar i was computed 26 bars earlier */
  for(let i=26;i<N;i++){const j=i-26;if(ten[j]!=null&&kij[j]!=null)sa[i]=(ten[j]+kij[j])/2;sb[i]=mid(j,52);}
  return{ten,kij,sa,sb};
}
/* Nadaraya-Watson with a Gaussian kernel, endpoint version (each value uses only the bars up to it) */
function nwCalc(c,h,mult){
  const N=c.length,L=Math.min(Math.round(h*5),100),w=[];for(let j=0;j<=L;j++)w.push(Math.exp(-(j*j)/(2*h*h)));
  const y=new Array(N).fill(null);
  for(let i=L;i<N;i++){let s=0,ws=0;for(let j=0;j<=L;j++){s+=c[i-j]*w[j];ws+=w[j];}y[i]=s/ws;}
  const up=new Array(N).fill(null),lo=new Array(N).fill(null);let acc=0,cnt=0;const err=c.map((v,i)=>y[i]==null?null:Math.abs(v-y[i]));
  for(let i=0;i<N;i++){if(err[i]==null)continue;acc+=err[i];cnt++;if(cnt>100){acc-=err[i-100];cnt=100;}const mae=acc/cnt*mult;up[i]=y[i]+mae;lo[i]=y[i]-mae;}
  return{mid:y,up,lo};
}
/* swing highs/lows confirmed after `len` bars on each side */
function pivots(D,len){
  const out=[];for(let i=len;i<D.length-len;i++){let ph=true,pl=true;
    for(let j=i-len;j<=i+len;j++){if(j===i)continue;if(D[j].h>=D[i].h)ph=false;if(D[j].l<=D[i].l)pl=false;if(!ph&&!pl)break;}
    if(ph)out.push({i,p:D[i].h,hi:true});if(pl)out.push({i,p:D[i].l,hi:false});}
  return out;
}
function smcCalc(D,len,atr){
  const N=D.length,pv=pivots(D,len),events=[],obs=[],fvgs=[];
  let lastH=null,lastL=null,trend=0,k=0;
  for(let i=0;i<N;i++){
    while(k<pv.length&&pv[k].i+len<=i){const p=pv[k++];if(p.hi)lastH={...p,broken:false};else lastL={...p,broken:false};}  /* a swing is known only after it is confirmed */
    const c=D[i].c;
    if(lastH&&!lastH.broken&&c>lastH.p){events.push({i,from:lastH.i,p:lastH.p,dir:1,type:trend<0?'CHoCH':'BOS'});trend=1;lastH.broken=true;
      for(let j=i-1;j>=lastH.i;j--)if(D[j].c<D[j].o){obs.push({i:j,lo:D[j].l,hi:D[j].h,dir:1,end:null});break;}}  /* last down candle before the break */
    if(lastL&&!lastL.broken&&c<lastL.p){events.push({i,from:lastL.i,p:lastL.p,dir:-1,type:trend>0?'CHoCH':'BOS'});trend=-1;lastL.broken=true;
      for(let j=i-1;j>=lastL.i;j--)if(D[j].c>D[j].o){obs.push({i:j,lo:D[j].l,hi:D[j].h,dir:-1,end:null});break;}}
    for(const o of obs)if(o.end==null&&i>o.i+1&&(o.dir>0?c<o.lo:c>o.hi))o.end=i;  /* closed through it: no longer valid */
    if(i>=2){const a=D[i-2],b=D[i],min=(atr[i]||0)*0.15;
      if(b.l>a.h&&b.l-a.h>min)fvgs.push({i:i-1,lo:a.h,hi:b.l,dir:1,end:null});
      if(b.h<a.l&&a.l-b.h>min)fvgs.push({i:i-1,lo:b.h,hi:a.l,dir:-1,end:null});}
    for(const g of fvgs)if(g.end==null&&i>g.i+1&&(g.dir>0?D[i].l<=g.lo:D[i].h>=g.hi))g.end=i;  /* fully filled */
  }
  return{events,obs,fvgs,trend,pivots:pv};
}
function zigzagCalc(D,dev){
  const pts=[];let dir=0,ext=0;
  for(let i=1;i<D.length;i++){
    if(dir>=0&&D[i].h>=D[ext].h){ext=i;if(dir===0)dir=1;}
    if(dir<=0&&D[i].l<=D[ext].l){ext=i;if(dir===0)dir=-1;}
    if(dir===1&&D[i].l<D[ext].h*(1-dev)){pts.push({i:ext,p:D[ext].h,hi:true});dir=-1;ext=i;}
    else if(dir===-1&&D[i].h>D[ext].l*(1+dev)){pts.push({i:ext,p:D[ext].l,hi:false});dir=1;ext=i;}}
  if(D.length)pts.push({i:ext,p:dir>0?D[ext].h:D[ext].l,hi:dir>0,live:true});
  return pts;
}
/* yearly Fibonacci: year to date or the last 365 days */
function yearFib(D,mode){
  const N=D.length;if(!N)return null;const last=D[N-1].t;
  const from=mode==='ytd'?Date.UTC(new Date(last).getUTCFullYear(),0,1):last-365*86400000;
  let hi=-Infinity,lo=Infinity,hiI=-1,loI=-1;for(let i=0;i<N;i++){if(D[i].t<from)continue;if(D[i].h>hi){hi=D[i].h;hiI=i;}if(D[i].l<lo){lo=D[i].l;loI=i;}}
  return hiI<0?null:{hi,lo,hiI,loI,up:loI<hiI};
}

/* all tools for the current bars, cached per data array */
function advCompute(D){
  const pa=advP(),key=D.length+'|'+(D.length?D[D.length-1].t+'|'+D[D.length-1].c:'')+'|'+JSON.stringify(pa);
  if(advCompute.c&&advCompute.c.D===D&&advCompute.c.key===key)return advCompute.c.r;
  const c=D.map(d=>d.c),atr=atrCalc(D,14);
  const atrP=atr.filter(v=>v!=null).slice(-100).map((v,j,a)=>v/c[c.length-a.length+j]).sort((a,b)=>a-b);
  const dev=Math.min(0.15,Math.max(0.02,3*(atrP[atrP.length>>1]||0.01)));
  const r={cf:ema(c,pa.cloudFast),cs:ema(c,pa.cloudSlow),e50:ema(c,50),e100:ema(c,100),e200:ema(c,200),atr,
    st:supertrendCalc(D,pa.stLen,pa.stMult),ichi:ichimokuCalc(D),nw:nwCalc(c,pa.nwBand,pa.nwMult),smc:smcCalc(D,pa.swing,atr),zz:zigzagCalc(D,dev),zzDev:dev};
  const N=D.length-1;
  r.buy=r.cs[N]!=null&&atr[N]!=null?{hi:r.cs[N]-atr[N],lo:r.cs[N]-2*atr[N]}:null;
  r.bz=D.map((_,i)=>r.cs[i]!=null&&atr[i]!=null?[r.cs[i]-2*atr[i],r.cs[i]-atr[i]]:null);
  advCompute.c={D,key,r};return r;
}
/* one line per tool describing where things stand now */
function advSummary(D){
  if(!D||D.length<60)return null;const r=advCompute(D),N=D.length-1,c=D[N].c,I=r.ichi,s=r.smc,ev=s.events[s.events.length-1];
  const cloudTop=I.sa[N]!=null&&I.sb[N]!=null?Math.max(I.sa[N],I.sb[N]):null,cloudBot=cloudTop!=null?Math.min(I.sa[N],I.sb[N]):null;
  const nOB=s.obs.filter(o=>o.end==null&&o.dir>0&&o.hi<c).length,nOBs=s.obs.filter(o=>o.end==null&&o.dir<0&&o.lo>c).length;
  const fvUp=s.fvgs.filter(g=>g.end==null&&g.dir>0).length,fvDn=s.fvgs.filter(g=>g.end==null&&g.dir<0).length;
  const lastFlip=r.st.flips[r.st.flips.length-1];
  return{
    st:r.st.dir[N],stLine:r.st.line[N],stSince:lastFlip?N-lastFlip.i:null,
    cloud:r.cf[N]!=null&&r.cs[N]!=null?(r.cf[N]>r.cs[N]?1:-1):0,
    e200:r.e200[N]!=null?(c>r.e200[N]?1:-1):0,e200v:r.e200[N],e50:r.e50[N],
    golden:r.e50[N]!=null&&r.e200[N]!=null?(r.e50[N]>r.e200[N]?1:-1):0,
    ichi:cloudTop==null?0:c>cloudTop?1:c<cloudBot?-1:0,tk:I.ten[N]!=null&&I.kij[N]!=null?(I.ten[N]>I.kij[N]?1:-1):0,
    nw:r.nw.up[N]==null?0:c>r.nw.up[N]?1:c<r.nw.lo[N]?-1:0,
    inBuy:r.buy?c<=r.buy.hi&&c>=r.buy.lo:false,buy:r.buy,
    struct:ev?{type:ev.type,dir:ev.dir,ago:N-ev.i,p:ev.p}:null,trend:s.trend,
    obBelow:nOB,obAbove:nOBs,fvUp,fvDn,
    down:r.st.dir[N]<0&&(r.e200[N]==null||c<r.e200[N])};
}
function renderAdvSummary(){
  const el=$('#advSum');if(!el)return;
  const sm=S.isFund||!S.data||!S.data.length?null:advSummary(S.data);
  if(!sm){el.hidden=true;return;}el.hidden=false;
  const tag=(ok,txt,tip)=>'<span class="adv-t '+(ok>0?'b':ok<0?'x':'n')+'" title="'+esc(tip||'')+'">'+txt+'</span>';
  const ago=n=>n==null?'':n===0?_t('اليوم'):NUM(n)+' '+_t('شمعة');
  el.innerHTML='<b class="adv-h">'+_t('الأدوات المتقدمة')+'</b>'+
    tag(sm.st,'Supertrend: '+(sm.st>0?_t('صاعد'):_t('هابط'))+(sm.stSince!=null?' · '+_t('منذ')+' '+ago(sm.stSince):''),_t('خط الاتجاه حاليًا عند')+' '+fp(sm.stLine))+
    tag(sm.cloud,_t('سحابة المتوسطات')+': '+(sm.cloud>0?_t('إيجابية'):_t('سلبية')),'EMA '+advP().cloudFast+' / '+advP().cloudSlow)+
    tag(sm.e200,'EMA 200: '+(sm.e200>0?_t('السعر فوقه'):_t('السعر تحته')),fp(sm.e200v))+
    (sm.golden?tag(sm.golden,sm.golden>0?_t('تقاطع ذهبي (50 فوق 200)'):_t('تقاطع الموت (50 تحت 200)'),''):'')+
    tag(sm.ichi,_t('إيشيموكو')+': '+(sm.ichi>0?_t('فوق السحابة'):sm.ichi<0?_t('تحت السحابة'):_t('داخل السحابة')),'')+
    (sm.struct?tag(sm.struct.dir,(sm.struct.type==='CHoCH'?_t('تغيّر الهيكل'):_t('كسر الهيكل'))+' '+(sm.struct.dir>0?_t('صاعد'):_t('هابط'))+' · '+ago(sm.struct.ago),
      (sm.struct.type==='CHoCH'?'CHoCH':'BOS')+' @ '+fp(sm.struct.p)):'')+
    (sm.inBuy?tag(1,_t('داخل منطقة الشراء الديناميكية'),fp(sm.buy.lo)+' – '+fp(sm.buy.hi)):'')+
    (sm.nw?tag(-sm.nw,sm.nw>0?_t('فوق غلاف ناداريا-واتسون (تمدد صعودي)'):_t('تحت غلاف ناداريا-واتسون (تمدد هبوطي)'),''):'')+
    (sm.fvUp+sm.fvDn?tag(0,_t('فجوات قيمة عادلة مفتوحة')+': '+NUM(sm.fvUp)+'↑ '+NUM(sm.fvDn)+'↓',''):'')+
    (sm.down?'<span class="adv-warn">⚠ '+_t('السهم في اتجاه هابط')+'</span>':'');
}

/* ---------- drawing (called from draw() inside the price pane) ---------- */
function drawAdvanced(ctx,L,C,labels){
  const D=S.data,sh=S.show,{st,end,X,Y,padL,padR,W,pTop,bw}=L;
  const anyOn=['cloud','ema3','super','buyz','yfib','smc','zz','ichi','nw'].some(k=>sh[k]);if(!anyOn||S.isFund)return;
  const r=advCompute(D);
  const line=(arr,col,w,dash)=>{ctx.strokeStyle=col;ctx.lineWidth=w||1.3;if(dash)ctx.setLineDash(dash);ctx.beginPath();let on=false;
    for(let i=st;i<end;i++){const v=arr[i];if(v==null){on=false;continue;}const x=X(i),y=Y(v);if(!on){ctx.moveTo(x,y);on=true;}else ctx.lineTo(x,y);}ctx.stroke();ctx.setLineDash([]);};
  /* fill between two series, coloured by which one is on top */
  const band=(a,b,colUp,colDn,alpha)=>{ctx.globalAlpha=alpha;
    for(let i=Math.max(st,1);i<end;i++){const a0=a[i-1],b0=b[i-1],a1=a[i],b1=b[i];if(a0==null||b0==null||a1==null||b1==null)continue;
      ctx.fillStyle=a1>=b1?colUp:colDn;ctx.beginPath();ctx.moveTo(X(i-1),Y(a0));ctx.lineTo(X(i),Y(a1));ctx.lineTo(X(i),Y(b1));ctx.lineTo(X(i-1),Y(b0));ctx.closePath();ctx.fill();}
    ctx.globalAlpha=1;};
  if(sh.ichi){const I=r.ichi;band(I.sa,I.sb,C.buy,C.sell,0.12);line(I.ten,'#2f7fd8',1);line(I.kij,'#b0442c',1);}
  if(sh.nw){line(r.nw.up,C.sell,1.1,[5,3]);line(r.nw.lo,C.buy,1.1,[5,3]);line(r.nw.mid,C.muted,0.8,[2,3]);}
  if(sh.cloud){band(r.cf,r.cs,C.buy,C.sell,0.18);line(r.cf,C.buy,1);line(r.cs,C.sell,1);}
  if(sh.ema3){[[r.e50,'#d4a017','EMA 50'],[r.e100,'#8e5bd0','EMA 100'],[r.e200,'#e0457b','EMA 200']].forEach(([a,col,n])=>{line(a,col,1.4);
    const v=a[end-1];if(v!=null)labels.push({y:Y(v),txt:n+'  '+fp(v),short:n.replace('EMA ','')+'  '+fp(v),col,strong:false});});}
  if(sh.buyz){ctx.globalAlpha=0.16;ctx.fillStyle=C.buy;ctx.beginPath();let first=true;const top=[],bot=[];
    for(let i=st;i<end;i++){const z=r.bz[i];if(!z)continue;top.push([X(i),Y(z[1])]);bot.push([X(i),Y(z[0])]);}
    top.forEach(([x,y],j)=>{if(first){ctx.moveTo(x,y);first=false;}else ctx.lineTo(x,y);});for(let j=bot.length-1;j>=0;j--)ctx.lineTo(bot[j][0],bot[j][1]);ctx.closePath();if(top.length)ctx.fill();ctx.globalAlpha=1;
    if(r.buy)labels.push({y:Y((r.buy.hi+r.buy.lo)/2),txt:_t('منطقة الشراء الديناميكية')+'  ⁦'+fp(r.buy.lo)+' – '+fp(r.buy.hi)+'⁩',short:_t('شراء ديناميكي')+' '+fp(r.buy.hi),col:C.buy,strong:false});}
  if(sh.super){const s=r.st;
    for(let i=Math.max(st,1);i<end;i++){if(s.line[i]==null||s.line[i-1]==null||s.dir[i]!==s.dir[i-1])continue;
      ctx.strokeStyle=s.dir[i]>0?C.buy:C.sell;ctx.lineWidth=1.8;ctx.beginPath();ctx.moveTo(X(i-1),Y(s.line[i-1]));ctx.lineTo(X(i),Y(s.line[i]));ctx.stroke();}
    ctx.font=FA;ctx.textAlign='center';ctx.direction='rtl';
    for(const f of s.flips){if(f.i<st||f.i>=end)continue;const d=D[f.i],x=X(f.i),y=f.dir>0?Y(d.l)+16:Y(d.h)-16;
      ctx.fillStyle=f.dir>0?C.buy:C.sell;ctx.beginPath();if(f.dir>0){ctx.moveTo(x,y-9);ctx.lineTo(x-5,y-1);ctx.lineTo(x+5,y-1);}else{ctx.moveTo(x,y+9);ctx.lineTo(x-5,y+1);ctx.lineTo(x+5,y+1);}ctx.fill();
      ctx.fillText(f.dir>0?_t('شراء'):_t('بيع'),x,f.dir>0?y+9:y-9);}
    ctx.direction='ltr';
    const sm=advSummary(D);if(sm&&sm.down){const t='⚠ '+_t('اتجاه هابط');ctx.font=FA;const w=ctx.measureText(t).width+16;
      ctx.fillStyle=C.sell;ctx.globalAlpha=0.9;rrect(ctx,padL+8,pTop+8,w,22,6);ctx.fill();ctx.globalAlpha=1;ctx.fillStyle='#fff';ctx.textAlign='center';ctx.direction='rtl';ctx.fillText(t,padL+8+w/2,pTop+19);ctx.direction='ltr';}}
  if(sh.yfib){const f=yearFib(D,(P.adv&&P.adv.fibMode)||'365');if(f){ctx.font=FN;
    for(const q of [0,0.236,0.382,0.5,0.618,0.786,1]){const v=f.hi-(f.hi-f.lo)*q,y=Math.round(Y(v))+0.5;
      ctx.strokeStyle=C.fib;ctx.globalAlpha=q===0.618||q===0.5?0.9:0.55;ctx.lineWidth=q===0.618?1.4:1;ctx.beginPath();ctx.moveTo(Math.max(padL,X(Math.max(st,Math.min(f.hiI,f.loI)))),y);ctx.lineTo(W-padR,y);ctx.stroke();ctx.globalAlpha=1;
      ctx.fillStyle=C.fib;ctx.textAlign='left';ctx.textBaseline='bottom';ctx.fillText(_t('سنوي')+' '+(q*100).toFixed(1)+'%  '+fp(v),padL+4,y-2);}
    ctx.textBaseline='middle';}}
  if(sh.zz){const z=r.zz.filter((p,j,a)=>p.i>=st-1||(a[j+1]&&a[j+1].i>=st));ctx.strokeStyle=C.trend;ctx.lineWidth=1.4;ctx.beginPath();
    z.forEach((p,j)=>{const x=X(p.i),y=Y(p.p);if(j===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);});ctx.stroke();
    ctx.font=FN;ctx.fillStyle=C.trend;ctx.textAlign='center';
    for(let j=1;j<z.length;j++){const p=z[j],q=z[j-1];if(p.i<st||p.i>=end)continue;const ch=(p.p/q.p-1)*100;ctx.fillText((ch>0?'+':'')+ch.toFixed(1)+'%',X(p.i),p.hi?Y(p.p)-9:Y(p.p)+10);}}
  if(sh.smc){const s=r.smc,right=W-padR;
    const box=(o,col,alpha,lab)=>{const x1=Math.max(padL,X(o.i)-bw/2),x2=o.end!=null?X(o.end):right;if(x2<padL||o.i>=end)return;
      ctx.globalAlpha=alpha;ctx.fillStyle=col;ctx.fillRect(x1,Y(o.hi),Math.max(2,x2-x1),Math.max(1,Y(o.lo)-Y(o.hi)));ctx.globalAlpha=1;
      if(lab&&o.end==null){ctx.font=FN;ctx.fillStyle=col;ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText(lab,right-4,(Y(o.hi)+Y(o.lo))/2);}};
    /* only what is still open, and only the few closest to the price on each side, so the chart stays readable */
    const px=D[end-1].c,near=(arr,n)=>{const op=arr.filter(o=>o.end==null&&o.i<end),dist=o=>Math.min(Math.abs(o.hi-px),Math.abs(o.lo-px));
      return op.filter(o=>o.lo>=px).sort((a,b)=>dist(a)-dist(b)).slice(0,n).concat(op.filter(o=>o.lo<px).sort((a,b)=>dist(a)-dist(b)).slice(0,n));};
    for(const o of near(s.obs,2))box(o,o.dir>0?C.buy:C.sell,0.22,o.dir>0?'OB+':'OB−');
    for(const g of near(s.fvgs,2))box(g,g.dir>0?'#2f9e8f':'#c0663a',0.2,'FVG');
    ctx.font=FN;ctx.textBaseline='bottom';
    for(const e of s.events){if(e.i<st||e.from>=end)continue;const y=Math.round(Y(e.p))+0.5,col=e.dir>0?C.buy:C.sell;
      ctx.strokeStyle=col;ctx.lineWidth=1;ctx.setLineDash(e.type==='CHoCH'?[]:[4,3]);ctx.beginPath();ctx.moveTo(Math.max(padL,X(e.from)),y);ctx.lineTo(X(e.i),y);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle=col;ctx.textAlign='center';ctx.fillText(e.type,(Math.max(padL,X(e.from))+X(e.i))/2,e.dir>0?y-2:y+12);}
    ctx.textBaseline='middle';}
}
