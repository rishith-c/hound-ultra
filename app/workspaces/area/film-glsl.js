// Shaders for the valley film. Heights are metres relative to the block; x is east, y is up, z is south.
export const COMMON = /* glsl */ `
precision highp float; precision highp sampler2D;
uniform sampler2D uH, uFH, uShadow, uDet, uFloor;
uniform vec3 uNB, uFB, uSun, uSunCol, uSkyCol, uHzCol, uCam;
uniform float uTime, uHasFar;
uniform float uFront, uSettle, uBase, uSurgeH;
float nearH(vec2 p) { return texture2D(uH, (p - uNB.xy) / uNB.z).r; }
float sunAt(vec2 p) { vec2 q = (p - uNB.xy) / uNB.z; vec2 e = min(q, 1. - q); float inb = step(0.002, min(e.x, e.y)); return mix(1., texture2D(uShadow, clamp(q, 0., 1.)).r, inb); }
float stageAt(float s) { float x = uFront - s; return uBase + smoothstep(-14., 70., x) * ((uSettle - uBase) + (uSurgeH - uSettle) * exp(-max(x, 0.) / 1500.)); }
vec3 skyCol(vec3 d) {
  float y = max(d.y, 0.), m = max(dot(d, uSun), 0.);
  vec3 c = mix(uHzCol, uSkyCol * 1.15, 1. - exp(-y * 7.5));
  c += uSunCol * (0.05 * pow(m, 6.) + 0.16 * pow(m, 48.) + 0.5 * pow(m, 700.)) ;
  return c;
}
vec3 shade(vec3 alb, vec3 N, float sh, float ao) {
  float nl = max(dot(N, uSun), 0.);
  vec3 amb = (uSkyCol * (0.62 + 0.38 * N.y) + uHzCol * 0.34 * (1. - N.y)) * ao;
  vec3 bounce = uSunCol * alb * 0.10 * sh * (1. - N.y * 0.6) * ao;
  return alb * (uSunCol * nl * sh + amb + bounce);
}
`;

export const QUAD_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0., 1.); }`;

// Sun shadow of the terrain, marched through the height grids on the GPU, a strip at a time.
export const SHADOW_FRAG = COMMON + /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 p = uNB.xy + vUv * uNB.z; float y = nearH(p) + 2.5, t = 14., res = 1.;
  for (int i = 0; i < 92; i++) {
    vec3 q = vec3(p.x, y, p.y) + uSun * t;
    vec2 uv = (q.xz - uNB.xy) / uNB.z; float g;
    if (uv.x > 0. && uv.y > 0. && uv.x < 1. && uv.y < 1.) g = texture2D(uH, uv).r;
    else if (uHasFar > 0.5) g = texture2D(uFH, (q.xz - uFB.xy) / uFB.z).r; else break;
    res = min(res, 0.5 + 26. * (q.y - g) / t);
    if (res <= 0.) break;
    t *= 1.052; t += 5.;
  }
  gl_FragColor = vec4(smoothstep(0., 1., clamp(res, 0., 1.)));
}`;

export const SKY_VERT = /* glsl */ `varying vec3 vDir; uniform mat4 uInvVP; uniform vec3 uCam; void main() { vec4 p = uInvVP * vec4(position.xy, 1., 1.); vDir = p.xyz / p.w - uCam; gl_Position = vec4(position.xy, 1., 1.); }`;
export const SKY_FRAG = COMMON + /* glsl */ `
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir), c = skyCol(d);
  if (d.y > 0.015) { // thin high cloud, streaked by the wind
    vec2 q = d.xz / (d.y + 0.09) * 0.16 + uTime * 0.0009;
    float n = texture2D(uDet, q * vec2(0.55, 1.5)).b * 0.6 + texture2D(uDet, q * vec2(1.7, 3.9) + 0.3).b * 0.4;
    float m = max(dot(d, uSun), 0.), k = smoothstep(0.50, 0.86, n) * smoothstep(0.015, 0.16, d.y) * 0.5;
    c = mix(c, uHzCol * 1.02 + uSunCol * (0.10 + 0.42 * pow(m, 5.)), k);
  }
  gl_FragColor = vec4(c, 1.);
}`;

