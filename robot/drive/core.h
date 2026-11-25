// HOUND drive core: what the motor board decides, with no hardware in it. Compiled into the UNO R4 sketch and, unchanged, into the tests and the simulator.
//
//   body speed wanted -> limited as one vector -> four wheel speeds -> step pulses, 30,000 times a second
//
// The limits, and where each comes from:
//   ACCEL 0.6 m/s2, DECEL 1.8 m/s2   the drivetrain check of this rover (DRV8825 at 1.5 A keeps torque in hand at both)
//   MAX_SPS 13,500                   90 % of what a 30 kHz step interrupt can pulse
//   WATCHDOG 400 ms                  no good command for this long: ramp to a stop, whatever the Pi is doing
// The rover is moved as ONE vector: if a wheel would be too fast, the whole motion is scaled, so the direction never bends.
#pragma once
#include <stdint.h>
#include <math.h>
#include "link.h"

namespace hound {

enum Wheel { FL, FR, RL, RR };
enum State : uint8_t { PARKED = 0, MOVING = 1, LOST = 2, STOPPED = 3 };
enum Fault : uint8_t { F_WATCHDOG = 1, F_LATCH = 2, F_LOWVOLT = 4, F_CLIPPED = 8, F_BADFRAME = 16 };

struct Vec { float x = 0, y = 0, w = 0; };                                  // m/s forward, m/s left, rad/s counter-clockwise

struct Config {
  float wheelD = 0.080f, lx = 0.125f, ly = 0.2155f;                          // metres: wheel, half wheelbase, half track
  int   stepsPerTurn = 200 * 32;                                             // full steps x microsteps
  float accel = 0.6f, decel = 1.8f, vmax = 0.415f, wmax = 1.2f;              // m/s2, m/s2, m/s, rad/s
  float maxSps = 13500; uint32_t tickHz = 30000, watchdogMs = 400, idleMs = 3000;
  float vLow = 10.5f;                                                        // pack volts, 3.5 V a cell; 0 V read = no divider fitted = not checked
};

class Core {
public:
  Config c;
  explicit Core(const Config& cfg = Config()) : c(cfg) { k = c.stepsPerTurn / (float(M_PI) * c.wheelD); }

  // ---- geometry. Rollers at 45 degrees, X pattern seen from above.
  void wheels(const Vec& v, float s[4]) const {                              // steps a second for each wheel
    float r = (c.lx + c.ly) * v.w;
    s[FL] = k * (v.x - v.y - r); s[FR] = k * (v.x + v.y + r); s[RL] = k * (v.x + v.y - r); s[RR] = k * (v.x - v.y + r);
  }
  Vec body(const float s[4]) const {
    Vec v; v.x = (s[FL] + s[FR] + s[RL] + s[RR]) / (4 * k); v.y = (-s[FL] + s[FR] + s[RL] - s[RR]) / (4 * k);
    v.w = (-s[FL] + s[FR] - s[RL] + s[RR]) / (4 * k * (c.lx + c.ly)); return v;
  }

  // ---- commands
  // A command after a watchdog stop must first ask for zero, so a stuck stick can never set it off again.
  Nak drive(const Vec& want, uint32_t ms) {
    if (!isfinite(want.x) || !isfinite(want.y) || !isfinite(want.w)) return OUT_OF_RANGE;
    if (latched) return LATCHED;
    lastCmd = ms; seen = true;
    bool zero = fabsf(want.x) < 1e-4f && fabsf(want.y) < 1e-4f && fabsf(want.w) < 1e-4f;
    if (lost) { if (!zero) return LATCHED; lost = false; faults &= ~F_WATCHDOG; }
    target = limit(want); return Nak(0);
  }
  void stop(uint8_t why) { latched = true; reason = why; target = Vec(); faults |= F_LATCH; }
  Nak clear(uint32_t key, uint32_t ms) { if (key != CLEAR_KEY) return BAD_KEY; latched = false; faults &= ~F_LATCH; lost = false; faults &= ~F_WATCHDOG; lastCmd = ms; return Nak(0); }
  void volts(float v) { vbat = v; bool low = v > 1 && v < c.vLow; if (low) { lowFor++; } else lowFor = 0; if (lowFor > 20) faults |= F_LOWVOLT; else if (!low && v > c.vLow + .3f) faults &= ~F_LOWVOLT; }

