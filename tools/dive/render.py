#!/usr/bin/env python3
"""render.py: from the Moon's distance, through the O of HOUND, through real clouds, down to a real village. One unbroken shot.

    render.py still T[,T...] OUT.jpg [--k 1] [--sub 4]      test frames
    render.py film OUT.mp4 [--from F] [--to F]              3840 x 2160, 60 a second
    render.py end OUT.mp4                                   the way back: the Earth goes into the O again, for the last card
Picture sources: NASA VIIRS true colour of 26 August 2026, Blue Marble and Black Marble; Esri World Imagery (Maxar); Mapzen terrain. The flood water is drawn.
"""
import sys, os, json, math, time, subprocess
import numpy as np, moderngl
from PIL import Image
from fetch import PLAN, corner
Image.MAX_IMAGE_PIXELS = None
D = os.path.dirname(os.path.abspath(__file__)) + '/'; B = D + 'b/'
FF = '/Library/Frameworks/Python.framework/Versions/3.12/lib/python3.12/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1'
EARTH = 40075016.686; R = 6371008.8; H0 = float(np.load(B + 'ring.npz')['H0'])
x0, y0 = corner(18, 24); TX, TY = (x0 + 2693 / 256) / 2 ** 18, (y0 + 3345 / 256) / 2 ** 18
LON = TX * 2 * math.pi - math.pi; LAT = math.atan(math.sinh(math.pi * (1 - 2 * TY))); M = EARTH * math.cos(LAT)
TITLE = json.load(open(B + 'title.json')); FPS = 60; NF = 525
arg = sys.argv; opt = lambda n, d: type(d)(arg[arg.index(n) + 1]) if n in arg else d

# ---------------------------------------------------------------- the sun over Asia on the morning of 26 August (04:00 UTC): overhead at 10.4 N, 120 E
def enu_basis():
    s, c, sl, cl = math.sin(LAT), math.cos(LAT), math.sin(LON), math.cos(LON)
    return np.array([[-sl, cl, 0], [-s * cl, -s * sl, c], [c * cl, c * sl, s]])            # rows: east, north, up in Earth axes
E2X = enu_basis(); ss = math.radians(10.4), math.radians(120.0)
SUN = E2X @ np.array([math.cos(ss[0]) * math.cos(ss[1]), math.cos(ss[0]) * math.sin(ss[1]), math.sin(ss[0])]); SUN /= np.linalg.norm(SUN)

# ---------------------------------------------------------------- the camera
def mono(keys):
    """Smooth curve through the keys that never overshoots (PCHIP)."""
    from scipy.interpolate import PchipInterpolator
    t, v = zip(*keys); f = PchipInterpolator(t, v); return lambda x: float(f(min(max(x, t[0]), t[-1])))
LOGD = mono([(0, 8.720), (.55, 8.712), (1.15, 8.66), (1.62, 8.36), (2.05, 7.72), (2.45, 7.35), (2.95, 7.13), (3.35, 6.78), (3.75, 5.95), (4.15, 4.86), (4.45, 4.22), (4.8, 3.84), (5.3, 3.56), (6.2, 3.30), (7.4, 3.13), (8.75, 3.01)])
EL = mono([(0, 52), (1.6, 52), (2.6, 55), (3.3, 64), (3.8, 72), (4.2, 66), (4.6, 52), (5.1, 40), (6.0, 29), (7.2, 21.5), (8.75, 18)])
AZ = mono([(0, 282), (1.6, 281), (2.6, 272), (3.4, 240), (4.0, 218), (4.6, 208), (5.5, 204), (7.2, 198), (8.75, 192)])
LOOKC = mono([(0, 1), (2.2, 1), (2.9, .72), (3.5, .12), (3.8, 0), (8.75, 0)])                            # 1 = the middle of the Earth, 0 = the village
HEAD = mono([(0, -24), (1.6, -22), (2.6, -12), (3.4, 12), (4.0, 30), (8.75, 24)])                         # which way is up on screen while looking down
TILT = mono([(0, 0), (3.9, 0), (4.7, 1), (8.75, 1)])
FOV = mono([(0, 34), (2.4, 34), (3.9, 40), (5.4, 44), (8.75, 43)])
OX, OY = (TITLE['w_title']['hole'][0] + TITLE['w_title']['hole'][2]) / 2, (TITLE['w_title']['hole'][1] + TITLE['w_title']['hole'][3]) / 2
SX = mono([(0, (OX - 1920) / 1920), (1.1, (OX - 1920) / 1920), (2.05, -.02), (2.9, .04), (3.9, 0), (4.6, .04), (5.6, .12), (8.75, .20)])
SY = mono([(0, (1080 - OY) / 1080), (1.1, (1080 - OY) / 1080), (2.05, 0), (2.9, -.06), (3.9, 0), (4.6, .0), (5.6, -.12), (7.0, -.28), (8.75, -.38)])
ZOOM = mono([(0, 0), (.6, .012), (1.15, .035), (1.45, .30), (1.75, 1.25), (1.95, 2.3), (2.12, 3.6), (2.3, 4.4)])          # log of how close the letters are
WORD_T = 2.4
if len(arg) > 1 and arg[1] in ('end', 'endstill'):          # the same camera, flown the other way, with the word where the last card has it
    TITLE['w_title'] = TITLE['w_end']; WORD_T = 99; h_ = TITLE['w_end']['hole']; OX, OY = (h_[0] + h_[2]) / 2, (h_[1] + h_[3]) / 2; NF = 195
    LOGD = mono([(0, 7.50), (.35, 7.86), (.75, 8.22), (1.15, 8.47), (1.6, 8.64), (2.2, 8.735), (3.25, 8.78)]); EL = mono([(0, 47), (3.25, 52)]); AZ = mono([(0, 262), (1.2, 276), (3.25, 283)]); LOOKC = lambda t: 1.0; HEAD = mono([(0, -12), (3.25, -24)]); TILT = lambda t: 0.0; FOV = lambda t: 34.0
    SX = mono([(0, -.03), (.75, (OX - 1920) / 1920), (3.25, (OX - 1920) / 1920)]); SY = mono([(0, .02), (.75, (1080 - OY) / 1080), (3.25, (1080 - OY) / 1080)])
    ZOOM = mono([(0, 3.9), (.12, 3.35), (.4, 2.05), (.75, 1.05), (1.15, .42), (1.6, .13), (2.2, .03), (3.25, 0)])
def on(f, v, t1=8.75, t2=11.62):
    """The same curve, carried on past its end with no jump in place or speed."""
    a, sl = f(t1), (f(t1) - f(t1 - 1e-3)) / 1e-3; h = t2 - t1
    def g(t):
        if t <= t1: return f(t)
        u = min((t - t1) / h, 1); return a * (2 * u ** 3 - 3 * u * u + 1) + sl * h * (u ** 3 - 2 * u * u + u) + v * (3 * u * u - 2 * u ** 3) + .55 * sl * h * (u ** 3 - u * u)
    return g
if WORD_T < 9:
    LOGD, EL, AZ, FOV, SX, SY = on(LOGD, 2.905), on(EL, 15.0), on(AZ, 187), on(FOV, 41.5), on(SX, .13), on(SY, -.40)
