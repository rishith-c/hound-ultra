// What each part is. Only statements from docs/FACTS.md, the design study README, wiring.json, assembly.json and the drive firmware.
export const PARTS = [
  { id: 'radio', name: 'Wi-Fi radio', what: 'ESP32-S3 board, the receiver', role: 'Measures how each Wi-Fi probe arrives on 51 subcarriers, 100 times a second.', iface: 'Wi-Fi to the Pi’s hotspot, channel 6, UDP port 5005', power: 'Its own small USB power bank, 5 V', chain: ['Transmitter off the rover', 'This radio', 'Raspberry Pi 4', 'Person or no one'], src: 'FACTS, wiring file' },
  { id: 'radar', name: 'Tracking radar', what: 'HLK-LD2450, 24 GHz', role: 'Tracks a moving person: x, y and speed. It gives the position.', iface: 'Serial (UART) on the Pi header, pins 8 and 10', power: '5 V from the Pi header, pin 4', chain: ['This radar', 'UART', 'Raspberry Pi 4', 'Fusion'], src: 'FACTS, wiring file' },
  { id: 'thermal', name: 'Thermal camera', what: 'MLX90640, 32 by 24 pixels', role: 'Shows body heat.', iface: 'I2C, address 0x33', power: '3.3 V from the Pi header', chain: ['This camera', 'I2C', 'Raspberry Pi 4', 'Fusion'], src: 'FACTS, wiring file' },
  { id: 'webcam', name: 'Webcam', what: 'USB webcam', role: 'Shows the operator what the rover is looking at.', iface: 'USB to the Pi', power: '5 V over USB', chain: ['This camera', 'USB', 'Raspberry Pi 4', 'The operator'], src: 'FACTS, wiring file' },
  { id: 'tof', name: 'Distance sensor', what: 'VL53L1X, one of two', role: 'Distance to walls and obstacles.', iface: 'I2C', power: '3.3 V from the Pi header', chain: ['This sensor', 'I2C', 'Raspberry Pi 4', 'The operator'], src: 'FACTS, wiring file. The front one is drawn.' },
  { id: 'pi', name: 'Raspberry Pi 4', what: 'The computer that runs the network', role: 'Reads every sensor, runs the Wi-Fi neural network and serves the web remote.', iface: 'USB, I2C, UART, Wi-Fi hotspot', power: 'USB power bank, 5 V, up to 3 A', chain: ['Every sensor', 'This computer', 'Person or no one', 'The operator decides'], src: 'FACTS, wiring file' },
  { id: 'uno', name: 'Arduino UNO R4', what: 'Motor controller', role: 'Turns drive commands into steps with a 30 kHz interrupt. Stops the motors by itself 400 ms after the Pi goes quiet.', iface: 'USB serial to the Pi', power: '5 V over USB from the Pi', chain: ['Laptop', 'Raspberry Pi 4', 'This board', 'Motor drivers'], src: 'FACTS, drive firmware' },
  { id: 'drivers', name: 'Motor drivers', what: 'CNC shield with four DRV8825', role: 'Drive the four steppers at 1/32 step. Chosen because the torque check showed A4988 drivers stall on a 5° ramp.', iface: 'STEP, DIR and EN lines from the UNO', power: 'Battery pack, 11.1 V', chain: ['Arduino UNO R4', 'These drivers', 'Four motors', 'Wheels'], src: 'FACTS, design study' },
  { id: 'motors', name: 'Motors and brackets', what: 'Four NEMA 17 steppers, JK42HS40', role: 'One motor for each wheel, 200 full steps a turn.', iface: 'Four wires each, from the drivers', power: 'Battery pack, through the drivers', chain: ['Motor drivers', 'These motors', 'Hubs', 'Wheels'], src: 'FACTS, design study' },
  { id: 'wheels', name: 'Mecanum wheels', what: 'Four wheels, 80 mm', role: 'Rollers at 45° let the rover go forward, sideways and turn in place.', iface: 'Hub on each motor shaft', power: 'None', chain: ['Motors', 'Hubs', 'These wheels', 'The floor'], src: 'FACTS, CAD' },
  { id: 'battery', name: 'Battery', what: '3S 2200 mAh LiPo', role: 'Powers the motors.', iface: 'T-plug lead to the shield’s power terminal', power: '11.1 V nominal', chain: ['This battery', 'Motor drivers', 'Motors', 'Wheels'], src: 'FACTS, wiring file' },
  { id: 'bank', name: 'Power bank', what: 'USB power bank', role: 'Powers the Pi, apart from the motors.', iface: 'USB-C to the Pi', power: '5 V, 3 A', chain: ['This bank', 'Raspberry Pi 4', 'Its USB sensors', ''], src: 'Wiring file' },
  { id: 'bank2', name: 'Radio power bank', what: 'Second USB power bank', role: 'Powers only the Wi-Fi radio. No wire joins it to the rover’s electronics.', iface: 'USB-C to the ESP32-S3', power: '5 V', chain: ['This bank', 'Wi-Fi radio', '', ''], src: 'Wiring file' },
  { id: 'frame', name: 'Frame', what: '2020 V-slot aluminium, four 350 mm rails', role: 'Carries everything.', iface: 'Corner brackets in the slots', power: 'None', chain: [], src: 'FACTS, assembly file' },
  { id: 'deck', name: 'Deck', what: 'Foam board', role: 'Holds the electronics. The CAD drew printed tiles; the rover was built with foam board.', iface: 'Sits on the rails', power: 'None', chain: [], src: 'Photograph' },
  { id: 'mast', name: 'Sensor mast', what: 'Foam board and tape', role: 'Lifts the radar, thermal camera and webcam. The CAD drew a sweeping bridge; it was not fitted.', iface: 'Red tape to the deck', power: 'None', chain: [], src: 'Photograph' },
  { id: 'wiring', name: 'Wiring', what: 'Motor, power and sensor leads', role: 'Routed from the photograph where it can be seen, simplified elsewhere.', iface: 'Dupont, USB, T-plug', power: 'All rails', chain: [], src: 'Photograph, wiring file' },
];
export const SIGNAL = [['radio', 'pi', 'Wi-Fi, UDP'], ['radar', 'pi', 'UART'], ['thermal', 'pi', 'I2C'], ['tof', 'pi', 'I2C'], ['webcam', 'pi', 'USB'], ['pi', 'uno', 'USB'], ['uno', 'drivers', 'STEP, DIR'], ['drivers', 'motors', '4 wires']];
export const POWER = [['battery', 'drivers', 'pack'], ['drivers', 'motors', 'pack'], ['bank', 'pi', 'bank'], ['pi', 'uno', 'usb'], ['pi', 'webcam', 'usb'], ['pi', 'radar', 'bank'], ['pi', 'thermal', 'v3'], ['pi', 'tof', 'v3'], ['bank2', 'radio', 'bank2']];
export const RAILS = [
  { id: 'pack', name: 'Battery pack', v: '11.1 V', feeds: 'Drivers and four motors', color: '--danger' },
  { id: 'bank', name: 'Power bank', v: '5 V', feeds: 'Pi 4, tracking radar', color: '--warn' },
  { id: 'usb', name: 'Pi USB', v: '5 V', feeds: 'UNO R4, webcam, USB adapters', color: '--accent' },
  { id: 'v3', name: 'Pi 3.3 V pin', v: '3.3 V', feeds: 'Thermal camera, distance sensors', color: '--ok' },
  { id: 'bank2', name: 'Radio power bank', v: '5 V', feeds: 'Wi-Fi radio only', color: '--text-2' },
];
export const CHAIN = [
  ['Transmitter', 'A second ESP32-S3, off the rover, sends 100 probes a second.'], ['Receiver', 'The ESP32-S3 on the rover measures each probe on 51 subcarriers.'], ['To the computer', 'Wi-Fi, UDP port 5005. No wire.'],
  ['Window', '10 seconds become 52 values by 200 steps: 51 subcarriers and one motion row.'], ['Network', '23,372 parameters, in NumPy, on the Pi. Trained on simulated people.'], ['Answer', 'Person or no one. Still or moving.'],
];
// drive firmware constants (firmware/r4_drive)
export const FW = { wheelD: 80, lx: 125, ly: 215.5, steps: 200, micro: 32, maxRate: 13500, accel: 600, watchdog: 400, cruise: 415, browser: 600 };
