// HOUND's drone: the flight core. Plain C++, no operating system, no hardware, so it can be compiled for a flight board and, unchanged, for the simulator.
//
//   sensors -> estimate (where am I, which way up) -> guide (where to) -> position -> speed -> tilt -> spin -> four motors
//
// The drone is a concept: this code has flown only in simulation (drone/sim), never on an aircraft.
// Axes: x east, y north, z up for the world; x forward, y left, z up for the body. SI units.
#pragma once
#include <math.h>
#include <stdint.h>

namespace hound {

struct V3 { float x = 0, y = 0, z = 0;
  V3 operator+(V3 o) const { return { x + o.x, y + o.y, z + o.z }; } V3 operator-(V3 o) const { return { x - o.x, y - o.y, z - o.z }; } V3 operator*(float k) const { return { x * k, y * k, z * k }; }
  float dot(V3 o) const { return x * o.x + y * o.y + z * o.z; } V3 cross(V3 o) const { return { y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x }; }
  float len() const { return sqrtf(dot(*this)); } bool ok() const { return isfinite(x) && isfinite(y) && isfinite(z); } };
struct Q { float w = 1, x = 0, y = 0, z = 0;
  Q operator*(Q b) const { return { w * b.w - x * b.x - y * b.y - z * b.z, w * b.x + x * b.w + y * b.z - z * b.y, w * b.y - x * b.z + y * b.w + z * b.x, w * b.z + x * b.y - y * b.x + z * b.w }; }
  Q inv() const { return { w, -x, -y, -z }; } void norm() { float n = 1 / sqrtf(w * w + x * x + y * y + z * z); w *= n; x *= n; y *= n; z *= n; }
  V3 rot(V3 v) const { V3 u{ x, y, z }, t = u.cross(v) * 2; return v + t * w + u.cross(t); } V3 back(V3 v) const { return inv().rot(v); }
  float yaw() const { return atan2f(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)); } };
inline float clampf(float v, float a, float b) { return v < a ? a : v > b ? b : v; }
inline V3 cap(V3 v, float m) { float n = v.len(); return n > m ? v * (m / n) : v; }
inline float wrap(float a) { return atan2f(sinf(a), cosf(a)); }
constexpr float G = 9.80665f;

// The design point, from the sizing calculation (python3 -m aeromech mtow --payload 0.65 --rotors 4 --prop 10 --endurance 22 --cells 6 --chem liion --alt 1800):
// 1.487 kg all up, 3.65 N a rotor and 158.7 W electrical in the hover at 1,800 m. Motors are asked for 8.0 N each at most (thrust to weight 2.2).
struct Design { float mass = 1.487f, arm = .275f, Jx = .0165f, Jy = .0165f, Jz = .0300f, thrustMax = 8.0f, torqueRatio = .0145f, motorTau = .045f, hoverW = 158.7f, packWh = 72.7f; };

struct Imu { V3 gyro, acc; }; struct Fix { V3 pos, vel; float sd = .5f; bool good = false; }; struct Vision { V3 pos; bool good = false; }; struct Range { float up = 0; bool good = false; };

// ---- estimate: gyro for the fast part, gravity and course for the slow part, GPS or the camera for position
class Estimate {
public:
  Q q; V3 pos, vel, bias; float posVar = 4, t = 0, sinceFix = 1e3f, sinceImu = 0;
  void imu(const Imu& m, float dt, float yawRef, bool haveYaw) {
    if (!m.gyro.ok() || !m.acc.ok()) { sinceImu += dt; return; }
    sinceImu = 0; t += dt; sinceFix += dt;
    V3 w = m.gyro - bias, up = q.back({ 0, 0, 1 }); float a = m.acc.len();
    // gravity is trusted only when the push felt is close to 1 g, and after taking out the speed change we know about
    if (a > .7f * G && a < 1.3f * G) { V3 f = m.acc - q.back(accWorld); float n = f.len(); if (n > 1) { V3 e = (f * (1 / n)).cross(up); float k = t < 3 ? 2.f : .25f; w = w + e * k; bias = bias - e * (t < 3 ? .05f : .004f) * dt; bias = cap(bias, .1f); } }
    if (haveYaw) { float e = wrap(yawRef - q.yaw()); w = w + up * (e * .8f); }
    float h = dt * .5f; Q d{ 1, w.x * h, w.y * h, w.z * h }; q = q * d; q.norm();
    V3 acc = q.rot(m.acc) - V3{ 0, 0, G } - abias; pos = pos + vel * dt + acc * (dt * dt * .5f); vel = vel + acc * dt; posVar += dt * dt * .3f + dt * .02f; lastAcc = acc;
  }
  // Position from outside. A jump that neither the drone nor the sensor could have made is refused, and while refusals last the drone has no position (guard() below acts on that).
  bool fix(V3 p, V3 v, bool haveV, float sd) {
    if (!p.ok() || !(sd > 0)) return false;
    V3 e = p - pos; float gate = 4 * sqrtf(posVar + sd * sd) + .8f;
    if (t > 3 && e.len() > gate) { refused++; return false; } refused = 0;
    float k = posVar / (posVar + sd * sd); float dtf = clampf(sinceFix, .005f, .5f); pos = pos + e * k; posVar *= 1 - k;
    if (haveV && v.ok()) { V3 ev = v - vel; vel = vel + ev * .35f; abias = cap(abias - ev * (.05f * dtf * 4), .6f); } else { vel = vel + e * (.6f * k); }
    sinceFix = 0; return true;
  }
  // Height on its own: the laser below 12 m, the barometer always. They keep working when the position does not.
  void height(float z, float sd) { if (!isfinite(z)) return; float e = z - pos.z; if (fabsf(e) < 1.5f + 3 * sd) { float k = clampf(.02f / sd, .01f, .3f); pos.z += e * k; vel.z += e * k * .25f; } }
  V3 accWorld; V3 lastAcc; int refused = 0;
private:
  V3 abias;
};