def cam(t):
    d = 10 ** LOGD(t); el, az = math.radians(EL(t)), math.radians(AZ(t)); p = d * np.array([math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)])
    if t > 4.4: s = (t - 4.4); p = p + np.array([math.sin(s * 1.7) * 2.2, math.sin(s * 1.23 + 1) * 2.2, math.sin(s * 2.1 + 2) * 1.6]) * min(1, s) * .5     # a hand on the camera
    C = np.array([0, 0, -(R + H0)]); look = C * LOOKC(t) + np.array([0., 0., 30.]); f = look - p; f /= np.linalg.norm(f)
    h = math.radians(HEAD(t)); k = TILT(t); up = np.array([math.sin(h), math.cos(h), 0]) * (1 - k) + np.array([0, 0, 1.]) * k
    r = np.cross(f, up); r /= np.linalg.norm(r); u = np.cross(r, f); return p, r, u, f, math.tan(math.radians(FOV(t)) / 2)

# ---------------------------------------------------------------- shaders
COMMON = '''
#version 410
const float PI = 3.14159265;
uniform vec3 eye, cr, cu, cf; uniform vec2 tanv, shift, jit; uniform float time; uniform vec3 sun; uniform mat3 x2e;   // x2e: east-north-up to Earth axes
const float RE = 6371008.8; uniform float H0;
vec3 centre() { return vec3(0., 0., -(RE + H0)); }
vec2 ll(vec3 p) { vec3 q = normalize(x2e * normalize(p - centre())); return vec2(atan(q.y, q.x), asin(clamp(q.z, -1., 1.))); }
float hash(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y), mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p) { float a = .5, s = 0.; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 7.1; a *= .5; } return s; }
'''
PROJ = '''
vec4 project(vec3 p) { vec3 q = p - eye; float w = dot(q, cf); return vec4(dot(q, cr) / tanv.x + (shift.x + jit.x) * w, dot(q, cu) / tanv.y + (shift.y + jit.y) * w, 0., w); }
'''
RING_V = COMMON + PROJ + 'in vec3 pos; in vec2 uv; out vec3 P; out vec2 T; out vec4 A; out float W; void main() { P = pos; T = uv; A = vec4(0.); gl_Position = project(pos); W = gl_Position.w; }'
GRID_V = COMMON + PROJ + '''
uniform ivec2 gn; uniform vec4 go; uniform sampler2D hgt; uniform int kind; out vec3 P; out vec2 T; out vec4 A; out float W;
void main() { ivec2 ij = ivec2(gl_VertexID - (gl_VertexID / gn.x) * gn.x, gl_VertexID / gn.x); vec4 h = texelFetch(hgt, ij, 0); vec2 xy = go.xy + vec2(ij.x, -ij.y) * go.z; bool rim = ij.x == 0 || ij.y == 0 || ij.x == gn.x - 1 || ij.y == gn.y - 1;
  float z = h.x + h.y; P = vec3(xy, z - (rim ? 40. : 0.)); T = vec2(xy.x, -xy.y) / %.4f; A = vec4(h.y, h.z, h.w, 2.); gl_Position = project(P); W = gl_Position.w; }''' % M
TILE = '''
uniform sampler2DArray far; uniform sampler2D c16, c17, c18; uniform vec3 lv[10];       // lv: offset x, y, scale, for zoom 9..18
vec4 tile(int z, vec2 o, float lod) { vec2 q = lv[z - 9].xy + o * lv[z - 9].z; vec2 e = min(q, 1. - q); float m = clamp(min(e.x, e.y) / .10, 0., 1.); if (m <= 0.) return vec4(0.);
  vec3 c = z >= 18 ? texture(c18, q).rgb : z == 17 ? texture(c17, q).rgb : z == 16 ? texture(c16, q).rgb : texture(far, vec3(q, float(z - 9))).rgb; return vec4(c, m * m * (3. - 2. * m)); }
vec4 ground(vec2 o, float mpp) {                                                       // the finest picture that is worth showing at this distance
  vec4 s = vec4(0.); for (int z = 18; z >= 9; z--) { float res = %.4f / exp2(float(z)) / 256.; float want = 1. - smoothstep(2.2, 5.0, log2(max(mpp, .001) / res)); if (z == 9) want = 1.; if (want <= 0.) continue;
    vec4 c = tile(z, o, 0.); float w = c.a * want * (1. - s.a); s += vec4(c.rgb * w, w); if (s.a > .997) break; } return s; }''' % M
