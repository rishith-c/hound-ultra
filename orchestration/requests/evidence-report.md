# Requests from evidence-report

1. **app/core/sim.js**: `state.coverage[room]` is not refreshed after a second look. `investigate` calls `takeReading` with
   `covers = []`, so at the end of the scripted run `state.coverage['103']` is still `status: 'lead', residual: 0.58` although
   D4 in room 103 is confirmed at 95 %. Evidence works around it in `graph/model.js` and Report in `report/model.js`; any other
   reader of coverage will show the stale value. Suggested: update coverage for the detection's room when `judge` changes its status.
2. **app/core/sim.js**: `detection.updated` moves forward when other detections are judged (D2 and D3 close at 04:18 but end with
   `updated` = 07:52). Do not use it as a closing time; Report now uses the LEAD_CLOSED event.
3. **app/shell.js** (optional): `graph` has a full Demo hero but is not in CHAPTERS. "The proof" is fusion today.
