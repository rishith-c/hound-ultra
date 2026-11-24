// Shaders of the hall. Light is analytic: one long skylight slot (a line source), the network wall as the back light,
// one pool over the first figure. Haze is the closed-form in-scatter of those same sources, so it costs no ray march.
export const COMMON = /* glsl */ `
precision highp float; precision highp sampler2D;
uniform float uTime, uKey, uWave, uNet, uAmb, uWarmNet; uniform vec4 uPool; uniform vec4 uRip; uniform vec3 uWarmCol; uniform sampler2D uNoise; uniform vec3 uEye;
const vec2 SLOT = vec2(0.0, 29.0); const vec3 NETC = vec3(0.0, 15.0, -74.0);
float ash(float x) { float a = abs(x); return sign(x) * log(a + sqrt(a * a + 1.0)); }
float slotOn(float z) { return uKey * smoothstep(9.0, -9.0, z - uWave); }
vec3 coolW() { return vec3(0.86, 0.93, 1.0); }
vec3 lightAt(vec3 p, vec3 n, vec3 bent, float ao) {
  vec2 q = SLOT - p.xy; float d = length(q); vec3 l = vec3(q / d, 0.0);
  float occ = smoothstep(-0.35, 0.75, dot(bent, l)) * mix(0.35, 1.0, ao);
  vec3 E = vec3(0.97, 0.985, 1.0) * max((dot(n, l) + 0.18) / 1.18, 0.0) * occ * slotOn(p.z) * 30.0 / d;
  vec3 b = NETC + vec3(p.x * 0.25, 0.0, 0.0) - p; float bd = length(b); b /= bd;
  float nb = max((dot(n, b) + 0.22) / 1.22, 0.0); E += coolW() * nb * nb * smoothstep(-0.3, 0.6, dot(bent, b)) * uNet * 62.0 / (18.0 + bd) * (1.0 + 1.6 * uPool.w);
  E += uWarmCol * nb * uWarmNet * 26.0 / (14.0 + bd);
  vec2 pr = p.xz - uPool.xy; float pf = exp(-dot(pr, pr) / (uPool.z * uPool.z)); vec3 pl = normalize(vec3(uPool.x - p.x - 2.6, 5.4 - p.y * 0.6, uPool.y - p.z + 1.5));
  E += vec3(1.0, 0.985, 0.96) * max((dot(n, pl) + 0.06) / 1.06, 0.0) * smoothstep(-0.25, 0.6, dot(bent, pl)) * mix(0.4, 1.0, ao) * pf * uPool.w;
  float rk = max(dot(n, normalize(vec3(0.86, 0.22, -0.46))), 0.0); E += coolW() * (rk * rk * smoothstep(-0.2, 0.5, dot(bent, vec3(0.86, 0.22, -0.46))) * 0.75 * pf + 0.014 * ao) * uPool.w;
  E += vec3(0.62, 0.72, 0.86) * ao * (0.55 + 0.45 * n.y) * (uAmb + 0.055 * slotOn(p.z));
  return E;
}
float ripple(vec3 p) {                       // the thin Wi-Fi wavefronts crossing every surface
  if (uRip.w <= 0.0) return 0.0; float d = length(p - uRip.xyz), o = 0.0, R = uRip.w, w = 0.012 + 0.0022 * d;
  for (int i = 0; i < 3; i++) { float k = (d - R + float(i) * 0.42) / w; o += exp(-k * k) * (1.0 - 0.28 * float(i)); }
  return o * smoothstep(13.0, 2.0, R) * smoothstep(0.0, 0.5, R);
}
vec4 haze(vec3 ro, vec3 p) {                 // rgb in-scatter, a transmittance
  vec3 v = p - ro; float T = length(v); vec3 d = v / max(T, 1e-4);
  float Tr = exp(-0.0135 * T);
  vec2 o = ro.xy - SLOT; float a = max(dot(d.xy, d.xy), 1e-4), b = dot(o, d.xy), c = dot(o, o); float m = sqrt(max(a * c - b * b, 0.02));
  float I = (ash((a * T + b) / m) - ash(b / m)) / sqrt(a);
  float zm = ro.z + d.z * min(T, 34.0) * 0.6; float n = texture2D(uNoise, vec2((ro.x + d.x * 22.0) * 0.011 + uTime * 0.003, zm * 0.008 + d.y * 0.5)).r;
  vec3 S = vec3(0.80, 0.90, 1.0) * max(I - 0.5, 0.0) * 0.0068 * slotOn(zm) * (0.35 + 1.1 * n);
  vec3 k = NETC - ro; float t0 = dot(k, d), h2 = max(dot(k, k) - t0 * t0, 10.0), h = sqrt(h2); float J = (atan((T - t0) / h) + atan(t0 / h)) / h;
  S += coolW() * J * uNet * 0.19 + uWarmCol * J * uWarmNet * 0.22;
  vec2 pk = uPool.xy - ro.xz; float a2 = max(dot(d.xz, d.xz), 1e-3), tp = dot(pk, d.xz) / a2; vec2 cl = pk - d.xz * tp; 
  if (tp > 0.0 && tp < T) { float hy = ro.y + d.y * tp; S += vec3(1.0, 0.98, 0.95) * exp(-dot(cl, cl) / (uPool.z * uPool.z * (0.35 + 0.05 * hy))) * uPool.w * 0.016 * smoothstep(-1.0, 3.0, hy) * (0.6 + 0.8 * n); }
  return vec4(S, Tr);
}
vec4 safe(vec3 c) { return vec4(min(max(c, vec3(0.0)), vec3(24.0)), 1.0); }
vec3 octd(vec2 e) { vec3 v = vec3(e, 1.0 - abs(e.x) - abs(e.y)); float t = max(-v.z, 0.0); v.x += v.x >= 0.0 ? -t : t; v.y += v.y >= 0.0 ? -t : t; return normalize(v); }
`;

