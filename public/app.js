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
const extWrap = $('#extSelectWrap');
const qualityTrigger = $('#qualityTrigger');
const qualityValue = $('#qualityValue');
const qualityDropdown = $('#qualityDropdown');
const extHint = $('#extHint');
const qualityHint = $('#qualityHint');
const mainDlBtn = $('#mainDlBtn');
const dlError = $('#dlError');

let currentVideo = null;
let allFormats = [];
let selectedExt = 'MP4';
let selectedQuality = '';

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

// custom dropdown logic
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

  const exts = [...new Set(allFormats.map(f=>f.ext.toUpperCase()))];
  const order = { 'MP4':0, 'WEBM':1, 'M4A':2, 'MP3':3, 'OPUS':4 };
  exts.sort((a,b)=>(order[a]??99)-(order[b]??99));

  // build ext dropdown
  extDropdown.innerHTML = exts.map(ext=>{
    const label = ext==='MP4' ? 'MP4 — Vidéo' : ext==='WEBM' ? 'WEBM — Vidéo' : ext==='MP3' ? 'MP3 — Audio' : ext==='M4A' ? 'M4A — Audio' : ext;
    const active = ext===selectedExt || (selectedExt==='MP4' && !exts.includes('MP4') && ext===exts[0]);
    return `<div class="cs-option ${active?'active':''}" data-value="${ext}"><span>${label}</span><small>${ext}</small></div>`;
  }).join('');
  if(exts.includes('MP4')) selectedExt='MP4'; else selectedExt=exts[0]||'MP4';
  extValue.textContent = extDropdown.querySelector('.active')?.textContent?.trim() || selectedExt;

  extDropdown.querySelectorAll('.cs-option').forEach(o=>{
    o.addEventListener('click', ()=>{
      selectedExt=o.dataset.value;
      extDropdown.querySelectorAll('.cs-option').forEach(x=>x.classList.remove('active'));
      o.classList.add('active');
      extValue.textContent=o.textContent.trim();
      closeAllDropdowns();
      buildQualityOptions();
    });
  });

  buildQualityOptions();
}