// ---- control
struct Gains { float pos = 1.1f, vel = 2.6f, velI = .6f, att = 7.0f, yaw = 2.0f, rate = 22.f, rateI = 12.f, rateD = .12f, tiltMax = .52f, vMax = 8, climb = 3, sink = 2; };

class Control {
public:
  Design d; Gains g; V3 iv, iw, lastRate, dFilt; float thrust = 0; float m[4] = { 0, 0, 0, 0 }; bool saturated = false, blind = false; Q want;
  void reset() { iv = iw = dFilt = V3(); }
  // wanted: position, speed on top of it, heading, and whether to hold position or only speed
  void run(const Estimate& e, V3 gyro, V3 pWant, V3 vFeed, float yaw, float dt) {
    V3 err = pWant - e.pos, v = vFeed + err * g.pos; V3 vh = cap({ v.x, v.y, 0 }, g.vMax); v = { vh.x, vh.y, clampf(v.z, -g.sink, g.climb) };
    V3 ev = v - e.vel; if (blind) { ev.x = ev.y = 0; }                          // no position: level, plus the lean that was holding against the wind
    V3 a = ev * g.vel + iv; float amax = G * tanf(g.tiltMax); V3 ah = cap({ a.x, a.y, 0 }, amax); bool sat = ah.len() < V3{ a.x, a.y, 0 }.len() - 1e-3f;
    if (!sat && !saturated) iv = iv + ev * (g.velI * dt); iv = V3{ clampf(iv.x, -3, 3), clampf(iv.y, -3, 3), clampf(iv.z, -4, 4) };
    V3 f{ ah.x, ah.y, clampf(a.z, -.6f * G, .8f * G) + G }; V3 z = f * (1 / f.len());
    V3 zb = e.q.rot({ 0, 0, 1 }); thrust = clampf(d.mass * f.dot(zb), .12f * d.mass * G, 4 * d.thrustMax * .92f);
    V3 xc{ cosf(yaw), sinf(yaw), 0 }, y = z.cross(xc); y = y * (1 / y.len()); V3 x = y.cross(z); want = fromAxes(x, y, z);
    Q qe = e.q.inv() * want; if (qe.w < 0) qe = { -qe.w, -qe.x, -qe.y, -qe.z };
    V3 w{ 2 * g.att * qe.x, 2 * g.att * qe.y, 2 * g.yaw * qe.z }; w = { clampf(w.x, -5, 5), clampf(w.y, -5, 5), clampf(w.z, -1.6f, 1.6f) };
    spin(w, gyro - e.bias, dt);
  }
  void spin(V3 w, V3 rate, float dt) {
    V3 e = w - rate, raw = (lastRate - rate) * (1 / dt); lastRate = rate; float k = dt / (dt + .006f); dFilt = dFilt + (raw - dFilt) * k;
    if (!saturated) iw = V3{ clampf(iw.x + e.x * g.rateI * dt, -20, 20), clampf(iw.y + e.y * g.rateI * dt, -20, 20), clampf(iw.z + e.z * g.rateI * .5f * dt, -8, 8) };
    V3 a = e * g.rate + iw + dFilt * (g.rateD * g.rate * .1f); mix({ d.Jx * a.x, d.Jy * a.y, d.Jz * a.z * .6f });
  }
  // X frame: 0 front left (turns clockwise), 1 front right, 2 rear left, 3 rear right (clockwise). Roll and pitch come first, then thrust, yaw last.
  void mix(V3 t) {
    float L = d.arm * .7071f, r = t.x / (4 * L), p = t.y / (4 * L), y = t.z / (4 * d.torqueRatio), b = thrust / 4, rp[4] = { r - p, -r - p, r + p, -r + p }; saturated = false;
    float hi = -1e9f, lo = 1e9f; for (float v : rp) { hi = fmaxf(hi, v); lo = fminf(lo, v); }
    if (hi - lo > d.thrustMax) { float s = d.thrustMax / (hi - lo); for (float& v : rp) v *= s; hi *= s; lo *= s; saturated = true; }
    if (b + hi > d.thrustMax) { b = d.thrustMax - hi; saturated = true; } if (b + lo < .02f * d.thrustMax) b = .02f * d.thrustMax - lo;
    float room = fmaxf(0.f, fminf(d.thrustMax - b - hi, b + lo)); float ys = clampf(y, -room, room); if (ys != y) saturated = true;
    const float sgn[4] = { 1, -1, -1, 1 }; for (int i = 0; i < 4; i++) m[i] = clampf(b + rp[i] + sgn[i] * ys, 0, d.thrustMax);
  }
  static Q fromAxes(V3 x, V3 y, V3 z) {
    float t = x.x + y.y + z.z; Q q;
    if (t > 0) { float s = sqrtf(t + 1) * 2; q = { s / 4, (y.z - z.y) / s, (z.x - x.z) / s, (x.y - y.x) / s }; }
    else if (x.x > y.y && x.x > z.z) { float s = sqrtf(1 + x.x - y.y - z.z) * 2; q = { (y.z - z.y) / s, s / 4, (x.y + y.x) / s, (z.x + x.z) / s }; }
    else if (y.y > z.z) { float s = sqrtf(1 + y.y - x.x - z.z) * 2; q = { (z.x - x.z) / s, (x.y + y.x) / s, s / 4, (y.z + z.y) / s }; }
    else { float s = sqrtf(1 + z.z - x.x - y.y) * 2; q = { (x.y - y.x) / s, (z.x + x.z) / s, (y.z + z.y) / s, s / 4 }; }
    q.norm(); return q;
  }
};