GROUND_F = COMMON + TILE + '''
in vec3 P; in vec2 T; in vec4 A; in float W; layout(location = 0) out vec4 col; uniform float F; uniform int kind; uniform vec4 hole; uniform sampler2D dayG, dayA, dayN, nightG, river; uniform float rise;
vec4 dayTex(vec2 l, float mpp, out float lodN) {
  vec2 d = degrees(l); vec2 ug = vec2((d.x + 180.) / 360., (90. - d.y) / 180.); vec4 c = textureLod(dayG, ug, max(0., log2(mpp / 4892.))); 
  vec2 ua = vec2((d.x - 45.) / 90., (59.5 - d.y) / 67.5); vec2 e = min(ua, 1. - ua); float w = smoothstep(0., .06, min(e.x, e.y)); if (w > 0.) c = mix(c, textureLod(dayA, ua, max(0., log2(mpp / 1223.))), w);
  vec2 un = vec2((d.x - 77.5) / 16., (34. - d.y) / 12.); e = min(un, 1. - un); w = smoothstep(0., .08, min(e.x, e.y)); if (w > 0.) c = mix(c, textureLod(dayN, un, max(0., log2(mpp / 217.))), w); lodN = 0.; return c; }
void main() {
  if (kind == 0 && abs(P.x) < hole.x && abs(P.y) < hole.x) discard;
  if (kind == 1 && P.x > hole.x + 1. && P.x < hole.y - 1. && P.y > hole.z + 1. && P.y < hole.w - 1.) discard;
  vec3 c0 = centre(); vec3 up = normalize(P - c0); vec3 n = normalize(cross(dFdx(P), dFdy(P))); if (dot(n, up) < 0.) n = -n; if (any(isnan(n))) n = up;
  vec3 V = normalize(eye - P); float dist = length(eye - P), mpp = max(dist * tanv.y / 1080., fwidth(P.x) * .0 ) ; vec2 l = ll(P); float dum; vec4 day = dayTex(l, max(mpp, 60.), dum); vec3 base = pow(day.rgb, vec3(2.2));
  { float bl = dot(base, vec3(.3, .6, .1)); base = mix(vec3(bl), base, 1.12) * 1.45; } float ocean = smoothstep(1.15, 1.6, day.b / max(day.r, .004)) * smoothstep(.30, .12, day.r); base = mix(base, vec3(.008, .028, .070) + base * .55, ocean);
  float g9 = smoothstep(260000., 70000., dist); vec3 a = base; vec4 g = vec4(0.); if (g9 > 0.) { g = ground(T, mpp); vec3 gc = pow(g.rgb, vec3(2.2)); a = mix(base, gc, g.a * g9); }
  float nl = dot(n, sun), ul = dot(up, sun); float rel = clamp(nl / max(ul, .15), 0., 2.2);
  float k = kind == 0 ? mix(.55, .75, smoothstep(40000., 4000., dist)) : .55; float lit = mix(1., rel, k);
  float shw = 1.;
  float steep = smoothstep(.78, .52, dot(n, up)); float dk = smoothstep(9000., 1500., dist); if (dk > 0.) { float f1 = fbm(P / 7.), f2 = fbm(P / 31. + 9.), f3 = vnoise(P / 1.7); a *= 1. + ((f1 - .47) * .9 + (f3 - .5) * .35 * smoothstep(2500., 900., dist)) * dk * mix(.35, 1., steep) + (f2 - .47) * .35 * dk; if (steep > .01) { vec4 gc2 = ground(T, max(mpp, 6.)); vec3 cc = pow(gc2.rgb, vec3(2.2)); float r1 = fbm(P / vec3(11., 11., 17.)), r2 = fbm(P / 3.1 + 4.), r3 = fbm(P / vec3(46., 46., 80.) + 2.); float gz = clamp(dot(cc, vec3(-1., 2., -1.)) * 8., 0., 1.); cc = mix(cc, vec3(dot(cc, vec3(.3, .6, .1))) * vec3(1.02, 1., .95), .35) * (.42 + .75 * r1 + .42 * (r2 - .47) * smoothstep(3500., 1200., dist) + .35 * (r3 - .3)); float bush = smoothstep(.54, .68, r3 * .6 + r1 * .5); cc = mix(cc, cc * vec3(.55, .74, .48), bush * .6); a = mix(a, cc, steep * .85 * dk); } }
  float pool = 1.; { float nn = smoothstep(26000., 6000., dist); if (nn > 0.) { vec2 vc = P.xy - vec2(70., -60.); float rr = length(vc * vec2(1., .50)) / 1000.; float f = fbm(vec3(P.xy / 1300. + vec2(time * .05, 0.), 4.)) ; float s1 = 1. - smoothstep(.16, .62, rr + (f - .5) * .55); float s2 = smoothstep(.56, .70, f) * .42; if (time > 8.75) { float fr = -2300. + 2050. * (time - 8.6); float k = smoothstep(fr - 420., fr + 420., P.y + (f - .5) * 900.); s1 *= k; s2 *= k; } pool = mix(1., mix(.16, 1.20, max(s1, s2)), nn); } }
  if (kind == 0) { /* far hills: finer relief than the mesh, from the picture */ }
  if (kind >= 1) {                                                                     // the last kilometres: leaves, roofs, walls
    float can = A.x; float fine = vnoise(vec3(P.xy * 1.9, 3.)) * .6 + vnoise(vec3(P.xy * 4.7, 9.)) * .4; float det = smoothstep(2200., 700., dist);
    float leaf = smoothstep(.3, 2.2, can); a *= mix(1., .62 + .16 * can, leaf * .75); a *= 1. + (fine - .5) * (.55 * leaf + .22 * (1. - leaf)) * det;
    lit = mix(1., clamp(nl / max(ul, .2), .12, 1.7), mix(.45, .72, leaf));
    shw = mix(1., A.y, smoothstep(6000., 2500., dist)); a *= mix(1., A.z, .8 * smoothstep(6000., 2500., dist));
  }
  // the flood: brown water in the real river's bed, moving
  vec2 rv = texture(river, vec2(P.x + 8700., 8700. - P.y) / 17400.).xy; float water = 0.;
  if (abs(P.x) < 8600. && abs(P.y) < 8600.) { float s = rv.y, half_ = 19. + 4. * vnoise(vec3(s * .02, 1., 0.)) + 5. * rise + (vnoise(vec3(P.xy * .045, 2.)) - .5) * 16. + (vnoise(vec3(P.xy * .16, 2.)) - .5) * 6. + (vnoise(vec3(P.xy * .5, 4.)) - .5) * 2.5; water = 1. - smoothstep(half_ - 1.2, half_ + 1.2 + mpp * .7, rv.x); water *= smoothstep(8600., 7600., max(abs(P.x), abs(P.y)));
    if (water > 0.) { float v = 7.5, ss = s + time * v * mix(1., .55, smoothstep(0., half_, rv.x)); float far_ = smoothstep(9., 2., mpp); 
      vec2 wp = vec2(ss, rv.x); float warp = fbm(vec3(ss * .020, rv.x * .05, time * .15)) - .5; float q = fbm(vec3(ss * .030 + warp * 1.6, rv.x * .085 + warp * 2.0, time * .18)), q2 = fbm(vec3(ss * .085 + warp * 2.5, rv.x * .34 + warp * 3., time * .5 + 5.)), q3 = fbm(vec3(ss * .33, rv.x * 1.1, time * 1.1)); float crest = smoothstep(.50, .74, q2 * .62 + q3 * .38); float foam = crest * .65 + smoothstep(half_ - 7., half_ - 1.5, rv.x) * smoothstep(.42, .62, q2) * .55; foam *= mix(.45, 1., far_);
      vec3 mud = mix(vec3(.150, .122, .076), vec3(.275, .232, .155), smoothstep(.30, .70, q)) * (.86 + .34 * (q3 - .45) * far_); vec3 wn = normalize(vec3((q2 - .5) * 1.1, (q3 - .5) * .9, 1.)); vec3 hv = normalize(V + sun); float sp = pow(max(dot(wn, hv), 0.), 46.) * .55 + pow(max(dot(wn, hv), 0.), 9.) * .05;
      vec3 wcol = mix(mud, vec3(.50, .46, .39), clamp(foam, 0., .8)); float wl = clamp(dot(mix(vec3(0., 0., 1.), wn, .6), sun) / max(ul, .2), .3, 1.4); a = mix(a, wcol * wl + sp * far_, water); lit = mix(lit, 1., water); float bank = (1. - smoothstep(half_, half_ + 9., rv.x)) * (1. - water); a *= 1. - .35 * bank; } }
  float dayk = smoothstep(-.06, .16, ul); vec3 sunT = mix(vec3(1., .42, .16), vec3(1., .97, .92), smoothstep(.0, .42, ul)); float amb = .20 * smoothstep(-.12, .25, ul);
  vec3 L = a * (sunT * max(ul, 0.) * lit * 1.16 * pool * mix(.34, 1., shw) + vec3(.62, .78, 1.) * amb);
  if (ocean > .01 && g9 < 1.) { vec3 hv = normalize(V + sun); float sp = pow(max(dot(up, hv), 0.), 90.) * .55 + pow(max(dot(up, hv), 0.), 18.) * .09; L += sp * ocean * sunT * dayk * (1. - g9) * smoothstep(.55, .1, day.a); }
  if (ul < .12 && g9 < 1.) { vec2 d = degrees(l); vec3 nt = textureLod(nightG, vec2((d.x + 180.) / 360., (90. - d.y) / 180.), max(0., log2(mpp / 4892.))).rgb; float lum = max(0., dot(nt, vec3(.4, .4, .2)) - .10); L += vec3(1., .72, .42) * lum * lum * 1.5 * smoothstep(.10, -.10, ul) * (1. - g9); }
  { float nk = smoothstep(30000., 3000., dist); float mk = smoothstep(900000., 150000., dist) * (1. - nk); float ll0 = dot(L, vec3(.25, .6, .15)); L = mix(L, vec3(ll0) * vec3(.98, 1., 1.02), mk * .38); float ll_ = dot(L, vec3(.25, .6, .15)); L = mix(L, mix(vec3(ll_), L, .84) * vec3(.97, .98, 1.0), nk); L *= mix(1., .80, nk); }
  col = vec4(L, 1.); gl_FragDepth = log2(1. + max(W, 0.)) * F; }
'''
HOUSE_V = COMMON + PROJ + 'in vec3 pos, nrm, col; in vec2 uv, size; in float kind_, idn; out vec3 P, N, K; out vec2 U, S; flat out float kd, id; out float W; void main() { P = pos; N = nrm; K = col; U = uv; S = size; kd = kind_; id = idn; gl_Position = project(pos); W = gl_Position.w; }'
HOUSE_F = COMMON + '''
in vec3 P, N, K; in vec2 U, S; flat in float kd, id; in float W; out vec4 c; uniform float F; uniform sampler2D c18; uniform vec3 lv18;
void main() { vec3 n = normalize(N); float dist = length(eye - P), px = dist * tanv.y / 1080.; vec3 a = K; float ul = sun.z, nl = max(dot(n, sun), 0.); float occ = 1.;
  if (kd < .5 || kd > 2.5) { a = K * .80; float g = smoothstep(-.5, 2.2, U.y); occ = mix(.55, 1., g); a *= .9 + .2 * vnoise(vec3(U * .9, id * 40.)); a *= 1. - .25 * smoothstep(.55, .8, vnoise(vec3(U.x * 1.5, U.y * .25, id * 77.)));
    if (kd < .5) { float fl = U.y / 2.95; float k = floor(fl), fy = fract(fl); float nw = max(1., floor(S.x / 2.5)), fx = fract(U.x / S.x * nw), ix = floor(U.x / S.x * nw); float soft = clamp(px / .5, .06, .5); float lim = step(U.y, S.y - .3) * step(0., U.y); float h = hash(vec3(ix, k, id * 91.));
      float w = smoothstep(.26 - soft * .2, .26 + soft * .2, fx) * smoothstep(.74 + soft * .2, .74 - soft * .2, fx) * smoothstep(.30 - soft * .2, .30 + soft * .2, fy) * smoothstep(.78 + soft * .2, .78 - soft * .2, fy) * lim; vec3 glass = mix(vec3(.035, .045, .055), vec3(.16, .19, .22), step(.78, h)); a = mix(a, glass, w * step(.12, h));
      if (k < .5 && S.x > 3.) { float sh = smoothstep(.06, .10, fx) * smoothstep(.94, .90, fx) * step(fy, .80) * lim; vec3 shut = mix(vec3(.10, .16, .22), mix(vec3(.28, .10, .07), vec3(.12, .20, .13), step(.5, h)), step(.4, h)); a = mix(a, shut * (.8 + .2 * step(.5, fract(U.y * 5.))), sh * .85); }
      a *= 1. - .30 * smoothstep(.06, .0, abs(fy - .985)) * lim; } }
  else if (kd < 1.5) { vec2 q = lv18.xy + vec2(P.x, -P.y) / %.4f * lv18.z; vec3 t = pow(texture(c18, q).rgb, vec3(2.2)); a = mix(K, t, .55) * .95; vec2 e = min(U, S - U); a *= mix(.72, 1., smoothstep(.0, .7, min(e.x, e.y))); a *= .88 + .24 * vnoise(vec3(U * .7, id * 31.)); float tank = step(.62, id) * smoothstep(.75, .55, length(U - S * vec2(.28 + .4 * fract(id * 5.), .3))); a = mix(a, vec3(.02, .02, .025), tank); }
  else { float rib = .5 + .5 * sin(U.x * 6.2832 / .9); rib = mix(rib, .5, smoothstep(.12, .45, px)); a = K * (.84 + .28 * rib) * (.9 + .22 * vnoise(vec3(U * vec2(.35, 1.2), id * 19.))); a *= 1. - .18 * smoothstep(.10, .0, abs(fract(U.y / 2.4) - .5) * 2.4); }
  float sp = kd > 1.5 && kd < 2.5 ? pow(max(dot(reflect(-sun, n), normalize(eye - P)), 0.), 22.) * .35 : 0.;
  float kk = 1.; if (time > 8.75) { float f = fbm(vec3(P.xy / 1300. + vec2(time * .05, 0.), 4.)), fr = -2300. + 2050. * (time - 8.6); kk = smoothstep(fr - 420., fr + 420., P.y + (f - .5) * 900.); } a *= mix(.66, 1., kk);
  vec3 L = a * (vec3(1., .95, .88) * (nl * 1.10 * 1.14) * mix(.22, 1., kk) + (vec3(.62, .78, 1.) * (.28 + .12 * max(n.z, 0.)) + vec3(1., .86, .66) * .16 * (1. - n.z)) * occ) + sp; float g = dot(L, vec3(.25, .6, .15)); L = mix(vec3(g), L, .86) * .80; c = vec4(L, 1.); gl_FragDepth = log2(1. + max(W, 0.)) * F; }''' % M