  // Frames in, at most one frame out (0 = nothing to say).
  size_t handle(const Frame& f, uint32_t ms, uint8_t* out) {
    Nak e = Nak(0);
    switch (f.type) {
      case DRIVE: if (f.len != 7) e = BAD_LENGTH; else { Vec v; v.x = i16(f.body) * 1e-3f; v.y = i16(f.body + 2) * 1e-3f; v.w = i16(f.body + 4) * 1e-3f; e = drive(v, ms); } break;
      case STOP: stop(f.len ? f.body[0] : 0); break;
      case CLEAR: e = f.len != 4 ? BAD_LENGTH : clear(u32(f.body), ms); break;
      case PING: return status(f.seq, ms, out);
      default: e = BAD_TYPE;
    }
    if (!e) return 0;
    uint8_t b[2] = { f.type, uint8_t(e) }; return build(NAK, f.seq, b, 2, out);
  }
  size_t status(uint8_t seq, uint32_t ms, uint8_t* out) {
    uint8_t b[40]; float s[4]; wheels(now, s);
    b[0] = state(); b[1] = faults; put16(b + 2, lroundf(now.x * 1000)); put16(b + 4, lroundf(now.y * 1000)); put16(b + 6, lroundf(now.w * 1000));
    for (int i = 0; i < 4; i++) put32(b + 8 + 4 * i, uint32_t(steps[i]));
    put16(b + 24, lroundf(vbat * 1000)); put32(b + 26, ms); b[30] = reason; b[31] = uint8_t(badFrames > 255 ? 255 : badFrames);
    return build(STATUS, seq, b, 32, out);
  }

  // ---- every millisecond: safety first, then the ramp
  void update(uint32_t ms, float dt) {
    if (seen && !lost && ms - lastCmd > c.watchdogMs) { lost = true; faults |= F_WATCHDOG; target = Vec(); }
    Vec t = (latched || lost || (faults & F_LOWVOLT)) ? Vec() : target;
    ramp(t, dt);
    bool still = now.x == 0 && now.y == 0 && now.w == 0;
    if (still) { if (!idleSince) idleSince = ms ? ms : 1; } else idleSince = 0;
    energised = !still || (idleSince && ms - idleSince < c.idleMs);
    float s[4]; wheels(now, s); for (int i = 0; i < 4; i++) rate[i] = s[i];
  }
  State state() const { return latched ? STOPPED : lost ? LOST : (now.x || now.y || now.w) ? MOVING : PARKED; }

  // ---- every tick (30 kHz): which step pins go high and which way each motor faces
  // A step pulse stays high for one whole tick (33 us, the DRV8825 wants 1.9 us) and a direction never changes in the tick of a step (it wants 650 ns).
  void tick(uint8_t& stepMask, uint8_t& dirMask) {
    stepMask = 0;
    for (int i = 0; i < 4; i++) {
      float r = rate[i]; bool fwd = r >= 0;
      if (high & (1 << i)) { high &= ~(1 << i); continue; }                   // let the pulse fall before anything else
      if (fwd != bool(dir & (1 << i)) && r != 0) { dir ^= 1 << i; acc[i] = 0; continue; }
      acc[i] += fabsf(r) / c.tickHz;
      if (acc[i] >= 1) { acc[i] -= 1; high |= 1 << i; stepMask |= 1 << i; steps[i] += fwd ? 1 : -1; }
    }
    dirMask = dir;
  }

  Vec now, target; float rate[4] = {}, acc[4] = {}; int32_t steps[4] = {}; uint8_t faults = 0, reason = 0, dir = 0xF, high = 0; bool energised = false; uint32_t badFrames = 0; float vbat = 0;

private:
  float k; bool latched = false, lost = false, seen = false; uint32_t lastCmd = 0, idleSince = 0; int lowFor = 0;

  Vec limit(Vec v) {
    float sp = hypotf(v.x, v.y), s = 1; if (sp > c.vmax) s = c.vmax / sp;
    if (fabsf(v.w) * s > c.wmax) s = c.wmax / fabsf(v.w);
    float w[4]; wheels(v, w); float top = 0; for (float q : w) top = fmaxf(top, fabsf(q)); if (top * s > c.maxSps) s = c.maxSps / top;
    if (s < 1) faults |= F_CLIPPED; else faults &= ~F_CLIPPED;
    v.x *= s; v.y *= s; v.w *= s; return v;
  }
  static float rim(const Vec& v, float R) { return fmaxf(fabsf(v.x - v.y), fabsf(v.x + v.y)) + R * fabsf(v.w); }   // the fastest wheel rim
  void ramp(const Vec& t, float dt) {
    float R = c.lx + c.ly; Vec d; d.x = t.x - now.x; d.y = t.y - now.y; d.w = t.w - now.w;
    float need = rim(d, R); if (need < 1e-6f) { now = t; return; }
    bool slowing = now.x * d.x + now.y * d.y + R * R * now.w * d.w < 0;
    float step = (slowing ? c.decel : c.accel) * dt, f = need > step ? step / need : 1;
    now.x += d.x * f; now.y += d.y * f; now.w += d.w * f;
    if (f == 1) now = t;
  }
};

}  // namespace hound
