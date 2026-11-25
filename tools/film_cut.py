#!/usr/bin/env python3
"""film_cut.py: cut the recorded shots (tools/film.py) into the film, with captions and music.

    python3 tools/film_cut.py tools/film-edit.json [--out NAME] [--no-captions] [--only-audio]

The edit file: {"segments": [{"clip", "a": start, "d": seconds used from the clip, "s": speed, "fi", "fo": fades,
"cap": [[t0, t1, text], ...], "band": true, "card": "html", "zoom": [from, to, cx, cy], "blur", "dim", "html": [[t0, t1, html, fade], ...],
"over": [{"clip", "a", "s", "d", "x", "y", "w", "h", "at", "fi", "fo", "frame"}], "voice": [[name, t], ...],
"cam": [[t, zoom, cx, cy], ...] moves the window over the picture, "adv": true for a console take (1536 x 800, sits above the caption bar),
"scope": true for a 2.39 : 1 picture, "bars": height of black bars above and below, "grade": "film" or "ui", "clean": true puts a console take in the
middle of the frame (no caption bar)}], "music": [{"file", "at": block, "db", "fi", "fo"}], "block": seconds, "k": 1 or 2 (2 = a 3840 x 2160 film)}
Captions are set in the site's own type by Chrome and laid over the lower bar, so no picture is covered.
"""
import argparse, hashlib, base64, concurrent.futures, json, os, subprocess, sys, tempfile
import film, shoot

FF = film.FFMPEG
HERE = os.path.dirname(os.path.abspath(__file__))
FILM = os.path.expanduser("~/Developer/.hound-release/film")
K = 1
# one look for the whole film: colour held back, shadows a little cold, corners a little dark, a trace of grain (none on the console, so its text stays clean)
GRADE = {"film": "eq=contrast=1.05:saturation=0.85,colorbalance=rs=-0.014:bs=0.020:rh=0.008:bh=-0.010,vignette=angle=PI/6.5,noise=c0s=KK:c0f=t",
         "dust": "eq=contrast=1.22:brightness=-0.055:saturation=0.5,colorbalance=rs=-0.03:bs=0.04:rm=-0.02:bm=0.03,vignette=angle=PI/5,noise=c0s=KK:c0f=t",
         "real": "eq=saturation=0.90:gamma=1.06,colorbalance=rs=-0.010:bs=0.014,noise=c0s=KK:c0f=t",
         "night": "lutyuv=y='16+(val-16)*(1+1.15*exp(-max(val-16\\,0)/26))':u='128+(val-128)*1.06':v='128+(val-128)*1.06',noise=c0s=KK:c0f=t",
         "lift": "eq=saturation=0.95:gamma=1.32,colorbalance=rs=-0.010:bs=0.014,noise=c0s=KK:c0f=t",
         "ui": "eq=saturation=0.88:gamma=1.05"}
ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "15", "-pix_fmt", "yuv420p", "-r", "60", "-color_range", "tv", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-video_track_timescale", "60000"]


def font(name):
    p = os.path.join(HERE, "..", "assets", "brand", "fonts", name)
    return "data:font/woff2;base64," + base64.b64encode(open(p, "rb").read()).decode()


def css():
    return ("@font-face{font-family:HSerif;src:url(%s)}@font-face{font-family:HSans;font-weight:400 700;src:url(%s)}"
            "html,body{margin:0;background:transparent}body{width:1920px;height:1080px;position:relative;overflow:hidden;-webkit-font-smoothing:antialiased}"
            ".cap{position:absolute;left:0;right:0;bottom:0;height:80px;display:grid;place-items:center;font:500 31px/1 HSans;letter-spacing:.002em;color:#f2f5f8;text-shadow:0 1px 8px rgba(0,0,0,.65)}"
            ".cap.scope{height:138px}"
            ".tag{position:absolute;right:44px;top:34px;padding:9px 14px 10px;background:rgba(8,11,15,.66);border:1px solid rgba(165,139,255,.5);border-radius:4px;font:500 20px/1 HSans;color:#e6e1ff}"
            % (font("instrument-serif-latin-400-normal.woff2"), font("instrument-sans-latin-wdth-normal.woff2")))