// ---------------------------------------------------------------- ground
export const NEAR_VERT = COMMON + /* glsl */ `
attribute float aSkirt; varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.); w.y = nearH(w.xz) - aSkirt * 60.; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
export const NEAR_FRAG = COMMON + /* glsl */ `
uniform sampler2D uNrm, uA, uB, uC, uD; uniform vec4 uRC, uRD, uGlow; uniform float uWetTop;
varying vec3 vW;
vec4 over(vec4 a, vec4 b, float k) { return a * (1. - b.a * k) + vec4(b.rgb * k, b.a * k); }
void main() {
  vec2 uv = (vW.xz - uNB.xy) / uNB.z; float dist = distance(vW, uCam);
  vec4 nt = texture2D(uNrm, uv); vec2 nxz = (nt.xy * 255. / 127.5) - 1.; vec3 N = vec3(nxz.x, sqrt(max(0.04, 1. - dot(nxz, nxz))), nxz.y);
  // imagery: coarse to fine, each level only where its tiles have arrived
  vec4 im = texture2D(uA, uv); im = im.a > 0.01 ? im : vec4(0.);
  vec4 b = texture2D(uB, uv); im = over(im, b, 1.);
  vec2 qc = (vW.xz - uRC.xy) / uRC.z; float fc = smoothstep(0., 0.05, min(min(qc.x, qc.y), min(1. - qc.x, 1. - qc.y)));
  if (fc > 0.) im = over(im, texture2D(uC, qc), fc);
  vec2 qd = (vW.xz - uRD.xy) / uRD.z; float fd = smoothstep(0., 0.08, min(min(qd.x, qd.y), min(1. - qd.x, 1. - qd.y)));
  if (fd > 0.) im = over(im, texture2D(uD, qd), fd);
  // no imagery yet: ground colour from slope and height
  vec3 plain = mix(vec3(0.055, 0.065, 0.032), vec3(0.17, 0.155, 0.135), smoothstep(0.86, 0.66, N.y));
  vec3 img = mix(plain, im.rgb, im.a);
  // take some of the photograph's own light back out: lift its shadows, hold its highlights
  float lum = dot(img, vec3(0.3, 0.6, 0.1));
  img *= mix(1.25, 0.80, smoothstep(0.015, 0.24, lum));
  img = mix(vec3(dot(img, vec3(0.3, 0.6, 0.1))), img, 0.70);
  // mud and broken ground round the drawn school (part of the simulated exercise)
  float md = smoothstep(46., 18., length(vW.xz - uGlow.xz + vec2(9., -8.) + (texture2D(uDet, vW.xz / 60.).xy - 0.5) * 34.));
  img = mix(img, vec3(0.115, 0.096, 0.074) * (0.45 + 1.1 * texture2D(uDet, vW.xz / 8.3).b), md * 0.88);
  // small bumps from the photograph itself
  float px = uNB.z / 4096.; vec2 du = vec2(px / uNB.z * 1.4, 0.);
  float lx = dot(texture2D(uB, uv + du.xy).rgb - texture2D(uB, uv - du.xy).rgb, vec3(0.33)), lz = dot(texture2D(uB, uv + du.yx).rgb - texture2D(uB, uv - du.yx).rgb, vec3(0.33));
  N = normalize(N - vec3(lx, 0., lz) * (1.5 / (0.06 + lum)) * 0.13 * smoothstep(5200., 900., dist));
  // what the ground is made of
  float green = smoothstep(0.0, 0.022, img.g - max(img.r * 1.0, img.b * 1.04));
  float steep = smoothstep(0.80, 0.60, N.y), rock = clamp(steep * (1. - 0.55 * green) + smoothstep(0.10, 0.24, lum) * 0.25 * (1. - green), 0., 1.);
  vec3 an = abs(N); vec2 side = an.x > an.z ? vW.zy : vW.xy;
  vec4 r1 = mix(texture2D(uDet, vW.xz / 46.), texture2D(uDet, side / 46.), steep), r2 = mix(texture2D(uDet, vW.xz / 9.7 + 0.37), texture2D(uDet, side / 9.7 + 0.37), steep);
  vec4 r0 = mix(texture2D(uDet, vW.xz / 210. + 0.11), texture2D(uDet, side / 210. + 0.11), steep);
  vec4 r3 = texture2D(uDet, vW.xz / 2.7 + 0.19);
  float close = smoothstep(2600., 250., dist), vclose = smoothstep(620., 60., dist);
  vec2 tilt = ((r0.xy - 0.5) * 0.9 + (r1.xy - 0.5) * (0.5 + close) + (r2.xy - 0.5) * vclose * 1.4 + (r3.xy - 0.5) * vclose * 0.9) * (0.35 + 0.95 * rock);
  vec3 Tn = an.x > an.z ? vec3(0., 1., 0.) : vec3(0., 1., 0.), Sn = an.x > an.z ? vec3(0., 0., 1.) : vec3(1., 0., 0.);
  N = normalize(N + mix(vec3(tilt.x, 0., tilt.y), Sn * tilt.x + Tn * tilt.y, steep));
  float strata = sin(vW.y * 0.21 + r0.b * 9. + r1.b * 2.) * 0.5 + 0.5;
  float rh = r0.b * 0.45 + r1.b * 0.35 + r2.b * 0.2;
  vec3 rockC = img * (0.52 + 0.98 * rh) * mix(1., 0.80 + 0.34 * strata, steep * 0.8);
  float lh = r1.a * 0.5 + r2.a * 0.5 * vclose + 0.22 * (1. - vclose), clump = r0.a;
  vec3 vegC = img * (0.34 + 0.80 * lh + 0.34 * clump) * mix(1., 0.62 + 0.85 * r3.a, vclose) * mix(vec3(0.90, 0.98, 0.76), vec3(1.10, 1.02, 0.80), r0.b);
  vec3 soilC = img * (0.66 + 0.42 * rh + 0.24 * r2.a * vclose) * mix(1., 0.72 + 0.6 * r3.b, vclose);
  vec3 alb = mix(mix(soilC, vegC, green), rockC, rock);
  float snow = smoothstep(2750., 3150., vW.y + (r0.b - 0.5) * 500.) * smoothstep(0.56, 0.76, N.y); alb = mix(alb, vec3(0.80, 0.83, 0.88), snow);
  // wet, darker ground just above the water the surge has left
  float ao = mix(0.46, 1.10, nt.b) * mix(1., 0.62 + 0.6 * lh, green * close) * mix(1., 0.55 + 0.75 * rh, rock);
  float sh = sunAt(vW.xz + (r1.xy - 0.5) * 14.);
  vec3 c = shade(alb, N, sh, ao);
  gl_FragColor = vec4(c, 1.);
}`;

export const FAR_VERT = COMMON + /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.); w.y = texture2D(uFH, (w.xz - uFB.xy) / uFB.z).r; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
export const FAR_FRAG = COMMON + /* glsl */ `
uniform sampler2D uFN, uF, uF2; uniform vec3 uF2B; varying vec3 vW;
void main() {
  vec2 nb = (vW.xz - uNB.xy) / uNB.z; if (min(min(nb.x, nb.y), min(1. - nb.x, 1. - nb.y)) > 0.006) discard;
  vec2 uv = (vW.xz - uFB.xy) / uFB.z;
  vec4 nt = texture2D(uFN, uv); vec2 q = (nt.xy * 255. / 127.5) - 1.; vec3 N = vec3(q.x, sqrt(max(0.04, 1. - dot(q, q))), q.y);
  float h = vW.y; vec4 d = texture2D(uDet, vW.xz / 900.), d2 = texture2D(uDet, vW.xz / 210.);
  vec3 plain = mix(vec3(0.040, 0.050, 0.026), vec3(0.15, 0.14, 0.125), clamp(smoothstep(0.82, 0.62, N.y) + smoothstep(1700., 2500., h), 0., 1.));
  vec4 im = texture2D(uF, uv); vec2 q2 = (vW.xz - uF2B.xy) / uF2B.z; float e = smoothstep(0., 0.06, min(min(q2.x, q2.y), min(1. - q2.x, 1. - q2.y)));
  if (e > 0.) { vec4 b = texture2D(uF2, q2); im = im * (1. - b.a * e) + vec4(b.rgb * e, b.a * e); }
  vec3 img = mix(plain, im.rgb, im.a); float lum = dot(img, vec3(0.3, 0.6, 0.1));
  img *= mix(1.5, 0.95, smoothstep(0.01, 0.22, lum));
  vec2 tilt = (d.xy - 0.5) * 0.9 + (d2.xy - 0.5) * 0.7; N = normalize(N + vec3(tilt.x, 0., tilt.y) * 0.75);
  vec3 alb = img * (0.6 + 0.8 * (d.b * 0.5 + d2.b * 0.5));
  float snow = smoothstep(2900., 3500., h + (d.b - 0.5) * 900.) * smoothstep(0.42, 0.70, N.y); alb = mix(alb, vec3(0.80, 0.83, 0.88), max(snow, smoothstep(0.42, 0.7, lum) * step(2200., h)));
  float res = 1., t = 90.; for (int i = 0; i < 11; i++) { vec3 s = vW + uSun * t; res = min(res, 0.6 + 14. * (s.y - texture2D(uFH, (s.xz - uFB.xy) / uFB.z).r) / t); t *= 1.62; }
  float sh = smoothstep(0., 1., res);
  gl_FragColor = vec4(shade(alb, N, sh, mix(0.5, 1.1, nt.b)), 1.);
}`;

// ---------------------------------------------------------------- water
export const WATER_VERT = COMMON + /* glsl */ `
attribute vec4 aWat; attribute vec2 aFlow; varying vec3 vW; varying vec4 vWat; varying vec2 vFlow;
void main() {
  float jit = (texture2D(uDet, position.xz / 320.).b - 0.5) * 90.;
  float s = aWat.y + jit, h = stageAt(s), x = uFront - s, boil = exp(-max(x, 0.) / 240.) * smoothstep(-10., 40., x);
  vec4 n = texture2D(uDet, position.xz / 60. - aFlow * uTime * 0.16), n2 = texture2D(uDet, position.xz / 23. - aFlow * uTime * 0.33);
  float y = aWat.x + h + 4.6 * exp(-pow((x - 34.) / 30., 2.)) * step(-20., x) + boil * ((n.b - 0.5) * 7. + (n2.a - 0.4) * 2.6 + 1.6) + (n2.b - 0.5) * 0.5 * smoothstep(0., 200., x);
  vW = vec3(position.x, y, position.z); vWat = vec4(aWat.x, s, aWat.z, h); vFlow = aFlow;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
}`;
export const WATER_FRAG = COMMON + /* glsl */ `
varying vec3 vW; varying vec4 vWat; varying vec2 vFlow;
vec4 flowTex(float scale, float speed) {
  float t = uTime * speed, a = fract(t), b = fract(t + 0.5); vec2 f = vFlow / max(length(vFlow), 0.2);
  vec2 base = vec2(dot(vW.xz, f) * 0.62, dot(vW.xz, vec2(-f.y, f.x))) / scale; // stretched along the current
  base = mix(vW.xz / scale, base, 0.0);
  vec4 A = texture2D(uDet, base - f * a * 1.1), B = texture2D(uDet, base - f * b * 1.1 + 0.43); return mix(A, B, abs(a * 2. - 1.));
}
void main() {
  float ground = nearH(vW.xz), depth = vW.y - ground, h = vWat.w;
  if (depth < 0.02 || vWat.z > h + 0.8) discard;
  float x = uFront - vWat.y, surge = smoothstep(-6., 30., x), near = exp(-max(x, 0.) / 120.) * surge, dist = distance(vW, uCam);
  vec4 w1 = flowTex(34., 0.34), w2 = flowTex(9., 0.62), w0 = flowTex(120., 0.16);
  float rough = mix(0.22, 0.95, near) + 0.24 * surge;
  vec2 tilt = (w0.xy - 0.5) * 0.4 + (w1.xy - 0.5) * 0.75 + (w2.xy - 0.5) * 0.75 * smoothstep(1400., 150., dist);
  vec3 N = normalize(vec3(tilt.x * rough * 1.7, 1., tilt.y * rough * 1.7)), V = normalize(uCam - vW);
  float sh = sunAt(vW.xz), fres = 0.02 + 0.98 * pow(1. - max(dot(N, V), 0.), 5.);
  // clear glacial river ahead of the front; silt behind it
  float d01 = 1. - exp(-depth / mix(2.6, 1.3, surge));
  vec3 clear = mix(vec3(0.11, 0.15, 0.14), vec3(0.030, 0.072, 0.080), d01), silt = mix(vec3(0.150, 0.118, 0.086), vec3(0.070, 0.054, 0.040), d01) * (0.45 + 0.6 * w0.b + 0.5 * w1.b);
  vec3 body = mix(clear, silt, surge);
  vec3 c = body * (uSunCol * (0.25 + 0.75 * max(dot(N, uSun), 0.)) * sh + uSkyCol * mix(vec3(0.9), vec3(0.95, 0.78, 0.58), surge) * (0.55 + 0.9 * N.y * N.y * N.y));
  vec3 R = reflect(-V, N); R.y = abs(R.y); vec3 H = normalize(V + uSun);
  // the reflected sky is cut down by the valley walls round the water
  vec3 refl = skyCol(normalize(R + vec3(0., 0.35, 0.))) * mix(0.34, 0.62, sh); c = mix(c, refl * mix(0.8, 0.5, surge), fres * mix(0.8, 0.22, surge));
  c += uSunCol * sh * pow(max(dot(N, H), 0.), mix(420., 60., rough)) * mix(2.2, 0.45, rough);
  // foam: the breaking front, streaks carried behind it, and a wet edge against the banks
  float fn = w1.a * 0.55 + w2.a * 0.45, streak = w0.a * 0.6 + w1.b * 0.4;
  float crest = exp(-pow((x - 30.) / 46., 2.)); float foam = max(min(1., near * 1.25) * smoothstep(0.27, 0.52, fn + near * 0.18), crest * smoothstep(0.08, 0.34, fn));
  foam = max(foam, surge * smoothstep(0.60, 0.78, streak * 0.55 + fn * 0.42) * exp(-max(x, 0.) / 900.) * 0.6);
  foam = max(foam, smoothstep(1.2, 0.15, depth) * smoothstep(0.22, 0.52, fn) * (0.35 + 0.55 * surge));
  foam = max(foam, (1. - surge) * smoothstep(0.50, 0.72, fn * 0.6 + w1.b * 0.45) * 0.28);
  vec3 foamC = mix(vec3(0.62, 0.63, 0.62), vec3(0.56, 0.51, 0.45), surge) * (0.62 + 0.7 * w2.b) * mix(1., 1.75, crest);
  c = mix(c, foamC * (uSunCol * sh * (0.35 + 0.65 * max(dot(N, uSun), 0.)) + uSkyCol * mix(vec3(1.05), vec3(1.25, 1.1, 0.95), surge)), clamp(foam, 0., 1.));
  gl_FragColor = vec4(c, smoothstep(0.02, 0.5, depth));
}`;

// Spray thrown up by the front. One point per droplet cloud; everything is worked out here from the time.
export const SPRAY_VERT = COMMON + /* glsl */ `
attribute vec4 aR; uniform vec4 uFP[8]; uniform float uScale, uSprayOn; varying float vA, vL;
void main() {
  float life = fract(uTime * (0.34 + 0.3 * aR.w) + aR.x); int k = int(aR.y * 7.99); vec4 f = uFP[k];
  vec2 dir = vec2(cos(f.w), sin(f.w)), side = vec2(-dir.y, dir.x);
  vec2 p = f.xy + side * (aR.z - 0.5) * 74. + dir * (life * 16. - 6.) + (aR.wx - 0.5) * 12.;
  float y = f.z + 3. + (aR.w * 24. + 4.) * 4. * life * (1. - life) * (0.6 + 0.6 * aR.x);
  vec4 v = viewMatrix * vec4(p.x, y, p.y, 1.); gl_Position = projectionMatrix * v;
  gl_PointSize = min(130., (5. + 13. * life) * uScale / -v.z); vA = uSprayOn * smoothstep(0., 0.12, life) * (1. - life) * (1. - life) * 0.26; vL = sunAt(p);
}`;
export const SPRAY_FRAG = COMMON + /* glsl */ `
varying float vA, vL;
void main() { vec2 q = gl_PointCoord * 2. - 1.; float r = dot(q, q); if (r > 1.) discard; float n = texture2D(uDet, gl_PointCoord * 0.16 + vA).a; float a = vA * (1. - r) * (0.35 + n); gl_FragColor = vec4(vec3(0.70, 0.67, 0.62) * (uSunCol * vL * 0.75 + vec3(dot(uSkyCol, vec3(0.4))) * 1.1), a); }`;

// ---------------------------------------------------------------- trees, buildings, site line
export const TREE_VERT = COMMON + /* glsl */ `
attribute vec4 iPos; attribute vec4 iCol; uniform vec3 uRight, uUp; varying vec2 vUv2; varying vec3 vC, vP; varying float vK, vFoot;
void main() {
  float d = distance(iPos.xyz, uCam), k = smoothstep(2300., 1500., d), size = iPos.w * k;
  vec3 up = normalize(mix(vec3(0., 1., 0.), uUp, 0.28));
  vec3 p = iPos.xyz + uRight * position.x * size * 0.5 + up * (position.y * 0.5 + 0.44) * size;
  p.x += sin(uTime * 1.3 + iPos.x) * 0.012 * size * max(position.y, 0.);
  vUv2 = vec2((floor(iCol.a) + position.x * 0.5 + 0.5) / 3., position.y * 0.5 + 0.5); vC = iCol.rgb; vP = iPos.xyz; vK = k; vFoot = position.y * 0.5 + 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
}`;
export const TREE_FRAG = COMMON + /* glsl */ `
uniform sampler2D uTc, uTn; uniform vec3 uRight, uUp, uFwd; varying vec2 vUv2; varying vec3 vC, vP; varying float vK, vFoot;
void main() {
  vec4 t = texture2D(uTc, vUv2); float a = (t.a - 0.42) / max(fwidth(t.a), 0.0001) + 0.5; if (a < 0.06) discard;
  vec3 m = texture2D(uTn, vUv2).xyz * 2. - 1., N = normalize(uRight * m.x + uUp * m.y - uFwd * m.z);
  float sh = sunAt(vP.xz), wrap = max(0., dot(N, uSun) * 0.75 + 0.25), through = pow(max(dot(uFwd, uSun), 0.), 3.) * 0.95 * t.r;
  vec3 alb = vC * (0.55 + 1.9 * t.r);
  float ao = mix(0.55, 1.05, smoothstep(0.0, 0.8, vFoot));
  vec3 c = alb * ((uSunCol * wrap * sh + uSkyCol * (0.95 + 0.6 * N.y)) * ao + uSunCol * through * sh * vec3(1.1, 1.15, 0.5));
  gl_FragColor = vec4(c, clamp(a, 0., 1.));
}`;
export const BLD_VERT = COMMON + /* glsl */ `
attribute vec4 aInf; attribute vec2 aUv; varying vec3 vW, vN; varying vec4 vI; varying vec2 vU;
void main() { vW = position; vN = normal; vI = aInf; vU = aUv; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`;
export const BLD_FRAG = COMMON + /* glsl */ `
uniform vec4 uGlow; varying vec3 vW, vN; varying vec4 vI; varying vec2 vU;
void main() {
  float r = vI.x, kind = floor(vI.y + 0.5); vec3 alb; float ao = 1.; vec4 d = texture2D(uDet, (abs(vN.y) > 0.5 ? vW.xz : vU) / 5.3);
  vec3 N = normalize(vN);
  if (kind == 0.) { // roofs: tin sheet, mostly grey and faded blue, some rust; flat concrete on some
    alb = r < 0.34 ? vec3(0.15, 0.22, 0.30) : r < 0.52 ? vec3(0.24, 0.115, 0.085) : r < 0.8 ? vec3(0.27, 0.27, 0.265) : vec3(0.36, 0.345, 0.32);
    float rib = sin((r < 0.6 ? vW.x : vW.z) * 8.); alb *= 0.82 + 0.10 * rib + 0.35 * (d.b - 0.5) + 0.15; N = normalize(N + vec3(r < 0.6 ? rib * 0.1 : 0., 0., r < 0.6 ? 0. : rib * 0.1));
  } else if (kind == 1.) { // plastered walls with window openings
    alb = mix(vec3(0.40, 0.375, 0.33), vec3(0.30, 0.31, 0.32), fract(r * 7.)) * (0.8 + 0.4 * d.b);
    vec2 g = vec2(vU.x / 2.9, vU.y / 3.0), f = fract(g); float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.34, f.y) * step(f.y, 0.78) * step(0., vU.y); alb = mix(alb, vec3(0.035, 0.045, 0.055), win); ao *= smoothstep(-2., 3.5, vU.y) * 0.5 + 0.5;
  } else { alb = kind == 2. ? vec3(0.215, 0.212, 0.205) : vec3(0.20, 0.196, 0.188); alb *= 0.5 + 1.0 * d.b; N = normalize(N + (d.xyy - 0.5) * 0.35);
    if (kind == 3.) { vec2 f = fract(vec2(vU.x / 3.4, vU.y / 3.1)); float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.32, f.y) * step(f.y, 0.80) * step(0., vU.y); alb = mix(alb, vec3(0.03), win); ao *= smoothstep(-1., 3., vU.y) * 0.5 + 0.5; } }
  vec3 gl = uGlow.xyz - vW; float gd = dot(gl, gl); // the weak light under the rubble, on the blocks round it
  gl_FragColor = vec4(shade(alb, N, sunAt(vW.xz), ao) + (alb * 0.6 + 0.04) * vec3(1., 0.50, 0.17) * uGlow.w * (0.45 + 0.55 * max(dot(N, gl) / sqrt(gd + 0.01), 0.)) * 9. / (1. + gd * 1.1), 1.);
}`;
// dust over the collapsed corner, and the light itself (a core the rubble hides in part, and a faint halo)
export const DUST_VERT = COMMON + /* glsl */ `
attribute vec4 aR; uniform vec4 uGlow; uniform float uScale, uDustOn; varying float vA, vL;
void main() {
  float life = fract(uTime * (0.035 + 0.04 * aR.w) + aR.x); vec2 p = uGlow.xz + (aR.yz - 0.5) * 26. + vec2(1., 0.45) * life * 11. + sin(uTime * 0.3 + aR.xy * 40.) * 0.8;
  vec4 v = viewMatrix * vec4(p.x, uGlow.y + 0.4 + life * (3. + 7. * aR.w), p.y, 1.); gl_Position = projectionMatrix * v;
  gl_PointSize = min(170., (1.4 + 5. * life) * uScale / -v.z); vA = uDustOn * smoothstep(0., 0.2, life) * (1. - life) * 0.12; vL = sunAt(p);
}`;
export const GLOW_VERT = /* glsl */ `uniform vec4 uGlow; uniform float uScale, uGlowSize; void main() { vec4 v = viewMatrix * vec4(uGlow.xyz, 1.); gl_Position = projectionMatrix * v; gl_PointSize = min(400., uGlowSize * uScale / -v.z); }`;
export const GLOW_FRAG = /* glsl */ `uniform vec4 uGlow; uniform float uGlowGain; void main() { vec2 q = gl_PointCoord * 2. - 1.; float a = max(0., 1. - dot(q, q)); gl_FragColor = vec4(vec3(1., 0.56, 0.22) * uGlow.w * uGlowGain * a * a * a, 1.); }`;
export const CAST_VERT = COMMON + /* glsl */ `
attribute vec4 aInf; varying float vF;
void main() { // the building's footprint pushed along the ground away from the sun
  float up = max(position.y - aInf.z, 0.), t = min(up / max(uSun.y, 0.12), 40.); vec2 p = position.xz - uSun.xz * t; float y = nearH(p) + 0.5; vF = 1.;
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, y, p.y, 1.);
}`;
export const CAST_FRAG = COMMON + /* glsl */ `uniform float uCast; void main() { gl_FragColor = vec4(0.02, 0.03, 0.045, uCast); }`;
export const LINE_VERT = COMMON + /* glsl */ `attribute float aD; varying float vD; varying vec3 vW; void main() { vD = aD; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`;
export const LINE_FRAG = COMMON + /* glsl */ `uniform float uLine; varying float vD; void main() { float run = fract(vD / 420. - uTime * 0.09); float g = 0.55 + 1.6 * exp(-run * 14.); gl_FragColor = vec4(vec3(0.62, 0.82, 1.0) * g * 1.5, uLine * step(vD / 420., uLine * 1.02)); }`;

// ---------------------------------------------------------------- air
export const AIR_FRAG = COMMON + /* glsl */ `
uniform sampler2D uDepth; uniform mat4 uInvVP; uniform float uFrame, uMist; varying vec2 vUv;
void main() {
  float z = texture2D(uDepth, vUv).r; vec4 p = uInvVP * vec4(vec3(vUv, z) * 2. - 1., 1.); vec3 rd = p.xyz / p.w - uCam; float L = length(rd); rd /= L; L = min(L, 8200.);
  float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy + 5.588238 * uFrame, vec2(0.06711056, 0.00583715))));
  float mu = dot(rd, uSun), ph = 0.10 + 0.95 * pow(max(mu, 0.), 5.) + 0.22 * pow(0.5 + 0.5 * mu, 2.);
  vec3 sc = vec3(0.); float T = 1., prev = 0.; const int N = 20;
  for (int i = 0; i < N; i++) {
    float f = (float(i) + j) / float(N), t = L * f * f, dt = t - prev; prev = t;
    vec3 w = uCam + rd * t; vec2 q = clamp((w.xz - uNB.xy) / uNB.z, 0., 1.);
    float fl = texture2D(uFloor, q).r, above = w.y - fl;
    vec2 e = min(q, 1. - q); float inb = smoothstep(0., 0.05, min(e.x, e.y));
    float n = texture2D(uDet, w.xz / 1500. + vec2(uTime * 0.0016, above / 900.)).b * 0.6 + texture2D(uDet, w.xz / 430. + vec2(uTime * 0.004, -above / 320.)).b * 0.4;
    float mist = uMist * inb * exp(-max(above - 18., 0.) / 62.) * smoothstep(0.34, 0.70, n) * 0.0046;
    float bank = uMist * inb * smoothstep(120., 230., above) * smoothstep(430., 270., above) * smoothstep(0.60, 0.80, n) * 0.0022;
    float dens = mist + bank + 0.000022 * exp(-max(above, 0.) / 1100.);
    float lit = sunAt(w.xz + uSun.xz / max(uSun.y, 0.2) * -clamp(above, 0., 520.));
    vec3 L1 = uSunCol * lit * ph * 1.5 + uSkyCol * 0.72 + uHzCol * 0.16; float a = exp(-dens * dt);
    sc += T * (1. - a) * L1; T *= a;
  }
  gl_FragColor = vec4(sc, T);
}`;

export const BRIGHT_FRAG = /* glsl */ `precision highp float; uniform sampler2D uTex; uniform vec2 uPx; varying vec2 vUv; void main() { vec3 c = (texture2D(uTex, vUv + uPx * vec2(-1., -1.)).rgb + texture2D(uTex, vUv + uPx * vec2(1., -1.)).rgb + texture2D(uTex, vUv + uPx * vec2(-1., 1.)).rgb + texture2D(uTex, vUv + uPx).rgb) * 0.25; float l = max(c.r, max(c.g, c.b)); gl_FragColor = vec4(min(c * smoothstep(0.75, 1.9, l), vec3(4.)), 1.); }`;
export const BLUR_FRAG = /* glsl */ `precision highp float; uniform sampler2D uTex; uniform vec2 uDir; varying vec2 vUv; void main() { vec3 c = texture2D(uTex, vUv).rgb * 0.227; c += (texture2D(uTex, vUv + uDir * 1.385).rgb + texture2D(uTex, vUv - uDir * 1.385).rgb) * 0.316; c += (texture2D(uTex, vUv + uDir * 3.231).rgb + texture2D(uTex, vUv - uDir * 3.231).rgb) * 0.0703; gl_FragColor = vec4(c, 1.); }`;

export const FINAL_FRAG = COMMON + /* glsl */ `
uniform sampler2D uScene, uDepth, uAir, uBloom; uniform mat4 uInvVP; uniform vec2 uAirPx; uniform float uExposure, uFade, uFrame; varying vec2 vUv;
float lin(float z) { return 1. / max(1.00001 - z, 1e-6); }
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0., 1.); }
void main() {
  vec3 c = texture2D(uScene, vUv).rgb; float z = texture2D(uDepth, vUv).r;
  vec4 p = uInvVP * vec4(vec3(vUv, z) * 2. - 1., 1.); vec3 rd = p.xyz / p.w - uCam; float L = length(rd); rd /= L;
  if (z < 0.999999) { // aerial perspective: blue scatters in first, warm toward the sun
    float h0 = uCam.y, h1 = uCam.y + rd.y * L, H = 2600., dens = abs(h1 - h0) > 1. ? H * (exp(-max(h0, -400.) / H) - exp(-max(h1, -400.) / H)) / (h1 - h0) : exp(-h0 / H);
    float od = L * dens * 0.000052; vec3 T = exp(-od * vec3(0.62, 0.92, 1.45)); float m = max(dot(rd, uSun), 0.);
    vec3 ins = mix(uSkyCol * 1.05, uHzCol, 0.42) + uSunCol * (0.05 * pow(m, 3.) + 0.12 * pow(m, 14.));
    c = c * T + ins * (1. - T);
  }
  // half-size air, pulled up to full size without bleeding over edges
  vec4 air = vec4(0.); float ws = 0., zl = lin(z); vec2 base = (floor(vUv / uAirPx - 0.5) + 0.5) * uAirPx;
  for (int i = 0; i < 16; i++) { vec2 o = vec2(float(i - (i / 4) * 4), float(i / 4)) - 1.; vec2 q = base + o * uAirPx; vec2 f = abs(vUv - q) / uAirPx; float w = max(0., 2. - f.x) * max(0., 2. - f.y) + 0.001, zq = lin(texture2D(uDepth, q).r); w *= 1. / (0.02 + abs(zq - zl) / zl); air += texture2D(uAir, q) * w; ws += w; }
  air /= ws; c = c * air.a + air.rgb;
  c += texture2D(uBloom, vUv).rgb * 0.16;
  c *= uExposure;
  vec2 v = (vUv - 0.5) * vec2(1.05, 1.); c *= 1. - 0.62 * smoothstep(0.16, 0.62, dot(v, v) * 1.5);
  c = aces(c);
  c = mix(vec3(dot(c, vec3(0.3, 0.59, 0.11))), c, 1.04) * mix(vec3(0.97, 0.99, 1.05), vec3(1.03, 1.0, 0.955), smoothstep(0.15, 0.7, dot(c, vec3(0.33)))); c = mix(c, c * c * (3. - 2. * c), 0.22);
  c = pow(max(c, 0.), vec3(1. / 2.2));
  float g = fract(sin(dot(gl_FragCoord.xy + uFrame, vec2(12.9898, 78.233))) * 43758.5453) - 0.5; c += g * 0.013;
  gl_FragColor = vec4(c * uFade, 1.);
}`;