export const FIG_V = COMMON + /* glsl */ `
attribute vec4 aD; attribute vec4 aB; attribute float iId; uniform sampler2D uPeople, uHeat; uniform vec3 uLo, uSpan; uniform float uMirror, uLying, uHover;
varying vec3 vP, vN, vB, vO; varying vec4 vK; varying float vH;
void main() {
  vec3 p = uLo + position * uSpan; vec3 n = octd(aD.xy), b = octd(aB.xy); float hgt = aD.w * 1.8;
  vec4 A = texelFetch(uPeople, ivec2(int(iId + 0.5), 0), 0), S = texelFetch(uPeople, ivec2(int(iId + 0.5), 1), 0); vec4 H = texelFetch(uHeat, ivec2(int(iId + 0.5), 0), 0);
  p.x *= uMirror; n.x *= uMirror; b.x *= uMirror; vO = p * 1.0 + S.w * 7.0;
  float br = sin(uTime * 1.5 + S.w * 40.0) * (0.35 + 0.65 * H.r);
  p += n * exp(-pow((hgt - 1.22) / 0.15, 2.0)) * 0.0058 * br * step(0.0, 1.0);
  if (uLying < 0.5) {
    float w = smoothstep(1.40, 1.53, hgt), a = (S.w - 0.5) * 0.85 * w, cs = cos(a), sn = sin(a); p.y += 0.02;
    p.xy = mat2(cs, sn, -sn, cs) * p.xy; n.xy = mat2(cs, sn, -sn, cs) * n.xy; b.xy = mat2(cs, sn, -sn, cs) * b.xy; p.y -= 0.02;
    float hm = mix(1.0, S.x / S.y, w); p.x *= mix(S.x, S.y, w); p.y *= mix(S.z, S.y, w); p.z *= S.y;
  } else { float w = smoothstep(1.40, 1.53, hgt); p.x *= mix(S.x, S.y, w); p.y *= S.y; p.z *= mix(S.z, S.y, w); }
  vec3 q = vec3(p.x, p.z, -p.y), m = vec3(n.x, n.z, -n.y), e = vec3(b.x, b.z, -b.y);
  float c = cos(A.w), s = sin(A.w); mat3 R = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  vP = R * q + A.xyz; vN = R * m; vB = R * e; vK = vec4(aD.z, H.r, S.w, H.g); vH = abs(iId - uHover) < 0.5 ? 1.0 : 0.0;
  vO.z = hgt; gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
}`;
export const FIG_F = COMMON + /* glsl */ `
uniform sampler2D uPl; uniform float uDetail; varying vec3 vP, vN, vB, vO; varying vec4 vK; varying float vH;
void main() {
  vec3 n = normalize(vN), v = normalize(uEye - vP); float ao = vK.x;
  float dist = length(uEye - vP), near = uDetail * smoothstep(16.0, 3.0, dist), pit = 0.0, tone = 0.0;
  vec3 w = pow(abs(n), vec3(4.0)); w /= w.x + w.y + w.z;
  vec3 P = vP * 1.0 + vK.z * 13.0;
  #define TRI(s) (texture2D(uNoise, P.zy * s) * w.x + texture2D(uNoise, P.xz * s) * w.y + texture2D(uNoise, P.xy * s) * w.z)
  vec4 lo = TRI(0.55); tone = lo.r;
  if (near > 0.01) {
    vec4 h1 = TRI(4.3), h2 = TRI(13.0); float hh = h1.g * 0.9 + h2.r * 0.10; pit = smoothstep(0.80, 0.95, h2.b) * 0.5;
    vec3 dpx = dFdx(vP), dpy = dFdy(vP); float hx = dFdx(hh), hy = dFdy(hh); vec3 r1 = cross(dpy, n), r2 = cross(n, dpx); float det = dot(dpx, r1);
    vec3 g = sign(det) * (hx * r1 + hy * r2); n = normalize(abs(det) * n - g * 0.0016 * near); ao *= 1.0 - 0.28 * pit * near;
  }
  vec3 alb = mix(vec3(0.50, 0.495, 0.485), vec3(0.66, 0.655, 0.64), smoothstep(0.25, 0.75, tone)); alb *= 0.72 + 0.28 * smoothstep(0.0, 0.35, vO.z);
  alb *= mix(0.55, 1.0, ao);
  vec3 E = lightAt(vP, n, normalize(mix(n, vB, 0.8)), ao);
  vec3 col = alb * E * 0.74;
  vec3 bk = normalize(NETC - vP), hv = normalize(bk + v); col += coolW() * pow(max(dot(n, hv), 0.0), 18.0) * 0.05 * uNet * smoothstep(0.0, 0.3, dot(n, bk));
  col += coolW() * ripple(vP) * 0.8;
  float heat = vK.y, nv = max(dot(n, v), 0.0), flick = 0.92 + 0.08 * sin(uTime * 2.1 + vK.z * 60.0);
  float core = 0.28 + 0.95 * exp(-pow((vO.z - 1.22) / 0.34, 2.0)) + 0.22 * exp(-pow((vO.z - 0.75) / 0.5, 2.0));
  vec3 emb = mix(uWarmCol * vec3(0.95, 0.80, 0.70), uWarmCol, heat) + vec3(0.30, 0.17, 0.06) * heat * exp(-pow((vO.z - 1.22) / 0.26, 2.0)) * nv;
  col = mix(col, col * vec3(1.0, 0.80, 0.68), heat * 0.6);
  col += emb * heat * flick * (0.10 + 0.95 * pow(nv, 1.9)) * core * mix(0.35, 1.0, ao) * (0.65 + 0.65 * tone) * 0.80;
  col += vec3(0.9, 0.95, 1.0) * vH * (0.05 + 0.5 * pow(1.0 - nv, 3.0));
  col += coolW() * vK.w * (0.015 + 0.12 * pow(1.0 - nv, 3.0));
  vec4 hz = haze(uEye, vP); gl_FragColor = safe(col * hz.a + hz.rgb);
}`;

