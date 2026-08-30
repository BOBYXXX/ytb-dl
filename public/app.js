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
const extSelect = $('#extSelect');
const qualitySelect = $('#qualitySelect');
const extHint = $('#extHint');
const qualityHint = $('#qualityHint');
const mainDlBtn = $('#mainDlBtn');
const dlError = $('#dlError');

let currentVideo = null;
let allFormats = [];

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
      if(txt.includes('Not Found')) throw new Error("Backend non déployé — sur Render choisis 'Web Service' (pas Static Site) et attends 2 min");
      throw new Error(txt.slice(0,120));
    }
    if(!res.ok) throw new Error(data.error||'Erreur');
    currentVideo=data; allFormats=data.formats||[];
    render(data);
    result.classList.remove('hidden');
    result.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){ showError(e.message.includes('Unexpected token') ? "Backend non disponible — redéploie sur Render en Web Service" : e.message); }
  finally{ loading.classList.add('hidden'); analyzeBtn.disabled=false; analyzeBtn.innerHTML='<span>Analyser</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>'; }
}

function render(data){
  thumb.src=data.thumbnail||''; thumb.alt=data.title;
  durationEl.textContent=formatDuration(data.duration);
  videoTitleEl.textContent=data.title;
  uploaderEl.textContent=data.uploader||'—';
  viewsEl.textContent=formatViews(data.viewCount);
  videoIdEl.textContent=data.id;

  // Build extension list
  const exts = [...new Set(allFormats.map(f=>f.ext.toUpperCase()))];
  // prioriser MP4, MP3, M4A
  const order = { 'MP4':0, 'WEBM':1, 'M4A':2, 'MP3':3, 'OPUS':4, 'WAV':5 };
  exts.sort((a,b)=>(order[a]??99)-(order[b]??99));

  extSelect.innerHTML = exts.map(ext=>{
    const label = ext==='MP4' ? 'MP4 — Vidéo' : ext==='WEBM' ? 'WEBM — Vidéo' : ext==='MP3' ? 'MP3 — Audio' : ext==='M4A' ? 'M4A — Audio' : ext+' — Audio';
    return `<option value="${ext}">${label}</option>`;
  }).join('');

  // default to MP4 if exists
  if(exts.includes('MP4')) extSelect.value='MP4';

  updateQualityOptions();
  extSelect.onchange = updateQualityOptions;
  qualitySelect.onchange = updateHints;
  updateHints();
}

function updateQualityOptions(){
  const ext = extSelect.value.toLowerCase();
  const filtered = allFormats.filter(f=>f.ext.toLowerCase()===ext);
  // pour MP3 on n'a pas de qualité native, on propose une seule option
  if(filtered.length===0){
    qualitySelect.innerHTML='<option value="">Aucune qualité</option>';
    qualitySelect.disabled=true;
    extHint.textContent=''; qualityHint.textContent='';
    mainDlBtn.disabled=true;
    return;
  }
  qualitySelect.disabled=false; mainDlBtn.disabled=false;
  const isVideo = filtered.some(f=>f.height);
  if(isVideo){
    // video: tri par hauteur desc, dédupliquer
    const seen=new Set();
    const opts=[];
    filtered.filter(f=>f.height).sort((a,b)=>b.height-a.height).forEach(f=>{
      if(!seen.has(f.quality)){ seen.add(f.quality); opts.push(f); }
    });
    // ajouter audio-only si MP4 n'a pas de mixé ? non, on garde séparé
    qualitySelect.innerHTML = opts.map(f=>{
      const tag = f.hasAudio ? 'avec audio' : 'vidéo seule';
      return `<option value="${f.quality}">${f.quality} — ${f.ext.toUpperCase()} ${f.hasAudio?'✓':''}</option>`;
    }).join('');
  } else {
    // audio
    const opts = filtered.sort((a,b)=>(b.abr||0)-(a.abr||0));
    qualitySelect.innerHTML = opts.map(f=>{
      const br = f.abr ? `${Math.round(f.abr)} kbps` : f.quality;
      return `<option value="${f.formatId}">${br} — ${f.ext.toUpperCase()}</option>`;
    }).join('');
    // Si un seul format, on garde quand même
  }
  updateHints();
}

function updateHints(){
  const ext = extSelect.value.toLowerCase();
  const q = qualitySelect.value;
  if(!q){ extHint.textContent=''; qualityHint.textContent=''; return; }
  const fmt = allFormats.find(f=> f.ext.toLowerCase()===ext && (f.quality===q || f.formatId===q));
  if(!fmt){ extHint.textContent=''; qualityHint.textContent=''; return; }
  // hints
  if(fmt.height){
    extHint.textContent = fmt.hasAudio ? 'Muxé — prêt à télécharger' : 'Vidéo seule — sans son (1080p+)';
    qualityHint.textContent = fmt.filesize ? `${(fmt.filesize/1024/1024).toFixed(1)} Mo · ${fmt.fps||30} fps` : '';
  } else {
    extHint.textContent = 'Audio seul';
    qualityHint.textContent = fmt.filesize ? `${(fmt.filesize/1024/1024).toFixed(1)} Mo` : '';
  }
}

mainDlBtn.addEventListener('click', async ()=>{
  dlError.textContent='';
  const ext = extSelect.value.toLowerCase();
  const q = qualitySelect.value;
  if(!q) return;
  // trouver le format exact
  let fmt = allFormats.find(f=> f.ext.toLowerCase()===ext && (f.quality===q || f.formatId===q));
  if(!fmt) fmt = allFormats.find(f=> f.ext.toLowerCase()===ext);
  if(!fmt){ dlError.textContent='Format indisponible.'; return; }

  // si URL directe dispo -> téléchargement même page sans ouvrir onglet
  if(fmt.url){
    const safe = (currentVideo.title||'video').replace(/[<>:"/\\|?*]/g,'').slice(0,80).trim() || 'video';
    const filename = `${safe}.${fmt.ext}`;
    // technique même page : anchor avec download
    const a=document.createElement('a');
    a.href=fmt.url;
    a.download=filename;
    a.style.display='none';
    document.body.appendChild(a);
    a.click();
    // fallback si le navigateur bloque le download cross-origin (ouvre quand même sans quitter)
    setTimeout(()=>a.remove(), 1000);
    mainDlBtn.innerHTML='<span>✓ Lancement...</span>';
    setTimeout(()=> mainDlBtn.innerHTML='<span>Télécharger</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>', 1500);
    return;
  }

  // fallback proxy (ex: MP3 converti ou démo) -> passe par serveur
  mainDlBtn.disabled=true; mainDlBtn.innerHTML='<span>Préparation...</span>';
  try{
    const res=await fetch('/api/download',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ url: urlInput.value.trim(), formatId: fmt.formatId, quality: fmt.quality||fmt.height+'p', filename: currentVideo.title }) });
    if(!res.ok){ const j=await res.json().catch(()=>({error:'Erreur'})); throw new Error(j.error); }
    const blob=await res.blob();
    const cd=res.headers.get('Content-Disposition');
    let filename = `${currentVideo.title}.${fmt.ext}`;
    if(cd){ const m=cd.match(/filename="(.+?)"/); if(m) filename=decodeURIComponent(m[1]); }
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href);
    mainDlBtn.innerHTML='<span>✓ Téléchargé</span>';
  }catch(e){ dlError.textContent=e.message; }
  finally{ setTimeout(()=>{ mainDlBtn.disabled=false; mainDlBtn.innerHTML='<span>Télécharger</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>'; },2000); }
});
