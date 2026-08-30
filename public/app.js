const $ = s => document.querySelector(s);
const urlInput = $('#urlInput');
const analyzeBtn = $('#analyzeBtn');
const pasteBtn = $('#pasteBtn');
const inputWrap = $('#inputWrap');
const inputError = $('#inputError');
const loading = $('#loading');
const result = $('#result');
const thumb = $('#thumb');
const durationEl = $('#duration');
const videoTitleEl = $('#videoTitle');
const uploaderEl = $('#uploader');
const viewsEl = $('#views');
const videoIdEl = $('#videoId');
const extTrigger = $('#extTrigger');
const extValue = $('#extValue');
const extDropdown = $('#extDropdown');
const qualityTrigger = $('#qualityTrigger');
const qualityValue = $('#qualityValue');
const qualityDropdown = $('#qualityDropdown');
const extHint = $('#extHint');
const qualityHint = $('#qualityHint');
const mainDlBtn = $('#mainDlBtn');
const dlError = $('#dlError');
const progressWrap = $('#progressWrap');
const progressFill = $('#progressFill');
const progressText = $('#progressText');
const progressPercent = $('#progressPercent');

let currentVideo = null;
let allFormats = [];
let selectedExtId = 'mp4';
let selectedQuality = '';

const NOTUBE_EXTS = [
  {id:'mp4', label:'MP4', ext:'mp4'},
];

const FUNNY_MSGS = [
  "On réveille le hamster qui pédale...",
  "On polit les pixels un par un...",
  "On négocie avec YouTube...",
  "On déroule le tapis rouge pour ta vidéo...",
  "On recharge les pop-corn...",
  "On chasse les pubs fantômes...",
  "On fait briller les bits...",
  "On caresse le serveur dans le bon sens...",
  "Patience, même Usain Bolt met du temps à 4K...",
  "On met les lunettes 3D pour mieux voir ta vidéo..."
];
let funnyInterval = null;

function isValidUrl(v){ return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/i.test(v); }
function formatDuration(s){
  if(!s) return '--:--';
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  if(h) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function formatViews(n){
  if(!n) return '— vues';
  if(n>=1e6) return (n/1e6).toFixed(1)+' M vues';
  if(n>=1e3) return (n/1e3).toFixed(1)+' k vues';
  return n.toLocaleString('fr-FR')+' vues';
}
function showError(msg){ inputError.textContent = msg; inputWrap.classList.add('error'); }
function clearError(){ inputError.textContent=''; inputWrap.classList.remove('error'); }

pasteBtn.addEventListener('click', async ()=>{
  try{ urlInput.value = await navigator.clipboard.readText(); urlInput.focus(); clearError(); }catch{ urlInput.focus(); }
});
urlInput.addEventListener('input', clearError);
urlInput.addEventListener('keydown', e=>{ if(e.key==='Enter') analyze(); });
analyzeBtn.addEventListener('click', analyze);

function toggleDropdown(trigger, dropdown){
  const isOpen = !dropdown.classList.contains('hidden');
  closeAllDropdowns();
  if(!isOpen){ dropdown.classList.remove('hidden'); trigger.classList.add('open'); }
}
function closeAllDropdowns(){
  document.querySelectorAll('.cs-dropdown').forEach(d=>d.classList.add('hidden'));
  document.querySelectorAll('.cs-trigger').forEach(t=>t.classList.remove('open'));
}
document.addEventListener('click', e=>{
  if(!e.target.closest('.custom-select')) closeAllDropdowns();
});
extTrigger.addEventListener('click', ()=> toggleDropdown(extTrigger, extDropdown));
qualityTrigger.addEventListener('click', ()=> toggleDropdown(qualityTrigger, qualityDropdown));

async function analyze(){
  const url=urlInput.value.trim();
  if(!url){ showError("Collez un lien YouTube d'abord."); return; }
  if(!isValidUrl(url)){ showError('Lien invalide — utilisez un lien youtube.com ou youtu.be'); return; }
  clearError(); dlError.textContent='';
  analyzeBtn.disabled=true; analyzeBtn.innerHTML='<span>Analyse...</span>';
  loading.classList.remove('hidden'); result.classList.add('hidden');
  try{
    const res=await fetch('/api/video-info',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url}) });
    const ct = res.headers.get('content-type')||'';
    let data;
    if(ct.includes('application/json')) data = await res.json();
    else {
      const txt = await res.text();
      if(txt.includes('Not Found')) throw new Error("Backend non déployé — sur Render choisis 'Web Service'");
      throw new Error(txt.slice(0,120));
    }
    if(!res.ok) throw new Error(data.error||'Erreur');
    currentVideo=data; allFormats=data.formats||[];
    render();
    result.classList.remove('hidden');
    result.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){ showError(e.message.includes('Unexpected token') ? "Backend non disponible — redéploie sur Render en Web Service" : e.message); }
  finally{ loading.classList.add('hidden'); analyzeBtn.disabled=false; analyzeBtn.innerHTML='<span>Analyser</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>'; }
}

