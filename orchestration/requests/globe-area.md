# Requests from globe-area

1. `app/shell.js` (openWorkspace, the catch): when a workspace fails, its root stays in #main and `mounted.delete` forgets it, so it is never hidden and the next failure is drawn on top of it. Seen with the network down: "Valley is not built yet" under "Model forge is not built yet". Please remove or hide the failed root when another workspace opens.
2. Same place: a network failure is worded "is not built yet". "could not load; check the connection" would be true.
