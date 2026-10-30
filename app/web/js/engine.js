/* ================= analysis engine =================
   analyzeCore(D, I, opts) looks only at bars [end-span, end) so the same code drives the
   live view, the watchlist, the scanner and the walk-forward backtest without look-ahead. */

function findPivots(D,from,to,k){
  const piv=[];
  for(let i=Math.max(from,k);i<to-k;i++){let isH=true,isL=true;
    for(let j=i-k;j<=i+k;j++){if(j===i)continue;if(D[j].h>D[i].h)isH=false;if(D[j].l<D[i].l)isL=false;if(!isH&&!isL)break;}
    if(isH)piv.push({i,p:D[i].h,t:'h'});if(isL)piv.push({i,p:D[i].l,t:'l'});}
  /* right edge: accept a swing point with at least 2 bars after it (full window on the left) */
  for(let i=Math.max(from+k,to-k);i<=to-3;i++){let isH=true,isL=true;
    for(let j=i-k;j<to;j++){if(j===i)continue;if(D[j].h>D[i].h)isH=false;if(D[j].l<D[i].l)isL=false;if(!isH&&!isL)break;}
    if(isH)piv.push({i,p:D[i].h,t:'h',recent:true});if(isL)piv.push({i,p:D[i].l,t:'l',recent:true});}
  return piv;
}

function volumeProfile(D,from,to,bins=48){
  let lo=Infinity,hi=-Infinity,tot=0;
  for(let i=from;i<to;i++){lo=Math.min(lo,D[i].l);hi=Math.max(hi,D[i].h);tot+=D[i].v||0;}
  if(!(tot>0)||!(hi>lo))return null;
  const step=(hi-lo)/bins,vol=new Array(bins).fill(0);
  for(let i=from;i<to;i++){const v=D[i].v||0;if(!v)continue;
    const a=clamp(Math.floor((D[i].l-lo)/step),0,bins-1),b=clamp(Math.floor((D[i].h-lo)/step),0,bins-1);
    const share=v/(b-a+1);for(let j=a;j<=b;j++)vol[j]+=share;}
  let poc=0;for(let j=1;j<bins;j++)if(vol[j]>vol[poc])poc=j;
  return{lo,hi,step,vol,tot,poc,mean:tot/bins,pocPrice:lo+(poc+0.5)*step};
}
function vpShare(vp,lo,hi){
  if(!vp)return 0;let s=0;
  for(let j=0;j<vp.vol.length;j++){const a=vp.lo+j*vp.step,b=a+vp.step;const ov=Math.min(b,hi)-Math.max(a,lo);if(ov>0)s+=vp.vol[j]*ov/vp.step;}
  return s/vp.tot;
}

function fitTrendlines(D,piv,start,N,atr){
  const out={};
  for(const type of ['l','h']){
    const pts=piv.filter(p=>p.t===type&&p.i>=start).slice(-14);let best=null;
    for(let x=0;x<pts.length;x++)for(let y=x+1;y<pts.length;y++){
      const a=pts[x],b=pts[y];if(b.i-a.i<6)continue;
      const slope=(b.p-a.p)/(b.i-a.i);let ok=true,brk=-1;
      for(let j=a.i;j<N;j++){const line=a.p+slope*(j-a.i);
        const viol=type==='l'?D[j].c<line-(j<=b.i?0.25:0.35)*atr:D[j].c>line+(j<=b.i?0.25:0.35)*atr;
        if(viol){if(j>b.i&&j>=N-3){if(brk<0)brk=j;}else{ok=false;break;}}}
      if(!ok)continue;
      let touches=0;for(const p of pts)if(p.i>=a.i&&Math.abs(p.p-(a.p+slope*(p.i-a.i)))<=0.35*atr)touches++;
      if(touches<2)continue;
      const now=a.p+slope*(N-1-a.i);
      if(!(now>0)||Math.abs(now-D[N-1].c)>D[N-1].c*0.25)continue;
      const score=touches*2+2*(b.i-start)/(N-start);
      if(!best||score>best.score)best={a,b,slope,touches,score,now,broken:brk>=0,brk,type};
    }
    out[type==='l'?'sup':'res']=best;
  }
  return out;
}

