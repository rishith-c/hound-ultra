// The drone in the air, simulated: a rigid body with four slow motors, drag, gusting wind and noisy sensors, flown by the real flight core. 1,000 steps a second.
#include "../fc/board.h"
#include <random>
#include <string>
using namespace hound;
struct Sky {
  Drone d; Talk wire{ d }; std::string out; int ms = 0; V3 p, v, w; Q q; float thrust[4] = { 0, 0, 0, 0 }; V3 wind, gust, gw; std::mt19937 rng; std::normal_distribution<float> n{ 0, 1 }; float t = 0, fixT = 0, rngT = 0, gustSd = 0, baro = 0; V3 gyroBias, accBias; float yawOff = 0;
  bool gps = true, link = true, imuOk = true, rangeOk = true; int dead = -1; float drain = 1; float gz = 0, worstTilt = 0, worstVz = 0; V3 jump; bool touched = false;
  Sky(int seed) : rng(seed) { gyroBias = { .004f * n(rng), .004f * n(rng), .004f * n(rng) }; accBias = { .03f * n(rng), .03f * n(rng), .03f * n(rng) }; yawOff = .02f * n(rng); baro = .25f * n(rng); }
  void step() {
    const float dt = .001f; const Design& D = d.c.d; t += dt;
    for (int i = 0; i < 4; i++) { float m = i == dead ? 0 : d.c.m[i]; thrust[i] += (m - thrust[i]) * dt / D.motorTau; }
    float a = dt / 2.5f; gw = gw * (1 - a) + V3{ n(rng), n(rng), n(rng) * .5f } * (gustSd * sqrtf(2 * a)); gust = gw;
    V3 air = v - wind - gust; float T = thrust[0] + thrust[1] + thrust[2] + thrust[3], L = D.arm * .7071f; V3 drag = air * -(.10f + .028f * air.len());
    V3 f = q.rot({ 0, 0, T }) + drag + V3{ 0, 0, -D.mass * G }; V3 acc = f * (1 / D.mass); bool onGround = p.z <= gz && acc.z * dt + v.z <= 0 && T < D.mass * G * 1.02f;
    if (onGround) { acc = V3(); v = V3(); w = V3(); p.z = gz; float y = q.yaw(); q = { cosf(y / 2), 0, 0, sinf(y / 2) }; }
    else {
      V3 tq{ L * (thrust[0] - thrust[1] + thrust[2] - thrust[3]), L * (-thrust[0] - thrust[1] + thrust[2] + thrust[3]), D.torqueRatio * (thrust[0] - thrust[1] - thrust[2] + thrust[3]) };
      V3 h{ D.Jx * w.x, D.Jy * w.y, D.Jz * w.z }, g = w.cross(h); V3 wd{ (tq.x - g.x - .01f * w.x) / D.Jx, (tq.y - g.y - .01f * w.y) / D.Jy, (tq.z - g.z - .02f * w.z) / D.Jz };
      w = w + wd * dt; Q dq{ 1, w.x * dt / 2, w.y * dt / 2, w.z * dt / 2 }; q = q * dq; q.norm(); v = v + acc * dt; p = p + v * dt;
      if (p.z < gz) { worstVz = fminf(worstVz, v.z); p.z = gz; if (v.z < 0) v.z = 0; touched = true; }
      worstTilt = fmaxf(worstTilt, acosf(clampf(q.rot({ 0, 0, 1 }).z, -1, 1)));
    }
    float P = 0; for (float q_ : thrust) P += powf(fmaxf(q_, 0.f) / (D.mass * G / 4), 1.5f) * D.hoverW / 4; d.wh -= (P + 6) * dt / 3600 * drain;
    Imu m; float bad = imuOk ? 0 : NAN; m.gyro = w + gyroBias + V3{ n(rng), n(rng), n(rng) } * .006f; m.acc = q.back(acc + V3{ 0, 0, G }) + accBias + V3{ n(rng), n(rng), n(rng) } * .12f; m.gyro.x += bad;
    d.e.imu(m, dt, q.yaw() + yawOff, true);
    if (gps && (fixT += dt) >= .1f) { fixT = 0; d.e.fix(p + jump + V3{ n(rng), n(rng), n(rng) * 1.4f } * .12f, v + V3{ n(rng), n(rng), n(rng) } * .06f, true, .25f); }
    if (rangeOk && (rngT += dt) >= .05f) { rngT = 0; if (p.z - gz < 12) d.e.height(p.z + n(rng) * .03f, .05f); else d.e.height(p.z + baro + n(rng) * .3f, .4f); }
    if (link) d.linkAge = 0;                                                   // only for the tests that fly without a companion
    d.step(m.gyro, dt); if (++ms % 50 == 0) { uint8_t o[MAX_BODY + 8]; size_t n = wire.state(ms, o); out.append((char*)o, n); n = wire.words(o); out.append((char*)o, n); if (out.size() > 60000) out.clear(); }
  }
};
extern "C" {
Sky* sky_new(int seed) { return new Sky(seed); } void sky_free(Sky* s) { delete s; }
void sky_at(Sky* s, float x, float y, float z) { s->p = { x, y, z }; s->gz = z; s->d.e.pos = s->p; }
void sky_wind(Sky* s, float x, float y, float sd) { s->wind = { x, y, 0 }; s->gustSd = sd; }
void sky_set(Sky* s, int what, float v) { switch (what) { case 0: s->gps = v > 0; break; case 1: s->link = v > 0; break; case 2: s->imuOk = v > 0; break; case 3: s->dead = int(v); break; case 4: s->drain = v; break; case 5: s->d.wh = v; break; case 6: s->jump = { v, 0, 0 }; break; case 7: s->rangeOk = v > 0; break; case 8: s->d.safeHeight = v; break; case 9: s->d.yaw = v; break; case 10: s->d.operatorLand(v); break; } }
void sky_path(Sky* s, const float* xyz, const float* sp, int n) { V3 p[64]; for (int i = 0; i < n && i < 64; i++) p[i] = { xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2] }; s->d.follow(p, sp, n); }
const char* sky_arm(Sky* s) { const char* e = s->d.arm(); return e ? e : ""; }
void sky_bytes(Sky* s, const char* b, int n) { for (int i = 0; i < n; i++) s->wire.heard(uint8_t(b[i])); }
int sky_read(Sky* s, char* b, int cap) { int n = int(s->out.size()) < cap ? int(s->out.size()) : cap; memcpy(b, s->out.data(), n); s->out.erase(0, n); return n; }
void sky_home(Sky* s) { s->d.operatorReturn(); }
void sky_run(Sky* s, int ms) { for (int i = 0; i < ms; i++) s->step(); }
void sky_look(Sky* s, float* o) { const Drone& d = s->d; float v[] = { s->p.x, s->p.y, s->p.z, s->v.x, s->v.y, s->v.z, d.e.pos.x, d.e.pos.y, d.e.pos.z, float(d.mode), float(d.why), d.wh, s->worstTilt, s->worstVz, float(d.at), float(d.armed), s->q.yaw(), s->t }; memcpy(o, v, sizeof v); s->worstTilt = 0; }
}
