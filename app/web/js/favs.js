/* ================= favorites: save any asset to reopen it later ================= */
const FAV={list:[]};
async function loadFavs(){FAV.list=await Store.get('favorites',[]);renderFavs();updateFavBtn();}
function favIndex(){return FAV.list.findIndex(f=>f.ex===S.ex&&(f.code||'')===(S.code||'')&&(f.code||f.name===S.name));}
function favLabel(f){if(f.short)return f.short;const code=(f.code||'').replace(/\.(SR|CA)$/,'');const nm=(f.name||'').replace(/\b(Company|Corporation|Co\.?|S\.?A\.?E\.?|Inc\.?)\b/gi,'').trim();
  return code&&nm&&nm.toUpperCase()!==code?code+' · '+nm.slice(0,18):(code||nm);}
function updateFavBtn(){const b=$('#favBtn');if(!b)return;const can=S.source!=='sample'&&!!(S.code||S.name);b.hidden=!can;if(!can)return;
  const on=favIndex()>=0;b.setAttribute('aria-pressed',String(on));b.textContent=on?'★ في المفضلة':'☆ أضف للمفضلة';}
async function toggleFav(){
  if(S.source==='sample')return;
  const i=favIndex();
  if(i>=0){FAV.list.splice(i,1);toast('أزيل من المفضلة.');}
  else{const f={ex:S.ex,code:S.code||'',name:S.name||'',short:(S.meta&&S.meta.short)||'',at:Date.now()};
    if(S.source==='user'){const lf=await Store.get('lastFile',null);if(lf&&lf.text&&lf.text.length<600000){f.text=lf.text;f.fileName=lf.fileName||'';}}
    FAV.list.unshift(f);toast('أضيف '+favLabel(f)+' إلى المفضلة.');}
  await Store.set('favorites',FAV.list);renderFavs();updateFavBtn();
}
function renderFavs(){const box=$('#favs');if(!box)return;$('#favRow').hidden=!FAV.list.length;
  box.innerHTML=FAV.list.map((f,i)=>'<span class="fav-chip"><button type="button" class="pill-btn" data-fav="'+i+'" title="'+esc(f.name||f.code)+'"><span aria-hidden="true">★</span> <bdi>'+esc(favLabel(f))+'</bdi></button>'+
    '<button type="button" class="fav-x" data-unfav="'+i+'" aria-label="إزالة من المفضلة">×</button></span>').join('');}
function openFav(f){
  location.hash='#analysis';applySource(f.ex,f.code||'');
  if(LOCAL&&f.code){fetchSymbol(f.code,f.ex);return;}
  if(f.text){loadText(f.text,{fileName:f.fileName||''});return;}
  setStatus('افتح بيانات '+favLabel(f)+' من أحد الموقعين، ثم ارفع الملف.');
}
function setupFavs(){
  $('#favBtn').addEventListener('click',toggleFav);
  $('#favs').addEventListener('click',async e=>{
    const x=e.target.closest('[data-unfav]');if(x){FAV.list.splice(+x.dataset.unfav,1);await Store.set('favorites',FAV.list);renderFavs();updateFavBtn();return;}
    const b=e.target.closest('[data-fav]');if(b)openFav(FAV.list[+b.dataset.fav]);});
  loadFavs();
}
