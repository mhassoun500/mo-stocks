/* ---------- backup/restore and the error log (Settings) ---------- */
const BK_KIND={auto:'تلقائية',manual:'يدوية','before-restore':'قبل الاستعادة'};
const fmtSize=n=>n>1048576?(n/1048576).toFixed(1)+' MB':Math.max(1,Math.round(n/1024))+' KB';
async function renderBackups(){
  const j=await api('/api/backup').catch(()=>null);if(!j||!j.ok)return;
  $('#bkList').innerHTML=j.list.length?j.list.map(b=>'<tr><td>'+NUM(esc(b.date))+'</td><td>'+BK_KIND[b.kind]+'</td><td>'+NUM(fmtSize(b.size))+'</td><td><button class="btn xs ghost" type="button" data-restore="'+esc(b.name)+'">استعادة</button></td></tr>').join('')
    :'<tr><td colspan="4" class="muted">لا توجد نسخ بعد. ستُنشأ أول نسخة تلقائية خلال دقائق من تشغيل البرنامج.</td></tr>';
}
async function doRestore(body,label){
  if(!(await confirmBox(_t('ستُستبدل بياناتك الحالية بالنسخة')+' '+label+'. '+_t('يحفظ البرنامج نسخة من بياناتك الحالية أولًا، فيمكنك التراجع. متابعة؟'))))return;
  const st=$('#bkStatus');st.className='status';st.textContent=_t('جارٍ الاستعادة…');
  const j=await apiPost('/api/backup',Object.assign({action:'restore'},body)).catch(()=>null);
  if(!j||!j.ok){st.className='status err';st.textContent=(j&&j.error)||_t('تعذّرت الاستعادة.');return;}
  st.textContent=_t('تمت الاستعادة. سيُعاد تحميل البرنامج…');setTimeout(()=>location.reload(),900);
}
/* a small in-page yes/no box (the app window does not show browser dialogs reliably) */
function confirmBox(msg){return new Promise(res=>{
  const d=document.createElement('div');d.className='modal-back';
  d.innerHTML='<div class="modal" role="dialog" aria-modal="true"><p></p><div class="actions"><button class="btn sm primary" type="button" data-v="1">'+_t('متابعة')+'</button><button class="btn sm ghost" type="button" data-v="0">'+_t('إلغاء')+'</button></div></div>';
  d.querySelector('p').textContent=msg;document.body.appendChild(d);d.querySelector('[data-v="1"]').focus();
  d.addEventListener('click',e=>{const b=e.target.closest('[data-v]');if(!b&&e.target!==d)return;d.remove();res(!!(b&&b.dataset.v==='1'));});
  d.addEventListener('keydown',e=>{if(e.key==='Escape'){d.remove();res(false);}});});}
async function renderErrors(){
  const j=await api('/api/errors').catch(()=>null);if(!j||!j.ok)return null;
  const box=$('#errLog');box.value=j.text||_t('لا توجد أخطاء مسجلة.');box.scrollTop=box.scrollHeight;return j;
}
function setupMaint(){
  if(!LOCAL)return;
  $('#bkExport').addEventListener('click',async()=>{const st=$('#bkStatus');st.className='status';
    const j=await apiPost('/api/backup',{action:'export'}).catch(()=>null);
    if(j&&j.ok){st.textContent=_t('حُفظت النسخة في مجلد التنزيلات.');api('/api/reveal',{path:j.path}).catch(()=>{});}else{st.className='status err';st.textContent=(j&&j.error)||_t('تعذّر الحفظ.');}});
  $('#bkNow').addEventListener('click',async()=>{const j=await apiPost('/api/backup',{action:'now'}).catch(()=>null);$('#bkStatus').className='status'+(j&&j.ok?'':' err');$('#bkStatus').textContent=j&&j.ok?_t('أُنشئت نسخة جديدة.'):(j&&j.error)||_t('تعذّر الحفظ.');renderBackups();});
  $('#bkFolder').addEventListener('click',()=>apiPost('/api/backup',{action:'folder'}).catch(()=>{}));
  $('#bkList').addEventListener('click',e=>{const b=e.target.closest('[data-restore]');if(b)doRestore({name:b.dataset.restore},b.closest('tr').cells[0].textContent);});
  $('#bkFile').addEventListener('change',async e=>{const f=e.target.files[0];e.target.value='';if(!f)return;
    let obj;try{obj=JSON.parse((await f.text()).replace(/^﻿/,''));}catch(err){$('#bkStatus').className='status err';$('#bkStatus').textContent=_t('الملف ليس بصيغة صحيحة.');return;}
    if(!obj||obj.app!=='Mo Stocks'||!obj.data){$('#bkStatus').className='status err';$('#bkStatus').textContent=_t('هذا الملف ليس نسخة احتياطية من Mo Stocks.');return;}
    doRestore({data:obj},f.name+(obj.created?' ('+obj.created+')':''));});
  $('#errReload').addEventListener('click',renderErrors);
  $('#errClear').addEventListener('click',async()=>{await apiPost('/api/errors',{action:'clear'}).catch(()=>{});renderErrors();$('#errStatus').textContent=_t('مُسح السجل.');});
  $('#errCopy').addEventListener('click',async()=>{const j=await renderErrors();if(!j)return;
    const tail=(j.text||'').trim().split('\n').slice(-80).join('\n');
    const rep=['Mo Stocks '+j.version+' · '+j.platform+' · Python '+j.python+(j.frozen?'':' (source)'),'Language: '+LANG+' · Data source: '+(P.dataSource||'tv')+' · Screen: '+innerWidth+'x'+innerHeight,
      'Current: '+(S.ex||'')+' '+(S.code||'')+' '+(S.tf||''),'','--- errors ---',tail||'(none)'].join('\n');
    const ok=await copyText(rep);$('#errStatus').textContent=ok?_t('نُسخ التقرير. الصقه في رسالتك مع وصف المشكلة.'):_t('تعذّر النسخ؛ انسخ النص من الخانة يدويًا.');});
  window.addEventListener('hashchange',()=>{if(location.hash==='#prefs'){renderBackups();renderErrors();}});
  if(location.hash==='#prefs'){renderBackups();renderErrors();}
}
