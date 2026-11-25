# Robot and drone: every case, what should happen, what did

Made by `robot/sim/cases.py` from `robot/sim/results.json`. Everything is simulated: a made-up building, made-up people, made-up readings.
What runs is the code that would run on the machines: the motor board core and the flight board core (compiled C++), their wire frames, the radio packets, the neural network, the fusion, the planner and both missions. Nothing here has been run on the real rover or flown.

Every search must: finish; never close a room with a person in it as empty; never call an empty room a person; never touch a wall; keep the drone more than 0.4 m from walls.

| Case | Runs | What should happen | What happened | Met |
|---|---|---|---|---|
| Two people walking (A, E), a fan (B), a hot pipe (C); light wind | 20 | Every rule above | 39 of 40 people confirmed, 1 flagged for a check, 0 closed as empty, 0 empty rooms called a person, 0 wall touches. A team opens 2.00 rooms (of 5) before everyone is found; in a random order it would be 4.0 | 20 of 20 |
| Two other people (C, D), the fan and pipe moved; light wind | 20 | Every rule above | 40 of 40 people confirmed, 0 flagged for a check, 0 closed as empty, 0 empty rooms called a person, 0 wall touches. A team opens 2.00 rooms (of 5) before everyone is found; in a random order it would be 4.0 | 20 of 20 |
| Three people, one standing still (E); two fans; wind 5 m/s gusting; 10 % of radio packets damaged | 20 | Every rule above | 42 of 60 people confirmed, 18 flagged for a check, 0 closed as empty, 0 empty rooms called a person, 0 wall touches. A team opens 3.65 rooms (of 5) before everyone is found; in a random order it would be 4.5 | 20 of 20 |
| The cable to the motor board is cut while driving | 3 | Stops by itself in a second, goes on when it is back | wheels still after 0.64 s and 0.13 m ("the motor board is silent"); cable back, search finished: 2 of 2 confirmed | 3 of 3 |
| The operator's link drops in the middle of a search | 3 | Holds, keeps finished rooms, goes on when the link is back | stopped 1.3 s after the last word ("holding: no operator for a second"), 1 finished room kept, went on when the operator came back | 3 of 3 |
| The drone never takes off, so there is no Wi-Fi | 3 | No room is called empty, and no one is found | every room ends "not searched" or "possible", 0 called empty, 0 called a person | 3 of 3 |
| The Wi-Fi goes silent while listening, for good | 3 | Blind, not empty: every room goes to the team | reported as "Wi-Fi: no probe heard"; 0 rooms called empty, 0 called a person, all 5 handed to the team | 3 of 3 |
| 30 % of the radio packets are garbage | 3 | Broken packets thrown away, no false person, no one closed as empty | 2804 broken packets thrown away, 0 empty rooms called a person, 0 people closed as empty | 3 of 3 |
| The thermal camera is dead | 3 | Counted as blind, search goes on with Wi-Fi and radar | heat counted as blind; 2 of 2 confirmed by Wi-Fi and radar, 0 flagged | 3 of 3 |
| The map from the drone is damaged, twice | 3 | Refused, asked for again, then searched | 2 bad maps refused, a new one asked for, then searched: 2 of 2 confirmed | 3 of 3 |
| The operator says no to every route | 3 | Recorded by name, search goes on | 2 routes recorded as refused by name, search went on, 5 rooms reported | 3 of 3 |
| The pack runs low while driving | 3 | Stops and holds, keeps finished rooms | "holding: pack at 10.3 V", stopped in 0.18 s, 1 finished room kept, waits for the operator | 3 of 3 |
| All stop is pressed at full speed | 3 | Stops, stays stopped until cleared by hand | stopped in 0.16 s and 0.01 m, stayed stopped until cleared, then finished | 3 of 3 |
| The drone loses its position in flight | 3 | Comes down level, motors off | "no position": came down level and touched at 0.57 m/s, motors off | 3 of 3 |
| The drone loses its link in flight | 3 | Comes home and lands | waited, came back and landed 0.1 m from where it left | 3 of 3 |
| The drone's pack fails half way through | 3 | Drone goes home, readings so far are kept, no room is called empty | drone came home on a failing pack; readings of 2 rooms kept, 0 rooms called empty, 0 called a person | 3 of 3 |

99 of 99 met.

What this does not show: anything on the real machines; real Wi-Fi through real walls; real people. The radar and heat readings follow the makers' sheets and are assumed. A person standing still is the hard case: in the hard search they were confirmed 2 times in 20 and flagged for a check the other 18, never closed as empty.
