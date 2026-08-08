---
'@mmnto/mcp': patch
'@mmnto/totem': patch
---

Demote the denominator-blind context-pressure warning to a measured size disclosure (#2600): `search_knowledge` no longer claims "you may be at risk of forgetting earlier instructions" (live-falsified at 15% occupancy on a 1M-window seat) — above `contextWarningThreshold` it now appends a self-closing `<size-disclosure chars approxTokens sessionChars sessionCalls />` measurement envelope and leaves the weighing judgment with the consumer, the only party holding the window denominator. `totem_system_warning` remains for conditions the server actually measures (index staleness, degraded retrieval, store failures).
