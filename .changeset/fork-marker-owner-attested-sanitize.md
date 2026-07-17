---
'@mmnto/totem': patch
---

fork-marker owner/attested (repo content) sanitized before terminal interpolation — same class as the #2400 role/seat fix.

`parseForkMarker`'s `owner`/`attested` attributes are repository content; a hostile `totem:fork` marker could embed ANSI/control sequences and spoof the parity readout. Route both through core `sanitize()` at the `formatForkMeta` interpolation seam (parse output stays raw), mirroring the #2400 role/seat fix; regression test injects CSI sequences into owner/attested and asserts the rendered message is clean.

Consumer-impact: output-sanitization hardening, no behavior change for clean markers.