def stills(items, out):
    """Render each HTML body to a transparent 1920 x 1080 PNG."""
    a = argparse.Namespace()
    proc, prof, page = film.chrome(a, (1920, 1080, K))
    try:
        page.call("Emulation.setDefaultBackgroundColorOverride", {"color": {"r": 0, "g": 0, "b": 0, "a": 0}})
        tree = page.call("Page.getFrameTree")["frameTree"]["frame"]["id"]
        for name, body in items:
            page.call("Page.setDocumentContent", {"frameId": tree, "html": f"<!doctype html><meta charset=utf-8><style>{css()}</style><body>{body}</body>"})
            page.eval("document.fonts.ready.then(() => 1)")
            page.pump(0.15)
            open(os.path.join(out, name), "wb").write(base64.b64decode(page.call("Page.captureScreenshot", {"format": "png"})["data"]))
    finally:
        proc.terminate()


def cut(job):
    i, seg, tmp, caps = job
    sp = seg.get("s", 1)
    dur = seg["d"] / sp
    out = os.path.join(tmp, f"{i:03d}.mp4")
    cmd = [FF, "-y", "-loglevel", "error", "-ss", f"{seg['a']:.3f}", "-t", f"{seg['d']:.3f}", "-i", os.path.join(FILM, seg["clip"] + ".mp4")]
    g = f"[0:v]setpts=(PTS-STARTPTS)/{sp},fps=60,"
    ph = 1000 if seg.get("adv") else 1080
    if seg.get("zoom"):
        z0, z1, cx, cy = seg["zoom"]
        w = lambda z: (cx * (1 - 1 / z) + 0.5 / z, cy * (1 - 1 / z) + 0.5 / z)
        seg["cam"] = [[0, z0, *w(z0)], [dur, z1, *w(z1)]]
    if seg.get("win"):   # filmed at its own framing (film4k.py): the window moves inside the filmed picture, which is already larger than the film
        key = [tuple(x) for x in seg["win"]]
    elif seg.get("cam"):   # sub-pixel moves: the corners of the picture are read from a window that travels smoothly
        key = [(t, 1 / z, min(max(cx - 0.5 / z, 0), 1 - 1 / z), min(max(cy - 0.5 / z, 0), 1 - 1 / z)) for t, z, cx, cy in seg["cam"]]
    if seg.get("win") or seg.get("cam"):
        def ex(i):
            e = f"{key[0][i]:.6f}"
            for m, n in zip(key, key[1:]):
                if abs(n[i] - m[i]) > 1e-6:
                    e += f"+({n[i] - m[i]:.6f})*(st(0,clip((on/60-{m[0]:.4f})/{max(n[0] - m[0], 0.01):.4f},0,1))*0+pow(ld(0),3)*(ld(0)*(ld(0)*6-15)+10))"
            return f"({e})"
        z, l, t = ex(1), ex(2), ex(3)
        g += ("" if seg.get("win") else f"scale=3840:{2 * ph}:flags=lanczos,") + f"perspective=x0='W*{l}':y0='H*{t}':x1='W*({l}+{z})':y1='H*{t}':x2='W*{l}':y2='H*({t}+{z})':x3='W*({l}+{z})':y3='H*({t}+{z})':interpolation=cubic:eval=frame,"
    g += f"scale={1920 * K}:{ph * K}:flags=lanczos:out_range=tv:out_color_matrix=bt709,setsar=1"
    if seg.get("adv"):
        g += f",pad={1920 * K}:{1080 * K}:0:{40 * K if seg.get('clean') else 0}:color={'black' if seg.get('clean') else '0x0a0d11'}"
    if seg.get("blur"):
        g += f",gblur=sigma={seg['blur']}"
    if seg.get("grade"):
        g += "," + GRADE[seg["grade"]].replace("KK", str(3 * K))
    if seg.get("dim"):
        g += f",lutyuv=y='16+(val-16)*{seg['dim']}':u='128+(val-128)*{(1 + seg['dim']) / 2}':v='128+(val-128)*{(1 + seg['dim']) / 2}'"
    g += "[b]"
    last, k = "b", 1
    for o in seg.get("over", []):
        os_, at, d = o.get("s", 1), o.get("at", 0), o["d"]
        cmd += ["-ss", f"{o.get('a', 0):.3f}", "-t", f"{d * os_:.3f}", "-i", os.path.join(FILM, o["clip"])]
        f = f"[{k}:v]setpts=(PTS-STARTPTS)/{os_},fps=60,format=rgba"
        if o.get("h"):
            f += f",scale={o['w'] * K}:{o['h'] * K}:force_original_aspect_ratio=increase:flags=lanczos,crop={o['w'] * K}:{o['h'] * K}"
        else:
            f += f",scale={o['w'] * K}:-2:flags=lanczos"
        if o.get("frame"):
            f += f",drawbox=x=0:y=0:w=iw:h=ih:t={2 * K}:color=0xcfe0f2@0.34"
        for kind, st in (("fi", 0), ("fo", d - o.get("fo", 0))):
            if o.get(kind):
                f += f",fade=t={'in' if kind == 'fi' else 'out'}:st={st:.3f}:d={o[kind]}:alpha=1"
        g += f";{f},setpts=PTS+{at:.3f}/TB[p{k}];[{last}][p{k}]overlay={o['x'] * K}:{o['y'] * K}:eof_action=pass:format=auto[q{k}]"
        last = f"q{k}"
        k += 1
    tail = []
    if seg.get("bars"):
        tail += [f"drawbox=x=0:y={y * K}:w={1920 * K}:h={seg['bars'] * K}:color=black:t=fill" for y in (0, 1080 - seg["bars"])]
    if seg.get("band"):
        tail.append(f"drawbox=x=0:y={1000 * K}:w={1920 * K}:h={80 * K}:color=0x0a0d11:t=fill")
    if seg.get("scope"):
        tail += [f"drawbox=x=0:y={y * K}:w={1920 * K}:h={138 * K}:color=black:t=fill" for y in (0, 942)]
    if seg.get("fi"):
        tail.append(f"fade=t=in:st=0:d={seg['fi']}:color={seg.get('fade', '0x06080a')}")
    if seg.get("fo"):
        tail.append(f"fade=t=out:st={dur - seg['fo']:.3f}:d={seg['fo']}:color={seg.get('fade', '0x06080a')}")
    if tail:
        g += f";[{last}]{','.join(tail)}[v]"
        last = "v"
    for n, (png, t0, t1, f) in enumerate(caps):
        cmd += ["-loop", "1", "-framerate", "60", "-t", f"{t1 - t0:.3f}", "-i", png]
        fades = f",fade=t=in:st=0:d={f}:alpha=1,fade=t=out:st={t1 - t0 - f:.3f}:d={f}:alpha=1" if f else ""
        g += f";[{k + n}:v]format=rgba{fades},setpts=PTS-STARTPTS+{t0:.3f}/TB[c{n}];[{last}][c{n}]overlay=0:0:eof_action=pass:format=auto[o{n}]"
        last = f"o{n}"
    cmd += ["-filter_complex", g + f";[{last}]format=yuv420p,setparams=range=tv[out]", "-map", "[out]", "-t", f"{dur:.3f}", "-an"] + ENC
    h = hashlib.sha1()                      # a shot that has not changed is not rendered again
    for c in cmd:
        if c.endswith(".png"):
            h.update(open(c, "rb").read())
        else:
            h.update(c.encode())
            if c.startswith("/") and os.path.isfile(c):
                h.update(f"{os.path.getsize(c)} {os.path.getmtime(c):.0f}".encode())
    done = os.path.join(FILM, "seg", h.hexdigest() + ".mp4")
    if os.path.exists(done):
        return done, dur
    r = subprocess.run(cmd + [out], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"segment {i} {seg['clip']}: {r.stderr[-1500:]}")
    os.makedirs(os.path.dirname(done), exist_ok=True)
    os.replace(out, done)
    return done, dur