function render(){
  const data=currentVideo;
  thumb.src=data.thumbnail||''; thumb.alt=data.title;
  durationEl.textContent=formatDuration(data.duration);
  videoTitleEl.textContent=data.title;
  uploaderEl.textContent=data.uploader||'—';
  viewsEl.textContent=formatViews(data.viewCount);
  videoIdEl.textContent=data.id;

  // build ext dropdown Notube-like
  extDropdown.innerHTML = NOTUBE_EXTS.map(o=>{
    const active = o.id===selectedExtId ? 'active' : '';
    return `<div class="cs-option ${active}" data-id="${o.id}" data-ext="${o.ext}"><span>${o.label}</span><small>${o.ext.toUpperCase()}</small></div>`;
  }).join('');
  extValue.textContent = NOTUBE_EXTS.find(x=>x.id===selectedExtId)?.label || 'MP4';
  extDropdown.querySelectorAll('.cs-option').forEach(o=>{
    o.addEventListener('click', ()=>{
      selectedExtId=o.dataset.id;
      extDropdown.querySelectorAll('.cs-option').forEach(x=>x.classList.remove('active'));
      o.classList.add('active');
      extValue.textContent=o.querySelector('span').textContent.trim();
      closeAllDropdowns();
      buildQualityOptions();
    });
  });
  buildQualityOptions();
}

function getFormatsForExtId(id){
  // Plus qu'un seul MP4 avec toutes les qualités, toujours avec son (mux serveur si besoin)
  let filtered = allFormats.filter(f=>f.ext.toLowerCase()==='mp4' && f.height);
  filtered = filtered.sort((a,b)=> b.height - a.height);
  return filtered;
}

function buildQualityOptions(){
  const filtered = getFormatsForExtId(selectedExtId);
  if(filtered.length===0){
    qualityDropdown.innerHTML=`<div class="cs-option">Aucune qualité dispo</div>`;
    qualityValue.textContent='—'; selectedQuality='';
    mainDlBtn.disabled=true; extHint.textContent=''; qualityHint.textContent='';
    return;
  }
  mainDlBtn.disabled=false;
  const isVideo = filtered.some(f=>f.height);
  let opts=[];
  if(isVideo){
    const seen=new Set();
    filtered.filter(f=>f.height).sort((a,b)=>b.height-a.height).forEach(f=>{
      if(!seen.has(f.quality)){ seen.add(f.quality); opts.push(f); }
    });
    opts.sort((a,b)=> (b.hasAudio?1:0)-(a.hasAudio?1:0) || b.height-a.height);
  } else {
    opts = filtered.sort((a,b)=>(b.abr||0)-(a.abr||0));
  }
  qualityDropdown.innerHTML = opts.map((f,i)=>{
    const active = i===0 ? 'active' : '';
    const badge = f.height>=2160 ? '4K' : f.height>=1440 ? '2K' : f.height>=1080 ? 'FHD' : f.height>=720 ? 'HD' : 'SD';
    return `<div class="cs-option ${active}" data-quality="${f.quality}" data-fid="${f.formatId}" data-ext="${f.ext}"><span>${f.quality}</span><small>${badge} · MP4 · avec son</small></div>`;
  }).join('');
  const first = qualityDropdown.querySelector('.cs-option');
  if(first){ selectedQuality = first.dataset.quality; qualityValue.textContent = first.querySelector('span').textContent.trim(); }
  qualityDropdown.querySelectorAll('.cs-option').forEach(o=>{
    o.addEventListener('click', ()=>{
      qualityDropdown.querySelectorAll('.cs-option').forEach(x=>x.classList.remove('active'));
      o.classList.add('active');
      selectedQuality=o.dataset.quality;
      qualityValue.textContent=o.querySelector('span').textContent.trim();
      closeAllDropdowns();
      updateHints();
    });
  });
  updateHints();
}

function updateHints(){
  const filtered = getFormatsForExtId(selectedExtId);
  const fmt = filtered.find(f=> f.quality===selectedQuality) || filtered[0];
  if(!fmt){ extHint.textContent='MP4 — Haute qualité'; qualityHint.textContent=''; return; }
  extHint.textContent='MP4 • H.264 • avec son';
  qualityHint.textContent = fmt.filesize ? `${(fmt.filesize/1024/1024).toFixed(1)} Mo · ${fmt.fps||30}fps` : `${fmt.quality} · MP4`;
}