AIR_F = COMMON + '''
in vec2 q; out vec4 col; uniform sampler2D img, dep, trans, dayG, dayA, dayN; uniform sampler3D n3; uniform float F, seed, volk; uniform vec4 path; 
const float Ra = 6371.0088, Rt = 6451.; const vec3 bR = vec3(5.8e-3, 13.5e-3, 33.1e-3); const float bM = 4.0e-3;
vec2 sph(vec3 o, vec3 d, float r) { float b = dot(o, d), c = dot(o, o) - r * r, h = b * b - c; if (h < 0.) return vec2(1e9, -1e9); h = sqrt(h); return vec2(-b - h, -b + h); }
vec3 T2sun(float r, float mu) { return texture(trans, vec2(mu * .5 + .5, sqrt(clamp((r - Ra) / (Rt - Ra), 0., 1.)))).rgb; }
float cover(vec2 l, float mpp) { vec2 d = degrees(l); float c = textureLod(dayG, vec2((d.x + 180.) / 360., (90. - d.y) / 180.), max(0., log2(mpp / 4892.))).a; vec2 ua = vec2((d.x - 45.) / 90., (59.5 - d.y) / 67.5); vec2 e = min(ua, 1. - ua); float w = smoothstep(0., .06, min(e.x, e.y)); if (w > 0.) c = mix(c, textureLod(dayA, ua, max(0., log2(mpp / 1223.))).a, w);
  vec2 un = vec2((d.x - 77.5) / 16., (34. - d.y) / 12.); e = min(un, 1. - un); w = smoothstep(0., .08, min(e.x, e.y)); if (w > 0.) c = mix(c, textureLod(dayN, un, max(0., log2(mpp / 217.))).a, w); return c; }
float coverP(vec3 p, float mpp) { float c = cover(ll(p), mpp); float r = length(p - centre() - normalize(-centre()) * 0.); float n = length(p.xy); float k = smoothstep(2.6e6, 3.0e5, n) ; return mix(c, pow(c, 1.9) * .96, k); }
// the cloud layer as a volume, for the last hundred kilometres
const float HB = 2300., HT = 6900.;      // metres above the village
float alt(vec3 p) { return length(p - centre()) - RE - H0; }
float density(vec3 p, bool fine) { float h = (alt(p) - HB) / (HT - HB); if (h < 0. || h > 1.) return 0.; float c = coverP(p, 260.); float r = length(p.xy); c *= smoothstep(2600., 8200., r); vec2 b = (p.xy - path.xy) / path.z; c = max(c, path.w * exp(-dot(b, b) * 1.2)); c = clamp(c * 1.12, 0., 1.);
  float top = mix(.45, 1., c); float prof = smoothstep(0., .14, h) * smoothstep(top, top * .45, h); vec3 u = p / vec3(9000., 9000., 7600.); vec2 a = texture(n3, u).rg; vec2 a2 = texture(n3, u * 3.7 + .31).rg; float n = a.x * .60 + a.y * .42 + (a2.x - .27) * .34; if (fine) { vec2 a3 = texture(n3, u * 13.1 + .7).rg; n += (a3.x - .27) * .16 + (a3.y - .5) * .10; }
  float d = n * .95 + c * 1.02 - 1.02 ; d = clamp(d, 0., 1.) * prof; return d * smoothstep(.02, .30, c); }
float phase(float c) { float g = .55; float a = (1. - g * g) / (4. * PI * pow(1. + g * g - 2. * g * c, 1.5)); return mix(a, .0796, .45); }
void main() {
  vec2 s = (q - shift - jit) ; vec3 rd = normalize(cf + cr * s.x * tanv.x + cu * s.y * tanv.y); float dz = texture(dep, q * .5 + .5).r; float w = exp2(dz / F) - 1.; float tg = dz >= 1. ? 1e30 : w / dot(rd, cf); vec4 im = texture(img, q * .5 + .5); vec3 L = im.rgb; bool hit = dz < 1.;
  vec3 ok = (eye - centre()) * 1e-3; float tb = dot(ok, rd); float adv = max(0., -tb - 9000.); vec3 o = ok + rd * adv; float tgk = hit ? tg * 1e-3 - adv : 1e9;
  if (!hit) { vec2 e = sph(o, rd, Ra - .5); if (e.x < e.y && e.x > 0. && tgk > 1e8) { } }
  // stars, few and quiet
  if (!hit) { vec3 sd = x2e * rd; vec3 c = floor(sd * 260.); float h = hash(c + 3.3); if (h > .9962) { vec3 ctr = (c + .5 + (vec3(hash(c), hash(c + 5.), hash(c + 9.)) - .5) * .6) / 260.; float dd = length(normalize(ctr) - sd); float px = tanv.y / 1080.; float m = pow(hash(c + 1.7), 5.); L += vec3(.9, .95, 1.) * m * .85 * exp(-dd * dd / (px * px * 1.1)) ; } L *= 1.; }
  float ce = 0.; vec3 cloudc = vec3(0.); float tcl = 1e9; float pxm = max(length(eye - centre()) - RE, 1000.) * tanv.y / 1080.;
  // clouds as a thin shell from far away
  vec2 sh = sph(o, rd, Ra + 9.5); if (sh.x < sh.y && sh.x > 0. && sh.x < tgk + 60. && volk < 1.) { tcl = sh.x; vec3 pk = o + rd * tcl; vec3 P = pk * 1e3 + centre(); float mu = dot(normalize(pk), sun), vm = abs(dot(normalize(pk), rd)); float mpp = max((tcl + adv) * 1e3 * tanv.y / 1080. / max(vm, .12), 200.);
    float a = coverP(P, mpp); vec3 sd = normalize(sun - normalize(pk) * mu); float st = clamp(mpp * 2.2, 2600., 26000.); float a1 = coverP(P + sd * st, mpp * 1.5), a2 = coverP(P + sd * st * 2.4, mpp * 2.2); float sha = clamp(1. - .55 * (a1 - a) - .35 * (a2 - a), .45, 1.25);
    if (mpp < 3500.) { vec3 u = P / 90000.; float n = texture(n3, u).r * .6 + texture(n3, u * 4.1 + .2).g * .4; float k = smoothstep(3500., 700., mpp); a = clamp(a + (n - .46) * .75 * a * (1. - a) * 4. * k * .5, 0., 1.); sha *= 1. + (n - .46) * .35 * k; }
    vec3 st3 = T2sun(Ra + 9., mu); vec3 sc = st3 * max(mu, 0.) * (.72 + .28 * smoothstep(.0, .6, mu)); cloudc = (vec3(.92) * sc * sha * (.62 + .38 * sqrt(a)) + vec3(.10, .13, .18) * smoothstep(-.12, .2, mu)); ce = smoothstep(.02, .95, a) ; ce = 1. - (1. - ce) * (1. - ce * .25); ce *= (1. - volk); 
    if (!hit) ce *= smoothstep(0., 60., sh.y - sh.x); }
  // shadow the clouds throw on the ground
  if (hit) { vec3 P = eye + rd * tg; vec3 up = normalize(P - centre()); float mu = dot(up, sun); if (mu > .05) { vec3 C = P + sun * ((6500.) / max(mu, .25)); float mpp = max(tg * tanv.y / 1080., 500.); float a = coverP(C, mpp); float r = length(C.xy); if (length(P) < 3e5) a *= smoothstep(3500., 9500., r); L *= 1. - .62 * smoothstep(.15, .8, a) * smoothstep(0., .2, mu); } }
  float tend = min(tgk, mix(tgk, tcl, step(.5, ce))); L = mix(L, cloudc, ce);
  // the cloud volume
  vec3 vl = vec3(0.); float vt = 1.; float vz = 0., va = 0.;
  if (volk > 0.) { vec2 hi = sph(o, rd, Ra + (H0 + HT) * 1e-3), lo = sph(o, rd, Ra + (H0 + HB) * 1e-3); float camh = length(ok) - Ra - H0 * 1e-3; float a0 = 0., a1 = 0.;
    if (camh > HT * 1e-3) { a0 = hi.x; a1 = lo.x < lo.y ? lo.x : hi.y; if (hi.x > hi.y) a1 = -1.; } else if (camh > HB * 1e-3) { a0 = 0.; a1 = (lo.x < lo.y && lo.x > 0.) ? lo.x : hi.y; } else { a0 = lo.y; a1 = hi.y; }
    a0 = max(a0, 0.); a1 = min(min(a1, tgk), a0 + 60.); if (a1 > a0 && a0 < 260.) { const int N = 96; float L_ = (a1 - a0) * 1e3; float ds = L_ / float(N); float t = a0 * 1e3 + ds * fract(seed + hash(vec3(gl_FragCoord.xy * .71, seed * 13.))); vec3 base = o * 1e3 + centre(); float c = dot(rd, sun); float ph = phase(c) * 4.2 + .55;
      for (int i = 0; i < N; i++) { vec3 p = base + rd * t; float d = density(p, t < 40000.); if (d > .002) { float e = d * .0060; float sh1 = density(p + sun * 260., false), sh2 = density(p + sun * 800., false), sh3 = density(p + sun * 1700., false); float od = (sh1 * 420. + sh2 * 720. + sh3 * 1000.) * .0060; float tr = exp(-od) * .72 + exp(-od * .22) * .36; float h = clamp((alt(p) - HB) / (HT - HB), 0., 1.); vec3 up = normalize(p - centre()); float mu = dot(up, sun);
          vec3 S = vec3(1., .965, .91) * tr * ph * .92 * max(mu, 0.) * (1. - .45 * exp(-d * 9.)) + vec3(.42, .52, .66) * (.20 + .34 * h); float a = exp(-e * ds); vl += S * vt * (1. - a); vz += t * vt * (1. - a); va += vt * (1. - a); vt *= a; if (vt < .01) break; } t += ds; }
      vl *= volk; vt = mix(1., vt, volk); if (va > .001) vz /= va; } }
  // the air itself
  vec2 at = sph(o, rd, Rt); if (at.x < at.y && at.y > 0.) { float ta = max(at.x, 0.), te = min(at.y, tend); if (te > ta) { const int N = 20; float ds = (te - ta) / float(N); float camk = length(eye);camk *= 1e-3; vec3 odS = vec3(0.), ins = vec3(0.); float c = dot(rd, sun); float pR = .0597 * (1. + c * c); float g = .76; float pM = .1194 * (1. - g * g) * (1. + c * c) / ((2. + g * g) * pow(1. + g * g - 2. * g * c, 1.5));
      vec3 Tacc = vec3(1.); float jt = fract(seed * 1.7 + hash(vec3(gl_FragCoord.yx * .37, seed * 7.)));
      for (int i = 0; i < N; i++) { float t = ta + (float(i) + jt) * ds; vec3 p = o + rd * t; float r = length(p), h = max(r - Ra, 0.); float mu = dot(p, sun) / r; float dR = exp(-h / 8.), dM = exp(-h / 1.25) * mix(1., 3.4, volk * smoothstep(60., 8., camk)); vec3 oz = vec3(.65e-3, 1.88e-3, .085e-3) * max(0., 1. - abs(h - 25.) / 15.); vec3 ext = bR * dR + bM * 1.11 * dM + oz; vec3 st = exp(-ext * ds); vec3 sc = (bR * dR * pR + bM * dM * pM) * T2sun(r, mu) + (bR * dR * .03 + bM * dM * .02) * smoothstep(-.1, .3, mu); ins += Tacc * sc * (1. - st) / max(ext, 1e-7); Tacc *= st; }
      L = L * Tacc + ins * mix(5.2, 4.2, volk); } }
  if (vt < 1.) { float hz = 1. - exp(-vz * 1e-3 / 60.); vl = mix(vl, vec3(.34, .46, .62) * (1. - vt), hz * .5); L = L * vt + vl; }
  col = vec4(max(L, 0.), 1.); }
'''
QUAD_V = '#version 410\nout vec2 q; void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); q = p * 2. - 1.; gl_Position = vec4(q, 0., 1.); }'
WORD_V = '#version 410\nuniform vec4 rect; out vec2 uv; void main() { vec2 p = vec2(gl_VertexID & 1, gl_VertexID >> 1); uv = p; gl_Position = vec4(mix(rect.xy, rect.zw, p), 0., 1.); }'
WORD_F = '#version 410\nin vec2 uv; out vec4 col; uniform sampler2D tex; uniform float op; void main() { float a = texture(tex, uv).a * op; col = vec4(pow(vec3(.933, .945, .957), vec3(2.2)) * a, a); }'
POST_F = '''#version 410
in vec2 q; out vec4 col; uniform sampler2D acc; uniform float n, expo, grain, fr, vig; 
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + fr * 3.17) * 43758.5453); }
vec3 tone(vec3 x) { const float a = 2.51, b = .03, c = 2.43, d = .59, e = .14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0., 1.); }
void main() { vec4 s = texture(acc, q * .5 + .5); vec3 c = s.rgb / n; c *= expo; c = tone(c * .72); float l = dot(c, vec3(.2126, .7152, .0722)); c = mix(c * vec3(.965, .99, 1.05), c * vec3(1.03, 1.0, .965), smoothstep(.05, .7, l)); { float gy = clamp(min(c.r, c.g) - c.b, 0., 1.); c.g -= gy * .10; c.r -= gy * .02; c.b += gy * .10; } c = mix(vec3(l), c, 1.04); c = mix(c, c * c * (3. - 2. * c), .38);
  c *= 1. - vig * smoothstep(.55, 1.5, length(q * vec2(1., .72))); c = pow(clamp(c, 0., 1.), vec3(1. / 2.2)); float g = (h(gl_FragCoord.xy) + h(gl_FragCoord.xy + 17.3) - 1.); c += g * grain * (.35 + .65 * sqrt(max(l, 0.))) * step(.0005, l + .0); col = vec4(clamp(c, 0., 1.), 1.); }'''