function buildQualityOptions(){
  const ext = selectedExt.toLowerCase();
  const filtered = allFormats.filter(f=>f.ext.toLowerCase()===ext);
  if(filtered.length===0){
    qualityDropdown.innerHTML='<div class="cs-option">Aucune qualité</div>';
    qualityValue.textContent='—';
    mainDlBtn.disabled=true;
    extHint.textContent=''; qualityHint.textContent='';
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
    // trier muxés en premier
    opts.sort((a,b)=> (b.hasAudio?1:0)-(a.hasAudio?1:0) || b.height-a.height);
  } else {
    opts = filtered.sort((a,b)=>(b.abr||0)-(a.abr||0));
  }

  qualityDropdown.innerHTML = opts.map((f,i)=>{
    const active = i===0 ? 'active' : '';
    if(f.height){
      return `<div class="cs-option ${active}" data-quality="${f.quality}" data-fid="${f.formatId}"><span>${f.quality} ${f.hasAudio?'✓':''}</span><small>${f.ext.toUpperCase()} · ${f.hasAudio?'avec audio':'vidéo seule'}</small></div>`;
    } else {
      const br = f.abr ? `${Math.round(f.abr)} kbps` : 'Audio';
      return `<div class="cs-option ${active}" data-quality="${f.quality}" data-fid="${f.formatId}"><span>${br}</span><small>${f.ext.toUpperCase()}</small></div>`;
    }
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
  const ext = selectedExt.toLowerCase();
  const q = selectedQuality;
  const fmt = allFormats.find(f=> f.ext.toLowerCase()===ext && f.quality===q) || allFormats.find(f=> f.ext.toLowerCase()===ext);
  if(!fmt){ extHint.textContent=''; qualityHint.textContent=''; return; }
  if(fmt.height){
    extHint.textContent = fmt.hasAudio ? 'Muxé — prêt à télécharger' : 'Vidéo seule — sans son (1080p+)';
    qualityHint.textContent = fmt.filesize ? `${(fmt.filesize/1024/1024).toFixed(1)} Mo · ${fmt.fps||30} fps` : '';
  } else {
    extHint.textContent = 'Audio seul';
    qualityHint.textContent = fmt.filesize ? `${(fmt.filesize/1024/1024).toFixed(1)} Mo` : '';
  }
}

const progressWrap = $('#progressWrap');
const progressFill = $('#progressFill');
const progressText = $('#progressText');
const progressPercent = $('#progressPercent');

mainDlBtn.addEventListener('click', async ()=>{
  dlError.textContent='';
  if(!selectedQuality){ dlError.textContent='Choisis une qualité.'; return; }
  const ext = selectedExt.toLowerCase();
  let fmt = allFormats.find(f=> f.ext.toLowerCase()===ext && f.quality===selectedQuality);
  if(!fmt) fmt = allFormats.find(f=> f.ext.toLowerCase()===ext);
  if(!fmt){ dlError.textContent='Format indisponible.'; return; }

  // Si muxé (720p/480p avec son) et lien direct dispo → direct client (rapide, 0 bande passante serveur)
  // Sinon (1080p vidéo seule ou MP3) → passe par le serveur pour merger et rester sur la page avec explorateur
  if(fmt.url && fmt.hasAudio && fmt.ext !== 'mp3'){
    const safe = (currentVideo.title||'video').replace(/[<>:"/\\|?*]/g,'').slice(0,80).trim() || 'video';
    const filename = `${safe}.${fmt.ext}`;
    progressWrap.classList.remove('hidden');
    progressFill.style.width='100%'; progressFill.classList.remove('indeterminate');
    progressText.textContent='Lancement du téléchargement direct...'; progressPercent.textContent='→ navigateur';
    // technique qui reste sur la page: iframe caché + anchor download (évite l'ouverture manifest.googlevideo)
    const iframe=document.createElement('iframe');
    iframe.style.display='none';
    iframe.src=fmt.url;
    document.body.appendChild(iframe);
    // aussi anchor pour forcer le Save As (file explorer) sans quitter la page
    const a=document.createElement('a');
    a.href=fmt.url;
    a.download=filename;
    a.rel='noopener';
    a.style.display='none';
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ try{iframe.remove();}catch{}; a.remove(); }, 1500);
    mainDlBtn.innerHTML='<span>✓ Lancé</span>';
    progressText.textContent='✓ Si une nouvelle page s\'ouvre, ferme-la — le téléchargement est lancé';
    setTimeout(()=>{
      mainDlBtn.innerHTML='<span>Télécharger</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      progressWrap.classList.add('hidden');
    }, 3000);
    return;
  }

  // Fallback serveur: 1080p/4K vidéo seule (nécessite merge audio), MP3, ou pas de lien direct → reste sur la page + explorateur de fichiers via blob
  mainDlBtn.disabled=true; mainDlBtn.innerHTML='<span>Préparation...</span>';
  progressWrap.classList.remove('hidden');
  progressFill.style.width='0%'; progressFill.classList.add('indeterminate');
  const isMuxNeeded = fmt.height && !fmt.hasAudio;
  progressText.textContent= isMuxNeeded ? 'Muxage vidéo+audio sur le serveur (1080p avec son)...' : 'Préparation sur le serveur (conversion)...';
  progressPercent.textContent='...';

  try{
    const res=await fetch('/api/download',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ url: urlInput.value.trim(), formatId: fmt.formatId, quality: fmt.quality||fmt.height+'p', filename: currentVideo.title }) });
    if(!res.ok){ const j=await res.json().catch(()=>({error:'Erreur serveur'})); throw new Error(j.error); }
    progressFill.classList.remove('indeterminate');
    progressText.textContent='Téléchargement vers ton navigateur...';
    const total = parseInt(res.headers.get('Content-Length')||'0',10);
    const cd=res.headers.get('Content-Disposition');
    let filename = `${(currentVideo.title||'video').replace(/[<>:"/\\|?*]/g,'').slice(0,80)}.${fmt.ext}`;
    if(cd){ const m=cd.match(/filename="(.+?)"/); if(m) filename=decodeURIComponent(m[1]); }
    if(!res.body || !total){
      const blob=await res.blob();
      progressFill.style.width='100%'; progressPercent.textContent='100%';
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    } else {
      const reader=res.body.getReader();
      const chunks=[]; let received=0;
      while(true){
        const {done,value}=await reader.read();
        if(done) break;
        chunks.push(value); received+=value.length;
        const pct=Math.round((received/total)*100);
        progressFill.style.width=pct+'%'; progressPercent.textContent=pct+'%';
      }
      const blob=new Blob(chunks);
      progressFill.style.width='100%'; progressPercent.textContent='100%';
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    progressText.textContent='✓ Terminé';
    mainDlBtn.innerHTML='<span>✓ Téléchargé</span>';
  }catch(e){ dlError.textContent=e.message; progressText.textContent='Erreur'; mainDlBtn.innerHTML='<span>Erreur</span>'; }
  finally{
    setTimeout(()=>{
      mainDlBtn.disabled=false;
      mainDlBtn.innerHTML='<span>Télécharger</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      setTimeout(()=>progressWrap.classList.add('hidden'), 2500);
    },1200);
  }
});
