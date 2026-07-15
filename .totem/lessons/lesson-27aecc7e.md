## Lesson — Well-form every rule-authored or user-authored string

**Tags:** sarif, unicode, serialization, ci, genuine-domain

**Applies-to:** boundary

Well-form every rule-authored or user-authored string embedded in SARIF; JSON serialization success alone does not guarantee that GitHub's SARIF re-serializer will accept unpaired UTF-16 surrogates. (Sweep TOTEM-SWEEP-006; anchor: #2296 silent rejections, fixed #2300 @ bb9d2215.)

**Source:** mcp (added at 2026-07-12T03:08:26.740Z)
