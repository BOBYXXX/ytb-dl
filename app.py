import http.server, json, os, re, subprocess, urllib.parse, shutil, pathlib, mimetypes, sys

PORT = int(os.environ.get("PORT", 3000))
ROOT = pathlib.Path(__file__).parent
PUBLIC = ROOT / "public"
DOWNLOADS = ROOT / "downloads"
DOWNLOADS.mkdir(exist_ok=True)

def extract_id(url):
    m = re.search(r'(?:youtube\.com/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be/)([^"&?\/\s]{11})', url)
    return m.group(1) if m else None

def sanitize(n): return re.sub(r'[<>:"/\\|?*\x00-\x1F]', '_', n).strip()[:120]

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
        url = data.get("url","").strip()
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
                # Ajout MP3 synthétique pour menu déroulant (conversion serveur)
                if audios:
                    audios.append({"quality":"Audio uniquement","ext":"mp3","formatId":"bestaudio","filesize":None,"abr":320,"url": None})
                return self.json(200, {"id":vid,"title":info.get("title"),"thumbnail":info.get("thumbnail"),"duration":info.get("duration"),"uploader":info.get("uploader"),"viewCount":info.get("view_count"),"formats":fmts+audios, "direct": True})
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
        mock=[{"quality":"1080p","height":1080,"ext":"mp4","formatId":"137","filesize":85000000,"fps":30,"hasAudio":False,"url": None},{"quality":"720p","height":720,"ext":"mp4","formatId":"136","filesize":45000000,"fps":30,"hasAudio":True,"url": None},{"quality":"480p","height":480,"ext":"mp4","formatId":"135","filesize":22000000,"fps":30,"hasAudio":True,"url": None},{"quality":"360p","height":360,"ext":"mp4","formatId":"134","filesize":12000000,"fps":30,"hasAudio":True,"url": None}]
        audios=[{"quality":"Audio uniquement","ext":"m4a","formatId":"140","filesize":5000000,"abr":128,"url": None},{"quality":"Audio uniquement","ext":"mp3","formatId":"bestaudio","filesize":5000000,"abr":320,"url": None}]
        note = "Mode démo — installe yt-dlp pour le téléchargement réel (voir README)" if not shutil.which("yt-dlp") else None
        payload={"id":vid,"title":title,"thumbnail":thumb,"duration":None,"uploader":uploader,"viewCount":None,"formats":mock+audios}
        if note: payload["demo"]=True; payload["note"]=note
        return self.json(200, payload)

    def handle_download(self, data):
        url=data.get("url",""); fmt=data.get("formatId",""); quality=data.get("quality",""); fname=data.get("filename","video")
        if not url or not fmt: return self.json(400, {"error":"URL et formatId requis"})
        vid=extract_id(url)
        if not vid: return self.json(400, {"error":"URL invalide"})
        if not shutil.which("yt-dlp"):
            return self.json(500, {"error":"yt-dlp non installé. Installe-le : winget install yt-dlp  ou  pip install yt-dlp"})
        safe=sanitize(fname)
        ext="m4a" if quality=="Audio uniquement" else "mp4"
        outpath=DOWNLOADS / f"{safe}.{ext}"
        selector=fmt if quality=="Audio uniquement" else f"{fmt}+bestaudio[ext=m4a]/best"
        cmd=["yt-dlp","-f",selector,"--merge-output-format","mp4","--no-warnings","-o",str(outpath),url]
        try:
            subprocess.check_call(cmd, timeout=300)
            if not outpath.exists(): raise FileNotFoundError
            self.send_response(200)
            self.send_header("Content-Disposition", f'attachment; filename="{urllib.parse.quote(outpath.name)}"')
            self.send_header("Content-Type", "video/mp4" if ext=="mp4" else "audio/mp4")
            self.send_header("Content-Length", str(outpath.stat().st_size))
            self.end_headers()
            with open(outpath,"rb") as f: shutil.copyfileobj(f, self.wfile)
            try: outpath.unlink()
            except: pass
        except Exception as e:
            print(e)
            if not self.wfile.closed: self.json(500, {"error": str(e)})

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