def voices(ed):
    """Every spoken line with its time on the film."""
    t, res = 0, []
    for s in ed["segments"]:
        res += [(n, t + x) for n, x in s.get("voice", [])]
        t += s["d"] / s.get("s", 1)
    return res


def speak(ed, total, bed, out):
    """Lay the spoken lines over the music, which steps back under them."""
    v = voices(ed)
    cmd = [FF, "-y", "-loglevel", "error", "-i", bed]
    g = []
    for k, (n, at) in enumerate(v):
        cmd += ["-i", os.path.join(FILM, "voice", n + ".wav")]
        g.append(f"[{k + 1}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={int(at * 1000)}|{int(at * 1000)}[v{k}]")
    g.append("".join(f"[v{k}]" for k in range(len(v))) + f"amix=inputs={len(v)}:normalize=0:duration=longest,apad,atrim=0:{total:.3f},volume={ed.get('voice_db', 1.5)}dB,asplit[v][sc]")
    th, ra = ed.get("duck", [0.018, 3.2])
    g.append(f"[0:a][sc]sidechaincompress=threshold={th}:ratio={ra}:attack=45:release=520:knee=4[m]")
    g.append(f"[m][v]amix=inputs=2:normalize=0,alimiter=limit=0.87:level=false,atrim=0:{total:.3f}[a]")
    subprocess.run(cmd + ["-filter_complex", ";".join(g), "-map", "[a]", "-ar", "48000", out], check=True)