function detectPatterns(D,piv,N,atr,close,tl){
  const out=[];const recent=N-170;
  const H=piv.filter(p=>p.t==='h'&&p.i>=recent),L=piv.filter(p=>p.t==='l'&&p.i>=recent);
  const lowBetween=(i,j)=>{let m=Infinity,mi=i;for(let k=i;k<=j;k++)if(D[k].l<m){m=D[k].l;mi=k;}return[m,mi];};
  const highBetween=(i,j)=>{let m=-Infinity,mi=i;for(let k=i;k<=j;k++)if(D[k].h>m){m=D[k].h;mi=k;}return[m,mi];};
  const near=(x,y,base)=>Math.abs(x-y)<=Math.max(0.6*atr,0.015*base);
  if(H.length>=2){const a=H[H.length-2],b=H[H.length-1];
    if(b.i-a.i>=8&&b.i>=N-60&&near(a.p,b.p,a.p)){const[neck,ni]=lowBetween(a.i,b.i);const peak=Math.max(a.p,b.p);
      if(peak-neck>=Math.max(2*atr,0.03*peak)&&close<=peak+0.5*atr)
        out.push({key:'dtop',name:'قمة مزدوجة',dir:-1,confirmed:close<neck,neck,target:neck-(peak-neck),pts:[a.i,b.i],ni,price:peak});}}
  if(L.length>=2){const a=L[L.length-2],b=L[L.length-1];
    if(b.i-a.i>=8&&b.i>=N-60&&near(a.p,b.p,a.p)){const[neck,ni]=highBetween(a.i,b.i);const trough=Math.min(a.p,b.p);
      if(neck-trough>=Math.max(2*atr,0.03*trough)&&close>=trough-0.5*atr)
        out.push({key:'dbot',name:'قاع مزدوج',dir:1,confirmed:close>neck,neck,target:neck+(neck-trough),pts:[a.i,b.i],ni,price:trough});}}
  if(H.length>=3){const l=H[H.length-3],h=H[H.length-2],r=H[H.length-1];
    if(r.i>=N-60&&h.p>Math.max(l.p,r.p)+Math.max(atr,0.02*h.p)&&Math.abs(l.p-r.p)<=Math.max(atr,0.03*h.p)&&h.i-l.i>=5&&r.i-h.i>=5){
      const n1=lowBetween(l.i,h.i)[0],n2=lowBetween(h.i,r.i)[0],neck=(n1+n2)/2;
      if(close<=h.p)out.push({key:'hs',name:'رأس وكتفين',dir:-1,confirmed:close<neck,neck,target:neck-(h.p-neck),pts:[l.i,h.i,r.i],price:h.p});}}
  if(L.length>=3){const l=L[L.length-3],h=L[L.length-2],r=L[L.length-1];
    if(r.i>=N-60&&h.p<Math.min(l.p,r.p)-Math.max(atr,0.02*h.p)&&Math.abs(l.p-r.p)<=Math.max(atr,0.03*h.p)&&h.i-l.i>=5&&r.i-h.i>=5){
      const n1=highBetween(l.i,h.i)[0],n2=highBetween(h.i,r.i)[0],neck=(n1+n2)/2;
      if(close>=h.p)out.push({key:'ihs',name:'رأس وكتفين مقلوب',dir:1,confirmed:close>neck,neck,target:neck+(neck-h.p),pts:[l.i,h.i,r.i],price:h.p});}}
  if(tl.sup&&tl.res&&tl.sup.b.i>=N-90&&tl.res.b.i>=N-90&&!tl.sup.broken&&!tl.res.broken&&tl.res.now>tl.sup.now){
    const ss=tl.sup.slope/atr,rs=tl.res.slope/atr,flat=0.015;
    let tri=null;
    if(ss>flat&&rs<-flat)tri={key:'sym',name:'مثلث متماثل',dir:0};
    else if(Math.abs(rs)<=flat&&ss>flat)tri={key:'asc',name:'مثلث صاعد',dir:1};
    else if(rs<-flat&&Math.abs(ss)<=flat)tri={key:'desc',name:'مثلث هابط',dir:-1};
    if(tri)out.push(Object.assign(tri,{confirmed:false,neck:null,target:null,pts:[],tri:true}));
  }
  return out;
}

