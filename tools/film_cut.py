#!/usr/bin/env python3
"""film_cut.py: cut the recorded shots (tools/film.py) into the film, with captions and music.

    python3 tools/film_cut.py tools/film-edit.json [--out NAME] [--no-captions] [--only-audio]

The edit file: {"segments": [{"clip", "a": start, "d": seconds used from the clip, "s": speed, "fi", "fo": fades,
"cap": [[t0, t1, text], ...], "band": true, "card": "html", "zoom": [from, to, cx, cy], "blur", "dim", "html": [[t0, t1, html, fade], ...],
"over": [{"clip", "a", "s", "d", "x", "y", "w", "h", "at", "fi", "fo", "frame"}], "voice": [[name, t], ...]}], "music": [{"file", "at": block, "db", "fi", "fo"}], "block": seconds}
Captions are set in the site's own type by Chrome and laid over the lower bar, so no picture is covered.
"""
import argparse, base64, concurrent.futures, json, os, subprocess, sys, tempfile
import film, shoot

FF = film.FFMPEG
HERE = os.path.dirname(os.path.abspath(__file__))
FILM = os.path.expanduser("~/Developer/.hound-release/film")
ENC = ["-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "60", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-video_track_timescale", "60000"]


def font(name):
    p = os.path.join(HERE, "..", "assets", "brand", "fonts", name)
    return "data:font/woff2;base64," + base64.b64encode(open(p, "rb").read()).decode()


def css():
    return ("@font-face{font-family:HSerif;src:url(%s)}@font-face{font-family:HSans;font-weight:400 700;src:url(%s)}"
            "html,body{margin:0;background:transparent}body{width:1920px;height:1080px;position:relative;overflow:hidden;-webkit-font-smoothing:antialiased}"
            ".cap{position:absolute;left:0;right:0;bottom:0;height:80px;display:grid;place-items:center;font:500 29px/1 HSans;letter-spacing:.002em;color:#f2f5f8;text-shadow:0 1px 8px rgba(0,0,0,.65)}"
            ".tag{position:absolute;right:44px;top:34px;padding:9px 14px 10px;background:rgba(8,11,15,.66);border:1px solid rgba(165,139,255,.5);border-radius:4px;font:500 20px/1 HSans;color:#e6e1ff}"
            % (font("instrument-serif-latin-400-normal.woff2"), font("instrument-sans-latin-wdth-normal.woff2")))


def stills(items, out):
    """Render each HTML body to a transparent 1920 x 1080 PNG."""
    a = argparse.Namespace()
    proc, prof, page = film.chrome(a, (1920, 1080, 1))
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
    if seg.get("zoom"):   # sub-pixel push: the corners of the picture are read from a slowly shrinking window
        z0, z1, cx, cy = seg["zoom"]
        z = f"({z0}+({z1 - z0})*(0.5-0.5*cos(PI*min(1,on/{dur * 60:.1f}))))"
        l, r = f"{cx}*W*(1-1/{z})", f"({cx}*W*(1-1/{z})+W/{z})"
        t, o = f"{cy}*H*(1-1/{z})", f"({cy}*H*(1-1/{z})+H/{z})"
        g += f"scale=2880:1620:flags=lanczos,perspective=x0='{l}':y0='{t}':x1='{r}':y1='{t}':x2='{l}':y2='{o}':x3='{r}':y3='{o}':interpolation=cubic:eval=frame,"
    g += "scale=1920:1080:flags=lanczos,setsar=1"
    if seg.get("blur"):
        g += f",gblur=sigma={seg['blur']}"
    if seg.get("dim"):
        g += f",lutyuv=y='16+(val-16)*{seg['dim']}':u='128+(val-128)*{(1 + seg['dim']) / 2}':v='128+(val-128)*{(1 + seg['dim']) / 2}'"
    g += "[b]"
    last, k = "b", 1
    for o in seg.get("over", []):
        os_, at, d = o.get("s", 1), o.get("at", 0), o["d"]
        cmd += ["-ss", f"{o.get('a', 0):.3f}", "-t", f"{d * os_:.3f}", "-i", os.path.join(FILM, o["clip"])]
        f = f"[{k}:v]setpts=(PTS-STARTPTS)/{os_},fps=60,format=rgba"
        if o.get("h"):
            f += f",scale={o['w']}:{o['h']}:force_original_aspect_ratio=increase:flags=lanczos,crop={o['w']}:{o['h']}"
        else:
            f += f",scale={o['w']}:-2:flags=lanczos"
        if o.get("frame"):
            f += ",drawbox=x=0:y=0:w=iw:h=ih:t=2:color=0xcfe0f2@0.34"
        for kind, st in (("fi", 0), ("fo", d - o.get("fo", 0))):
            if o.get(kind):
                f += f",fade=t={'in' if kind == 'fi' else 'out'}:st={st:.3f}:d={o[kind]}:alpha=1"
        g += f";{f},setpts=PTS+{at:.3f}/TB[p{k}];[{last}][p{k}]overlay={o['x']}:{o['y']}:eof_action=pass:format=auto[q{k}]"
        last = f"q{k}"
        k += 1
    tail = []
    if seg.get("band"):
        tail.append("drawbox=x=0:y=1000:w=1920:h=80:color=0x0a0d11:t=fill")
    if seg.get("fi"):
        tail.append(f"fade=t=in:st=0:d={seg['fi']}:color=0x06080a")
    if seg.get("fo"):
        tail.append(f"fade=t=out:st={dur - seg['fo']:.3f}:d={seg['fo']}:color=0x06080a")
    if tail:
        g += f";[{last}]{','.join(tail)}[v]"
        last = "v"
    for n, (png, t0, t1, f) in enumerate(caps):
        cmd += ["-loop", "1", "-framerate", "60", "-t", f"{t1 - t0:.3f}", "-i", png]
        fades = f",fade=t=in:st=0:d={f}:alpha=1,fade=t=out:st={t1 - t0 - f:.3f}:d={f}:alpha=1" if f else ""
        g += f";[{k + n}:v]format=rgba{fades},setpts=PTS-STARTPTS+{t0:.3f}/TB[c{n}];[{last}][c{n}]overlay=0:0:eof_action=pass:format=auto[o{n}]"
        last = f"o{n}"
    cmd += ["-filter_complex", g + f";[{last}]format=yuv420p[out]", "-map", "[out]", "-t", f"{dur:.3f}", "-an"] + ENC + [out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"segment {i} {seg['clip']}: {r.stderr[-1500:]}")
    return out, dur


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
    g.append("[0:a][sc]sidechaincompress=threshold=0.018:ratio=3.2:attack=45:release=520:knee=4[m]")
    g.append(f"[m][v]amix=inputs=2:normalize=0,alimiter=limit=0.87:level=false,atrim=0:{total:.3f}[a]")
    subprocess.run(cmd + ["-filter_complex", ";".join(g), "-map", "[a]", "-ar", "48000", out], check=True)


