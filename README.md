# ÉCLAT — YouTube Downloader Pro

Site luxueux pour télécharger des vidéos YouTube en haute qualité.

## Installation

1. **Installer yt-dlp** (requis pour le téléchargement réel) :
   - Windows: `winget install yt-dlp` ou `pip install yt-dlp`
   - Vérifier : `yt-dlp --version`

2. **Installer les dépendances** :
   ```bash
   npm install
   ```

3. **Lancer** :
   ```bash
   npm start
   ```
   Ouvre http://localhost:3000

## Formats supportés
MP4 2160p/1440p/1080p/720p/480p/360p + Audio M4A/MP3/OPUS/WAV

## Stack
Node.js + Express + yt-dlp + Frontend vanilla (aucun framework)
