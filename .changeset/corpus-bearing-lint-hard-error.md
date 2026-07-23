---
'@mmnto/cli': minor
---

fix(lint): corpus-bearing repos hard-error when compiled rules are unloadable

`totem lint` passed vacuously when the compiled-rules manifest was missing, truncated, or unreadable: `loadCompiledRules` returns `[]` on a missing file, and on a JSON/`SyntaxError` or I/O fault (`EISDIR`/`EACCES`) it fired an optional `onWarn` and returned `[]` — but the lint call site omitted `onWarn`, so even the accounting line was dropped. A repo with a real lesson corpus and hundreds of compiled rules could therefore have its entire enforcement gate silently disarmed behind a green exit.

The lint call site now threads an `onWarn` that both records and renders the load-time warning, and — when zero rules load — discriminates on whether the repo is **corpus-bearing** (does the loaded config declare lesson-kind ingest targets whose globs match real files on disk, a pure git-free filesystem derivation). A corpus-bearing repo whose manifest is missing or unloadable now throws a `TotemError` (non-zero exit) naming the lesson count, the manifest path, and the phrase "enforcement disarmed", with a `totem lesson compile` fix hint. A manifest that is present and valid but filtered to zero ACTIVE rules (all archived / pending-verification / untested-against-codebase) stays an honest info-skip that names the zero-active-rules lifecycle state.

The empty-corpus / early-adoption skip is preserved exactly (mmnto-ai/totem#1831): a repo with no lesson files, or any caller that does not pass its config, keeps today's info-skip. `@mmnto/core`'s `loadCompiledRules` public API and its return-`[]` semantics are unchanged — the enforcement lives entirely at the CLI call site.

First quota item of the Prop 309 hardening program (mmnto-ai/totem-strategy#971).
