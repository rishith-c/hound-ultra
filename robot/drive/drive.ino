// HOUND drive board: Arduino UNO R4 WiFi, CNC shield, four DRV8825 at 1/32 step, four NEMA 17, mecanum wheels.
// All the thinking is in core.h. This file only moves pins and bytes. Radio off. Nothing here can make the rover drive without a good command every 400 ms.
#include "FspTimer.h"
#include "core.h"
using namespace hound;

// wheel -> shield axis, as wired: front left Y, front right A, rear left X, rear right Z
static const uint8_t STEP[4] = { 3, 12, 2, 4 }, DIR[4] = { 6, 13, 5, 7 }, EN = 8, VBAT = A3;
static const bool FLIP[4] = { false, true, false, true };                     // the right-hand motors face the other way

static Core core; static Reader rd; static FspTimer timer; static volatile bool running = false;

static void isr(timer_callback_args_t*) {
  uint8_t s, d; core.tick(s, d);
  for (int i = 0; i < 4; i++) { digitalWrite(DIR[i], bool(d & (1 << i)) != FLIP[i]); digitalWrite(STEP[i], (s >> i) & 1); }
}

void setup() {
  for (int i = 0; i < 4; i++) { pinMode(STEP[i], OUTPUT); pinMode(DIR[i], OUTPUT); digitalWrite(STEP[i], LOW); }
  pinMode(EN, OUTPUT); digitalWrite(EN, HIGH);                               // motors off until there is a reason
  analogReadResolution(14); Serial.begin(115200);
  uint8_t type; int8_t ch = FspTimer::get_available_timer(type);
  if (ch >= 0 && timer.begin(TIMER_MODE_PERIODIC, type, ch, float(core.c.tickHz), 0.0f, isr) && timer.setup_overflow_irq() && timer.open() && timer.start()) running = true;
}

void loop() {
  static uint32_t last = 0, said = 0, seq = 0; uint32_t ms = millis(); uint8_t out[64]; Frame f;
  while (Serial.available()) {
    if (rd.push(uint8_t(Serial.read()), f)) { noInterrupts(); size_t n = core.handle(f, ms, out); interrupts(); if (n) Serial.write(out, n); }
  }
  core.badFrames = rd.bad;
  if (ms != last) {
    float dt = (ms - last) * 1e-3f; last = ms; if (dt > .02f) dt = .02f;
    core.volts(analogRead(VBAT) * (5.0f / 16383) * 5.7f);                     // 47k / 10k divider on the pack
    if (!running) core.stop(99);
    noInterrupts(); core.update(ms, dt); interrupts();
    digitalWrite(EN, core.energised ? LOW : HIGH);
  }
  if (ms - said >= 50) { said = ms; noInterrupts(); size_t n = core.status(uint8_t(seq++), ms, out); interrupts(); Serial.write(out, n); }
}
