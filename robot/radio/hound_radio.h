// What the probe and the listener agree on. Channel 6, because an ESP32 has one radio: the listener is also a client of the rover's hotspot, so both must share a channel.
#pragma once
#include <stdint.h>
constexpr uint8_t  HC_CHANNEL = 6;
constexpr uint16_t HC_PORT = 5005;
constexpr uint32_t HC_PERIOD_US = 10000;                                      // 100 probes a second
constexpr uint32_t HC_MAGIC = 0x31504348;                                     // "HCP1"
struct __attribute__((packed)) Probe { uint32_t magic, seq, us; uint8_t unit; };   // unit: 1 = set down by hand, 2 = the drone

// Listener to Pi, one UDP packet for each probe heard, little-endian:
//   "HC" | version 2 | unit u8 | probe seq u32 | listener us u32 | rssi i8 | noise i8 | flags u8 | n u8 | n x (imag i8, real i8)
// The n pairs are the 64 LLTF subcarriers in the radio's own order. flags bit 0: the radio says the first four bytes are not valid.
struct __attribute__((packed)) CsiHead { char id[2]; uint8_t version, unit; uint32_t seq, us; int8_t rssi, noise; uint8_t flags, n; };
