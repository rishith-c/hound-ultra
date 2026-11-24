# Request from scan
`app/workspaces/mission/sensors.js:33` (`drawRadar`): `arc` gets a negative radius (-26) when drawn while the panel has no size. Seen once, going from #/scan to #/mission in Advanced at 1440x900; it is an uncaught exception, so `--strict` fails. Return early when the radius is not positive.
