---
'@mmnto/cli': minor
'@mmnto/totem': minor
'@mmnto/mcp': minor
'@mmnto/pack-agent-security': minor
'@mmnto/pack-agent-workflow': minor
'@mmnto/pack-rust-architecture': minor
---

`totem mail send` and `totem mail reply` now guard what they write, on four datums from the cohort (mmnto-ai/totem#2930, mmnto-ai/totem#2929, mmnto-ai/totem#2887, mmnto-ai/totem#2889).

- **Outbox root (mmnto-ai/totem#2930).** The send resolves its repository root the way `mail mark` and the poll do: walking up from the current directory to the nearest `.totem/` or `.git/` marker. A send from `<repo>/tools/` lands in `<repo>/.totem/orchestration/<seat>/outbox/`, where the poll reads it. Before, the outbox root was the current directory itself, so a send from a subdirectory or from the workspace parent minted a `.totem/orchestration/` tree there, printed `Dispatch written` and exited 0 while no poll would ever list the file. **BEHAVIOUR CHANGE:** a start with no marker at or above it is refused (exit 1, the line names the directory) instead of being used as-is.
- **Empty body (mmnto-ai/totem#2887).** An empty or whitespace-only body, from `--body-file` or the body argument, is refused before anything is written; the line names the source and its byte count. **BEHAVIOUR CHANGE:** a send with no body at all used to write a frontmatter-only dispatch and exit 0; it now exits 1. The listing (`totem mail`) flags a served dispatch whose body is empty with a `warning:` line beside its subject, and `--json` entries carry `bodyEmpty`.
- **Reply basenames (mmnto-ai/totem#2929).** A reply's derived basename is `<stamp>-<recipient>-<sender>-<re-subject>`: the sender token leads the topic, so N seats replying to one round kit in the same minute never converge on one basename in the recipient's `processed/` store. `mail reply` gains `--slug`, used verbatim when given (no sender token is added to an explicit slug). Send basenames are unchanged.
- **Recipient-prefixed slugs (mmnto-ai/totem#2889).** A `--slug` that begins with the recipient token is stripped of it, with a warning naming what was stripped, instead of doubling the recipient in the filename; both verbs' `--slug` help text now says the slug is appended after `<stamp>-<recipient>-`.
- **`totem mail verify <path>` (mmnto-ai/totem#2887, ask 3).** Verifies ONE dispatch as written and routable, without listing or reading any other seat's outbox: the frontmatter parses, `to:` is `broadcast` or a roster seat, the body is non-empty, and the file sits at outbox depth 1 of a hosted seat. A failing check exits 1. `send` and `reply` end with the same four checks over the file they wrote and print one `verified:` line. The verb reports written-and-routable, never consumed: consumption is the recipient's mark.