mainDlBtn.addEventListener('click', async ()=>{
  dlError.textContent='';
  if(!selectedQuality){ dlError.textContent='Choisis une qualité.'; return; }
  const filtered = getFormatsForExtId(selectedExtId);
  let fmt = filtered.find(f=> f.quality===selectedQuality);
  if(!fmt) fmt = filtered[0];
  if(!fmt){ dlError.textContent='Format indisponible.'; return; }
  const extToSend = 'mp4';

  // MP4 toujours avec son: si muxé direct → direct navigateur, sinon serveur mux
  if(fmt.url && fmt.hasAudio){
    const safe = (currentVideo.title||'video').replace(/[<>:"/\\|?*]/g,'').slice(0,80).trim() || 'video';
    const filename = `${safe}.mp4`;
    progressWrap.classList.remove('hidden');
    progressFill.style.width='100%'; progressFill.classList.remove('indeterminate');
    progressText.textContent='Lancement direct navigateur...'; progressPercent.textContent='100%';
    const a=document.createElement('a'); a.href=fmt.url; a.download=filename; a.style.display='none'; document.body.appendChild(a); a.click();
    setTimeout(()=>a.remove(), 1000);
    mainDlBtn.innerHTML='<span>✓ Lancé</span>';
    progressText.textContent='✓ Téléchargement lancé — regarde tes téléchargements';
    setTimeout(()=>{ mainDlBtn.innerHTML='<span>Télécharger</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'; progressWrap.classList.add('hidden'); },2500);
    return;
  }

  // Fallback serveur pour 1080p/2K etc (vidéo seule → besoin de muxer pour avoir le son)
  mainDlBtn.disabled=true; mainDlBtn.innerHTML='<span>Préparation...</span>';
  progressWrap.classList.remove('hidden');
  progressFill.style.width='0%'; progressFill.classList.add('indeterminate');
  const needMux = fmt.height && !fmt.hasAudio;
  let msgIdx=0;
  progressText.textContent = FUNNY_MSGS[0];
  progressPercent.textContent='...';
  funnyInterval = setInterval(()=>{ msgIdx=(msgIdx+1)%FUNNY_MSGS.length; progressText.textContent=FUNNY_MSGS[msgIdx]; }, 1800);
  try{
    const res=await fetch('/api/download',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ url: urlInput.value.trim(), formatId: fmt.formatId, quality: fmt.quality||fmt.height+'p', filename: currentVideo.title, ext: extToSend }) });
    if(!res.ok){ const j=await res.json().catch(()=>({error:'Erreur serveur'})); throw new Error(j.error); }
    clearInterval(funnyInterval); progressFill.classList.remove('indeterminate'); progressText.textContent='Téléchargement vers toi...';
    const total = parseInt(res.headers.get('Content-Length')||'0',10);
    const cd=res.headers.get('Content-Disposition');
    let filename = `${(currentVideo.title||'video').replace(/[<>:"/\\|?*]/g,'').slice(0,80)}.${extToSend}`;
    if(cd){ const m=cd.match(/filename="(.+?)"/); if(m) filename=decodeURIComponent(m[1]); }
    if(!res.body || !total){
      const blob=await res.blob(); progressFill.style.width='100%'; progressPercent.textContent='100%';
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
    } else {
      const reader=res.body.getReader(); const chunks=[]; let received=0;
      while(true){ const {done,value}=await reader.read(); if(done) break; chunks.push(value); received+=value.length; const pct=Math.round((received/total)*100); progressFill.style.width=pct+'%'; progressPercent.textContent=pct+'%'; }
      const blob=new Blob(chunks); progressFill.style.width='100%'; progressPercent.textContent='100%';
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
    }
    clearInterval(funnyInterval); progressText.textContent='✓ Terminé — à toi de jouer !'; mainDlBtn.innerHTML='<span>✓ Téléchargé</span>';
  }catch(e){ clearInterval(funnyInterval); dlError.textContent=e.message; progressText.textContent='Oups, le hamster a trébuché...'; mainDlBtn.innerHTML='<span>Erreur</span>'; }
  finally{ setTimeout(()=>{ mainDlBtn.disabled=false; mainDlBtn.innerHTML='<span>Télécharger</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'; setTimeout(()=>progressWrap.classList.add('hidden'),2500); },1200); }
});