COPY_F = '#version 410\nin vec2 q; out vec4 col; uniform sampler2D t; void main() { col = texture(t, q * .5 + .5); }'

def transmittance():
    """How much sunlight is left after crossing the air, by height and sun angle."""
    W, H = 256, 128; Ra, Rt = 6371.0088, 6451.; bR = np.array([5.8e-3, 13.5e-3, 33.1e-3]); out = np.zeros((H, W, 4), 'f4')
    for j in range(H):
        r = Ra + (Rt - Ra) * ((j + .5) / H) ** 2; mu = (np.arange(W) + .5) / W * 2 - 1; b = r * mu; disc = b * b - (r * r - Rt * Rt); t1 = -b + np.sqrt(np.maximum(disc, 0)); g = b * b - (r * r - Ra * Ra); block = (g > 0) & (mu < 0); n = 60; od = np.zeros((W, 3))
        for i in range(n):
            t = t1 * (i + .5) / n; h = np.maximum(np.sqrt(r * r + t * t + 2 * r * mu * t) - Ra, 0); ds = t1 / n; oz = np.array([.65e-3, 1.88e-3, .085e-3]) * np.maximum(0, 1 - np.abs(h - 25) / 15)[:, None]; od += (bR * np.exp(-h / 8)[:, None] + 4.0e-3 * 1.11 * np.exp(-h / 1.25)[:, None] + oz) * ds[:, None]
        T = np.exp(-od); soft = np.clip((mu - (-np.sqrt(np.maximum(1 - (Ra / r) ** 2, 0)) - .02)) / .04, 0, 1); out[j, :, :3] = T * soft[:, None]; out[j, :, 3] = 1
    return out