export const BLOB_V = COMMON + /* glsl */ `
attribute float iId; uniform sampler2D uPeople, uHeat; varying vec2 vU; varying vec3 vP; varying vec3 vK;
void main() { int id = int(iId + 0.5); vec4 A = texelFetch(uPeople, ivec2(id, 0), 0), S = texelFetch(uPeople, ivec2(id, 1), 0), X = texelFetch(uPeople, ivec2(id, 2), 0); float ly = X.x; vec2 q = position.xy; vU = q * 2.0; float ht = texelFetch(uHeat, ivec2(id, 0), 0).r;
  vec2 r = vec2(1.9); vec2 s = q * (ly > 0.5 ? vec2(2.4, 3.6) : vec2(2.9)); float c = cos(A.w), n = sin(A.w); vK = vec3(ly, ht, S.w);
  vP = A.xyz + vec3(c * s.x + n * s.y, 0.012, -n * s.x + c * s.y); gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0); }`;
export const BLOB_F = COMMON + /* glsl */ `
varying vec2 vU; varying vec3 vP; varying vec3 vK;
void main() { vec2 u = vU; float r = length(u); vec2 k = vK.x > 0.5 ? u * vec2(3.6, 1.85) : u * vec2(3.9, 4.4);
  float sh = 0.86 * exp(-pow(length(k), 1.7) * 0.9) + 0.30 * exp(-dot(u, u) * 5.0); float edge = smoothstep(1.0, 0.45, r); sh = clamp(sh, 0.0, 0.93) * edge;
  vec3 warm = uWarmCol * vK.y * (0.10 * exp(-r * r * 4.2)) * edge; vec4 hz = haze(uEye, vP); sh *= hz.a;
  gl_FragColor = vec4(warm * hz.a + hz.rgb * 0.0, sh); }`;

