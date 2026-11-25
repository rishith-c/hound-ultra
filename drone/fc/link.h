// HOUND drive link: the frames between the Raspberry Pi and the motor board. Plain C++, no Arduino, so the same file runs in the tests.
//   frame = COBS( type u8 | seq u8 | payload | crc16 little-endian ) then one 0x00 byte
//   CRC-16/CCITT-FALSE over type, seq and payload. A frame that fails the check is counted and dropped, never half used.
#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>

namespace hound {

enum Type : uint8_t { DRIVE = 0x01, STOP = 0x02, CLEAR = 0x03, PING = 0x04, STATUS = 0x81, NAK = 0x82 };
enum Nak : uint8_t { BAD_LENGTH = 1, BAD_TYPE = 2, LATCHED = 3, BAD_KEY = 4, OUT_OF_RANGE = 5 };
constexpr uint32_t CLEAR_KEY = 0x444E4F48;  // "HOND": a stop is only cleared by a frame that says so on purpose
constexpr size_t MAX_BODY = 48;

inline uint16_t crc16(const uint8_t* d, size_t n) {
  uint16_t c = 0xFFFF;
  for (size_t i = 0; i < n; i++) { c ^= uint16_t(d[i]) << 8; for (int b = 0; b < 8; b++) c = (c & 0x8000) ? uint16_t((c << 1) ^ 0x1021) : uint16_t(c << 1); }
  return c;
}

// COBS: no zero byte inside a frame, so a zero always means "end" and a torn frame costs only itself.
inline size_t cobsEncode(const uint8_t* in, size_t n, uint8_t* out) {
  size_t w = 1, code = 0; uint8_t run = 1;
  for (size_t i = 0; i < n; i++) {
    if (in[i]) { out[w++] = in[i]; if (++run == 0xFF) { out[code] = run; code = w++; run = 1; } }
    else { out[code] = run; code = w++; run = 1; }
  }
  out[code] = run; out[w++] = 0; return w;
}
inline int cobsDecode(const uint8_t* in, size_t n, uint8_t* out, size_t cap) {
  size_t r = 0, w = 0;
  while (r < n) {
    uint8_t run = in[r++]; if (!run) return -1;
    for (uint8_t k = 1; k < run; k++) { if (r >= n || w >= cap) return -1; out[w++] = in[r++]; }
    if (run < 0xFF && r < n) { if (w >= cap) return -1; out[w++] = 0; }
  }
  return int(w);
}

struct Frame { uint8_t type, seq, len, body[MAX_BODY]; };

// Feeds on single bytes. Returns true when `f` holds a whole frame that passed its check.
class Reader {
  uint8_t raw[MAX_BODY + 8]; size_t n = 0; bool over = false;
public:
  uint32_t good = 0, bad = 0;
  bool push(uint8_t b, Frame& f) {
    if (b) { if (n < sizeof raw) raw[n++] = b; else over = true; return false; }
    size_t m = n; bool o = over; n = 0; over = false;
    if (!m) return false;
    uint8_t d[MAX_BODY + 4]; int k = o ? -1 : cobsDecode(raw, m, d, sizeof d);
    if (k < 4 || crc16(d, k - 2) != uint16_t(d[k - 2] | (d[k - 1] << 8))) { bad++; return false; }
    f.type = d[0]; f.seq = d[1]; f.len = uint8_t(k - 4); memcpy(f.body, d + 2, f.len); good++; return true;
  }
};

inline size_t build(uint8_t type, uint8_t seq, const uint8_t* body, uint8_t len, uint8_t* out) {
  uint8_t d[MAX_BODY + 4]; d[0] = type; d[1] = seq; memcpy(d + 2, body, len);
  uint16_t c = crc16(d, len + 2); d[len + 2] = c & 255; d[len + 3] = c >> 8; return cobsEncode(d, len + 4, out);
}

inline int16_t i16(const uint8_t* p) { return int16_t(p[0] | (p[1] << 8)); }
inline uint32_t u32(const uint8_t* p) { return uint32_t(p[0]) | uint32_t(p[1]) << 8 | uint32_t(p[2]) << 16 | uint32_t(p[3]) << 24; }
inline void put16(uint8_t* p, int32_t v) { p[0] = v & 255; p[1] = (v >> 8) & 255; }
inline void put32(uint8_t* p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (v >> (8 * i)) & 255; }

}  // namespace hound
