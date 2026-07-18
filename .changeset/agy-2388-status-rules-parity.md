---
'@mmnto/cli': patch
---

Ensure `totem status` derives rules count from the `compiled-rules.json` file as the primary source of truth, falling back to the manifest rule count only if the compiled rules file is absent. This prevents the command from erroneously displaying "Rules: 0 compiled" when the compile manifest is absent but compiled rules are present.