export const ROOM_V = COMMON + /* glsl */ `
varying vec3 vP, vN; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vec3 n = normal;
  #ifdef USE_INSTANCING
  w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  #endif
  vP = w.xyz; vN = n; gl_Position = projectionMatrix * viewMatrix * w; }`;
export const ROOM_F = COMMON + /* glsl */ `
varying vec3 vP, vN;
void main() {
  vec3 n = normalize(vN); vec3 a = abs(n); vec2 uv = a.x > 0.5 ? vP.zy : a.y > 0.5 ? vP.xz : vP.xy; bool top = a.y > 0.5;
  vec4 n1 = texture2D(uNoise, uv * 0.031), n2 = texture2D(uNoise, uv * 0.21), n3 = texture2D(uNoise, uv * vec2(0.9, 0.035) + 0.3);
  float alb = 0.15 + 0.10 * n1.r + 0.07 * (n2.g - 0.5); alb *= mix(0.30, 1.0, smoothstep(-77.5, -70.0, vP.z));
  float ao = 1.0; if (vP.y > 34.6 && abs(vP.x) < 4.3) { vec4 hs = haze(uEye, vP); gl_FragColor = vec4(vec3(0.92, 0.97, 1.0) * 2.6 * slotOn(vP.z) * hs.a + hs.rgb, 1.0); return; }
  if (!top) {                                  // board-marked concrete: lifts, boards, tie holes, water stains
    float lift = abs(fract(uv.y / 2.9) - 0.5), board = abs(fract(uv.y / 0.29) - 0.5), pan = abs(fract(uv.x / 4.35) - 0.5); float px = fwidth(uv.y);
    ao *= 1.0 - 0.55 * smoothstep(0.494, 0.499, lift) ; ao *= 1.0 - 0.5 * smoothstep(0.4955, 0.499, pan);
    ao *= 1.0 - 0.17 * smoothstep(0.44, 0.49, board) * smoothstep(0.09, 0.02, px); alb *= 0.94 + 0.12 * texture2D(uNoise, vec2(floor(uv.y / 0.29) * 0.137, uv.x * 0.004)).r;
    vec2 th = vec2(fract(uv.x / 2.175) - 0.5, fract(uv.y / 1.45) - 0.5) * vec2(2.175, 1.45); ao *= 1.0 - 0.75 * smoothstep(0.055, 0.030, length(th)) * smoothstep(0.12, 0.03, px);
    alb *= 1.0 - 0.38 * smoothstep(0.50, 0.78, n3.r) * smoothstep(0.0, 14.0, vP.y); alb *= 0.62 + 0.38 * smoothstep(0.0, 3.2, vP.y + n2.r * 1.4);
  }
  vec3 E = lightAt(vP, n, n, ao); E += vec3(0.8, 0.9, 1.0) * ao * 0.02 * uKey;
  vec3 col = vec3(1.0, 0.99, 0.97) * alb * ao * E * 0.42; col += coolW() * ripple(vP) * 0.10;
  vec4 hz = haze(uEye, vP); gl_FragColor = safe(col * hz.a + hz.rgb);
}`;