function findGaps(D,start,N,atr){
  const gaps=[];
  for(let i=Math.max(start,1);i<N;i++){
    if(D[i].l>D[i-1].h&&D[i].l-D[i-1].h>=0.2*atr)gaps.push({i,lo:D[i-1].h,hi:D[i].l,dir:'up'});
    else if(D[i].h<D[i-1].l&&D[i-1].l-D[i].h>=0.2*atr)gaps.push({i,lo:D[i].h,hi:D[i-1].l,dir:'down'});
  }
  return gaps.filter(g=>{for(let j=g.i+1;j<N;j++){if(g.dir==='up'&&D[j].l<=g.lo)return false;if(g.dir==='down'&&D[j].h>=g.hi)return false;}return true;}).slice(-4);
}

function findBreakouts(D,I,zones,start,N,atr){
  const ev=[];
  for(const z of zones){
    for(let i=Math.max(start+1,N-12);i<N;i++){
      const vm=I.volMa[i],vr=vm>0&&D[i].v>0?D[i].v/vm:null;
      if(D[i-1].c<=z.hi&&D[i].c>z.hi){let held=true;for(let j=i+1;j<N;j++)if(D[j].c<z.lo){held=false;break;}
        const strong=(vr==null?D[i].c-z.hi>=0.3*atr:vr>=1.4&&D[i].c-z.hi>=0.15*atr);
        ev.push({i,dir:1,z,vr,status:!held?'false':strong?'confirmed':'weak'});}
      if(D[i-1].c>=z.lo&&D[i].c<z.lo){let held=true;for(let j=i+1;j<N;j++)if(D[j].c>z.hi){held=false;break;}
        const strong=(vr==null?z.lo-D[i].c>=0.3*atr:vr>=1.4&&z.lo-D[i].c>=0.15*atr);
        ev.push({i,dir:-1,z,vr,status:!held?'false':strong?'confirmed':'weak'});}
    }
  }
  return ev.sort((a,b)=>a.i-b.i);
}