def music(ed, total, out):
    B, tail = ed["block"], ed.get("tail", 4.5)
    cmd, g, names = [FF, "-y", "-loglevel", "error"], [], []
    for k, m in enumerate(ed["music"]):
        cmd += ["-i", os.path.join(FILM, "music", m["file"])]
        at = int(round(m["at"] * 1000))
        n = m.get("n", 1)
        chain = f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo"
        chain += ",afade=t=in:d=0.006,areverse,afade=t=in:d=0.006,areverse"          # no click where the recording repeats
        if n > 1:
            chain += f",aloop=loop={n - 1}:size=2147483647"
        if m.get("lp"):
            chain += f",lowpass=f={m['lp']}"
        if m.get("dur"):
            chain += f",atrim=0:{m['dur']}"
        if m.get("fi"):
            chain += f",afade=t=in:st=0:d={m['fi']}"
        if m.get("fo"):
            chain += f",afade=t=out:st={m['end'] - m['at'] - m['fo']:.3f}:d={m['fo']}"
        chain += f",volume={m.get('db', 0)}dB,adelay={at}|{at}[m{k}]"
        g.append(chain)
        names.append(f"[m{k}]")
    g.append("".join(names) + f"amix=inputs={len(names)}:normalize=0:duration=longest,apad,atrim=0:{total:.3f},highpass=f=32,volume=-9dB" + (f",afade=t=out:st={total - tail:.3f}:d={tail}" if tail else "") + "[a]")
    raw = out + ".raw.wav"
    subprocess.run(cmd + ["-filter_complex", ";".join(g), "-map", "[a]", "-ar", "48000", "-c:a", "pcm_f32le", raw], check=True)
    r = subprocess.run([FF, "-hide_banner", "-i", raw, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    lufs = float(r[r.rindex("I:") + 2:].split("LUFS")[0])
    gain = ed["music_gain"] if "music_gain" in ed else ed.get("lufs", -18) - lufs
    print(f"music {lufs:.1f} LUFS, gain {gain:+.1f} dB")
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", raw, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.79:level=false", "-ar", "48000", out], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("edit")
    ap.add_argument("--out", default="HOUND Command film")
    ap.add_argument("--no-captions", action="store_true")
    ap.add_argument("--only-audio", action="store_true")
    ap.add_argument("--srt", action="store_true")
    ap.add_argument("--k", type=int)
    ap.add_argument("--crf", help="quality of the saved picture (lower is better), with a bit-rate limit for 3840 x 2160")
    ap.add_argument("--picture", action="store_true", help="the picture only, no sound: voices are laid in later without rendering again")
    ap.add_argument("--part", help="T0,T1: only the segments between these times, no sound")
    a = ap.parse_args()
    ed = json.load(open(a.edit))
    global K
    K = a.k or ed.get("k", 1)
    if a.crf:
        ENC[ENC.index("-crf") + 1] = a.crf
        ENC[:] = [*ENC, "-maxrate", "95M", "-bufsize", "190M"]
    if a.part:
        t0, t1 = map(float, a.part.split(","))
        t, keep = 0, []
        for x in ed["segments"]:
            d = x["d"] / x.get("s", 1)
            if t + d > t0 and t < t1:
                keep.append(x)
            t += d
        ed["segments"] = keep
    tmp = tempfile.mkdtemp(prefix="hound-cut-")
    items, jobs, n = [], [], 0
    for i, s in enumerate(ed["segments"]):
        caps = []
        for t0, t1, body, f in s.get("html", []):          # under the subtitles
            png = f"c{n:03d}.png"
            n += 1
            items.append((png, body))
            caps.append((os.path.join(tmp, png), t0, t1, f))
        if not a.no_captions:
            for t0, t1, text, *f in s.get("cap", []):
                png = f"c{n:03d}.png"
                n += 1
                items.append((png, f'<div class="cap{" scope" if s.get("scope") else ""}">{text}</div>'))
                caps.append((os.path.join(tmp, png), t0, t1, f[0] if f else 0.22 if t1 - t0 < s["d"] / s.get("s", 1) - 0.01 else 0))
        if s.get("tag"):
            png = f"c{n:03d}.png"
            n += 1
            items.append((png, f'<div class="tag">{s["tag"]}</div>'))
            caps.append((os.path.join(tmp, png), 0, s["d"] / s.get("s", 1), 0))
        if s.get("card"):
            png = f"c{n:03d}.png"
            n += 1
            items.append((png, s["card"]))
            caps.append((os.path.join(tmp, png), s.get("card_at", 0), s["d"] / s.get("s", 1), 0.9))
        jobs.append((i, s, tmp, caps))
    total = sum(s["d"] / s.get("s", 1) for s in ed["segments"])
    print(f"{len(jobs)} segments, {total:.1f} s = {int(total // 60)}:{total % 60:04.1f}")
    if a.srt:
        t, caps = 0, []
        f = lambda x: f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int(x * 1000 % 1000):03d}"
        for s in ed["segments"]:
            for t0, t1, text, *_ in s.get("cap", []):
                if caps and caps[-1][2] == text and t + t0 - caps[-1][1] < .1: caps[-1][1] = t + t1        # one line across a cut
                else: caps.append([t + t0, t + t1, text])
            t += s["d"] / s.get("s", 1)
        open(os.path.join(FILM, a.out + ".srt"), "w").write("\n".join(f"{k}\n{f(x)} --> {f(y)}\n{text}\n" for k, (x, y, text) in enumerate(caps, 1)))
        return
    wav = os.path.join(tmp, "music.wav")
    if a.picture:
        ed["segments"] = [dict(x, voice=[]) for x in ed["segments"]]
        for j in range(len(jobs)):
            jobs[j] = (jobs[j][0], ed["segments"][j], *jobs[j][2:])
    elif a.part:
        subprocess.run([FF, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"anullsrc=r=48000:cl=stereo:d={total}", wav], check=True)
        ed["segments"] = [dict(x, voice=[]) for x in ed["segments"]]
    else:
        music(ed, total, wav)
    if voices(ed):
        speak(ed, total, wav, wav + ".v.wav")
        wav += ".v.wav"
    if a.only_audio:
        os.replace(wav, os.path.join(FILM, a.out + ".wav"))
        return
    stills(items, tmp)
    with concurrent.futures.ThreadPoolExecutor(int(os.environ.get("HOUND_JOBS", 5))) as ex:
        parts = list(ex.map(cut, jobs))
    lst = os.path.join(tmp, "list.txt")
    open(lst, "w").write("".join(f"file '{p}'\n" for p, _ in parts))
    out = os.path.join(FILM, a.out + ".mp4")
    if a.picture:
        subprocess.run([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-c:v", "copy", "-an", "-movflags", "+faststart", out], check=True)
        print(out, f"{os.path.getsize(out) / 1e6:.0f} MB")
        return
    subprocess.run([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", out], check=True)
    print(out, f"{os.path.getsize(out) / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