export const FLOOR_F = COMMON + /* glsl */ `
uniform sampler2D uRefl; uniform vec2 uRes; varying vec3 vP, vN;
void main() {
  vec2 uv = vP.xz; vec4 a = texture2D(uNoise, uv * 0.017), b = texture2D(uNoise, uv * 0.083 + 0.31), c = texture2D(uNoise, uv * 0.47), g = texture2D(uNoise, uv * 2.3);
  float wet = smoothstep(0.30, 0.56, a.r * 0.62 + b.g * 0.38); vec3 v = uEye - vP; float dist = length(v); v /= dist;
  vec2 j = abs(fract(uv / vec2(5.7, 6.6) + vec2(0.5, 0.1)) - 0.5) * vec2(5.7, 6.6); float joint = smoothstep(0.030, 0.008, min(j.x, j.y)) * smoothstep(60.0, 12.0, dist);
  vec2 bump = (vec2(c.r, c.g) - 0.5) * 0.020 + (vec2(g.r, g.b) - 0.5) * 0.030 * (1.0 - wet) + vec2(0.0);
  vec3 n = normalize(vec3(bump.x, 1.0, bump.y));
  float nv = max(dot(n, v), 0.0), F = 0.022 + 0.978 * pow(1.0 - nv, 5.0);
  float rough = mix(0.62, 0.09, wet) + 0.10 * g.r; vec2 s = gl_FragCoord.xy / uRes + bump * vec2(1.4, 2.4) * (0.35 + 0.9 / (1.0 + dist * 0.06));
  float lod = rough * 5.4; vec3 R = textureLod(uRefl, clamp(s, 0.0, 1.0), lod).rgb * 0.55 + textureLod(uRefl, s + vec2(0.0, 0.004 + 0.03 * rough), lod + 1.0).rgb * 0.25 + textureLod(uRefl, s - vec2(0.0, 0.004 + 0.03 * rough), lod + 1.0).rgb * 0.20;
  float alb = mix(0.135, 0.050, wet) * (0.75 + 0.5 * b.r) * (0.85 + 0.3 * g.g);
  alb *= 1.0 - 0.6 * joint; vec3 E = lightAt(vP, n, vec3(0.0, 1.0, 0.0), 1.0);
  vec3 col = vec3(1.0, 0.99, 0.975) * alb * E * 0.42 + R * (F * mix(0.55, 1.0, wet) + 0.035 + 0.035 * wet) * (1.0 - 0.5 * joint);
  col += coolW() * ripple(vP) * 0.34;
  vec4 hz = haze(uEye, vP); gl_FragColor = safe(col * hz.a + hz.rgb * 0.92);
}`;

