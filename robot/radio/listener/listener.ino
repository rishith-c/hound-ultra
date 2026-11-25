// HOUND listener: an ESP32-S3 on the rover. It measures how every probe arrives on each Wi-Fi channel slice and sends the measurement to the Pi.
// It listens ONLY to our probe. The radio reports every frame it hears, and each sender is a different path through the room: mixed together they would hide a person.
#include <WiFi.h>
#include <WiFiUdp.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include <esp_timer.h>
#include "../hound_radio.h"
#if __has_include("secrets.h")
#include "secrets.h"                                                          // HOUND_SSID, HOUND_PASS, HOUND_SINK. Never in the repository.
#else
#define HOUND_SSID "hound"
#define HOUND_PASS ""
#define HOUND_SINK "10.42.0.1"
#endif
struct Slot { CsiHead h; int8_t iq[128]; };
static Slot ring[16]; static volatile uint8_t wr = 0, rd = 0; static volatile uint32_t heard = 0, full = 0;
static uint8_t from[6]; static volatile bool known = false; static volatile uint32_t lastSeq = 0, lastMs = 0; static volatile uint8_t unit = 0;
static WiFiUDP udp;

static void onProbe(const esp_now_recv_info_t* r, const uint8_t* d, int n) {
  if (n != sizeof(Probe)) return;
  Probe p; memcpy(&p, d, sizeof p); if (p.magic != HC_MAGIC) return;
  uint32_t ms = millis();
  if (known && memcmp(from, r->src_addr, 6) && ms - lastMs < 2000) return;    // one probe at a time: the first one heard keeps the line until it is silent for 2 s
  memcpy(from, r->src_addr, 6); known = true; lastSeq = p.seq; unit = p.unit; lastMs = ms;
}

static void IRAM_ATTR onCsi(void*, wifi_csi_info_t* i) {
  if (!known || !i || !i->buf || i->len < 128 || memcmp(i->mac, from, 6)) return;
  uint8_t nx = (wr + 1) & 15; if (nx == rd) { full = full + 1; return; }      // full: lose this one, never hold up the radio
  Slot& s = ring[wr]; s.h = { { 'H', 'C' }, 2, unit, lastSeq, uint32_t(esp_timer_get_time()), int8_t(i->rx_ctrl.rssi), int8_t(i->rx_ctrl.noise_floor), uint8_t(i->first_word_invalid ? 1 : 0), 64 };
  memcpy(s.iq, i->buf, 128); wr = nx; heard = heard + 1;
}

void setup() {
  Serial.begin(115200); WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true); WiFi.begin(HOUND_SSID, HOUND_PASS, HC_CHANNEL); esp_wifi_set_ps(WIFI_PS_NONE);
  if (esp_now_init() != ESP_OK) { delay(500); ESP.restart(); }
  esp_now_register_recv_cb(onProbe);
  wifi_csi_config_t c = {}; c.lltf_en = true; c.htltf_en = false; c.stbc_htltf2_en = false; c.ltf_merge_en = false; c.channel_filter_en = false; c.manu_scale = false;
  esp_wifi_set_csi_config(&c); esp_wifi_set_csi_rx_cb(onCsi, nullptr); esp_wifi_set_csi(true); udp.begin(HC_PORT);
}
void loop() {
  static uint32_t said = 0;
  while (rd != wr) { Slot& s = ring[rd]; if (WiFi.status() == WL_CONNECTED && udp.beginPacket(HOUND_SINK, HC_PORT)) { udp.write(reinterpret_cast<uint8_t*>(&s), sizeof(CsiHead) + 128); udp.endPacket(); } rd = (rd + 1) & 15; }
  if (millis() - said > 5000) { said = millis(); Serial.printf("heard %lu full %lu wifi %d probe %s\n", (unsigned long)heard, (unsigned long)full, WiFi.status(), known ? "yes" : "no"); }
  delay(1);
}
