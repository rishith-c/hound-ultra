// The drive core as a small library, so the tests and the simulator run the very code that is on the board. clang++ -O2 -shared -fPIC -o libdrive.dylib shim.cpp
#include "core.h"
#include <vector>
#include <string.h>
using namespace hound;
struct Board { Core core; Reader rd; std::vector<uint8_t> out; uint32_t ms = 0, said = 0; uint8_t seq = 0; int64_t tick = 0; float peak[4] = {0, 0, 0, 0}; long bad = 0; uint8_t last = 0xF, lastStep = 0; };
extern "C" {
Board* board_new() { return new Board; }
void board_free(Board* b) { delete b; }
void board_bytes(Board* b, const uint8_t* d, int n) { Frame f; uint8_t o[64]; for (int i = 0; i < n; i++) if (b->rd.push(d[i], f)) { size_t k = b->core.handle(f, b->ms, o); b->out.insert(b->out.end(), o, o + k); } b->core.badFrames = b->rd.bad; }
int board_read(Board* b, uint8_t* o, int cap) { int n = int(b->out.size()) < cap ? int(b->out.size()) : cap; memcpy(o, b->out.data(), n); b->out.erase(b->out.begin(), b->out.begin() + n); return n; }
void board_volts(Board* b, float v) { b->core.volts(v); }
// one millisecond: one update, thirty ticks. bad counts pulses that break the driver chip's rules.
void board_ms(Board* b) {
  b->ms++; b->core.update(b->ms, .001f);
  for (int i = 0; i < 30; i++) { uint8_t s, d; b->core.tick(s, d); if (s & b->lastStep) b->bad++; if (s & (d ^ b->last)) b->bad++; b->last = d; b->lastStep = s; b->tick++; }
  if (b->ms - b->said >= 50) { b->said = b->ms; uint8_t o[64]; size_t k = b->core.status(b->seq++, b->ms, o); b->out.insert(b->out.end(), o, o + k); }
}
void board_look(Board* b, float* v, int* steps, int* st) { v[0] = b->core.now.x; v[1] = b->core.now.y; v[2] = b->core.now.w; for (int i = 0; i < 4; i++) steps[i] = b->core.steps[i]; st[0] = b->core.state(); st[1] = b->core.faults; st[2] = b->core.energised; st[3] = int(b->bad); }
void core_wheels(float x, float y, float w, float* s) { Core c; Vec v; v.x = x; v.y = y; v.w = w; c.wheels(v, s); }
void core_body(const float* s, float* o) { Core c; Vec v = c.body(s); o[0] = v.x; o[1] = v.y; o[2] = v.w; }
}