// ---- ribbons: each person's real 52-channel pattern, flying to the network
export const RIB_V = COMMON + /* glsl */ `
attribute vec2 aU; attribute float iId; uniform sampler2D uPeople, uPat; uniform float uFlow, uDur, uGain, uSolo; uniform vec2 uPx; varying float vA; varying vec3 vP; varying float vS;
vec3 bez(vec3 a, vec3 b, vec3 c, vec3 d, float t) { float s = 1.0 - t; return a * s * s * s + 3.0 * b * s * s * t + 3.0 * c * s * t * t + d * t * t * t; }
vec3 path(float s, vec3 P0, vec4 r, float lane) { vec3 Q = vec3(lane, 3.2, -73.4); float far = length(P0 - Q);
  vec3 c1 = P0 + vec3((r.x - 0.5) * 5.0 - P0.x * 0.15, 3.6 + 6.5 * r.y, -2.0 - 4.0 * r.z), c2 = vec3(mix(P0.x * 0.35, lane, 0.6) + (r.z - 0.5) * 9.0, 7.5 + 8.0 * r.x, mix(P0.z, -73.4, 0.72));
  vec3 p = bez(P0, c1, c2, Q, s); float k = s * (1.0 - s) * 4.0; p.x += (sin(s * 11.0 + r.y * 6.3 + uTime * 0.35) * 1.5 + sin(s * 27.0 + r.z * 6.3 - uTime * 0.5) * 0.35) * k; p.y += (sin(s * 9.0 + r.x * 6.3 + uTime * 0.28) * 1.1 + sin(s * 23.0 + r.w * 6.3) * 0.3) * k; return p; }
void main() {
  int id = int(iId + 0.5); vec4 A = texelFetch(uPeople, ivec2(id, 0), 0), X = texelFetch(uPeople, ivec2(id, 2), 0); vec4 r = texelFetch(uPeople, ivec2(id, 3), 0);
  float life = uSolo >= 0.0 ? (uSolo) : fract(uFlow / uDur + r.w); float al = uSolo >= 0.0 ? (abs(iId - X.w) < 0.5 ? 1.0 : 0.0) : 1.0;
  vec3 P0 = A.xyz + vec3(0.0, X.y, 0.0); float lane = (aU.x - 0.5) * 13.0;
  float s1 = smoothstep(0.0, 1.0, life) * 0.35 + life * life * 0.65; float L = (uSolo >= 0.0 ? 0.17 : mix(0.07, 0.15, r.y)) * smoothstep(0.02, 0.35, life); float s = clamp(s1 - (1.0 - aU.x) * L, 0.0, 1.0);
  float spread = smoothstep(0.86, 1.0, s1); float lane2 = mix((r.z - 0.5) * 8.0, lane, spread); s = mix(s, s1, spread);
  vec3 p = path(s, P0, r, lane2), p2 = path(min(s + 0.004, 1.0), P0, r, lane2);
  float pat = texelFetch(uPat, ivec2(int(aU.x * 51.0 + 0.5), id), 0).r * 2.0 - 1.0; float ring = 1.0 - smoothstep(0.0, 0.16, life);
  float th = (aU.x - 0.5) * 6.0 + uTime * 0.2; vec3 rg = A.xyz + vec3(cos(th) * 0.46, X.y + pat * 0.13, sin(th) * 0.46);
  p.y += pat * (uSolo >= 0.0 ? 0.45 + 2.6 * s : 0.16 + 0.35 * r.x) * (1.0 - spread * 0.4); p = mix(p, rg, ring); p2 = mix(p2, A.xyz + vec3(cos(th + 0.1) * 0.46, X.y, sin(th + 0.1) * 0.46), ring);
  vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.0), c1 = projectionMatrix * viewMatrix * vec4(p2, 1.0); vec2 d = c1.xy / c1.w - c0.xy / c0.w; d = normalize(d * vec2(uPx.y / uPx.x, 1.0) + 1e-6); vec2 nn = vec2(-d.y, d.x);
  float px = (0.95 + 4.0 / max(c0.w, 2.0)) * (uSolo >= 0.0 ? 1.6 : 1.0); c0.xy += nn * aU.y * px / uPx.xy * 2.0 * c0.w; vS = aU.y; vP = p;
  vA = al * uGain * smoothstep(0.0, 0.10, life) * smoothstep(1.0, 0.93, life) * (uSolo >= 0.0 ? 1.0 : 0.35 + 0.65 * abs(pat)) * pow(aU.x, 1.1) * (uSolo >= 0.0 ? 3.4 : 0.30 + 0.5 * r.z) * smoothstep(0.6, 2.4, c0.w);
  gl_Position = al < 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : c0;
}`;
export const RIB_F = COMMON + /* glsl */ ` varying float vA; varying vec3 vP; varying float vS; void main() { float f = exp(-vS * vS * 3.0); vec4 hz = haze(uEye, vP); gl_FragColor = safe(vec3(0.80, 0.91, 1.0) * vA * f * mix(0.4, 1.0, hz.a)); }`;

