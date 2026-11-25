// HOUND's drone, flight board: ESP32-S3. Reads the sensors, runs flight.h a thousand times a second, drives four speed controllers, talks to the companion computer.
// The aircraft has not been built. This compiles, and flight.h itself has flown in simulation (drone/sim); the drivers below have never touched their parts.
//
//   ICM-42688-P gyro + accelerometer (SPI)   u-blox GNSS, 10 Hz (UART1)   TF-Luna laser, looking down (UART2)
//   BMP388 barometer, QMC5883L compass (I2C)   pack voltage and current (ADC)   four ESCs, OneShot125   companion (USB serial)
#include <SPI.h>
#include <Wire.h>
#include "board.h"
using namespace hound;

constexpr int PIN_CS = 10, PIN_SCK = 12, PIN_MISO = 13, PIN_MOSI = 11, PIN_SDA = 8, PIN_SCL = 9, GPS_RX = 17, GPS_TX = 18, LASER_RX = 15, LASER_TX = 16, PIN_VOLT = 1, PIN_AMP = 2, ESC[4] = { 4, 5, 6, 7 };
constexpr float VOLT_GAIN = 11.0f, AMP_GAIN = 50.0f;                            // divider, and amps per volt of the current sensor: to be calibrated

static Drone drone; static Talk talk(drone); static SemaphoreHandle_t lock; static TaskHandle_t flyTask; static hw_timer_t* tick;

// ---- gyro and accelerometer
static void imuWrite(uint8_t r, uint8_t v) { digitalWrite(PIN_CS, LOW); SPI.transfer(r); SPI.transfer(v); digitalWrite(PIN_CS, HIGH); }
static bool imuBegin() {
  digitalWrite(PIN_CS, LOW); SPI.transfer(0x75 | 0x80); uint8_t id = SPI.transfer(0); digitalWrite(PIN_CS, HIGH); if (id != 0x47) return false;
  imuWrite(0x4F, 0x06); imuWrite(0x50, 0x06); imuWrite(0x4E, 0x0F); delay(50); return true;                     // 2,000 deg/s, 16 g, 1 kHz
}
static Imu imuRead() {
  uint8_t b[12]; digitalWrite(PIN_CS, LOW); SPI.transfer(0x1F | 0x80); for (uint8_t& v : b) v = SPI.transfer(0); digitalWrite(PIN_CS, HIGH);
  auto at = [&](int i) { return float(int16_t(b[2 * i] << 8 | b[2 * i + 1])); }; constexpr float A = G / 2048, W = 3.14159265f / 180 / 16.4f; Imu m;
  bool dead = true; for (uint8_t v : b) if (v != 0x00 && v != 0xFF) dead = false;
  if (dead) { m.gyro.x = NAN; return m; }                                     // a bus stuck high or low is not a reading
  m.acc = { at(0) * A, at(1) * A, at(2) * A }; m.gyro = { at(3) * W, at(4) * W, at(5) * W }; return m;
}

