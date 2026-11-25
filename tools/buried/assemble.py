"""assemble.py: the rendered frames become buried_a.mp4, buried_b.mp4 and buried_c.mp4, 3840 x 2160 at 60 frames a second (the picture is 2.39 : 1 inside it; the film draws the bars).
Shot a is drawn at 3840. The dark, dusty shots are partly drawn at 2880 and scaled up in 16 bits; where a shot changes from one to the other the sharpness is eased over half a second."""
import subprocess, os, glob, sys, cv2, numpy as np
D = os.path.expanduser('~/Developer/.hound-release/film/buried/'); F = os.path.dirname(D.rstrip('/')) + '/'
FF = '/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1'
LOOK = dict(a='eq=contrast=1.04', b='eq=contrast=1.06:gamma=0.98,colorbalance=rs=-0.02:bs=0.03', c='eq=contrast=1.14:gamma=0.97,colorbalance=rs=-0.03:bs=0.04:rm=-0.02:bm=0.02')
SS = lambda x: (lambda t: t * t * (3 - 2 * t))(min(max(x, 0), 1))
for s, a, n in (('a', 18, 90), ('b', 258, 159), ('c', 0, 105)):
    if len(sys.argv) > 1 and s not in sys.argv[1]: continue
    have = [f for f in range(a, a + n) if os.path.exists(f'{D}r{s}/{f:04d}.png')]
    if len(have) < n: print(s, len(have), 'of', n); continue
    size = {f: cv2.imread(f'{D}r{s}/{f:04d}.png', cv2.IMREAD_REDUCED_COLOR_8).shape[1] for f in have}; first4 = next((f for f in have if size[f] > 400), a)
    p = subprocess.Popen([FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr48le', '-s', '3840x1608', '-r', '60', '-i', '-', '-vf', f'format=gbrp16le,{LOOK[s]},pad=3840:2160:0:276:black,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '8', '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', f'{F}buried_{s}.mp4'], stdin=subprocess.PIPE)
    for f in have:
        im = cv2.imread(f'{D}r{s}/{f:04d}.png').astype(np.uint16) * 257; up = lambda x: cv2.resize(x, (3840, 1608), interpolation=cv2.INTER_LANCZOS4)
        if im.shape[1] < 3840: im = up(im)
        elif first4 > a and f < first4 + 30:
            k = SS((f - first4 + 1) / 31); soft = up(cv2.resize(im, (2880, 1206), interpolation=cv2.INTER_AREA)); im = cv2.addWeighted(soft, 1 - k, im, k, 0)
        p.stdin.write(im.tobytes())
    p.stdin.close(); p.wait(); print(s, 'done', os.path.getsize(f'{F}buried_{s}.mp4') // 1e6, 'MB, first 4K frame', first4, flush=True)
