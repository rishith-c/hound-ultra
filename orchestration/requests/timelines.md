# Request from timelines

`app/core/sim.js`: please accept a `maxWindows` option in `createEngine` (default 2) instead of the literal `maxWindows = 2`. Timelines sweeps it today by fetching sim.js, rewriting that one default and importing the result. It throws a clear message if the literal changes, so nothing is blocked.
