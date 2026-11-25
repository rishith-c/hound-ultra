// The flight board's side of the wire: bytes in, orders to the drone; the drone's state, bytes out. Plain C++, so the simulator speaks the same bytes as the board.
#pragma once
#include <string.h>
#include "flight.h"
#include "link.h"

namespace hound {

enum Msg : uint8_t { WAYPOINT = 0x11, ARM = 0x12, HOME = 0x13, LAND_HERE = 0x14, HEART = 0x15, STATE = 0x91, SAY = 0x92 };

class Talk {
public:
  Drone& d; Reader rd; char said[48] = "";
  explicit Talk(Drone& drone) : d(drone) {}
  void heard(uint8_t byte) { Frame f; if (rd.push(byte, f)) act(f); }
  size_t state(uint32_t ms, uint8_t* o) {                                       // o: at least MAX_BODY + 8 bytes
    uint8_t b[34]; put32(b, ms); b[4] = d.mode; b[5] = d.why; b[6] = uint8_t(d.at); b[7] = d.armed; memcpy(b + 8, &d.e.pos, 12);
    put16(b + 20, d.e.vel.x * 100); put16(b + 22, d.e.vel.y * 100); put16(b + 24, d.e.vel.z * 100); put16(b + 26, d.e.q.yaw() * 1000); put16(b + 28, fmaxf(0, d.wh) * 100); put16(b + 30, clampf(d.watts, 0, 32000)); put16(b + 32, fminf(d.e.sinceFix, 60) * 1000);
    return build(STATE, ++seq, b, 34, o);
  }
  size_t words(uint8_t* o) { if (!said[0]) return 0; size_t n = build(SAY, ++seq, (const uint8_t*)said, uint8_t(strlen(said)), o); said[0] = 0; return n; }
private:
  V3 path[64]; float speeds[64]; uint64_t got = 0; uint8_t pathId = 0, seq = 0;
  static float f32(const uint8_t* p) { float f; memcpy(&f, p, 4); return f; }
  void act(const Frame& f) {
    d.linkAge = 0;
    if (f.type == WAYPOINT && f.len == 19) {                                    // id, index, count, x, y, z, speed. Nothing is flown until every point has arrived.
      uint8_t id = f.body[0], i = f.body[1], n = f.body[2]; V3 p{ f32(f.body + 3), f32(f.body + 7), f32(f.body + 11) }; float s = f32(f.body + 15);
      if (id != pathId) { pathId = id; got = 0; }
      if (n < 1 || n > 64 || i >= n || !p.ok() || !(s > 0 && s <= 8)) { got = 0; tell("bad point"); return; }
      path[i] = p; speeds[i] = s; got |= 1ull << i; if (got == (n == 64 ? ~0ull : (1ull << n) - 1)) { got = 0; d.follow(path, speeds, n); }
    } else if (f.type == ARM && f.len == 4 && u32(f.body) == CLEAR_KEY) { const char* no = d.arm(); tell(no ? no : "armed"); }
    else if (f.type == HOME) d.operatorReturn();
    else if (f.type == LAND_HERE && f.len == 4 && isfinite(f32(f.body))) d.operatorLand(f32(f.body));
  }
  void tell(const char* s) { strncpy(said, s, sizeof said - 1); }
};

}  // namespace hound