// ---- barometer, with the maker's compensation
struct Baro {
  double t1, t2, t3, p[12]; bool ok = false; float p0 = 0;
  static uint8_t rd8(const uint8_t* b, int i) { return b[i]; }
  bool get(uint8_t reg, uint8_t* b, int n) { Wire.beginTransmission(0x77); Wire.write(reg); if (Wire.endTransmission(false)) return false; if (Wire.requestFrom(0x77, n) != n) return false; for (int i = 0; i < n; i++) b[i] = Wire.read(); return true; }
  void put(uint8_t reg, uint8_t v) { Wire.beginTransmission(0x77); Wire.write(reg); Wire.write(v); Wire.endTransmission(); }
  void begin() {
    uint8_t id, c[21]; if (!get(0x00, &id, 1) || id != 0x50 || !get(0x31, c, 21)) return;
    auto u = [&](int i) { return double(uint16_t(c[i] | c[i + 1] << 8)); }; auto s = [&](int i) { return double(int16_t(c[i] | c[i + 1] << 8)); }; auto b = [&](int i) { return double(int8_t(c[i])); };
    t1 = u(0) * 256; t2 = u(2) / pow(2, 30); t3 = b(4) / pow(2, 48);
    p[1] = (s(5) - 16384) / pow(2, 20); p[2] = (s(7) - 16384) / pow(2, 29); p[3] = b(9) / pow(2, 32); p[4] = b(10) / pow(2, 37); p[5] = u(11) * 8; p[6] = u(13) / 64; p[7] = b(15) / 256; p[8] = b(16) / 32768; p[9] = s(17) / pow(2, 48); p[10] = b(19) / pow(2, 48); p[11] = b(20) / pow(2, 65);
    put(0x1C, 0x03); put(0x1D, 0x02); put(0x1F, 0x04); put(0x1B, 0x33); ok = true;
  }
  float height() {
    uint8_t d[6]; if (!ok || !get(0x04, d, 6)) return NAN; double up = d[0] | d[1] << 8 | uint32_t(d[2]) << 16, ut = d[3] | d[4] << 8 | uint32_t(d[5]) << 16, a = ut - t1, T = a * t2 + a * a * t3;
    double P = p[5] + p[6] * T + p[7] * T * T + p[8] * T * T * T + up * (p[1] + p[2] * T + p[3] * T * T + p[4] * T * T * T) + up * up * (p[9] + p[10] * T) + up * up * up * p[11];
    if (P < 30000 || P > 120000) return NAN; if (p0 == 0) p0 = P; return 44330.f * (1 - powf(float(P) / p0, .1903f));
  }
} static baro;

// ---- compass: heading with the tilt taken out
static float compass(const Q& q) {
  Wire.beginTransmission(0x0D); Wire.write(0x00); if (Wire.endTransmission(false) || Wire.requestFrom(0x0D, 6) != 6) return NAN;
  int16_t v[3]; for (int16_t& x : v) { uint8_t lo = Wire.read(); x = int16_t(lo | Wire.read() << 8); }
  V3 m{ float(v[0]), float(v[1]), float(v[2]) }; if (m.len() < 200) return NAN; float y = q.yaw(); Q flat{ cosf(y / 2), 0, 0, -sinf(y / 2) }; V3 w = (flat * q).rot(m); return wrap(1.5707963f - atan2f(w.y, w.x) - 3.14159265f);
}

// ---- position: u-blox NAV-PVT, as metres east and north of the first good fix
struct Ubx {
  uint8_t b[100]; int n = 0; bool haveO = false; double lat0, lon0, h0;
  bool push(uint8_t c, V3& p, V3& v, float& sd) {
    if (n == 0 && c != 0xB5) return false; if (n == 1 && c != 0x62) { n = 0; return false; } b[n++] = c;
    if (n == 6 && (b[2] != 0x01 || b[3] != 0x07 || b[4] != 92 || b[5] != 0)) { n = 0; return false; } if (n < 100) return false; n = 0;
    uint8_t a = 0, e = 0; for (int i = 2; i < 98; i++) { a += b[i]; e += a; } if (a != b[98] || e != b[99]) return false;
    const uint8_t* d = b + 6; auto i32 = [&](int o) { return int32_t(u32(d + o)); }; if (d[20] != 3 || !(d[21] & 1)) return false;
    double lon = i32(24) * 1e-7, lat = i32(28) * 1e-7, h = i32(36) * 1e-3; sd = i32(40) * 1e-3f; if (sd > 5) return false; if (!haveO) { lat0 = lat; lon0 = lon; h0 = h; haveO = true; }
    p = { float((lon - lon0) * 111320.0 * cos(lat0 * .0174532925)), float((lat - lat0) * 110574.0), float(h - h0) }; v = { i32(52) * 1e-3f, i32(48) * 1e-3f, -i32(56) * 1e-3f }; return true;
  }
} static ubx;

// ---- laser, looking down: 9-byte frames, 0x59 0x59 distance
static float laser() {
  static uint8_t b[9]; static int n = 0; float r = NAN;
  while (Serial2.available()) { uint8_t c = Serial2.read(); if (n < 2 && c != 0x59) { n = 0; continue; } b[n++] = c; if (n == 9) { n = 0; uint8_t s = 0; for (int i = 0; i < 8; i++) s += b[i]; int amp = b[4] | b[5] << 8, d = b[2] | b[3] << 8; if (s == b[8] && amp > 100 && amp != 65535 && d >= 20 && d <= 800) r = d * .01f; } }
  return r;
}

