### Active Work Summary

The project is at release `@mmnto/cli@1.5.8` with 938 lessons, 350 compiled rules, and 1,934 tests. The 1.6.0 milestone theme is **Pipeline Maturity** — improving rule quality, shield reliability, and bot review workflows.

Recent completed work (1.5.6–1.5.8):

- **Agent Governance (ADR-076 / Proposal 195):**
  - Rule unit testing — inline `**Example Hit:**`/`**Example Miss:**` verification at compile time (#1012)
  - Forbidden native module rules — enforce safeExec, readJsonSafe, GitAdapter usage (#1004)
  - New `core/src/sys/` standard library: `safeExec()`, `readJsonSafe()`, git adapter (13 functions)
- **Codebase Audit Remediation:**
  - Error cause chains (ES2022) across TotemError hierarchy
  - CoreLogger DI — injectable logger replaces `console.warn` in core
  - Phase-gate hooks hardened — `fix/*` exemption removed, warning upgraded to block
  - CRLF fixed with `.gitattributes` + prettier `endOfLine: "lf"`
- **Self-Healing Loop:**
  - Trap Ledger — `.totem/ledger/events.ndjson` append-only telemetry
  - `totem doctor --pr` — autonomous rule downgrading for noisy rules
  - Triage UX Phase 1 — categorized inbox with severity mapping
  - Review-learn — extract lessons from resolved bot findings
- **Shield Hardening:**
  - Context enrichment — full file content for small changed files in shield prompt
  - `--override <reason>` flag — audited bypass for LLM false positives, logged to trap ledger
  - safeExec forced pipe mode, type-safe return guard
  - gh-utils error unwrapping matches safeExec error chain
  - GH_PROMPT_DISABLED on all direct gh invocations
  - Hook paths resolved from git root, not cwd
  - jq for JSON parsing in hooks with grep/sed fallback
  - Hook regex tightened to match git subcommand only
  - `.claude/worktrees/` excluded from prettier
- **Ecosystem:**
  - Unified findings model — `TotemFinding` interface, `deduplicateFindings()`
  - User-defined secrets with DLP at every LLM boundary
  - Language packs — Python, Rust, Go baseline lessons
  - Strategy submodule now runs its own Totem instance

### Prioritized Roadmap

**Bug Fixes (shipped in 1.5.8)**

- ~~#992 — Shield false positive~~ SHIPPED (PR #1019)
- ~~#1006 — safeExec trim crash~~ SHIPPED (PR #1022)
- ~~#1005 — gh-utils error unwrapping~~ SHIPPED (PR #1022)
- ~~#1007 — GH_PROMPT_DISABLED~~ SHIPPED (PR #1022)
- ~~#989 — .spec-completed path~~ SHIPPED (PR #1022)
- ~~#991 — jq hook parsing~~ SHIPPED (PR #1022)
- ~~#1021 — Hook regex too broad~~ SHIPPED (PR #1022)

**Pipeline Integrity (Proposal 195, continued)**

- #1013 — Lesson logic linter — semantic validation for scope/severity/exclusions (tier-1)
- #1010 — Incremental shield validation — diff-only re-check after minor fixes (tier-1)
- #984 — triage-pr and review-learn skip CodeRabbit "outside diff range" findings (tier-1)

**Triage Phases 2–4**

- #957 — Phase 2: Agent Dispatch Integration — atomic triage fixes (tier-1)
- #958 — Phase 3: Interactive CLI — Clack prompts for PR triage
- #959 — Phase 4: Lesson Extraction Pipeline — bot to lesson loop (blocked)

**Enforcement & DX**

- #917 — Exemption engine — unified false positive tracking
- #951 — `totem check` + `totem status` — unified enforcement commands
- #931 — Auto-ticket deferred bot review items

### Completed (1.6.0 milestone)

- #1012 — Rule unit testing (PR #1018)
- #1004 — Forbidden native module lessons (PR #1011)
- #1001 — Error cause chains (PR #1003)
- #995, #996, #998 — safeExec, readJsonSafe, GitAdapter to core (PR #1003)
- #986 — Phase-gate hardening (PR #990)
- #981, #993 — CoreLogger DI, test coverage (PR #985)
- #971, #978, #994 — CI fix, rmSync sweep, dynamic import scoping (PR #982)
- #960, #961 — Trap Ledger + self-healing (PRs #962, #968)
- #956 — Triage Phase 1 (PR #967)
- #955 — Safe-regex validation (PR #977)
- #954 — Dynamic imports in non-command files (PR #977)
- #952 — shield-context deprecation (PR #982)
- #963 — Strip "works cited" during ingest (PR #977)
- #1002 — Test audit global state (PR #1003)

<!-- No blocked items except #959 (Phase 4), which depends on Phases 2-3. -->
