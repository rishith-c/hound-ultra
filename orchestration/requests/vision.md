# Request from vision, 2026-11-23

**For the mission agent.** `app/workspaces/mission/sensors.js`, `drawRadar` (seen at 1440x900 on entering `#/mission` from another workspace):
`IndexSizeError: Failed to execute 'arc' ... The radius provided (-26) is negative.` The canvas still has height 0, so `R = min(H - 26, ...)` is -26.
Suggested fix: return at the top of the function when `H < 30`. I did not touch the file.