// ---- network
export const THR_V = COMMON + /* glsl */ `
attribute vec2 aQ; attribute vec4 iAB; attribute float iE; uniform sampler2D uW; uniform float uCk, uRows, uBeat; uniform vec2 uPx; varying float vA; varying float vQ; varying vec3 vP;
void main() { float k = floor(uCk), f = uCk - k; int x = int(iE + 0.5); float w = mix(texelFetch(uW, ivec2(x, int(k)), 0).r, texelFetch(uW, ivec2(x, int(min(k + 1.0, uRows - 1.0))), 0).r, f); w = (w * 255.0 - 128.0) / 127.0;
  vec3 a = vec3(iAB.xy, -73.6), b = vec3(iAB.zw, -73.6); vec3 p = mix(a, b, aQ.x); float bow = sin(aQ.x * 3.14159); p.z += bow * (0.5 + 0.9 * fract(iE * 0.618)); vP = p;
  vec4 c = projectionMatrix * viewMatrix * vec4(p, 1.0), c1 = projectionMatrix * viewMatrix * vec4(mix(a, b, aQ.x + 0.02), 1.0); vec2 d = normalize((c1.xy / c1.w - c.xy / c.w) * vec2(uPx.x / uPx.y, 1.0) + 1e-6); c.xy += vec2(-d.y, d.x) * aQ.y * 1.0 / uPx * 2.0 * c.w; vQ = aQ.y;
  vA = pow(abs(w), 2.3) * 1.15 * (w > 0.0 ? 1.0 : 0.5); gl_Position = c; }`;
export const THR_F = COMMON + /* glsl */ ` uniform float uThr; varying float vA; varying float vQ; varying vec3 vP; void main() { vec4 hz = haze(uEye, vP); gl_FragColor = safe(vec3(0.84, 0.92, 1.0) * vA * exp(-vQ * vQ * 2.2) * uThr * (0.35 + 0.65 * hz.a)); }`;
export const NODE_V = COMMON + /* glsl */ `
attribute vec2 aQ; attribute vec4 iN; attribute float iV; uniform vec2 uPx; varying vec2 vQ; varying float vV; varying vec3 vP; varying float vW;
void main() { float r = iN.z; vec3 p = vec3(iN.xy, -73.2); vP = p; vV = iV; vW = iN.w; vec4 c = viewMatrix * vec4(p, 1.0); float sc = iN.w > 0.5 ? 1.0 + 0.9 * iV : 1.0; c.xy += aQ * r * 5.0 * sc; vQ = aQ * 5.0; gl_Position = projectionMatrix * c; }`;
export const NODE_F = COMMON + /* glsl */ ` varying vec2 vQ; varying float vV; varying vec3 vP; varying float vW; void main() { float r = length(vQ); float w = fwidth(r); float disc = smoothstep(1.0 + w, 1.0 - w, r); float rimL = exp(-pow((r - 1.0) / (0.10 + w), 2.0)); float halo = exp(-r * 1.05) * 0.5 * smoothstep(5.0, 3.2, r);
  vec3 c = vW > 1.5 ? uWarmCol : vec3(0.92, 0.96, 1.0); float v = vV; float lum = disc * (0.05 + 1.25 * v * (0.8 + 0.2 * (1.0 - r))) + rimL * 0.16 + halo * v * (vW > 0.5 ? 2.2 : 0.45); if (vW > 1.5) c = mix(vec3(0.9, 0.95, 1.0), uWarmCol * 1.35, smoothstep(0.02, 0.25, v)); vec4 hz = haze(uEye, vP); gl_FragColor = safe(c * lum * (0.35 + 0.65 * hz.a)); }`;
export const PART_V = COMMON + /* glsl */ `
attribute vec4 iAB; attribute vec4 iC; attribute vec2 aQ; uniform float uBeat; varying vec2 vQ; varying float vA; varying vec3 vP;
void main() { float t = (uBeat * 6.6 - iC.x * 0.92 - iC.z * 0.55) / 1.15; float s = t * t * (3.0 - 2.0 * t); vec3 p = vec3(mix(iAB.xy, iAB.zw, clamp(s, 0.0, 1.0)), -73.1 + sin(clamp(s, 0.0, 1.0) * 3.14) * iC.w); vA = iC.y * step(0.0, t) * step(t, 1.0) * smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.9, t); vP = p; vec4 c = viewMatrix * vec4(p, 1.0); c.xy += aQ * (0.16 + 0.16 * iC.y); vQ = aQ; gl_Position = vA <= 0.001 ? vec4(2.0) : projectionMatrix * c; }`;
export const PART_F = COMMON + /* glsl */ ` varying vec2 vQ; varying float vA; varying vec3 vP; void main() { float r = length(vQ); gl_FragColor = vec4(vec3(0.9, 0.96, 1.0) * vA * exp(-r * r * 9.0) * 1.5, 1.0); }`;

