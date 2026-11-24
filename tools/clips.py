#!/usr/bin/env python3
"""clips.py: make the recordings a weak computer gets instead of the live chapters (app/core/recording.js).

    python3 tools/clips.py [id ...]

Takes the chapter shots recorded by tools/film.py, cuts away the top bar and the dock, and writes film/<id>.mp4 and film/<id>.jpg.
"""
import concurrent.futures, os, subprocess, sys
import film

SRC = os.path.expanduser("~/Developer/.hound-release/film")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "film")
CROP = "crop=1920:930:0:70"                       # 52 px of top bar and 60 px of dock, at 1.3333
CLIPS = {"area": ("area", 0, 25), "radio": ("radio", 0, 32), "forge": ("forge", 0, 25), "sense": ("sense", 0.9, 21), "rover": ("rover", 0, 22), "mission": ("mission", 0, 124),
         "fusion": ("fusion", 1.2, 24.8), "report": ("report", 0, 18), "status": ("wall", 0, 22), "aerial": ("aerial", 0, 28), "scan": ("scan", 0, 32), "swarm": ("swarm", 0, 32),
         "structure": ("structure", 0, 28), "horizon": ("horizon", 0, 30)}


def one(i):
    name, a, d = CLIPS[i]
    src = os.path.join(SRC, name + ".mp4")
    vf = f"{CROP},scale=1360:658:flags=lanczos,fps=30"
    out = os.path.join(OUT, i + ".mp4")
    subprocess.run([film.FFMPEG, "-y", "-loglevel", "error", "-ss", str(a), "-t", str(d), "-i", src, "-vf", vf, "-an", "-c:v", "libx264", "-preset", "slow", "-profile:v", "high", "-level", "4.0", "-crf", "31",
                    "-maxrate", "1900k", "-bufsize", "3800k", "-g", "60", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-movflags", "+faststart", out], check=True)
    subprocess.run([film.FFMPEG, "-y", "-loglevel", "error", "-ss", str(a + min(6, d / 3)), "-i", src, "-frames:v", "1", "-vf", f"{CROP},scale=1440:698:flags=lanczos", "-q:v", "4", os.path.join(OUT, i + ".jpg")], check=True)
    return i, os.path.getsize(out)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    ids = sys.argv[1:] or list(CLIPS)
    with concurrent.futures.ThreadPoolExecutor(3) as ex:
        tot = 0
        for i, n in ex.map(one, ids):
            tot += n
            print(f"{i:10s} {n / 1e6:5.1f} MB", flush=True)
    print(f"total {tot / 1e6:.1f} MB")
