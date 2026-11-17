/* ================= weekly portfolio report, morning-report additions, assistant summary (Phase 4, step 4) ================= */
const curOf=t=>t.ex==='GOLD'?(String(t.code).split('-')[1]||'USD'):(PUR_CUR[t.ex]||t.ex);

/* the week in numbers: each currency on its own (adding riyals to dollars says nothing) */
function weekSummary(trades,now){
  now=now||Date.now();const from=now-7*DAY,open=[],cur={},closed=[];
  for(const t of trades||[]){
    if(t.exit){if(t.exitDate>=from&&t.exitDate<=now)closed.push(t);continue;}
    const c=curOf(t),x=cur[c]=cur[c]||{cost:0,value:0,n:0,noPrice:0};x.n++;
    if(t.last>0){x.cost+=t.entry*t.qty;x.value+=t.last*t.qty;open.push({t,pct:t.last/t.entry-1,pl:(t.last-t.entry)*t.qty,cur:c});}else x.noPrice++;}
  for(const c in cur)cur[c].pl=cur[c].value-cur[c].cost;
  const real={};for(const t of closed){const c=curOf(t);real[c]=(real[c]||0)+(t.exit-t.entry)*t.qty;}
  open.sort((a,b)=>b.pct-a.pct);
  return{from,now,cur,open,best:open.length>1?open[0]:null,worst:open.length>1?open[open.length-1]:null,closed,real,
    wins:closed.filter(t=>t.exit>t.entry).length};
}

/* purification still owed and zakat now, worked out the same way as the portfolio page */
function weekDues(trades,ctx){
  const pur=(trades||[]).map(t=>{const k=purTradeKey(t);const f=purifyEntries(t.code,t.ex,true);
      const r=purifyDue(t,f,k in ctx.divs?ctx.divs[k]:null,{gains:ctx.gains});const fig=r.fig;
      return fig&&fig.kind==='pct'&&!(k in ctx.divs)?null:r;}).filter(Boolean);
  const purTot=purifyTotals(pur,ctx.paid||[]);
  const zak={};for(const t of trades||[]){if(t.exit)continue;const z=zakatFor(t,ctx.zakat);if(z.status==='ok')zak[z.cur]=(zak[z.cur]||0)+z.zakat;}
  return{pur:purTot,zak};
}

function weeklyText(s,dues,when){
  const m=(v,c)=>fmtMoney.format(v)+' '+_t(purCurLabel(c)),L=['📊 '+_t('التقرير الأسبوعي للمحفظة')+' — '+(when||fmtLocal.format(new Date(s.now))),''];
  const curs=Object.keys(s.cur);
  if(!curs.length)L.push(_t('لا توجد صفقات مفتوحة.'));
  for(const c of curs){const x=s.cur[c];
    if(x.noPrice===x.n){L.push('💼 '+_t('المفتوحة')+' ('+_t(purCurLabel(c))+'): '+x.n+' · '+_t('بلا سعر حديث')+'. '+_t('أضفها لقائمة المراقبة أو اضغط «تحديث الأسعار» في الصفقات.'));continue;}
    L.push('💼 '+_t('المفتوحة')+' ('+_t(purCurLabel(c))+'): '+x.n+' · '+_t('القيمة')+' '+m(x.value,c)+' · '+_t('الربح أو الخسارة غير المحققة')+' '+m(x.pl,c)
      +(x.cost?' ('+(x.pl>=0?'+':'')+(x.pl/x.cost*100).toFixed(1)+'%)':'')+(x.noPrice?' · '+_t('بلا سعر حديث')+': '+x.noPrice:''));}
  if(s.best)L.push('▲ '+_t('الأفضل')+': '+(s.best.t.name||s.best.t.code)+' '+(s.best.pct>=0?'+':'')+(s.best.pct*100).toFixed(1)+'%');
  if(s.worst)L.push('▼ '+_t('الأضعف')+': '+(s.worst.t.name||s.worst.t.code)+' '+(s.worst.pct>=0?'+':'')+(s.worst.pct*100).toFixed(1)+'%');
  L.push('');
  if(s.closed.length){L.push('✅ '+_t('أُغلقت هذا الأسبوع')+': '+s.closed.length+' ('+_t('رابحة')+' '+s.wins+')');
    for(const c in s.real)L.push('   '+_t('الربح المحقق')+' ('+_t(purCurLabel(c))+'): '+m(s.real[c],c));}
  else L.push(_t('لم تُغلق صفقات هذا الأسبوع.'));
  const pc=Object.keys(dues.pur).filter(c=>dues.pur[c].left>0),zc=Object.keys(dues.zak);
  if(pc.length||zc.length)L.push('');
  for(const c of pc)L.push('🤲 '+_t('التطهير المتبقي')+': '+m(dues.pur[c].left,c));
  for(const c of zc)L.push('🕌 '+_t('الزكاة التقديرية الآن')+': '+m(dues.zak[c],c));
  L.push('',_t('أرقام من سجل صفقاتك بآخر سعر معروف، وليست توصية استثمارية.'));
  return L.join('\n');
}

