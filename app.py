import http.server, json, os, re, subprocess, urllib.parse, shutil, pathlib, mimetypes, sys

PORT = int(os.environ.get("PORT", 3000))
ROOT = pathlib.Path(__file__).parent
PUBLIC = ROOT / "public"
DOWNLOADS = ROOT / "downloads"
DOWNLOADS.mkdir(exist_ok=True)

def extract_id(url):
    m = re.search(r'(?:youtube\.com/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be/)([^"&?\/\s]{11})', url)
    return m.group(1) if m else None

def normalize_url(url):
    vid = extract_id(url)
    if vid:
        return f"https://www.youtube.com/watch?v={vid}"
    return url

def sanitize(n):
    # nettoie accents + caractères interdits pour Render (ext4)
    import unicodedata
    n = unicodedata.normalize('NFKD', n).encode('ascii','ignore').decode('ascii')
    return re.sub(r'[<>:"/\\|?*\x00-\x1F]', '_', n).strip()[:100] or "video"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=str(PUBLIC), **kw)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length) if length else b'{}'
        try: data = json.loads(body)
        except: data = {}
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/video-info":
            self.handle_info(data)
        elif parsed.path == "/api/download":
            self.handle_download(data)
        else:
            self.json(404, {"error": "Not Found - endpoint inconnu. Vérifie que le backend tourne (Render Web Service, pas Static Site)"})

    def handle_info(self, data):
        url = normalize_url(data.get("url","").strip())
        if not url: return self.json(400, {"error":"URL requise"})
        vid = extract_id(url)
        if not vid: return self.json(400, {"error":"URL YouTube invalide"})
        # try yt-dlp
        if shutil.which("yt-dlp"):
            try:
                out = subprocess.check_output(
                    ["yt-dlp","--dump-json","--no-download","--no-warnings",url],
                    timeout=30, text=True
                )
                info = json.loads(out)
                fmts=[]
                seen=set()
                for f in info.get("formats",[]):
                    has_audio = f.get("acodec") != "none"
                    # filtre: seulement https progressive (pas HLS/manifest) pour éviter le bug googlevideo/manifest
                    proto = f.get("protocol","")
                    url = f.get("url","")
                    if proto == "m3u8" or "manifest.googlevideo" in (url or "") or "m3u8" in (url or ""):
                        continue
                    if f.get("vcodec")!="none" and f.get("height") and f.get("ext") in ("mp4","webm") and proto in ("https","http"):
                        q=f"{f['height']}p"
                        key = (q, f.get("ext"))
                        if key not in seen:
                            seen.add(key)
                            fmts.append({"quality":q,"height":f["height"],"ext":f["ext"],"formatId":f["format_id"],"filesize":f.get("filesize"),"fps":f.get("fps"),"vcodec":f.get("vcodec"),"hasAudio":has_audio,"url": url, "protocol": proto})
                        elif has_audio:
                            for idx, old in enumerate(fmts):
                                if old["quality"]==q and old["ext"]==f["ext"] and not old.get("hasAudio"):
                                    fmts[idx]={"quality":q,"height":f["height"],"ext":f["ext"],"formatId":f["format_id"],"filesize":f.get("filesize"),"fps":f.get("fps"),"vcodec":f.get("vcodec"),"hasAudio":True,"url": url, "protocol": proto}
                                    break
                fmts.sort(key=lambda x: -x["height"])
                # prioriser les muxés (avec audio) en premier pour que le premier choix marche direct
                fmts.sort(key=lambda x: (0 if x.get("hasAudio") else 1, -x["height"]))
                audios=[{"quality":"Audio uniquement","ext":f.get("ext","m4a"),"formatId":f["format_id"],"filesize":f.get("filesize"),"abr":f.get("abr"),"url": f.get("url")} for f in info.get("formats",[]) if f.get("acodec")!="none" and f.get("vcodec")=="none" and f.get("protocol") in ("https","http") and "manifest" not in (f.get("url") or "")]
                # Extensions Notube-like (conversion serveur si besoin)
                if audios:
                    audios.append({"quality":"Audio uniquement","ext":"mp3","formatId":"bestaudio","filesize":None,"abr":192,"url": None})
                    audios.append({"quality":"Audio HD","ext":"mp3","formatId":"bestaudio","filesize":None,"abr":320,"url": None})
                    audios.append({"quality":"Audio WAV","ext":"wav","formatId":"bestaudio","filesize":None,"abr":1411,"url": None})
                # FLV / 3GP / WAV dérivés des MP4 existants (synthétiques)
                synth=[]
                for f in fmts:
                    if f["height"] <= 720:
                        synth.append({**f, "ext":"flv", "formatId": f["formatId"], "url": None})
                    if f["height"] <= 360:
                        synth.append({**f, "ext":"3gp", "formatId": f["formatId"], "url": None})
                # MP4 / MP4 HD / MP4 2K sont des vues filtrées côté frontend, pas besoin de dupliquer
                all_fmts = fmts + synth + audios
                return self.json(200, {"id":vid,"title":info.get("title"),"thumbnail":info.get("thumbnail"),"duration":info.get("duration"),"uploader":info.get("uploader"),"viewCount":info.get("view_count"),"formats":all_fmts, "direct": True})
            except Exception as e:
                print("yt-dlp error:", e)
                # fallback to mock still with real title if possible
                pass
        # Fallback: use oEmbed for title/thumb + mock formats (demo mode)
        try:
            import urllib.request
            with urllib.request.urlopen(f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json", timeout=8) as r:
                oe=json.loads(r.read())
                title=oe.get("title", f"Vidéo {vid}")
                thumb=oe.get("thumbnail_url", f"https://img.youtube.com/vi/{vid}/hqdefault.jpg")
                uploader=oe.get("author_name","")
        except:
            title=f"Vidéo {vid}"; thumb=f"https://img.youtube.com/vi/{vid}/hqdefault.jpg"; uploader=""
        mock=[
            {"quality":"2160p","height":2160,"ext":"mp4","formatId":"313","filesize":180000000,"fps":30,"hasAudio":False,"url": None},
            {"quality":"1440p","height":1440,"ext":"mp4","formatId":"308","filesize":120000000,"fps":30,"hasAudio":False,"url": None},
            {"quality":"1080p","height":1080,"ext":"mp4","formatId":"137","filesize":85000000,"fps":30,"hasAudio":False,"url": None},
            {"quality":"720p","height":720,"ext":"mp4","formatId":"136","filesize":45000000,"fps":30,"hasAudio":True,"url": None},
            {"quality":"480p","height":480,"ext":"mp4","formatId":"135","filesize":22000000,"fps":30,"hasAudio":True,"url": None},
            {"quality":"360p","height":360,"ext":"mp4","formatId":"134","filesize":12000000,"fps":30,"hasAudio":True,"url": None}
        ]
        mock_synth=[]
        for f in mock:
            if f["height"] <= 720: mock_synth.append({**f, "ext":"flv", "url": None})
            if f["height"] <= 360: mock_synth.append({**f, "ext":"3gp", "url": None})
        audios=[
            {"quality":"Audio uniquement","ext":"m4a","formatId":"140","filesize":5000000,"abr":128,"url": None},
            {"quality":"Audio uniquement","ext":"mp3","formatId":"bestaudio","filesize":4200000,"abr":192,"url": None},
            {"quality":"Audio HD","ext":"mp3","formatId":"bestaudio","filesize":6500000,"abr":320,"url": None},
            {"quality":"Audio WAV","ext":"wav","formatId":"bestaudio","filesize":25000000,"abr":1411,"url": None}
        ]
        mock = mock + mock_synth
        note = "Mode démo — installe yt-dlp pour le téléchargement réel (voir README)" if not shutil.which("yt-dlp") else None
        payload={"id":vid,"title":title,"thumbnail":thumb,"duration":None,"uploader":uploader,"viewCount":None,"formats":mock+audios}
        if note: payload["demo"]=True; payload["note"]=note
        return self.json(200, payload)

    def handle_download(self, data):
        url=normalize_url(data.get("url","")); fmt=data.get("formatId",""); quality=data.get("quality",""); fname=data.get("filename","video"); req_ext=(data.get("ext") or "").lower()
        if not url or not fmt: return self.json(400, {"error":"URL et formatId requis"})
        vid=extract_id(url)
        if not vid: return self.json(400, {"error":"URL invalide"})
        if not shutil.which("yt-dlp"):
            return self.json(500, {"error":"yt-dlp non installé. Installe-le : winget install yt-dlp  ou  pip install yt-dlp"})
        safe=sanitize(fname)
        # extension demandée (MP3, MP3 HD, M4A, MP4, MP4 HD, MP4 2K, WAV, 3GP, FLV)
        # mapping Notube-like
        if req_ext in ("mp3","m4a","wav","flv","3gp","mp4"):
            ext=req_ext
        else:
            ext="m4a" if "Audio" in (quality or "") else "mp4"
        # pour FLV/3GP/WAV on force la conversion
        outpath=DOWNLOADS / f"{safe}.{ext}"
        # sélecteur yt-dlp
        if ext in ("mp3","m4a","wav"):
            # audio
            if ext=="mp3": selector=fmt
            elif ext=="wav": selector=fmt
            else: selector=fmt
            # yt-dlp gère --extract-audio via postprocessor, mais on utilise -f bestaudio + conversion
            cmd=["yt-dlp","-f",selector,"--no-warnings","-o",str(outpath.with_suffix(f".%(ext)s")),url]
            # post-traitement selon ext (on laisse yt-dlp choisir, puis on renomme)
            if ext=="mp3":
                cmd += ["--extract-audio","--audio-format","mp3","--audio-quality","0" if "HD" in (quality or "") else "192K"]
            elif ext=="wav":
                cmd += ["--extract-audio","--audio-format","wav"]
            elif ext=="m4a":
                cmd += ["--extract-audio","--audio-format","m4a"]
        else:
            # video: FLV/3GP/MP4 — si ffmpeg manquant, fallback sur best muxé sans merge
            has_ffmpeg = shutil.which("ffmpeg") is not None
            selector=fmt if fmt=="bestaudio" else f"{fmt}+bestaudio/best"
            if ext=="flv":
                if has_ffmpeg:
                    cmd=["yt-dlp","-f",selector,"--merge-output-format","flv","--recode-video","flv","--no-warnings","-o",str(outpath),url]
                else:
                    cmd=["yt-dlp","-f","best[ext=flv]/best","--no-warnings","-o",str(outpath),url]
            elif ext=="3gp":
                if has_ffmpeg:
                    cmd=["yt-dlp","-f",selector,"--merge-output-format","3gp","--recode-video","3gp","--no-warnings","-o",str(outpath),url]
                else:
                    cmd=["yt-dlp","-f","best[ext=3gp]/best","--no-warnings","-o",str(outpath),url]
            else:
                if has_ffmpeg:
                    cmd=["yt-dlp","-f",selector,"--merge-output-format","mp4","--no-warnings","-o",str(outpath),url]
                else:
                    # sans ffmpeg: prend le best déjà muxé (22/18) avec son, pas besoin de merge
                    cmd=["yt-dlp","-f","best[ext=mp4]/best","--no-warnings","-o",str(outpath),url]
        try:
            try:
                proc = subprocess.run(cmd, timeout=300, capture_output=True, text=True)
                if proc.returncode != 0:
                    print(f"yt-dlp fail cmd={cmd} stderr={proc.stderr[:500]}")
                    raise subprocess.CalledProcessError(proc.returncode, cmd, proc.stdout, proc.stderr)
            except (subprocess.CalledProcessError, FileNotFoundError) as e:
                err = getattr(e, 'stderr', str(e)) or str(e)
                print(f"yt-dlp merge failed ({e}), stderr={err[:800]}, retry best")
                fallback = ["yt-dlp","-f","best","--no-warnings","--extractor-args","youtube:player_client=android","--geo-bypass","-o",str(outpath),url]
                try:
                    proc2 = subprocess.run(fallback, timeout=300, capture_output=True, text=True)
                    if proc2.returncode != 0:
                        print(f"fallback also failed: {proc2.stderr[:500]}")
                        raise subprocess.CalledProcessError(proc2.returncode, fallback, proc2.stdout, proc2.stderr)
                except FileNotFoundError as fe:
                    raise FileNotFoundError(f"yt-dlp non trouvé: {fe}")
            # fichier peut avoir ext différente (conversion) → cherche le fichier créé
            target = outpath
            if not target.exists():
                cands = list(DOWNLOADS.glob(f"{safe}.*"))
                if cands: target = max(cands, key=lambda p: p.stat().st_mtime)
                else: raise FileNotFoundError(f"fichier non créé: {outpath}")
            self.send_response(200)
            self.send_header("Content-Disposition", f'attachment; filename="{urllib.parse.quote(target.name)}"')
            ctype = "video/mp4" if ext in ("mp4","flv","3gp") else "audio/mpeg" if ext=="mp3" else "audio/mp4" if ext=="m4a" else "audio/wav"
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(target.stat().st_size))
            self.end_headers()
            with open(target,"rb") as f: shutil.copyfileobj(f, self.wfile)
            try: target.unlink()
            except: pass
            for p in DOWNLOADS.glob(f"{safe}.*"):
                try:
                    if p != target: p.unlink()
                except: pass
        except Exception as e:
            err = getattr(e, 'stderr', '') or str(e)
            print(f"download error: {e} stderr={err[:800]}")
            if "Sign in to confirm" in err or "not a bot" in err:
                msg = "Cette vidéo est bloquée par YouTube (anti-bot) sur nos serveurs US. Essaie une autre vidéo, ou passe en MP4 360p/720p direct si dispo. Voir https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp"
                if not self.wfile.closed: self.json(500, {"error": msg})
            else:
                if not self.wfile.closed: self.json(500, {"error": f"{e}\n{err[:600]}"})

    def json(self, code, obj):
        b=json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        # log pour debug Render
        # print(f"GET {self.path} -> PUBLIC={PUBLIC} exists={PUBLIC.exists()} index={ (PUBLIC/'index.html').exists() }")
        if self.path.startswith("/api/"):
            return self.json(404, {"error":"not found"})
        # clean path
        req = self.path.split("?")[0].split("#")[0]
        if req in ("/", "/index.html", ""):
            # sert index.html directement (plus robuste que SimpleHTTPRequestHandler)
            fp = PUBLIC / "index.html"
            if fp.exists():
                self.send_response(200)
                self.send_header("Content-Type","text/html; charset=utf-8")
                self.send_header("Content-Length", str(fp.stat().st_size))
                self.end_headers()
                with open(fp,"rb") as f: shutil.copyfileobj(f, self.wfile)
                return
            else:
                # debug: liste les fichiers pour voir où on est
                try:
                    lst = os.listdir(str(PUBLIC)) if PUBLIC.exists() else os.listdir(".")
                except Exception as e: lst = [str(e)]
                return self.json(500, {"error": f"index.html introuvable. PUBLIC={PUBLIC} cwd={os.getcwd()} files={lst}"})
        # fichiers statiques (style.css, app.js)
        p = PUBLIC / req.lstrip("/")
        if p.is_file():
            ctype,_ = mimetypes.guess_type(str(p))
            self.send_response(200)
            self.send_header("Content-Type", ctype or "application/octet-stream")
            self.send_header("Content-Length", str(p.stat().st_size))
            self.end_headers()
            with open(p,"rb") as f: shutil.copyfileobj(f, self.wfile)
            return
        # SPA fallback
        fp = PUBLIC / "index.html"
        if fp.exists():
            self.send_response(200)
            self.send_header("Content-Type","text/html; charset=utf-8")
            self.send_header("Content-Length", str(fp.stat().st_size))
            self.end_headers()
            with open(fp,"rb") as f: shutil.copyfileobj(f, self.wfile)
            return
        return self.json(404, {"error": f"Not Found: {req}"})

if __name__=="__main__":
    os.chdir(str(ROOT))
    print(f"ECLAT sur http://localhost:{PORT}")
    if not shutil.which("yt-dlp"):
        print("yt-dlp non trouve - mode demo active (analyse OK, telechargement necessite yt-dlp)")
        print("   Installe : winget install yt-dlp  ou  pip install yt-dlp")
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
