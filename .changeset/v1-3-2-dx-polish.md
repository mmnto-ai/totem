---
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

### DX Polish

- Post-init message for Lite users now dares them to test the engine: "Write an empty `catch(e) {}` block and run `npx totem lint`"
- Hidden legacy commands (`install-hooks`, `demo`, `migrate-lessons`) from `--help` output
- Clean `totem lint` PASS is now one line instead of six
- Added launch metrics to README (3-layer gate, 1.75s benchmark)
- Unix process group cleanup for lint timeout handler (prevents zombie processes)
