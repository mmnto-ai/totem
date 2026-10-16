## Lesson — a count or an absence claim over serialized text uses

**Tags:** measurement, json, grep, artifacts, windows, trap

**Applies-to:** infrastructure

An absence claim over a serialized artifact ("no machine-absolute path remains in any committed artifact under the spike") is measured with the file's ENCODING, never with the string as a human would type it: a Windows path is stored in JSON text as `D:\\\\Dev\\\\…` (each backslash doubled), so a grep for `D:\\Dev` or `D:/Dev` reads zero hits where files still carry it. On mmnto-ai/totem#3095 (2026-10-16) a commit message claimed the machine-path sweep complete on such a grep, and the second falsification read showed `artifacts/lowering-rejects.json` and the two `k4-swap` artifacts still carried the old absolute reason string; the claim was corrected in the next fold and the stale artifacts left to their own regenerating steps, which the pin document records. Rule: a count or an absence claim over serialized text uses a pattern written in that serialization (double the backslashes for JSON, or parse the file and test the decoded strings), and a message that declares a sweep complete names the pattern it ran so the next reader can re-run it. Companion from the same PR: the class-measurement lesson on a same-line grep missing multi-line sites; together, a measurement that supports a claim already drafted is the one to re-take.

**Source:** mcp (added at 2026-10-16T04:59:26.678Z)