def music(ed, total, out):
    B = ed["block"]
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
    g.append("".join(names) + f"amix=inputs={len(names)}:normalize=0:duration=longest,apad,atrim=0:{total:.3f},highpass=f=32,volume=-9dB,afade=t=out:st={total - 4.5:.3f}:d=4.5[a]")
    raw = out + ".raw.wav"
    subprocess.run(cmd + ["-filter_complex", ";".join(g), "-map", "[a]", "-ar", "48000", "-c:a", "pcm_f32le", raw], check=True)
    r = subprocess.run([FF, "-hide_banner", "-i", raw, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True).stderr
    lufs = float(r[r.rindex("I:") + 2:].split("LUFS")[0])
    gain = ed.get("lufs", -18) - lufs
    print(f"music {lufs:.1f} LUFS, gain {gain:+.1f} dB")
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", raw, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.79:level=false", "-ar", "48000", out], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("edit")
    ap.add_argument("--out", default="HOUND Command film")
    ap.add_argument("--no-captions", action="store_true")
    ap.add_argument("--only-audio", action="store_true")
    ap.add_argument("--srt", action="store_true")
    a = ap.parse_args()
    ed = json.load(open(a.edit))
    tmp = tempfile.mkdtemp(prefix="hound-cut-")
    items, jobs, n = [], [], 0
    for i, s in enumerate(ed["segments"]):
        caps = []
        if not a.no_captions:
            for t0, t1, text in s.get("cap", []):
                png = f"c{n:03d}.png"
                n += 1
                items.append((png, f'<div class="cap">{text}</div>'))
                caps.append((os.path.join(tmp, png), t0, t1, 0.22 if t1 - t0 < s["d"] / s.get("s", 1) - 0.01 else 0))
        if s.get("tag"):
            png = f"c{n:03d}.png"
            n += 1
            items.append((png, f'<div class="tag">{s["tag"]}</div>'))
            caps.append((os.path.join(tmp, png), 0, s["d"] / s.get("s", 1), 0))
        for t0, t1, body, f in s.get("html", []):
            png = f"c{n:03d}.png"
            n += 1
            items.append((png, body))
            caps.append((os.path.join(tmp, png), t0, t1, f))
        if s.get("card"):
            png = f"c{n:03d}.png"
            n += 1
            items.append((png, s["card"]))
            caps.append((os.path.join(tmp, png), s.get("card_at", 0), s["d"] / s.get("s", 1), 0.9))
        jobs.append((i, s, tmp, caps))
    total = sum(s["d"] / s.get("s", 1) for s in ed["segments"])
    print(f"{len(jobs)} segments, {total:.1f} s = {int(total // 60)}:{total % 60:04.1f}")
    if a.srt:
        t, k, lines = 0, 0, []
        f = lambda x: f"{int(x // 3600):02d}:{int(x % 3600 // 60):02d}:{int(x % 60):02d},{int(x * 1000 % 1000):03d}"
        for s in ed["segments"]:
            for t0, t1, text in s.get("cap", []):
                k += 1
                lines.append(f"{k}\n{f(t + t0)} --> {f(t + t1)}\n{text}\n")
            t += s["d"] / s.get("s", 1)
        open(os.path.join(FILM, a.out + ".srt"), "w").write("\n".join(lines))
        return
    wav = os.path.join(tmp, "music.wav")
    music(ed, total, wav)
    if voices(ed):
        speak(ed, total, wav, wav + ".v.wav")
        wav += ".v.wav"
    if a.only_audio:
        os.replace(wav, os.path.join(FILM, a.out + ".wav"))
        return
    stills(items, tmp)
    with concurrent.futures.ThreadPoolExecutor(5) as ex:
        parts = list(ex.map(cut, jobs))
    lst = os.path.join(tmp, "list.txt")
    open(lst, "w").write("".join(f"file '{p}'\n" for p, _ in parts))
    out = os.path.join(FILM, a.out + ".mp4")
    subprocess.run([FF, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", lst, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", "-shortest", out], check=True)
    print(out, f"{os.path.getsize(out) / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