// ---- post
export const FS_V = 'varying vec2 vU; void main() { vU = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }';
export const DOWN_F = 'precision highp float; varying vec2 vU; uniform sampler2D tS; uniform vec2 uT; uniform float uFirst; vec3 s(vec2 o) { vec3 c = texture2D(tS, vU + o * uT).rgb; return uFirst > 0.5 ? min(c, vec3(12.0)) : c; } void main() { vec3 c = s(vec2(0.0)) * 0.125 + (s(vec2(-1.0)) + s(vec2(1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0))) * 0.125 + (s(vec2(-2.0)) + s(vec2(2.0)) + s(vec2(2.0, -2.0)) + s(vec2(-2.0, 2.0))) * 0.03125 + (s(vec2(0.0, 2.0)) + s(vec2(0.0, -2.0)) + s(vec2(2.0, 0.0)) + s(vec2(-2.0, 0.0))) * 0.0625; gl_FragColor = vec4(c, 1.0); }';
export const UP_F = 'precision highp float; varying vec2 vU; uniform sampler2D tS; uniform vec2 uT; void main() { vec3 c = texture2D(tS, vU).rgb * 4.0; c += (texture2D(tS, vU + uT * vec2(1.0, 0.0)).rgb + texture2D(tS, vU - uT * vec2(1.0, 0.0)).rgb + texture2D(tS, vU + uT * vec2(0.0, 1.0)).rgb + texture2D(tS, vU - uT * vec2(0.0, 1.0)).rgb) * 2.0; c += texture2D(tS, vU + uT).rgb + texture2D(tS, vU - uT).rgb + texture2D(tS, vU + uT * vec2(1.0, -1.0)).rgb + texture2D(tS, vU + uT * vec2(-1.0, 1.0)).rgb; gl_FragColor = vec4(c / 16.0, 1.0); }';
export const FIN_F = /* glsl */ `
precision highp float; varying vec2 vU; uniform sampler2D tS, tB, tH, tD; uniform vec2 uT, uNF; uniform float uTime, uFade, uFocus, uDof, uBloom;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNF.x * uNF.y / (uNF.y + uNF.x - z * (uNF.y - uNF.x)); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tS, vU).rgb;
  if (uDof > 0.01) { float z = lin(texture2D(tD, vU).r); float coc = clamp(abs(1.0 / uFocus - 1.0 / z) * uFocus * 1.5 - 0.14, 0.0, 1.0) * uDof; vec3 h = vec3(0.0); float wt = 0.0; float jit = hash(gl_FragCoord.xy) * 6.283; for (int i = 0; i < 26; i++) { float a = float(i) * 2.39996 + jit, q = sqrt((float(i) + 0.5) / 26.0); vec2 o = vU + vec2(cos(a), sin(a)) * uT * q * (1.5 + 13.0 * coc); float zs = lin(texture2D(tD, o).r), cs = clamp(abs(1.0 / uFocus - 1.0 / zs) * uFocus * 1.5 - 0.14, 0.0, 1.0); float k = zs < z ? smoothstep(0.0, 0.35, cs) + 0.003 : 1.0; h += min(texture2D(tS, o).rgb, vec3(3.0)) * k; wt += k; } c = mix(c, h / wt, smoothstep(0.0, 0.40, coc)); }
  c += texture2D(tB, vU).rgb * uBloom; vec2 q = vU - 0.5; c *= 1.0 - dot(q, q) * 0.62; c = aces(c * 1.15); c = pow(c, vec3(1.0 / 2.2));
  c += (hash(vU * 900.0 + fract(uTime) * 7.0) - 0.5) * 0.020; gl_FragColor = vec4(c * uFade, 1.0);
}`;