class Dive:
    def __init__(s, K=2):
        s.W, s.H = 1920 * K, 1080 * K; s.K = K; c = s.c = moderngl.create_standalone_context(require=410); t0 = time.time()
        P = lambda v, f: c.program(vertex_shader=v, fragment_shader=f)
        s.ring, s.grid, s.air = P(RING_V, GROUND_F), P(GRID_V, GROUND_F), P(QUAD_V, AIR_F); s.word, s.post = P(WORD_V, WORD_F), P(QUAD_V, POST_F)
        s.ground_tex = {}; far = c.texture_array((4096, 4096, 7), 3)
        for z in range(9, 16): far.write(Image.open(B + f'c{z}.png').convert('RGB').tobytes(), viewport=(0, 0, z - 9, 4096, 4096, 1))
        s.far = s.mip(far); s.c = c
        def tex(n, ch=3): im = Image.open(B + n).convert('RGB' if ch == 3 else 'RGBA'); return s.mip(c.texture(im.size, ch, im.tobytes()))
        s.c16, s.c17, s.c18 = [tex(f'c{z}.png') for z in (16, 17, 18)]; s.dayG, s.dayA, s.dayN = [tex(f'day_{n}.png', 4) for n in ('globe', 'asia', 'nepal')]; s.nightG = tex('night_globe.png')
        for t in (s.dayG, s.nightG): t.repeat_x = True
        s.riv = c.texture((2048, 2048), 2, np.fromfile(B + 'river.bin', 'f4').tobytes(), dtype='f4'); s.riv.filter = (moderngl.LINEAR, moderngl.LINEAR); s.riv.repeat_x = s.riv.repeat_y = False
        s.n3 = c.texture3d((128, 128, 128), 2, open(B + 'noise3.bin', 'rb').read()); s.n3.build_mipmaps(); s.n3.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); tr = transmittance(); s.tr = c.texture((256, 128), 4, tr.tobytes(), dtype='f4'); s.tr.repeat_x = s.tr.repeat_y = False
        s.rv = c.vertex_array(s.ring, [(c.buffer(open(B + 'ring_v.bin', 'rb').read()), '3f 2f', 'pos', 'uv')], c.buffer(open(B + 'ring_i.bin', 'rb').read()))
        s.hn = c.texture((2560, 2560), 4, np.fromfile(B + 'near4.bin', 'f4').tobytes(), dtype='f4'); v = json.load(open(B + 'vil.json')); s.v = v; s.hv = c.texture((v['nx'], v['ny']), 4, np.fromfile(B + 'vil.bin', 'f4').tobytes(), dtype='f4')
        for t in (s.hn, s.hv): t.filter = (moderngl.NEAREST, moderngl.NEAREST)
        s.house = P(HOUSE_V, HOUSE_F); s.hs = c.vertex_array(s.house, [(c.buffer(open(B + 'houses.bin', 'rb').read()), '3f 3f 2f 1f 3f 1f 2f', 'pos', 'nrm', 'uv', 'kind_', 'col', 'idn', 'size')]); s.gn = c.vertex_array(s.grid, [], s.idx(2560, 2560)); s.gv = c.vertex_array(s.grid, [], s.idx(v['nx'], v['ny'])); s.qa = c.vertex_array(s.air, []); s.qp = c.vertex_array(s.post, []); s.qw = c.vertex_array(s.word, [])
        def al(n): im = Image.open(B + n).convert('RGBA'); return s.mip(c.texture(im.size, 4, im.transpose(Image.FLIP_TOP_BOTTOM).tobytes()))
        s.tw, s.tO = al('w_end_c.png' if WORD_T > 9 else 'w_title_c.png'), al('O_c.png'); s.tr_ = al('w_end_r.png' if WORD_T > 9 else 'w_title_r.png')
        size = (s.W, s.H); s.col, s.dep = c.texture(size, 4, dtype='f2'), c.depth_texture(size); s.dep.compare_func = ''; s.dep.filter = (moderngl.NEAREST, moderngl.NEAREST); s.f1 = c.framebuffer([s.col], s.dep); s.acc = c.texture(size, 4, dtype='f4'); s.f2 = c.framebuffer([s.acc]); s.out = c.texture(size, 3); s.f3 = c.framebuffer([s.out])
        for t in (s.col, s.acc): t.filter = (moderngl.NEAREST, moderngl.NEAREST)
        lv = []
        for z in range(9, 19):
            n = PLAN[z]; cx, cy = corner(z, n); lv.append(((TX * 2 ** z - cx) / n, (TY * 2 ** z - cy) / n, 2 ** z / n))
        s.lv = np.array(lv, 'f4'); print('loaded', round(time.time() - t0, 1), 's', c.info['GL_RENDERER'], flush=True)
    def mip(s, t): t.build_mipmaps(); t.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); t.anisotropy = 16.0; t.repeat_x = t.repeat_y = False; return t
    def idx(s, nx, ny): a = np.arange(nx * ny, dtype='u4').reshape(ny, nx); return s.c.buffer(np.stack([a[:-1, :-1], a[1:, :-1], a[:-1, 1:], a[:-1, 1:], a[1:, :-1], a[1:, 1:]], -1).reshape(-1).tobytes())
    def set(s, p, **k):
        for n, v in k.items():
            if n in p: p[n] = v if not isinstance(v, np.ndarray) else tuple(np.asarray(v, float).ravel())
    def sub(s, t, jit, seed, word=True):
        c = s.c; e, r, u, f, tv = cam(t); tan = (tv * 16 / 9, tv); F = 1 / math.log2(1e10); com = dict(eye=e, cr=r, cu=u, cf=f, tanv=tan, shift=(SX(t), SY(t)), jit=jit, time=t, sun=SUN, H0=H0, F=F); d = 10 ** LOGD(t)
        for p in (s.ring, s.grid, s.air, s.house): s.set(p, **com); p['x2e'].write(E2X.astype('f4').tobytes()) if 'x2e' in p else None
        units = dict(far=s.far, c16=s.c16, c17=s.c17, c18=s.c18, dayG=s.dayG, dayA=s.dayA, dayN=s.dayN, nightG=s.nightG, river=s.riv)
        for i, (n, tx) in enumerate(units.items()):
            tx.use(i)
            for p in (s.ring, s.grid, s.house):
                if n in p: p[n] = i
        s.f1.use(); c.enable_only(moderngl.DEPTH_TEST); c.clear(0, 0, 0, 0, depth=1.0); rise = min(1, max(0, (t - 4.6) / 4.2)); near = d < 90000
        for p in (s.ring, s.grid):
            if 'lv' in p: p['lv'].write(s.lv.tobytes())
            s.set(p, rise=rise)
        v = s.v; s.set(s.ring, kind=0, hole=(1262.0 if near else -1.0, 0, 0, 0)); s.rv.render()
        if near:
            box = (v['x0'], v['x0'] + (v['nx'] - 1) * v['res'], v['y1'] - (v['ny'] - 1) * v['res'], v['y1'])
            s.hn.use(10); s.set(s.grid, hgt=10, kind=1, gn=(2560, 2560), go=(-1279.5, 1279.5, 1.0, 0), hole=box); s.gn.render(vertices=-1)
            s.hv.use(10); s.set(s.grid, kind=2, gn=(v['nx'], v['ny']), go=(v['x0'], v['y1'], v['res'], 0)); s.gv.render()
            s.set(s.house, lv18=s.lv[9]); s.hs.render()
        s.f2.use(); c.enable_only(moderngl.BLEND); c.blend_func = moderngl.ONE, moderngl.ONE
        for i, (n, tx) in enumerate(dict(img=s.col, dep=s.dep, trans=s.tr, dayG=s.dayG, dayA=s.dayA, dayN=s.dayN, n3=s.n3).items()):
            tx.use(i); s.set(s.air, **{n: i})
        tp = 4.36; pe = cam(tp)[0]; alt = np.linalg.norm(e - np.array([0, 0, -(R + H0)])) - R - H0; vk = float(np.clip((170e3 - alt) / 100e3, 0, 1)); s.set(s.air, seed=seed, volk=vk * vk * (3 - 2 * vk), path=(pe[0], pe[1], 2600.0, .92)); s.qa.render(moderngl.TRIANGLES, vertices=3)
        if word and t < WORD_T: s.letters(t)
    def letters(s, t):
        """The word in front of the camera. It is added over everything; the camera goes through the middle of the O."""
        z = math.exp(ZOOM(t)); T = TITLE['w_title']; cx, cy = (SX(t) + 1) * 1920, (1 - SY(t)) * 1080; c = s.c; c.enable_only(moderngl.BLEND); c.blend_func = moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA
        # drawing over an accumulating picture: take away what is behind, then add the letters (each sub-frame on its own, so use a separate pass)
        def rect(x0_, y0_, x1_, y1_): X = lambda x: ((cx + (x - OX) * z) / 1920 - 1); Y = lambda y: (1 - (cy + (y - OY) * z) / 1080); return (X(x0_), Y(y1_), X(x1_), Y(y0_))
        a = T['crop']; s.lrect = []
        if z < 3.2: s.lrect.append((s.tw, rect(*a), 1.0))
        else:
            b = T['O']; w = (b[2] - b[0]); pad = TITLE['big']['pad'] / TITLE['big']['size'][0] * w; s.lrect.append((s.tO, rect(b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad), 1.0)); s.lrect.append((s.tr_, rect(*a), 1.0))          # the other letters fly past on both sides
        for tx, rc, op in s.lrect:
            if op <= 0: continue
            tx.use(0); s.set(s.word, tex=0, rect=rc, op=op); s.qw.render(moderngl.TRIANGLE_STRIP, vertices=4)
    def frame(s, t, sub=10, shutter=.5, fr=0):
        """One film frame: the shutter is open for half of it, and the picture is drawn many times while it is."""
        c = s.c; s.f2.use(); c.clear(0, 0, 0, 0); tmp = getattr(s, 'tmp', None)
        for i in range(sub):
            x = (i + .5) / sub; j = ((i * .754877666) % 1 - .5, (i * .569840291 + .3) % 1 - .5); tt = max(t + (x - .5) * shutter / FPS, 0)
            s.sub_over(tt, (j[0] * 2 / s.W, j[1] * 2 / s.H), (i * .618034 + fr * .37) % 1)
        s.f3.use(); c.disable(moderngl.BLEND); c.disable(moderngl.DEPTH_TEST); s.acc.use(0); e = EXPO(t); s.set(s.post, acc=0, n=float(sub), expo=e, grain=.020, fr=float(fr % 97), vig=.20); s.qp.render(moderngl.TRIANGLES, vertices=3)
        c.finish(); return np.frombuffer(s.out.read(), np.uint8).reshape(s.H, s.W, 3)[::-1]
    def sub_over(s, t, jit, seed):
        """Letters must cover what is behind them inside one sub-frame, so a sub-frame is drawn on its own and then added to the sum."""
        if not hasattr(s, 'one'):
            s.one = s.c.texture((s.W, s.H), 4, dtype='f2'); s.one.filter = (moderngl.NEAREST, moderngl.NEAREST); s.fone = s.c.framebuffer([s.one]); s.copy = s.c.program(vertex_shader=QUAD_V, fragment_shader=COPY_F); s.qc = s.c.vertex_array(s.copy, [])
        keep = s.f2; s.f2 = s.fone; s.fone.use(); s.c.clear(0, 0, 0, 0); s.sub(t, jit, seed); s.f2 = keep; keep.use(); s.c.enable_only(moderngl.BLEND); s.c.blend_func = moderngl.ONE, moderngl.ONE; s.one.use(0); s.copy['t'] = 0; s.qc.render(moderngl.TRIANGLES, vertices=3)
