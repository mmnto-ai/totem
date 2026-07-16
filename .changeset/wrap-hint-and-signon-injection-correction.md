---
'@mmnto/cli': patch
---

Correct two drifted doc/hint surfaces in the scaffolded CLI.

- The `totem wrap` retirement hint no longer instructs the manifest-desyncing `git checkout HEAD -- .totem/compiled-rules.json` rules-file revert (which desyncs the compile-manifest input/output hashes and fails `verify-manifest` at push); it now curates via `totem lesson archive` and stages the `.totem/compiled-rules.json` + `.totem/compile-manifest.json` artifacts, with a pointer to the canonical `.claude/skills/postmerge/SKILL.md` sequence.
- The scaffolded signon skill narrows its SessionStart-injection enumeration to what the hook actually injects (latest journal + carryforward, inbound mail, branch/ticket-matched context, and the bounded session-orientation slice), routing everything else to on-demand `totem orient`.

Consumer impact: docs/skill-template text only, no behavioral change.
