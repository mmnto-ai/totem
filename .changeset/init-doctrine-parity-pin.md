---
'@mmnto/cli': patch
---

feat(cli): `totem init --doctrine` wires `orient.parityManifest` to the installed `@mmnto/strategy-doctrine` pin (Proposal 292 S1). Detects the pin in `node_modules` and writes only the config pointer (no `package.json` mutation); honest-absent when the pin is missing. Lets `totem doctor --parity` sense cohort drift once the manifest package is installed.
