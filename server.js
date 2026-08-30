const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
const { promisify } = require('util');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const QUALITY_MAP = {
  '2160p': 'bestvideo[height<=2160]+bestaudio/best[height<=2160]',
  '1440p': 'bestvideo[height<=1440]+bestaudio/best[height<=1440]',
  '1080p': 'bestvideo[height<=1080]+bestaudio/best[height<=1080]',
  '720p': 'bestvideo[height<=720]+bestaudio/best[height<=720]',
  '480p': 'bestvideo[height<=480]+bestaudio/best[height<=480]',
  '360p': 'bestvideo[height<=360]+bestaudio/best[height<=360]',
  'audio': 'bestaudio/best',
};

function extractVideoId(url) {
  const regex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
}

async function getVideoInfo(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('URL YouTube invalide');

  try {
    const { stdout } = await execAsync(
      `yt-dlp --dump-json --no-download --no-warnings "${url}"`,
      { timeout: 30000, maxBuffer: 1024 * 1024 * 10 }
    );
    const info = JSON.parse(stdout);

    const formats = [];
    const seen = new Set();
    if (info.formats) {
      for (const f of info.formats) {
        const hasAudio = f.acodec !== 'none';
        if (f.vcodec !== 'none' && f.height && ['mp4','webm'].includes(f.ext)) {
          const quality = `${f.height}p`;
          const key = `${quality}-${f.ext}`;
          if (!seen.has(key)) {
            seen.add(key);
            formats.push({ quality, height: f.height, ext: f.ext, formatId: f.format_id, filesize: f.filesize, fps: f.fps, hasAudio, url: f.url });
          } else if (hasAudio) {
            const idx = formats.findIndex(x => x.quality===quality && x.ext===f.ext && !x.hasAudio);
            if (idx!==-1) formats[idx] = { quality, height: f.height, ext: f.ext, formatId: f.format_id, filesize: f.filesize, fps: f.fps, hasAudio: true, url: f.url };
          }
        }
      }
    }
    formats.sort((a, b) => b.height - a.height);
    const audioFormats = info.formats?.filter(f => f.acodec !== 'none' && f.vcodec === 'none').map(f => ({ quality: 'Audio uniquement', ext: f.ext, formatId: f.format_id, filesize: f.filesize, abr: f.abr, url: f.url })) || [];
    return { id: videoId, title: info.title, thumbnail: info.thumbnail, duration: info.duration, uploader: info.uploader, viewCount: info.view_count, formats: [...formats, ...audioFormats], direct: true };
  } catch (error) {
    console.error('Erreur yt-dlp:', error);
    throw new Error('Impossible de récupérer les infos de la vidéo');
  }
}

app.post('/api/video-info', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL requise' });

    const info = await getVideoInfo(url);
    res.json(info);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/download', async (req, res) => {
  try {
    const { url, formatId, quality, filename } = req.body;
    if (!url || !formatId) {
      return res.status(400).json({ error: 'URL et formatId requis' });
    }

    const videoId = extractVideoId(url);
    if (!videoId) return res.status(400).json({ error: 'URL invalide' });

    const safeTitle = sanitizeFilename(filename || `video_${videoId}`);
    const ext = quality === 'Audio uniquement' ? 'm4a' : 'mp4';
    const outputName = `${safeTitle}.${ext}`;
    const outputPath = path.join(__dirname, 'downloads', outputName);

    if (!fs.existsSync(path.join(__dirname, 'downloads'))) {
      fs.mkdirSync(path.join(__dirname, 'downloads'), { recursive: true });
    }

    const formatSelector = quality === 'Audio uniquement'
      ? formatId
      : `${formatId}+bestaudio[ext=m4a]/best`;

    const cmd = `yt-dlp -f "${formatSelector}" --merge-output-format mp4 --no-warnings -o "${outputPath}" "${url}"`;

    await execAsync(cmd, { timeout: 300000, maxBuffer: 1024 * 1024 * 50 });

    if (!fs.existsSync(outputPath)) {
      throw new Error('Échec du téléchargement');
    }

    const stat = fs.statSync(outputPath);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(outputName)}"`);
    res.setHeader('Content-Type', ext === 'mp4' ? 'video/mp4' : 'audio/mp4');
    res.setHeader('Content-Length', stat.size);

    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      setTimeout(() => {
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      }, 5000);
    });

  } catch (error) {
    console.error('Erreur download:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur http://localhost:${PORT}`);
});