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
const videoTitle = $('#videoTitle');
const uploaderEl = $('#uploader');
const viewsEl = $('#views');
const videoIdEl = $('#videoId');
const videoFormats = $('#videoFormats');
const audioFormats = $('#audioFormats');
const formatsCount = $('#formatsCount');

let currentVideo = null;

function isValidUrl(v){
  return /(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts\/)/i.test(v);
}
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
function formatBytes(b){
  if(!b) return '—';
  if(b>1e9) return (b/1e9).toFixed(2)+' Go';
  if(b>1e6) return (b/1e6).toFixed(1)+' Mo';
  return (b/1e3).toFixed(0)+' Ko';
}
function showError(msg){
  inputError.textContent = msg;
  inputWrap.classList.add('error');
}
function clearError(){
  inputError.textContent='';
  inputWrap.classList.remove('error');
}

pasteBtn.addEventListener('click', async ()=>{
  try{
    const t=await navigator.clipboard.readText();
    urlInput.value=t;
    urlInput.focus();
    clearError();
  }catch{
    urlInput.focus();
    document.execCommand('paste');
  }
});

urlInput.addEventListener('input', clearError);
urlInput.addEventListener('keydown', e=>{
  if(e.key==='Enter') analyze();
});

analyzeBtn.addEventListener('click', analyze);

async function analyze(){
  const url=urlInput.value.trim();
  if(!url){ showError('Collez un lien YouTube d\'abord.'); return; }
  if(!isValidUrl(url)){ showError('Lien invalide — utilisez un lien youtube.com ou youtu.be'); return; }
  clearError();
  analyzeBtn.disabled=true;
  analyzeBtn.innerHTML='<span>Analyse...</span>';
  loading.classList.remove('hidden');
  result.classList.add('hidden');

  try{
    const res=await fetch('/api/video-info',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({url})
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||'Erreur');
    currentVideo=data;
    render(data);
    result.classList.remove('hidden');
    result.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){
    showError(e.message.includes('yt-dlp') ? 'yt-dlp non installé sur le serveur — voir README pour l\'installer.' : e.message);
  }finally{
    loading.classList.add('hidden');
    analyzeBtn.disabled=false;
    analyzeBtn.innerHTML='<span>Analyser</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
  }
}