/* alerts of the last day and events of the coming week, for the morning report */
function morningExtras(log,events,now){
  now=now||Date.now();const L=[];
  const recent=(log||[]).filter(l=>l.t>=now-DAY);
  if(recent.length){L.push('','🔔 '+_t('تنبيهات آخر 24 ساعة')+': '+recent.length);for(const l of recent.slice(0,5))L.push('   • '+l.msg);}
  const soon=(events||[]).filter(e=>e.t>=now-DAY/2&&e.t<=now+7*DAY);
  if(soon.length){L.push('','📅 '+_t('أحداث الأسبوع القادم'));
    for(const e of soon.slice(0,10))L.push('   • '+fmtDay.format(e.t)+' — '+(e.name||e.code)+': '+_t(CAL_KIND[e.kind]||e.kind)+(e.est?' ('+_t('تقدير')+')':''));}
  return L;
}

/* ---------- assistant summary (off unless the user turns it on, uses the key they saved) ---------- */
const REPORT_AI_SYS='أنت مساعد مالي. يصلك تقرير آلي من برنامج «Mo Stocks». لخّصه بالعربية في 3 إلى 5 نقاط قصيرة: ما الأهم، وما يحتاج متابعة. لا تضف أرقامًا غير موجودة في التقرير، ولا توصيات شراء أو بيع.';
async function reportAiSummary(text){
  if(!P.report.ai)return null;
  const st=AI.status||await loadAiStatus().catch(()=>null),pv=(st&&st.providers)||{};
  const prov=pv[P.ai.provider]&&pv[P.ai.provider].hasKey?P.ai.provider:Object.keys(pv).find(k=>pv[k].hasKey);
  if(!prov)return{ok:false,error:_t('لم يُضف مفتاح لأي مساعد ذكي في الإعدادات.')};
  const r=await apiPost('/api/ai',{action:'ask',provider:prov,model:(P.ai.models||{})[prov]||'',base:prov==='custom'?P.ai.base:'',web:false,system:REPORT_AI_SYS,user:text}).catch(()=>null);
  return r&&r.ok&&r.text?{ok:true,text:r.text,name:r.name||pv[prov].name||prov}:{ok:false,error:(r&&r.error)||_t('لم يصل رد من المساعد.')};
}
const withAi=(text,ai)=>!ai?text:ai.ok?text+'\n\n🤖 '+_t('ملخص المساعد')+' ('+ai.name+'):\n'+ai.text:text+'\n\n('+_t('تعذّر ملخص المساعد')+': '+ai.error+')';

/* ---------- weekly report in the page ---------- */
async function buildWeekly(){
  if(!J.loaded)await loadJournal();
  await refreshJournalPrices();
  const s=weekSummary(J.trades);
  const dues=weekDues(J.trades,{divs:PUR.divs,paid:PUR.paid,gains:P.sharia.gains!==false,
    zakat:{method:P.zakat.method,cal:P.zakat.cal,saPays:P.zakat.saPays!==false,assets:zakatAssetsMap(P.zakat.assets),over:P.zakat.over||{}}});
  const text=withAi(weeklyText(s,dues),await reportAiSummary(weeklyText(s,dues)));
  $('#weekText').textContent=text;$('#weekMeta').textContent=_t('أُنشئ')+' '+fmtLocalTime.format(new Date());
  return text;
}
async function sendWeekly(){
  const text=await buildWeekly();
  const j=await apiPost('/api/notify',{title:_t('التقرير الأسبوعي للمحفظة'),body:_t('التقرير جاهز'),desktop:true,telegram:true,text}).catch(()=>null);
  await Store.set('lastWeekly',weekKey(new Date()));
  if(j&&j.telegram===true)toast(_t('أُرسل التقرير إلى تيليجرام.'));else if(j&&typeof j.telegram==='string')toast(j.telegram);
  else if(!P.telegram.enabled)toast(_t('أُنشئ التقرير. فعّل تيليجرام من الإعدادات لإرساله إلى هاتفك.'));
}
/* one report per week: the week is counted from Saturday */
function weekKey(d){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+1)%7));return x.getFullYear()+'-'+(x.getMonth()+1)+'-'+x.getDate();}
async function weeklyTick(now){
  const W2=P.report.weekly||{};if(!LOCAL||!W2.on)return;now=now||new Date();
  if(now.getDay()!==+W2.day)return;const [h,m]=(W2.time||'20:00').split(':').map(Number);
  if(now.getHours()*60+now.getMinutes()<h*60+m||(await Store.get('lastWeekly',''))===weekKey(now))return;
  await Store.set('lastWeekly',weekKey(now));sendWeekly();
}
function setupReports(){
  if(!$('#weekNow'))return;
  $('#weekNow').addEventListener('click',buildWeekly);$('#weekSend').addEventListener('click',sendWeekly);
}