function analyzeCore(D,I,o){
  const N=o.end!=null?o.end:D.length;if(N<30)return null;
  const span=Math.min(o.span||N,N),start=N-span;
  const last=D[N-1],close=last.c,atrv=I.atr[N-1]||close*0.02,k=o.sens||5,stopMult=o.stopMult!=null?o.stopMult:0.5;
  const zoneCount=o.zoneCount||6;
  const piv=findPivots(D,start,N,k);
  const tol=Math.max(atrv*0.6,close*0.006);

  /* 1) cluster pivots into zones */
  const sorted=piv.slice().sort((a,b)=>a.p-b.p);const cl=[];
  for(const p of sorted){const c=cl[cl.length-1];if(c&&p.p-c.min<=tol){c.pts.push(p);c.max=p.p;}else cl.push({pts:[p],min:p.p,max:p.p});}
  let zones=cl.map(c=>{const n=c.pts.length,lastI=Math.max(...c.pts.map(p=>p.i));
    const hs=c.pts.some(p=>p.t==='h'),ls=c.pts.some(p=>p.t==='l');const mid=c.pts.reduce((s,p)=>s+p.p,0)/n;
    let lo=c.min-tol*0.2,hi=c.max+tol*0.2;if(hi-lo<tol*0.5){lo=mid-tol*0.25;hi=mid+tol*0.25;}
    return{lo,hi,mid,touches:n,lastI,flip:hs&&ls,score:n+1.5*(lastI-start)/span+(hs&&ls?0.75:0),vp:0};});

  /* 2) weight by traded volume, add high-volume nodes */
  const vp=volumeProfile(D,start,N);
  if(vp){
    for(const z of zones){z.vp=vpShare(vp,z.lo,z.hi);z.score+=z.vp*12;}
    for(let j=1;j<vp.vol.length-1;j++){const v=vp.vol[j];
      if(v<1.35*vp.mean)continue;let peak=true;for(let d=-2;d<=2;d++){const q=vp.vol[j+d];if(d&&q!=null&&q>v)peak=false;}if(!peak)continue;
      const c=vp.lo+(j+0.5)*vp.step,w=Math.max(vp.step,tol*0.5)/2,lo=c-w,hi=c+w;
      if(zones.some(z=>z.lo<=hi&&z.hi>=lo))continue;
      const share=vpShare(vp,lo,hi);zones.push({lo,hi,mid:c,touches:0,lastI:start,flip:false,vp:share,hvn:true,score:share*12+0.5});}
  }
  /* 3) higher-timeframe confluence */
  if(o.htf)for(const z of zones)if(o.htf.some(h=>h.lo<=z.hi&&h.hi>=z.lo)){z.htf=true;z.score+=1.5;}

  /* 4) choose, merge overlaps, classify */
  let chosen=zones.filter(z=>z.touches>=2||z.hvn||z.htf).sort((a,b)=>b.score-a.score).slice(0,zoneCount);
  if(chosen.length<zoneCount)chosen=chosen.concat(zones.filter(z=>!(z.touches>=2||z.hvn||z.htf)).sort((a,b)=>b.score-a.score).slice(0,zoneCount-chosen.length));
  /* always keep at least one level on each side of the price when one exists */
  for(const below of [true,false]){
    if(chosen.some(z=>below?z.mid<=close:z.mid>close))continue;
    const cand=zones.filter(z=>!chosen.includes(z)&&(below?z.mid<=close:z.mid>close)).sort((a,b)=>b.score-a.score)[0];
    if(cand)chosen.push(cand);
  }
  chosen.sort((a,b)=>a.lo-b.lo);
  const merged=[];for(const z of chosen){const m=merged[merged.length-1];
    if(m&&z.lo<=m.hi){const t=Math.max(1,m.touches+z.touches);m.mid=(m.mid*Math.max(1,m.touches)+z.mid*Math.max(1,z.touches))/(Math.max(1,m.touches)+Math.max(1,z.touches));
      m.lo=Math.min(m.lo,z.lo);m.hi=Math.max(m.hi,z.hi);m.touches=m.touches+z.touches;m.score+=z.score;m.lastI=Math.max(m.lastI,z.lastI);
      m.flip=m.flip||z.flip;m.vp=(m.vp||0)+(z.vp||0);m.htf=m.htf||z.htf;m.hvn=m.hvn&&z.hvn;}
    else merged.push(Object.assign({},z));}
  /* nothing below the price in the window: look further back in the loaded history */
  if(!o.lite&&start>0&&!merged.some(z=>z.mid<=close)){
    const Aold=analyzeCore(D,I,{end:N,span:N,sens:k,zoneCount:zoneCount+4,stopMult,lite:true});
    const old=Aold&&Aold.zones.filter(z=>z.mid<=close&&z.hi<close).sort((a,b)=>b.hi-a.hi)[0];
    if(old)merged.push(Object.assign({},old,{old:true,role:undefined}));
  }
  for(const z of merged){z.kind=z.mid<=close?'s':'r';z.inside=close>=z.lo&&close<=z.hi;z.dist=(z.mid-close)/close;
    z.poc=!!(vp&&vp.pocPrice>=z.lo&&vp.pocPrice<=z.hi);z.vpStrong=(z.vp||0)>=0.06;}
  merged.sort((a,b)=>b.mid-a.mid);
  const sup=merged.filter(z=>z.kind==='s').sort((a,b)=>b.hi-a.hi);
  const res=merged.filter(z=>z.kind==='r').sort((a,b)=>a.lo-b.lo);
  const buy=sup[0]||null,sell=res[0]||null,sell2=res[1]||null;
  if(buy)buy.role='buy';if(sell)sell.role='sell';
  const entry=buy?(close<=buy.hi?close:buy.mid):close;
  const stop=(buy?buy.lo:close-1.5*atrv)-stopMult*atrv;
  const t1=sell?sell.lo:close+2*atrv;
  const t2=sell2?sell2.lo:(sell?sell.hi+atrv:close+3.5*atrv);
  const rr=entry>stop?(t1-entry)/(entry-stop):null;
  const A={start,N,span,close,atrv,zones:merged,buy,sell,sell2,entry,stop,t1,t2,rr,vp,piv};
  if(o.lite)return A;

  /* 5) signals */
  const sig=[];
  for(let i=Math.max(start,1);i<N;i++){
    const r0=I.rsi[i-1],r1=I.rsi[i],a0=I.ma1[i-1],a1=I.ma1[i],b0=I.ma2[i-1],b1=I.ma2[i],m0=I.macd[i-1],m1=I.macd[i],s0=I.macdSig[i-1],s1=I.macdSig[i];
    if(r0!=null&&r1!=null){
      if(r0<30&&r1>=30)sig.push({i,t:'b',s:'خروج القوة النسبية من منطقة التشبّع البيعي'});
      if(r0>70&&r1<=70)sig.push({i,t:'s',s:'خروج القوة النسبية من منطقة التشبّع الشرائي'});}
    if(a0!=null&&b0!=null&&a1!=null&&b1!=null){
      if(a0<=b0&&a1>b1)sig.push({i,t:'b',s:'تقاطع إيجابي: المتوسط القصير يعبر فوق الطويل'});
      if(a0>=b0&&a1<b1)sig.push({i,t:'s',s:'تقاطع سلبي: المتوسط القصير يهبط تحت الطويل'});}
    if(m0!=null&&s0!=null&&m1!=null&&s1!=null){
      if(m0<=s0&&m1>s1&&m1<0)sig.push({i,t:'b',s:'الماكد يعبر فوق خط الإشارة من منطقة سالبة',minor:true});
      if(m0>=s0&&m1<s1&&m1>0)sig.push({i,t:'s',s:'الماكد يهبط تحت خط الإشارة من منطقة موجبة',minor:true});}
  }
  const brk=findBreakouts(D,I,merged,start,N,atrv);
  for(const b of brk){const word=b.dir>0?'اختراق':'كسر';const zn=fp(b.dir>0?b.z.hi:b.z.lo);
    const txt=b.status==='confirmed'?word+' مؤكد للمستوى '+zn+(b.vr?' بحجم '+b.vr.toFixed(1)+'× المعتاد':''):
      b.status==='false'?word+' كاذب للمستوى '+zn+' وعاد السعر':word+' ضعيف للمستوى '+zn+' يحتاج تأكيدًا';
    sig.push({i:b.i,t:b.status==='false'?(b.dir>0?'s':'b'):(b.dir>0?'b':'s'),s:txt,brk:b});}
  sig.sort((a,b)=>a.i-b.i);
  const piv2=k>3?findPivots(D,start,N,Math.max(3,k-2)):piv;
  const tl=fitTrendlines(D,piv2,start,N,atrv);
  const pats=detectPatterns(D,piv2,N,atrv,close,tl);
  const gaps=o.noGaps?[]:findGaps(D,start,N,atrv);

  /* 6) stance */
  const r=I.rsi[N-1],s1=I.ma1[N-1],s2=I.ma2[N-1],s2p=N>11?I.ma2[N-11]:null;
  let score=0;const reasons=[];const R=(t,s)=>reasons.push([t,s]);
  const nearBuy=buy&&close<=buy.hi*1.012,nearSell=sell&&close>=sell.lo*0.988;
  if(buy){
    const extra=(buy.htf?'، وتظهر على الإطار الأعلى':'')+(buy.vpStrong?'، وبها تداول كثيف':'');
    if(buy.old)R('n','منطقة الشراء مأخوذة من تاريخ أقدم من الفترة المختارة، لأن السعر عند أدنى مستوياته في الفترة.');
    if(buy.inside){score+=2;R('p','السعر داخل منطقة الدعم الآن ('+buy.touches+' لمسات سابقة'+extra+').');}
    else if(nearBuy){score+=2;R('p','السعر قريب جدًا من منطقة الدعم'+extra+'.');}
    else R('n','أقرب دعم أسفل السعر بـ '+NUM(pct((close-buy.hi)/close).replace('+',''))+'، والأفضل الشراء عند الاقتراب منه.');
    if((nearBuy||buy.inside)&&(buy.htf||buy.vpStrong))score+=0.5;
  }else{score-=1;R('m','لا يوجد دعم واضح أسفل السعر خلال الفترة المختارة.');}
  if(sell){
    if(nearSell){score-=2;R('m','السعر يلامس منطقة مقاومة ('+sell.touches+' لمسات سابقة)، واحتمال الارتداد للأسفل مرتفع.');}
    else R('n','المسافة حتى المقاومة التالية '+NUM(pct((sell.lo-close)/close))+'.');
  }else{score+=0.5;R('p','السعر عند قمة الفترة ولا توجد مقاومة واضحة أعلاه.');}
  if(r!=null){
    if(r<30){score+=1.5;R('p','القوة النسبية '+NUM(r.toFixed(0))+': تشبّع بيعي.');}
    else if(r<40){score+=0.5;R('p','القوة النسبية '+NUM(r.toFixed(0))+': قريبة من التشبّع البيعي.');}
    else if(r>70){score-=1.5;R('m','القوة النسبية '+NUM(r.toFixed(0))+': تشبّع شرائي.');}
    else if(r>60){score-=0.5;R('m','القوة النسبية '+NUM(r.toFixed(0))+': مرتفعة نسبيًا.');}
    else R('n','القوة النسبية '+NUM(r.toFixed(0))+': محايدة.');}
  let trend='عرضي',trendSub='السعر يتذبذب حول المتوسط الطويل',trendN=0;
  if(s2!=null&&s2p!=null){
    if(close>s2&&s2>s2p){score+=1;trend='صاعد';trendN=1;trendSub='السعر فوق المتوسط الطويل والمتوسط يرتفع';R('p','الاتجاه صاعد: السعر فوق المتوسط الطويل.');}
    else if(close<s2&&s2<s2p){score-=1;trend='هابط';trendN=-1;trendSub='السعر تحت المتوسط الطويل والمتوسط ينخفض';R('m','الاتجاه هابط: السعر تحت المتوسط الطويل.');}
  }
  if(s1!=null&&s2!=null)score+=s1>s2?0.5:-0.5;
  const mh=I.macdHist[N-1],mhp=I.macdHist[N-2];
  if(mh!=null&&mhp!=null){if(mh>0&&mh>=mhp)score+=0.5;else if(mh<0&&mh<=mhp)score-=0.5;}
  const bu=I.bbUp[N-1],bl=I.bbLo[N-1];
  if(bl!=null&&close<bl){score+=0.5;R('p','السعر أسفل حد بولنجر السفلي، والارتداد للمتوسط محتمل.');}
  else if(bu!=null&&close>bu){score-=0.5;R('m','السعر أعلى حد بولنجر العلوي، وقد يتراجع للمتوسط.');}
  const lastBrk=brk.length?brk[brk.length-1]:null;
  if(lastBrk&&lastBrk.i>=N-6){
    if(lastBrk.status==='confirmed'){score+=1.5*lastBrk.dir;R(lastBrk.dir>0?'p':'m',(lastBrk.dir>0?'اختراق مؤكد':'كسر مؤكد')+' بحجم تداول مرتفع '+(N-1-lastBrk.i===0?'في آخر شمعة':'قبل '+(N-1-lastBrk.i)+' شمعة')+'.');}
    else if(lastBrk.status==='false'){score-=1*lastBrk.dir;R(lastBrk.dir>0?'m':'p',lastBrk.dir>0?'اختراق كاذب حديث: عاد السعر تحت المقاومة.':'كسر كاذب حديث: عاد السعر فوق الدعم، وهذه إشارة إيجابية.');}
    else R('n',(lastBrk.dir>0?'اختراق':'كسر')+' حديث بلا حجم كافٍ، ينتظر التأكيد.');
  }
  if(tl.sup){const d=(close-tl.sup.now)/atrv;
    if(tl.sup.broken){score-=1;R('m','كسر السعر خط الاتجاه الداعم.');}
    else if(d>=0&&d<=0.8){score+=0.75;R('p','السعر يرتكز على خط اتجاه داعم عند '+NUM(fp(tl.sup.now))+'.');}}
  if(tl.res){const d=(tl.res.now-close)/atrv;
    if(tl.res.broken){score+=1;R('p','اخترق السعر خط الاتجاه الهابط.');}
    else if(d>=0&&d<=0.8){score-=0.5;R('m','السعر تحت خط اتجاه مقاوم عند '+NUM(fp(tl.res.now))+'.');}}
  for(const p of pats){if(p.tri){R(p.dir>0?'p':p.dir<0?'m':'n','نموذج '+p.name+' قيد التكوّن.');score+=0.4*p.dir;continue;}
    if(p.confirmed){score+=1.5*p.dir;R(p.dir>0?'p':'m','نموذج '+p.name+' مكتمل، وهدفه '+NUM(fp(p.target))+'.');}
    else{score+=0.5*p.dir;R(p.dir>0?'p':'m','نموذج '+p.name+' محتمل، يكتمل عند '+NUM(fp(p.neck))+'.');}}
  if(rr!=null&&sell){if(rr>=2)score+=1;else if(rr<1){score-=1;R('m','العائد المتوقع أقل من المخاطرة عند السعر الحالي.');}}
  let stance=score>=3?'buy':score<=-2.5?'sell':'neutral';
  if(stance==='buy'&&r!=null&&r>70){stance='neutral';R('m','لا يُنصح بالشراء أثناء التشبّع الشرائي؛ انتظر تهدئة السعر نحو منطقة الشراء.');}
  if(stance==='sell'&&r!=null&&r<30){stance='neutral';R('p','السعر في تشبّع بيعي، والبيع هنا قد يكون متأخرًا؛ انتظر ارتدادًا.');}
  const bull=Math.round(50+40*Math.tanh(score/3.5)); /* 10..90: technical signals never justify certainty */
  const dirStrength=stance==='buy'?bull:stance==='sell'?100-bull:null;

  let notable='';
  if(lastBrk&&lastBrk.i>=N-6&&lastBrk.status!=='weak')notable=(lastBrk.status==='confirmed'?(lastBrk.dir>0?'اختراق مؤكد':'كسر مؤكد'):(lastBrk.dir>0?'اختراق كاذب':'كسر كاذب'));
  else if(pats.find(p=>p.confirmed))notable=pats.find(p=>p.confirmed).name+' مكتمل';
  else if(buy&&buy.inside)notable='داخل منطقة الشراء';
  else if(sell&&sell.inside)notable='داخل منطقة البيع';
  else if(pats.length)notable=pats[0].name;

  let hi=-Infinity,lo=Infinity,vs=0;for(let i=start;i<N;i++){hi=Math.max(hi,D[i].h);lo=Math.min(lo,D[i].l);vs+=D[i].v||0;}
  const base=start>0?D[start-1].c:D[start].o;
  return Object.assign(A,{sig,brk,tl,pats,gaps,stance,score,bull,dirStrength,reasons,trend,trendN,trendSub,rsi:r,notable,
    perf:{ret:close/base-1,hi,lo,atrp:atrv/close,avgV:vs/span,days:span}});
}