// ---- what is allowed, and what happens when something stops working
enum Mode : uint8_t { ON_GROUND, CLIMB, FOLLOW, HOLD, RETURN, LAND, CUT };
enum Why : uint8_t { W_NONE, W_DONE, W_LINK, W_BATTERY, W_NOFIX, W_FENCE, W_TILT, W_IMU, W_OPERATOR };
struct Fence { float radius = 180, top = 60; };

class Drone {
public:
  Estimate e; Control c; Fence fence; Mode mode = ON_GROUND; Why why = W_NONE; V3 home, target, feed, ground; float yaw = 0, t = 0, linkAge = 0, wh, reserve = .22f, cruise = 4, safeHeight = 14, modeT = 0; int at = 0, n = 0; V3 path[64]; float speed[64]; bool armed = false, flown = false; float tiltT = 0, watts;
  Drone() { wh = whWas = c.d.packWh; watts = c.d.hoverW; }
  const char* arm() {                                                           // every reason not to fly, checked before the motors turn
    if (e.t < 3) return "still settling"; if (e.sinceFix > .5f || e.posVar > 4) return "no position"; if (e.q.rot({ 0, 0, 1 }).z < .985f) return "not level"; if (e.bias.len() > .06f) return "gyro drifts"; if (!away() && wh < c.d.packWh * .6f) return "pack not full enough"; if (away() && wh < needHome() + reserve * c.d.packWh * .5f) return "not enough left to get home"; if (linkAge > 1) return "no link"; if (!n) return "no path";
    for (int i = 0; i < n; i++) if (V3 h = away() ? home : e.pos; hypotf(path[i].x - h.x, path[i].y - h.y) > fence.radius || path[i].z - h.z > fence.top) return "path leaves the fence";
    if (!away()) home = e.pos; flown = true; ground = e.pos; c.reset(); c.blind = false; smooth = V3(); whWas = wh; watts = c.d.hoverW; armed = true; go(CLIMB, W_NONE); target = { e.pos.x, e.pos.y, path[0].z }; yaw = e.q.yaw(); return nullptr;
  }
  bool away() const { return flown && hypotf(e.pos.x - home.x, e.pos.y - home.y) > 3; }       // set down somewhere out there, to be the probe: home stays where it was
  void follow(const V3* p, const float* s, int k) { n = k > 64 ? 64 : k; for (int i = 0; i < n; i++) { path[i] = p[i]; speed[i] = s[i]; } at = 0; leg0 = e.pos; if (mode == HOLD && why == W_DONE) go(FOLLOW, W_NONE); }
  void operatorReturn() { if (armed && mode != LAND && mode != CUT) go(RETURN, W_OPERATOR); }
  void operatorLand(float z) { if (armed && mode != CUT) { ground = { e.pos.x, e.pos.y, z }; go(LAND, W_OPERATOR); } }   // put the probe down here: the far side of a room
  float needHome() const {                                                      // watt-hours to fly home at cruise and land, with a third on top for wind
    V3 d = home - e.pos; float s = hypotf(d.x, d.y) / cruise + fmaxf(0.f, e.pos.z - home.z) / 1.2f + 8; return 1.33f * fmaxf(c.d.hoverW, watts) * s / 3600; }
  void step(V3 gyro, float dt) {
    t += dt; modeT += dt; linkAge += dt; if (gyro.ok()) lastGyro = gyro; else gyro = lastGyro; if (!armed) { for (float& v : c.m) v = 0; return; }
    float k = dt / 4; watts += ((whWas - wh) * 3600 / dt - watts) * k; whWas = wh;                // what the motors really draw, not what they should
    guard(dt); if (mode == CUT) { for (float& v : c.m) v = 0; return; }
    V3 p = target; feed = V3();
    switch (mode) {
      case CLIMB: if (fabsf(e.pos.z - target.z) < .4f) { at = 0; leg0 = e.pos; go(n ? FOLLOW : HOLD, n ? W_NONE : W_DONE); } break;
      case FOLLOW: p = along(dt); break;
      case RETURN: { V3 h{ home.x, home.y, home.z + safeHeight }; float dh = hypotf(h.x - e.pos.x, h.y - e.pos.y); if (dh > 1.5f && e.pos.z < h.z - 2 && modeT < 12) p = { hold.x, hold.y, h.z }; else { V3 d{ h.x - e.pos.x, h.y - e.pos.y, 0 }; float s = fminf(cruise, dh); feed = dh > .1f ? d * (s / dh) : V3(); p = { e.pos.x, e.pos.y, h.z }; if (dh < 3) { p = h; feed = V3(); } if (dh < .6f && e.vel.len() < .8f) { ground = home; hold = h; go(LAND, why); } } break; }
      case LAND: { float hgt = e.pos.z - ground.z; feed = { 0, 0, hgt > 4 ? -1.2f : -.45f }; p = { hold.x, hold.y, e.pos.z }; if (hgt < .15f && fabsf(e.vel.z) < .25f) { landT += dt; if (landT > .6f) { armed = false; go(ON_GROUND, why); } } else landT = 0; break; }
      default: break;
    }
    V3 df = cap(feed - smooth, 2.2f * dt); smooth = smooth + df; c.run(e, gyro, p, smooth, yaw, dt);
  }
  void go(Mode m, Why w) { mode = m; why = w; modeT = 0; hold = e.pos; landT = 0; if (m == HOLD) target = e.pos; }
private:
  V3 hold, leg0, lastGyro, smooth; float landT = 0, whWas;
  // Stay on the line between two points, not just heading for the next one, and slow down before the corner.
  V3 along(float) {
    V3 b = path[at], d = b - leg0; float L = fmaxf(.01f, d.len()); V3 u = d * (1 / L); float s = (e.pos - leg0).dot(u), left = L - s; float v = fminf(speed[at], sqrtf(2 * 1.2f * fmaxf(0.f, left)) + .15f);
    if (left < .5f) { if (at + 1 < n) { leg0 = b; at++; return along(0); } target = b; if ((e.pos - b).len() < .5f) { go(HOLD, W_DONE); target = b; } return b; }
    feed = u * v; float look = clampf(s, 0, L); if (hypotf(d.x, d.y) > 3) { float want = atan2f(d.y, d.x), e1 = wrap(want - yaw); yaw = wrap(yaw + clampf(e1, -.012f, .012f)); } return leg0 + u * look;
  }
  // Worst first. Each one is something the drone decides alone, because the link may be what is missing.
  void guard(float dt) {
    float up = e.q.rot({ 0, 0, 1 }).z; tiltT = up < .35f ? tiltT + dt : 0; if (tiltT > .35f) { go(CUT, W_TILT); return; }
    if (e.sinceImu > .05f) { go(CUT, W_IMU); return; }
    if (mode == LAND || mode == CUT) return;
    if (e.sinceFix > 4) { ground.z = home.z; c.blind = true; go(LAND, W_NOFIX); return; }
    if (wh < needHome() + reserve * c.d.packWh * .5f && mode != RETURN) { go(RETURN, W_BATTERY); return; }
    if ((hypotf(e.pos.x - home.x, e.pos.y - home.y) > fence.radius + 5 || e.pos.z - home.z > fence.top + 5) && mode != RETURN) { go(RETURN, W_FENCE); return; }
    if (linkAge > 1.5f && mode != RETURN && mode != HOLD) { go(HOLD, W_LINK); return; }
    if (mode == HOLD && why == W_LINK) { if (linkAge < .5f) { leg0 = e.pos; go(FOLLOW, W_NONE); } else if (modeT > 6) go(RETURN, W_LINK); }
  }
};

}  // namespace hound