// Thrust goes with the square of the propeller's speed, and an ESC's command is close to speed. 125 to 250 microseconds, 1,000 times a second.
static void motors(const float* t) { for (int i = 0; i < 4; i++) { float u = drone.armed ? .06f + .94f * sqrtf(clampf(t[i] / drone.c.d.thrustMax, 0, 1)) : 0; ledcWrite(ESC[i], uint32_t((125 + 125 * u) * 16.384f)); } }

static void IRAM_ATTR onTick() { BaseType_t w = pdFALSE; vTaskNotifyGiveFromISR(flyTask, &w); if (w) portYIELD_FROM_ISR(); }
static void fly(void*) {
  uint32_t last = micros(); float yaw = NAN, groundZ = NAN; int k = 0;
  for (;;) {
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(5)); uint32_t now = micros(); float dt = clampf((now - last) * 1e-6f, .0002f, .01f); last = now; Imu m = imuRead();
    xSemaphoreTake(lock, portMAX_DELAY);
    drone.e.imu(m, dt, yaw, isfinite(yaw)); V3 p, v; float sd; while (Serial1.available()) if (ubx.push(Serial1.read(), p, v, sd)) drone.e.fix(p, v, true, fmaxf(sd, .05f));
    if (++k % 50 == 0) { yaw = compass(drone.e.q); float l = laser(), tilt = drone.e.q.rot({ 0, 0, 1 }).z; if (!drone.armed && isfinite(l)) groundZ = drone.e.pos.z - l; if (isfinite(l) && isfinite(groundZ) && tilt > .8f) drone.e.height(groundZ + l * tilt, .05f); else drone.e.height(baro.height(), .4f); }
    float watts = analogReadMilliVolts(PIN_VOLT) * .001f * VOLT_GAIN * analogReadMilliVolts(PIN_AMP) * .001f * AMP_GAIN; if (drone.armed) drone.wh -= watts * dt / 3600;
    drone.step(m.gyro, dt); motors(drone.c.m);
    xSemaphoreGive(lock);
  }
}

void setup() {
  Serial.begin(460800); pinMode(PIN_CS, OUTPUT); digitalWrite(PIN_CS, HIGH); SPI.begin(PIN_SCK, PIN_MISO, PIN_MOSI, PIN_CS); SPI.beginTransaction(SPISettings(10000000, MSBFIRST, SPI_MODE0)); Wire.begin(PIN_SDA, PIN_SCL, 400000);
  for (int p : ESC) { ledcAttach(p, 1000, 14); ledcWrite(p, uint32_t(125 * 16.384f)); } Serial1.begin(115200, SERIAL_8N1, GPS_RX, GPS_TX); Serial2.begin(115200, SERIAL_8N1, LASER_RX, LASER_TX); analogSetAttenuation(ADC_11db);
  baro.begin(); Wire.beginTransmission(0x0D); Wire.write(0x0B); Wire.write(0x01); Wire.endTransmission(); Wire.beginTransmission(0x0D); Wire.write(0x09); Wire.write(0x1D); Wire.endTransmission();
  lock = xSemaphoreCreateMutex(); while (!imuBegin()) { Serial.println("no gyro"); delay(1000); }                         // without a gyro nothing else starts
  xTaskCreatePinnedToCore(fly, "fly", 8192, nullptr, configMAX_PRIORITIES - 2, &flyTask, 1); tick = timerBegin(1000000); timerAttachInterrupt(tick, &onTick); timerAlarm(tick, 1000, true, 0);
}

void loop() {
  static uint32_t at = 0; uint8_t o[MAX_BODY + 8], w[MAX_BODY + 8]; size_t n = 0, m = 0;
  xSemaphoreTake(lock, portMAX_DELAY); while (Serial.available()) talk.heard(Serial.read()); if (millis() - at >= 50) { at = millis(); n = talk.state(at, o); m = talk.words(w); } xSemaphoreGive(lock);
  if (n) Serial.write(o, n); if (m) Serial.write(w, m); delay(1);
}