/* walk-forward backtest on this asset's own history */
function runBacktest(D,I,o){
  const N=D.length,H=30;
  const res={zone:{n:0,w:0,r:0,b:0},rsi:{n:0,w:0,r:0,b:0},cross:{n:0,w:0,r:0,b:0},macd:{n:0,w:0,r:0,b:0},brk:{n:0,w:0,r:0,b:0}};
  const sim=(i,entry,stop,target)=>{
    for(let j=i+1;j<Math.min(N,i+1+H);j++){if(D[j].l<=stop)return{win:false,ret:(stop-entry)/entry,bars:j-i};if(D[j].h>=target)return{win:true,ret:(target-entry)/entry,bars:j-i};}
    if(i+H>=N)return null;const j=i+H;return{win:D[j].c>entry,ret:(D[j].c-entry)/entry,bars:H};};
  const add=(k,r)=>{if(!r)return;const s=res[k];s.n++;if(r.win)s.w++;s.r+=r.ret;s.b+=r.bars;};
  const first=Math.max(80,N-700),look=Math.min(o.span||250,250);
  let busy=-1;
  for(let e=first;e<N-1;e+=2){
    if(e<=busy)continue;
    const A=analyzeCore(D,I,{end:e+1,span:Math.min(look,e+1),sens:o.sens,zoneCount:o.zoneCount,stopMult:o.stopMult,lite:true});
    if(!A||!A.buy)continue;const c=D[e].c;
    if(c<=A.buy.hi&&c>=A.buy.lo-0.2*A.atrv&&(I.rsi[e]==null||I.rsi[e]<60)&&A.t1>c&&A.stop<c){const r=sim(e,c,A.stop,A.t1);add('zone',r);if(r)busy=e+r.bars;}
  }
  for(let i=Math.max(first,21);i<N-1;i++){
    const a=I.atr[i];if(!a)continue;const c=D[i].c,st=c-1.5*a,tg=c+3*a;
    if(I.rsi[i-1]!=null&&I.rsi[i-1]<30&&I.rsi[i]>=30)add('rsi',sim(i,c,st,tg));
    if(I.ma1[i-1]!=null&&I.ma2[i-1]!=null&&I.ma1[i-1]<=I.ma2[i-1]&&I.ma1[i]>I.ma2[i])add('cross',sim(i,c,st,tg));
    if(I.macd[i-1]!=null&&I.macdSig[i-1]!=null&&I.macd[i-1]<=I.macdSig[i-1]&&I.macd[i]>I.macdSig[i]&&I.macd[i]<0)add('macd',sim(i,c,st,tg));
    let hh=-Infinity;for(let j=i-20;j<i;j++)hh=Math.max(hh,D[j].h);
    const vm=I.volMa[i];if(c>hh&&D[i-1].c<=hh&&(!(vm>0)||D[i].v>=1.4*vm))add('brk',sim(i,c,st,tg));
  }
  return res;
}
function blendConfidence(A,bt){
  if(!A||A.dirStrength==null)return null;
  const ref=A.stance==='buy'&&bt&&bt.zone.n>=5?bt.zone:null;
  if(!ref)return{conf:A.dirStrength,hist:null};
  const win=ref.w/ref.n*100;return{conf:Math.min(90,Math.round(0.65*A.dirStrength+0.35*win)),hist:win,n:ref.n};
}