function render(data){
  thumb.src=data.thumbnail||'';
  thumb.alt=data.title;
  durationEl.textContent=formatDuration(data.duration);
  videoTitle.textContent=data.title;
  uploaderEl.textContent=data.uploader||'—';
  viewsEl.textContent=formatViews(data.viewCount);
  videoIdEl.textContent=data.id;
  formatsCount.textContent=`${data.formats.length} formats`;

  // bandeau info direct
  const existingNotice = document.getElementById('directNotice');
  if(existingNotice) existingNotice.remove();
  if(data.direct){
    const n=document.createElement('div');
    n.id='directNotice';
    n.style.cssText='margin:10px 0 14px;padding:10px 14px;border:1px solid rgba(201,168,106,.25);background:rgba(201,168,106,.07);border-radius:12px;font-size:12px;color:var(--accent2);line-height:1.5';
    n.innerHTML='⚡ <b>Lien direct</b> — le téléchargement passe par ta connexion (googlevideo.com), pas par notre serveur. Zéro bande passante côté serveur.';
    result.insertBefore(n, result.querySelector('.tabs'));
  } else if(data.demo){
    const n=document.createElement('div');
    n.id='directNotice';
    n.style.cssText='margin:10px 0 14px;padding:10px 14px;border:1px solid #2a2a2a;background:#1a1a1a;border-radius:12px;font-size:12px;color:var(--muted);line-height:1.5';
    n.innerHTML='Mode démo — installe <code>yt-dlp</code> sur le serveur pour générer les vrais liens directs.';
    result.insertBefore(n, result.querySelector('.tabs'));
  }

  const vF=data.formats.filter(f=>f.height);
  const aF=data.formats.filter(f=>!f.height);

  function dlButton(f){
    // si on a une URL directe, on donne un <a> direct — sinon fallback serveur (proxy)
    if(f.url){
      const name = encodeURIComponent((currentVideo.title||'video').replace(/[^\w\- ]/g,'').slice(0,60));
      return `<a href="${f.url}" target="_blank" rel="noopener" download="${name}.${f.ext}" class="dl-btn" title="Lien direct googlevideo — clic droit > Enregistrer sous">Lien direct <span>↗</span></a>`;
    } else {
      return `<button class="dl-btn" data-id="${f.formatId}" data-quality="${f.quality}">Télécharger <span>↓</span></button>`;
    }
  }

  videoFormats.innerHTML = vF.length ? vF.map(f=>{
    const isHD=f.height>=720;
    const badge = f.height>=2160 ? '4K' : f.height>=1080 ? 'FHD' : f.height>=720 ? 'HD' : 'SD';
    const audioBadge = f.hasAudio ? '<span class="badge badge-gold">avec audio</span>' : '<span class="badge">vidéo seule</span>';
    return `<div class="fmt">
      <div class="fmt-left">
        <div class="fmt-quality">${f.quality} <span class="badge ${isHD?'badge-gold':''}">${badge}</span> <span class="badge">${f.ext.toUpperCase()}</span> ${audioBadge}</div>
        <div class="fmt-meta">${f.ext.toUpperCase()} · ${formatBytes(f.filesize)} · ${f.fps||30}fps ${f.hasAudio?'· muxé':''}</div>
      </div>
      <div class="fmt-right">
        ${dlButton(f)}
      </div>
    </div>`;
  }).join('') : `<p style="color:var(--muted);font-size:13px;grid-column:1/-1">Aucun format vidéo détecté.</p>`;

  audioFormats.innerHTML = aF.length ? aF.map(f=>`
    <div class="fmt">
      <div class="fmt-left">
        <div class="fmt-quality">Audio <span class="badge badge-gold">${f.ext.toUpperCase()}</span> <span class="badge">${f.abr?Math.round(f.abr)+' kbps':''}</span></div>
        <div class="fmt-meta">${f.ext.toUpperCase()} · ${formatBytes(f.filesize)}</div>
      </div>
      <div class="fmt-right">
        ${dlButton(f)}
      </div>
    </div>
  `).join('') : `<p style="color:var(--muted);font-size:13px;grid-column:1/-1">Audio non disponible.</p>`;

  // bind only buttons without direct URL (fallback proxy)
  result.querySelectorAll('.dl-btn[data-id]').forEach(btn=>{
    btn.addEventListener('click', ()=> download(btn.dataset.id, btn.dataset.quality, btn));
  });
}

async function download(formatId, quality, btn){
  if(!currentVideo) return;
  const orig=btn.textContent;
  btn.disabled=true;
  btn.textContent='Préparation...';
  try{
    const res=await fetch('/api/download',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        url:urlInput.value.trim(),
        formatId,
        quality,
        filename: currentVideo.title
      })
    });
    if(!res.ok){
      const j=await res.json().catch(()=>({error:'Erreur'}));
      throw new Error(j.error);
    }
    const blob=await res.blob();
    const cd=res.headers.get('Content-Disposition');
    let filename=`${currentVideo.title}.${quality==='Audio uniquement'?'m4a':'mp4'}`;
    if(cd){
      const m=cd.match(/filename="(.+?)"/);
      if(m) filename=decodeURIComponent(m[1]);
    }
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=filename;
    a.click();
    URL.revokeObjectURL(a.href);
    btn.textContent='✓ Téléchargé';
    setTimeout(()=>{ btn.textContent=orig; btn.disabled=false; },2000);
  }catch(e){
    showError(e.message);
    btn.textContent=orig;
    btn.disabled=false;
  }
}

// tabs
document.querySelectorAll('.tab').forEach(t=>{
  t.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const tab=t.dataset.tab;
    videoFormats.classList.toggle('hidden', tab!=='video');
    audioFormats.classList.toggle('hidden', tab!=='audio');
  });
});

// demo: prefill with example if empty
if(!urlInput.value) urlInput.placeholder='https://www.youtube.com/watch?v=dQw4w9WgXcQ';
