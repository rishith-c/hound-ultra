// HOUND probe: an ESP32-S3 that says the same short thing 100 times a second. It carries no data and joins no network. It can sit on the floor, or ride on the drone.
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include <esp_timer.h>
#include "../hound_radio.h"
#ifndef UNIT
#define UNIT 1                                                                // 1 = set down by hand, 2 = on the drone
#endif
static const uint8_t ALL[6] = { 255, 255, 255, 255, 255, 255 };
static volatile uint32_t seq = 0, failed = 0; static esp_timer_handle_t clk;

static void send(void*) { Probe p = { HC_MAGIC, seq, uint32_t(esp_timer_get_time()), UNIT }; seq = seq + 1; if (esp_now_send(ALL, reinterpret_cast<uint8_t*>(&p), sizeof p) != ESP_OK) failed = failed + 1; }

void setup() {
  Serial.begin(115200); WiFi.mode(WIFI_STA); WiFi.disconnect();
  esp_wifi_set_ps(WIFI_PS_NONE);                                              // a sleeping radio would leave holes in the window
  esp_wifi_set_channel(HC_CHANNEL, WIFI_SECOND_CHAN_NONE); esp_wifi_set_max_tx_power(60);   // 15 dBm, a fixed level: the listener must not see our power change
  if (esp_now_init() != ESP_OK) { delay(500); ESP.restart(); }
  esp_now_peer_info_t peer = {}; memcpy(peer.peer_addr, ALL, 6); peer.channel = HC_CHANNEL; esp_now_add_peer(&peer);
  esp_now_rate_config_t rate = {}; rate.phymode = WIFI_PHY_MODE_11G; rate.rate = WIFI_PHY_RATE_6M; esp_now_set_peer_rate_config(ALL, &rate);   // one rate, so every probe is the same shape on the air
  const esp_timer_create_args_t a = { .callback = send, .arg = nullptr, .dispatch_method = ESP_TIMER_TASK, .name = "probe", .skip_unhandled_events = true };
  esp_timer_create(&a, &clk); esp_timer_start_periodic(clk, HC_PERIOD_US);
}
void loop() { delay(5000); Serial.printf("sent %lu failed %lu\n", (unsigned long)seq, (unsigned long)failed); }