EXPO = mono([(0, 1.12), (2.6, 1.05), (3.3, .84), (4.15, .80), (4.42, 1.08), (4.8, 1.52), (5.4, 1.72), (6.4, 1.62), (8.75, 1.58), (9.4, 1.58), (10.9, 1.12), (11.62, .82)])
SUBS = mono([(0, 12), (1.2, 12), (1.5, 20), (2.2, 20), (2.7, 16), (3.0, 26), (4.5, 30), (5.2, 18), (6.2, 12), (11.62, 12)])          # more pictures in a frame where the camera is fast

if WORD_T > 9: EXPO = lambda t: 1.12; SUBS = mono([(0, 24), (1.2, 18), (3.25, 10)])

if __name__ == '__main__':
    if arg[1] == 'endstill': arg[1] = 'still'
    if arg[1] == 'end': arg[1] = 'film'
    if arg[1] == 'still':
        K = opt('--k', 1); dv = Dive(K); T = [float(x) for x in arg[2].split(',')]; ims = []
        for t in T: a = time.time(); im = dv.frame(t, opt('--sub', 4), fr=int(t * 60)); print(t, round(time.time() - a, 2), 's', flush=True); ims.append(Image.fromarray(im))
        n = opt('--cols', 2); w = opt('--w', 960 if len(ims) > 1 else dv.W); h = w * 9 // 16; o = Image.new('RGB', (n * w if len(ims) > 1 else w, (len(ims) + n - 1) // n * h))
        for i, im in enumerate(ims): o.paste(im.resize((w, h), Image.LANCZOS) if w != dv.W else im, (i % n * w, i // n * h))
        o.save(arg[3], quality=92)
    if arg[1] == 'film':
        dv = Dive(opt('--k', 2)); a, b = opt('--from', 0), opt('--to', NF); p = subprocess.Popen([FF, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{dv.W}x{dv.H}', '-framerate', '60', '-i', '-', '-vf', 'scale=out_range=tv:out_color_matrix=bt709,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '8', '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', arg[2]], stdin=subprocess.PIPE); t0 = time.time()
        for f in range(a, b):
            p.stdin.write(dv.frame(f / FPS, opt('--sub', 0) or round(SUBS(f / FPS)), fr=f).tobytes())
            if f % 30 == 0: print(f, round((time.time() - t0) / (f - a + 1), 2), 's a frame', flush=True)
        p.stdin.close(); p.wait(); print('done', round(time.time() - t0), 's')
