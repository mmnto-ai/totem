# Changelog

## 2.12.0

### Patch Changes

- 24af836: The managed `.claude/hooks/gate-wrapper.cjs` (rendered by `totem gate install` from the template in `init-templates.ts`) now passes `killSignal: 'SIGKILL'` on both of its synchronous spawns, the `git` read and the node checker (mmnto-ai/totem#2932). Each spawn already carried a `timeout` derived from the wrapper's deadline, but Node's default kill signal is SIGTERM, which a wedged child can ignore, so on a POSIX seat (the macOS and Linux CI runners, liquid-city) the deadline did not bound the hook: a git or checker that ignored SIGTERM kept the hook past its budget. Now such a child dies at the deadline and the wrapper's spent-budget arm fires (exit 2) inside the budget. On win32 the kill is TerminateProcess whatever signal is named, so nothing changes there. Consumers take the fix by re-scaffolding the committed wrapper with `totem gate install <gate>`; nothing senses a stale wrapper, so an installed wrapper keeps the old behaviour until that runs. The committed wrapper on this repository is regenerated from the template so the two stay byte-identical; a template test pins the option on both spawns and the wrapper to the template, and a POSIX-only behavioural test (skipped on win32) drives the wrapper against a git shim that ignores SIGTERM. No skill text changes.
- 25f9783: `totem legs deposit` admits `QUESTION` as a finding severity (mmnto-ai/totem#2944). The cohort's falsification legs return four classes in practice (BLOCKING, MATERIAL, MINOR, QUESTION) while the deposit schema admitted three, so a leg's question had to be re-typed as MINOR to land and the record was lossy; doctrine's § Typed deposits still names three, and the amendment naming the fourth is owed in the strategy lane. A question is now its own class: counted beside the three (`countLegFindings` gains `question`; a QUESTION is never re-typed as MINOR; a folded QUESTION counts in `folded` like any answered finding), printed on the deposit's summary and on the gate's evidence line, both as `blocking=N material=N minor=N question=N folded=N`, and absent from the covariate `leg:` field for the same reason MINOR is (the round rules on blocking and material). `LegFindingCounts` gains the required member `question`, which is why this is a minor bump. The deposit verb stamps the writer's schemaVersion, `1.1.0`, on a findings file that carries no label or a 1.x label; a file that declares another major, or a value that is not a version, is refused with both versions named, never relabeled and accepted (the review round on mmnto-ai/totem#2964). Readers accept any 1.x; a 1.0 reader (a CLI before this change) refuses a deposit that carries a QUESTION as corrupt with the reason named, and the gate then finds no deposit for the head and blocks a legs-owed push, so a worktree whose dist predates this change, or a seat whose resolved `totem` is an older global, blocks on such a deposit until it is rebuilt or updated. The falsification-leg agent definition and the CLI reference in this repository name the fourth class.
- a59106f: `totem mail send --workspace <path>` and `totem mail reply <source> --workspace <path>` now reach the library (mmnto-ai/totem#2939). The parent `mail` command declares `--workspace` for the poll, and Commander lets a parent claim its option even when it is typed after a subcommand, so the flag landed on the parent's scope and the lib saw `workspace: undefined`; the recipient validation then fell back to `TOTEM_WORKSPACE` or the parent of the repo root, and a consumer whose workspace is elsewhere got the unknown-recipient warning it had tried to avoid. The two actions read `workspace` back through `optsWithGlobals`, exactly as the poll and `mail verify` actions do (the mmnto-ai/totem#2097 seam); every other option is read from the subcommand's own scope as before. The Commander wiring mirror gains `mail send` and the `--workspace` cases for send and reply in both flag positions.
- 6720b30: `totem orient` (both surfaces) renders the two sources' entries for one freeze as ONE parked line (mmnto-ai/totem#2937). The PARKED section is the union of `.totem/freeze.json` and the distributed `@mmnto/strategy-doctrine` snapshot, and a repo whose local file carries the cohort hold's `id` printed the one freeze twice: on a consumer that keeps a CI-visible local mirror (totem) and on the publisher whose local registry IS the hold the snapshot was cut from (totem-strategy). The union itself is unchanged (core's `readEffectiveFreezes` stays undeduplicated by contract; `verify-manifest` and `doctor` read it as such); orient's derivation folds a local entry whose `id` a cohort entry also carries into one line that names both provenances. Which side renders follows the local entry's own `scope`: on a consumer (`local`) the cohort hold's fields render as `[local mirror + cohort@0.1.49]` (the full surface: `[local mirror + cohort @ strategy-doctrine 0.1.49]`); on the publisher (`cohort`) the local source's fields render as `[local source + cohort@0.1.49]`. The count reads 1. When the two sides differ on a bound field (`subsystem`, `since`, `do-not`, the last compared as a sorted list with absent as empty), the line is flagged `⚠ local mirror differs (since)` on a consumer or `⚠ snapshot differs (since)` on the publisher; prose fields (`reason`, `tracking`) are not compared. The role is read from the local entry's `scope` alone: a consumer that copied the publisher's entry verbatim, `scope: "cohort"` included, would render as the source (today's one consumer mirror, totem's, is scoped `local`, and its note names the cohort registry as the change authority). A local id the snapshot lacks, or the reverse, stays its own line, and id-less entries never collapse. The JSON report's parked entries gain `id`, `mirroredLocally`, `localRole` and `mirrorDrift`, and the collapsed side's own row (its `reason`, `tracking` and provenance) no longer appears. `totem doctor`'s freeze row still lists both entries with their provenance tags: mmnto-ai/totem#2958.
- cb8de47: The mail reader verbs resolve the repository the way the send does — the same toplevel preference and the same three refusals — and refuse to read or write anywhere else (mmnto-ai/totem#2938, mmnto-ai/totem#2946, mmnto-ai/totem#2968). Two edges still differ and are disclosed, not cured here: the home directory (the reader excludes it from both walker arms, the send does not — its own exclusion is a follow-up), and a `.totem`-only tree with no `.git` at any height (the reader serves it as a bare fixture, the send refuses it as "not inside a repository"). The temp directory itself (`os.tmpdir()`, whatever `TMPDIR`/`TEMP` names) is excluded the same way — a phantom `%TEMP%/.totem` is where the old cwd-based send minted — so a start under it with no marker of its own between is refused rather than served from the stray, while a fixture below it, leaked or live, still anchors; a stray `.totem/` elsewhere outside any repository (`/srv/.totem`, or `/tmp/.totem` where the temp directory is not `/tmp`) is not distinguishable from a bare fixture by shape and still anchors the `.totem`-only arm, and a `TEMP` that names a checkout's own root leaves that root anchoring nothing — both named residue. A `.git` entry the walk found but cannot stat is refused rather than guessed into a class. Core's `findTotemRepoRootSync` now prefers the nearest `.git` toplevel (a directory, or a linked worktree's file) over a nearer `.totem/`: a `.totem/` a tool minted under a subdirectory (`packages/cli/.totem/temp`, a committed fixture's `.totem`, a phantom `apps/<x>/.totem/orchestration/`) no longer captures a verb run beneath it — a poll from `<repo>/packages/cli` read an empty workspace as clean and a mark landed in a store no poll drains. A `.totem`-only tree with no `.git` at any height still resolves to its nearest `.totem/`, so bare fixtures keep working, except that the home directory anchors neither arm — its `~/.totem` is the user-level store and a `~/.git` is a dotfiles repository, and on a host that keeps either a verb run outside any repository used to resolve the home directory as its repo root (the comparison canonicalises both sides, so a Windows 8.3 short spelling of home cannot slip past it); every consumer of `resolveTotemRepoRootSync` (`seat`, the doctor's seat-identity row, `deriveSeat`) inherits the preference. Two new core exports classify what the walk landed on — `classifyTotemRepoRootSync` (`toplevel`; `unmarked`, a `.git` toplevel with no real `.totem/`; `worktree`, with the resident named from the `.git` file's `gitdir:` pointer, the bare store itself for a worktree of a bare repository; or `none`) and `mainCheckoutFromGitFileSync` — and a new error code, `REPO_ROOT_REFUSED`, exits `2` at the CLI (the NOT-DERIVED family; the `ecl-gc` boundary now prints the hint beside the refusal). The poll, `mail mark`, `ecl-gc` and its compaction now refuse the `none` class (outside any repository the old fallback used the start itself: "inbox clean" over nothing, or a phantom `processed/` tree minted there), the `worktree` class (a worktree hosts no seat and no poll enumerates it; a mark from one mints a store the resident never drains, so the source stays unread forever) and the `unmarked` class (a repository that is not a Totem repository — the send already refuses it; a mark from one minted `<repo>/.totem/orchestration/<seat>/processed/`, the same phantom through a third door) before anything is read or written, each with one line naming the checkout to run from. `pollMail` throws for this one case; its never-throws contract for filesystem failures otherwise stands, and the SessionStart hook's `pollInboundMail` already catches it into a `scanError`. `totem doctor` gains the gate-exempt "Stray Markers" row, rooted at the repository toplevel: minted `.totem/` residue (untracked by git) warns with the remedy, committed fixture markers (tracked) are named and pass, a marker whose tracking git could not answer is named as unchecked with the probe's error (never called residue or fixture on a failed probe), a nested repository's own marker is neither, a multi-segment configured `totemDir` (`state/totem`) is matched on its trailing segments while the literal `<repo>/.totem` the mail verbs keep their store under stays a root marker whatever `totemDir` says, the tracking probe runs with git's location variables scrubbed so a hook's `GIT_DIR` cannot point it at another index, and a sweep its bounds stopped or that skipped an unreadable directory says so (the breadth bound aborts the sweep, the depth bound prunes only the branch it hit). Minor for cli and core: two new core exports, a new error code, a changed resolution rule for every walker consumer, and a refusal where three verbs previously read an empty workspace as clean or minted a phantom store. No skill text changes; the review-reply skill's recipe (mmnto-ai/totem#2925) still says to run the mark from the resident checkout, and its clause about what a worktree mark did before this fix reads as history once both land.
- 3a8539d: `totem review` (and the pre-push review fan) cuts an over-window code diff on a boundary, keeps its coverage, and says what it dropped (refs mmnto-ai/totem#2954). A filtered diff longer than the 50,000-char window used to be sliced wherever the count fell, mid-hunk or mid-line, and followed by a marker that named only the limit. Now one helper, `truncateDiffForReview` in `shield-templates.ts`, serves every assembly site and the fan's delivered-segment fallback. The cut prefers structure but never at the cost of coverage: the latest file or hunk boundary within the window is taken when it delivers at least nine tenths of the window (a hunk boundary only when a whole hunk of the same file precedes it); else the last line boundary when it delivers at least half and does not leave a file as a bare header (then the file boundary before that header when it clears the half, else the window); else a hard character cut at the window. The marker names the delivered and total sizes, the boundary kind, the file shown in part and the whole files not shown (the first twelve by name, then a count): `... [diff truncated: N of M chars delivered, cut at a file boundary; 3 file(s) not shown: a.ts, b.ts, c.ts] ...`. File names come from each file's `+++` operand (quoting, `a/` and `b/` prefixes and a trailing CR stripped; a deleted file by its `---` operand; a rename with hunks by its new path; a pure rename by its `rename to` line; a hunk-less header by its `b/` side). A truncated prompt also carries a `=== DIFF TRUNCATION NOTICE ===` section AFTER the `<git_diff>` block; the only diff-derived text in it is the file names. The review command warns on the DELIVERED size after file filtering, naming the cut, where the resolver's warning speaks of the raw pre-filter diff (its text now says so and names its lint and estimate callers). An unextractable lane abstention over a truncated payload names the cut in its persisted reason. The marker's head `... [diff truncated` is unchanged.

  What this proves and what it does not: for a diff longer than the window the delivered content is never shorter than half the window; it ends on a file, hunk or line boundary except when only a cut at the window delivers that half; and the marker describes the cut, the file shown in part and the files omitted (names under git's default `a/` and `b/` prefixes; `diff.noprefix` and mnemonic prefixes are not decoded, and nothing parses the marker). The persisted `<git_diff>` bytes equal the helper's output on both the extraction path and the fallback for a diff carrying no `</git_diff>` tag (`wrapXml` escapes that one tag inside the block; the fallback hashes the unescaped bytes, a pre-existing gap). Whether the Gemini lane now extracts a verdict from a truncated payload (the symptom mmnto-ai/totem#2954 measured on the strategy seat) is not measured here; the issue stays open for that measurement, and a zero-completed fan still hard-errors before any override.

- 4e2c4a2: Skill-changing: the distributed `review-reply` skill carries the completion recipe for a bus audit (mmnto-ai/totem#2925). The skill said how a round is triaged and dispositioned on GitHub and nothing about how a reviewer ENDS a blind-round audit on the bus, and a liquid-city seat with `mail reply --help` in front of it still used separate send and mark calls for five audits. The rendered skill now says: a finished audit or round deposit ends with `totem mail reply <source dispatch path> --body-file <deposit>`, one call that sends the reply into your own outbox and writes the `processed/` mark for the source under the resident checkout that hosts the seat; `--no-mark` stages the reply and leaves the source unread for a later `totem mail mark <source>`; both calls run from that resident checkout, never a worktree (the reply refuses one; a standalone mark from one mints a phantom store, mmnto-ai/totem#2968); never a hand-written mark, never a separate send followed by one; the source path is the `read:` line under the item in `totem mail`'s listing (`filePath` under `--json`). The surface is review-reply rather than signoff because the recipe ends a ROUND, which review-reply owns (its disposition step is where a reviewer finishes), while signoff ends a session and signon begins one; the skill's one-line description now names the recipe so a seat ending an audit is routed to it. The constants test locks the clause. Every cohort repository takes it at its next skill re-render; strategy's skills lock compares the working-tree skills to the installed CLI constant and flips on every open strategy PR at this cut, so it rides a cut with no open strategy PR.
- b628803: `totem spec <issue-url>` fetches the issue from the repository the URL names (mmnto-ai/totem#2943). A URL's owner and repository were dropped and the number resolved against the working directory's repository: when that repository had no issue of the number the run failed with an authentication hint, and when it had one the run silently anchored on the wrong issue, which the strict pre-commit tier then accepted as an anchored run. One parser, `parseIssueInput`, now reads the three forms: a bare number (this repository, or every repository under `config.repositories`), `owner/repo#N`, and an issue URL (`github.com` gives `owner/repo`; another host gives `host/owner/repo`, the form `gh --repo` takes). The fetch runs against the named repository and never falls back to the working directory's, the log line says which repository the issue was fetched from, and an issue fetch's failure hint puts a wrong repository before authentication (other `gh` callers keep the generic hint; the hint is measured at the adapter). The anchor's `ref` still keeps the input as typed, so the run artifact and the gate's evidence line name the URL; the resolved repository is not written into the artifact separately.

  The URL rule is exact (the review round on mmnto-ai/totem#2965): the path before `/issues/` is exactly `owner/repo`, the number ends its path segment (a query, a fragment or a slash may follow; `/issues/7abc` is not issue 7), the host is lower-cased and github.com's `www.` alias is folded so the repository reaches `gh --repo` in its canonical `owner/repo` form (gh resolves the alias as well; the form is kept canonical rather than relied on), and GitLab's `/-/issues/<n>` form is refused by name rather than handed to `gh` as a host it cannot read. A GitLab URL in the legacy `/issues/<n>` form is indistinguishable from a GitHub Enterprise host and reaches `gh`, which fails on it; a port or user info in a host reaches `gh` verbatim, as it does through `host/owner/repo#N`. Every `http(s)://` input is an issue URL or an explicit refusal naming the reason and the accepted forms — never a free-text topic, which was an unanchored draft wearing an issue's clothes, and never read as `owner/repo#N` either, so `…/a/b/c/issues/5#7` is refused for its path instead of being accepted as issue 7 of a URL. The refusal is judged over every input before the config resolves, before the store connects and before the first fetch; a URL without a scheme stays a topic. The default draft path keys on the repository the input named — `.totem/specs/<owner>_<repo>-<number>.md`, lower-cased, a host joining as `<host>_<owner>_<repo>`, for `owner/repo#N` or a URL; `<number>.md` for a bare number as before. The `_` join keeps the common collisions apart (`a-b/c` and `a/b-c` get different stems) but is not unique in general: a repository name may contain `_`, an Enterprise Managed User's handle does, and punctuation sanitizes to dashes, so two repositories can still share a stem — `--out` names a path. Dot segments in a URL (`.` and `..`) are taken literally, never normalized as a browser would; pass the canonical URL.

## 2.11.1

### Patch Changes

- 0279dee: The authored whitelist (`packages/cli/src/commands/authored-whitelist.ts`) gains the Gate 5 batch-1 class set: five `(ast-grep, structuralClass)` rows delivered as data by the scorer (strategy-claude's dispatch of 2026-09-24T00:28:55Z, set `gate5-2263305c` batch 1) — `forbidden-callee-call`, `static-import-from-module`, `catch-without-rethrow`, `type-assertion-on-call`, `forbidden-constructor-throw`, in that order. Ten registry rows with the shipped five; no class name repeats and none sits under two engines, so the predicate's exactly-one match and the load-time duplicate guard both hold. The set id is `static-whitelist@gate5-6cba5706`: the first 8 hex of the sha256 over ONE compact JSON array of the five rows in committed order (`JSON.stringify` of `{ engine, structuralClass }` objects, key order engine then structuralClass, no whitespace, no trailing newline; the dispatch's pretty-printed block is not the input). The batch-1 intake pin passes it as `--judged-by` explicitly, and a unit test pins the rows, their order, their position after the shipped five and the id. Data only: no mechanism, option, output format or default (`static-whitelist@cert-1`) changes; an envelope entry declaring one of the five pairs is now decidable (minted) where it was rejected with exit 1.

## 2.11.0

### Minor Changes

- 8d96f54: `totem mail send` and `totem mail reply` now guard what they write, on four datums from the cohort (mmnto-ai/totem#2930, mmnto-ai/totem#2929, mmnto-ai/totem#2887, mmnto-ai/totem#2889).
  - **Outbox root (mmnto-ai/totem#2930).** The send resolves its repository root to the repository TOPLEVEL: the nearest ancestor carrying a `.git` directory (a `.git` file, a worktree's or a submodule's pointer, stops the walk and is refused), which must carry a real `.totem/` and must HOST the sending seat (`.totem/orchestration/<seat>/` registered by `totem seat add`). A send from `<repo>/tools/` lands in `<repo>/.totem/orchestration/<seat>/outbox/`, where the poll reads it. Before, the outbox root was the current directory itself, so a send from a subdirectory or from the workspace parent minted a `.totem/orchestration/` tree there, printed `Dispatch written` and exited 0 while no poll would ever list the file. A `.totem/` WITHOUT `.git` (a tool's temp state under `packages/<x>/`, or a phantom outbox the old send left under `apps/<x>/`) is never the root: the nearest-marker walker the reader shares would stop at it, and the falsification leg reproduced a send from `<repo>/packages/cli/src` landing there. **BEHAVIOUR CHANGE:** a start with no `.git` at or above it, a worktree or submodule (a `.git` FILE: never a seat's host, the refusal names the resident checkout its pointer leads to), a git repository with no real `.totem/` directory (absent, or a link — the reader follows none), a resident checkout that has not registered the sending seat, and, when `TOTEM_WORKSPACE` names a workspace, a resident that is not its direct child (a clone elsewhere, a clone nested inside a resident: no poll of that workspace enumerates it) are each refused (exit 1, the line names the directory and the cure) instead of having an outbox minted under them. Disclosed residual: with no workspace named, the resident's parent is its workspace by definition, so a resident-shaped clone outside the cohort workspace is accepted and no poll of the cohort workspace reads it; the pin closes that. The reader-side verbs keep the nearest-marker walker; their stray-marker capture is filed separately.
  - **Empty body (mmnto-ai/totem#2887).** An empty or whitespace-only body, from `--body-file` or the body argument, is refused before anything is written; the line names the source and its byte count. **BEHAVIOUR CHANGE:** a send with no body at all used to write a frontmatter-only dispatch and exit 0; it now exits 1. The listing (`totem mail`) flags a served dispatch whose body is empty with a `warning:` line beside its subject, and `--json` entries carry `bodyEmpty`.
  - **Reply basenames (mmnto-ai/totem#2929).** A reply's derived basename is `<stamp>-<recipient>-<sender>-<re-subject>`: the sender token leads the topic, so N seats replying to one round kit in the same minute never converge on one basename in the recipient's `processed/` store. `mail reply` gains `--slug`, used as given after the recipient-prefix strip and slugification; a blank slug, or one that strips down to nothing, is no slug, and the derived form with the sender token applies. Send basenames are unchanged.
  - **Recipient-prefixed slugs (mmnto-ai/totem#2889).** A `--slug` that begins with the recipient token is stripped of it, with a warning naming what was stripped, instead of doubling the recipient in the filename; both verbs' `--slug` help text now says the slug is appended after `<stamp>-<recipient>-`.
  - **`totem mail verify <path>` (mmnto-ai/totem#2887, ask 3).** Verifies ONE dispatch as written and routable, without listing or reading any other seat's outbox: the frontmatter parses, `to:` is `broadcast` or a roster seat, the body is non-empty, and the file sits at outbox depth 1 of a hosted seat under a resident checkout (a `.git` directory at the root, a real `.totem/` and seat directory with no link in the way, and, when `--workspace` or `TOTEM_WORKSPACE` names a workspace, the repository is its direct child; a stray `.totem/` under a subdirectory, a worktree, a linked tree or a clone outside the named workspace fails placement). The roster is taken from the file's own repository when it is placed, never the shell's cwd, and the findings are reported in that fixed order. A failing check exits 1; `--json` emits the structured result on stdout with the same exit. `send` and `reply` end with the same four checks over the file they wrote and print one `verified:` line. The verb reports written-and-routable, never consumed: consumption is the recipient's mark.

## 2.10.0

### Minor Changes

- 6954f2a: The managed pre-commit and pre-push hooks now recognise a Claude Code shell (mmnto-ai/totem#2706). Their agent-detection block arms the strict tier on `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT`, the two variables Claude Code actually exports into every tool shell, beside the previous `CLAUDE_CODE_AGENT`, `CLAUDE_VERSION` and `CURSOR_TRACE_ID`. Five seat-measurements in five checkouts (four named cohort repositories and one consumer) between 2026-08-30 and 2026-09-13 found no live Claude Code session carrying the old two names, so the "AI agents get strict automatically" sentence in the managed CLAUDE.md block described a mechanism that never fired on any Claude Code seat; the sentence now names the variables and the opt-in for other seats, and the reflex block version moves to 16 so `totem init` refreshes it.

  **BEHAVIOUR CHANGE for Claude Code seats, at the next hook re-render** (`totem init`, `totem hook install`, or a consumer's `prepare`): the pre-commit hook blocks a commit until the checkout carries an anchored `totem spec` run artifact, and the pre-push hook runs the three strict arms: the legs gate in blocking mode (a legs-owed push with no fresh deposit is refused), `totem doctor --strict` (the repo-state gate), and the shield gate (`totem review --gate`, the local review lanes with the declared disposition-to-exit mapping). The claim-discipline gate is not one of them; it already ran at every tier. A seat that already runs `totem spec` and the review leg by discipline meets the first two arms with no new step; the other two run on every push from a Claude Code shell regardless, and each can block: `totem doctor --strict` on repo state, and the shield gate, which spends the local review lanes (an LLM call per push, about twenty seconds). A fresh worktree sees one BLOCKED line at commit with the one-command cure. There is no repo-level opt-out, and there never was one for Cursor seats: the arm is `is_agent = 1 OR tier = strict`, so an installed block that reads `TOTEM_HOOK_TIER="standard"` still arms when the shell carries a marker, and a `hooks.tier: 'standard'` pin in `totem.config.ts` does not suppress it (the config schema has said so all along: "Agents are auto-detected and enforced at strict level regardless of this setting"). The per-command overrides are git's own `--no-verify` on `git commit` (the pre-commit header names it) and on `git push`, or running that one command with both marker variables unset: a live Claude Code shell exports both, so unsetting one alone still arms. No exit code, flag or file format changes.

## 2.9.3

### Patch Changes

- caa425d: `totem mail`'s human listing names where to read each unread dispatch (mmnto-ai/totem#2919): every item now carries a third line, `read: <absolute path>`, the same `filePath` the `--json` output emits, under both the directed listing and the identity-gated broadcast listing. Before this a reader saw only the basename and had to know the sender's outbox layout; one consumer improvised with a directory listing of the sender's outbox and saw other seats' dispatches from the same round during a BLIND window. The empty-inbox lines, the `--json` shape and the exit codes are unchanged; the `mail` help text names the new line. A test locks the line's position under each item and its identity with the `--json` path.

## 2.9.2

### Patch Changes

- db20fde: The exports maps of `@mmnto/cli`, `@mmnto/totem` and `@mmnto/mcp` expose the `./package.json` subpath, so `require('@mmnto/cli/package.json').version` and `import.meta.resolve('@mmnto/totem/package.json')` resolve instead of throwing ERR_PACKAGE_PATH_NOT_EXPORTED (mmnto-ai/totem#2917). Additive: every existing subpath and condition is unchanged, and `@mmnto/pack-rust-architecture` already carried the key. A workspace lock in core asserts the key on every published package's source manifest and resolves it through Node's own resolver, red on the previous maps; the packed-tarball arm covers `@mmnto/totem`, and `npm pack --dry-run` shows `package.json` in all three tarballs. Consumers that read the installed version by walking `node_modules` by path can use the package specifier from this version.

## 2.9.1

### Patch Changes

- e4f35b4: ci(tests): `hookTimeout` rides the same platform floor as `testTimeout` in every workspace vitest config (30 s on win32, 15 s elsewhere; it sat at vitest's separate 10 s default), and the `scripts/sync-labels.ps1` dry-run suite carries a 60 s per-row budget for its cold `pwsh` spawn on a loaded runner (mmnto-ai/totem#2896: four CI timeouts in files the failing PRs did not touch — three timeouts across two distinct rows at the 15 s test limit on macOS, one `beforeEach` at the 10 s hook limit on Windows). Test configuration only; no runtime behavior changes.

## 2.9.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 2.8.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 2.7.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 2.6.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 2.5.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 2.4.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 2.3.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 2.2.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 2.2.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 2.1.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 2.0.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.124.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.123.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.122.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.121.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.120.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.119.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.118.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.118.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.117.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.116.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.115.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.114.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.113.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.113.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.112.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.111.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.111.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.110.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.109.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.108.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.107.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.107.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.106.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.105.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.104.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.103.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.102.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.101.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.101.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.101.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.100.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.99.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.98.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.98.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.97.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.96.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.95.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.94.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.93.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.92.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.91.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.90.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.89.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.88.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.87.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.86.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.85.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.84.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.83.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.82.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.81.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.81.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.80.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.79.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.78.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.77.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.76.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.76.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.75.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.75.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.75.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.74.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.73.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.73.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.73.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.72.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.72.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.71.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.71.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.70.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.70.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.69.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.68.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.67.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.67.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.66.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.65.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.64.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.64.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.64.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.63.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.62.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.61.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.60.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.59.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.59.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.58.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.58.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.57.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.56.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.55.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.55.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.54.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.54.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.9

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.8

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.7

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.6

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.5

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.4

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.3

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.53.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.52.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.51.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.50.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.49.3

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.49.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.49.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.49.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.48.0

_Cohort-link bump for the Node 24 engine constraint enforcement shipping with this release. The `engines.node: >=24` declaration aligns @mmnto/pack-rust-architecture's declared compatibility with the cohort's tested CI floor. See `@mmnto/cli` CHANGELOG for the full release rationale._

## 1.47.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.47.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.46.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.45.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.44.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.6

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.5

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.4

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.3

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.43.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.42.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.41.0

Coordinated cohort bump — no direct changes in this package; consumes the `@mmnto/totem` minor.

## 1.40.2

### Patch Changes

- d725010: fix(ci): audit + sweep narrow timing thresholds across packages

  Three independent CI flakes hit across three platforms in three hours after the #1928 merge to main, each on a different timing-window assertion:
  - **Ubuntu** (`@mmnto/mcp` `ledger-writer.test.ts`): vitest `testTimeout` 5_000ms tripped on cold-import (fixed in #1928).
  - **macOS** (`@mmnto/totem` `regex-safety/evaluator.test.ts:97`): `softWarningMs: 1` + 1000 trivial-pattern lines finished <1ms on fast hardware; `softWarningTriggered` assertion flipped false.
  - **Windows** (`@mmnto/cli` `run-compiled-rules.test.ts:203`): `RegexEvaluator` `DEFAULT_CONFIG.timeoutMs: 100` tripped at "timeout after 139ms" on a single-line `.sh` corpus — Windows worker thread spawn + IPC + shared-runner scheduling jitter exceeded the budget.

  This PR audits and uniformly addresses the class:

  **1. Vitest test-runner ceilings (4 configs)** — `packages/{cli,core,pack-agent-security,pack-rust-architecture}/vitest.config.ts` bumped non-Windows floor `5_000` → `15_000` to match the `@mmnto/mcp` precedent set in #1928. Windows stays at 30_000 (subprocess spawn). Comments updated to call out the shared-runner cold-import class explicitly.

  **2. `RegexEvaluator` production defaults** (`packages/core/src/regex-safety/evaluator.ts`) — `timeoutMs: 100 → 250`, `softWarningMs: 50 → 100`. 250ms keeps per-rule budget snappy in production while giving Windows worker IPC + CI scheduling ~2× headroom over the observed worst case (139ms). Backward compatible: callers passing explicit config are unaffected; callers using defaults gain headroom.

  **3. Soft-warning wall-clock test** (`packages/core/src/regex-safety/evaluator.test.ts:92`) — refactored from `softWarningMs: 1` + 1000 lines to `softWarningMs: 5` + 50_000 lines. Same assertion, but 50× wall-clock margin instead of a 1ms threshold racing fast hardware.

  No public API change. Verified locally: 2161 `@mmnto/cli` tests + matching cohort across `@mmnto/totem`, `@mmnto/mcp`, and the two packs all green.

## 1.40.1

Coordinated cohort bump — no direct changes to this pack.

## 1.40.0

### Minor Changes

- 986825c: feat(mcp+cli): Trap Ledger activity writers — MCP `mcp_call` + SessionStart `session_start` (A.3.a writers)

  Stacked on #1919 (A.3.a schema). Wires the two activity-event writers that the A.3.b compliance metric will read. Without these writers, the schema is inert — no events of the new types get produced.

  ## Writers shipped

  **MCP `mcp_call` writer** (`packages/mcp/src/ledger-writer.ts`):
  - New `logMcpCall(activityName)` helper. Fire-and-forget; internal try/catch + outer `.catch()` defense-in-depth at call sites.
  - Wired into `packages/mcp/src/tools/search-knowledge.ts` — emits `{ type: 'mcp_call', activity_name: 'search_knowledge', session_id, source: 'bot' }` at handler entry. Reads `session_id` from `.totem/ledger/.session-id` if present (TTL 24h), omits when missing.
  - Other MCP tools (`describe_project`, `add_lesson`, `verify_execution`) intentionally NOT wired in this PR — `search_knowledge` is the only one ADR-029's compliance metric measures. Symmetric wiring deferred to A.3.c when broader observability lands.

  **SessionStart hook writer** (`packages/cli/src/commands/init-templates.ts`):
  - `CLAUDE_SESSION_START` template extended to mint a session UUID via `crypto.randomUUID()`, persist to `.totem/ledger/.session-id`, and append a `session_start` activity event to `events.ndjson` BEFORE the existing `totem describe` briefing.
  - Inline implementation (no `@mmnto/totem` import) — hook scripts run via `node` from project root before any package resolution, so they can't depend on the totem npm packages being installed.
  - Gemini SessionStart hook (`GEMINI_SESSION_START`) intentionally NOT updated in this PR. Symmetric Gemini parity deferred to a follow-on.

  ## New core utilities (`packages/core/src/session-id.ts`)
  - `mintSessionId()` — wraps `crypto.randomUUID()`.
  - `writeSessionId(totemDir, sessionId)` — persists to `.totem/ledger/.session-id`. Swallows expected fs error classes (ENOENT/EACCES/EPERM/EROFS) via the optional `onWarn` callback and rethrows unexpected error classes per Tenet 4 Fail Loud.
  - `readSessionId(totemDir, ttlHours?)` — reads + validates UUID shape + checks mtime against TTL (default 24h). Returns `undefined` for missing/expired/malformed files.

  ## Tests
  - `packages/core/src/session-id.test.ts` — 15 tests covering mint uniqueness, write/read round-trip, malformed UUID rejection, TTL expiration (file backdating via `utimesSync`), custom TTL argument, trailing-whitespace tolerance, plus fs error class discrimination on read (ENOENT/EACCES/EPERM/EROFS swallow vs unexpected rethrow per Tenet 4).
  - `packages/mcp/src/ledger-writer.test.ts` — 5 tests covering event emission, session_id population/omission, getContext failure (must not throw), append-don't-overwrite.
  - `packages/mcp/src/tools/search-knowledge.test.ts` — 2 new integration tests verifying handler emits `mcp_call` with `activity_name: 'search_knowledge'`, including the dimension-mismatch error path (invocation, not success, is what ADR-029 measures).
  - `packages/cli/src/commands/init.test.ts` — 5 new tests covering the SessionStart template's session-id minting, persistence, ledger-event emission, agent_source stamping (Claude-specific), and fire-and-forget error-handling.

  ## Backward compatibility

  Same forward-only story as A.3.a schema:
  - Pre-writers Trap Ledgers don't contain `mcp_call` or `session_start` events — readers parse them fine when they appear post-upgrade.
  - SessionStart hook ledger-write block is in its own try/catch; if it fails (read-only filesystem, missing perms, etc.), the briefing path still runs.

  ## ADR alignment
  - ADR-029 § Session Heuristic: explicit UUID supersedes the rolling-2h activity heuristic when `.session-id` is present.
  - ADR-078 § Event Attribution: `source: 'bot'` for both writers (emitter = MCP server / hook subsystem). In this lift, `session_start` includes `agent_source: 'claude'` (the Claude hook template knows its vendor); MCP `mcp_call` agent attribution is deferred to A.3.c via orchestrator → MCP correlation propagation.
  - ADR-077 Smart Briefing: SessionStart hook already shipped (`installClaudeHooks` scaffolds the script); this PR only extends its body.

  ## Out of scope (next sub-lifts)
  - **A.3.b** — `totem doctor --compliance` reads these events and computes the ADR-029 metric (~1 week).
  - **A.3.c** — orchestrator → MCP correlation_id propagation; populates `agent_source` (~1 week).
  - **A.4.a / A.4.b** — PreToolUse soft-block + pre-push hard-block (per C-12); reads `mcp_call` events to gate Write/Edit on `proposals/active/**`, `adr/**`, `research/**`.
  - **Gemini SessionStart writer** — symmetric pattern, deferred for parity sweep.
  - **Other MCP tools** (`describe_project`, `add_lesson`, `verify_execution`) — wire `logMcpCall` when needed for broader observability.

## 1.39.0

### Minor Changes

- 1934f13: feat(core): Trap Ledger schema extension — agent attribution + activity events (A.3.a)

  Forward-only schema extension to `LedgerEventSchema` in `packages/core/src/ledger.ts`. First lift of the A.3 telemetry sprint (three-stream claim-discipline consensus, design doc at `mmnto-ai/totem-substrate:.handoff/_shared/2026-05-15-a3a-schema-extension-design.md`).

  **New event types** (activity family):
  - `mcp_call` — MCP tool invocation; `activity_name` discriminates (`search_knowledge`, `describe_project`, ...)
  - `tool_call_first_significant` — first non-Read/Grep/Glob orchestrator tool call in session
  - `hook_fire` — lifecycle hook executed; `activity_name` discriminates (`SessionStart`, `PreToolUse`, `pre-push`, ...)
  - `session_start` — SessionStart hook fired; new `session_id` minted

  **New optional fields:**
  - `agent_source: 'claude' | 'gemini' | 'human'` — agent runtime attribution, orthogonal to `source` (emitting subsystem). Implements ADR-078 § Event Attribution; renamed from the ADR's `source` to disambiguate against the load-bearing emitter identifier already in production.
  - `session_id` (UUID) — session correlation, persisted at `.totem/ledger/.session-id` per ADR-029 § Session Heuristic.
  - `correlation_id` (UUID) — trace correlation per ADR-014; populated by A.3.c end-to-end propagation work.
  - `activity_name` — sub-type discriminator for activity events.

  **Field relaxations:** `ruleId` and `file` are now optional at the schema level to accommodate activity events. Writer-side discipline enforces required-by-type for `suppress` / `override` / `exemption`. Promotion to a Zod `discriminatedUnion` is deferred to A.3.c per design doc OQ-1 (strategy-Claude T0345Z disposition agreed; rationale and gap-filler tests in `ledger.test.ts` § "writer-side per-branch field presence" lock the discipline until the schema enforces it structurally).

  **Backward compatibility:**
  - Pre-A.3.a override events (no new fields) parse fine — all new fields optional.
  - Post-A.3.a activity events read by pre-A.3.a code: silently dropped (`safeParse` fails on unknown enum value, line skipped). Acceptable — no data corruption, only telemetry-visibility loss in stale tooling. Cohort version bump after merge closes this naturally.

  **Doc-sync (bundled):** `docs/wiki/trap-ledger.md` example corrected — pre-existing drift surfaced during A.3.a empirical pass. Three drifts fixed:
  - Example `type` was `"exception"` (invalid; not in the enum) → now `"suppress"`.
  - Example `source` was `"totem-context"` (bypass-marker; conflated with code's emitter identifier) → now `"lint"`.
  - Prose claimed `// totem-context:` directives log `override` events — corrected to `suppress` per code comment in `LedgerEventSchema.type`.

  Activity-event example added for `mcp_call` / `search_knowledge` shape.

  **Out of scope (next sub-lifts):**
  - A.3.b: `totem doctor --compliance` reads this schema and computes the ADR-029 metric (~1 week).
  - A.3.c: orchestrator → MCP `correlation_id` propagation (~1 week).
  - A.4.a / A.4.b: PreToolUse soft-block + pre-push hard-block pair (per C-12, ships alongside A.3.a).

  ADR-078 surface amendment (rename agent attribution from `source` to `agent_source` in § Decision 2) landed at `mmnto-ai/totem-strategy#329` (commit `b830e0c` on main). Includes the first `Falsifying Metric:` field in the ecosystem per Tenet 19 — sibling capability-claim ADRs 014/029/044 backfilled in `mmnto-ai/totem-strategy#330`.

## 1.38.0

### Minor Changes

- 923deb0: feat(doctor): add `--strict` mode + pre-push hook integration + CI workflow template (#1908)

  Implements Proposal 273 § 7 routing matrix rows 5+6 (Repo + Auto + Both) for the first repo-state diagnostic (`checkAgentsMdCanonical`, shipped in #1907).
  - `totem doctor --strict` now exits non-zero when any check reports `fail` (`warn` results remain informational). Default behavior unchanged.
  - Pre-push hook injects `totem doctor --strict` inside the existing strict-tier guard (`is_agent=1` or `TOTEM_HOOK_TIER=strict`), mirroring the `totem review` shield gate. Standard-tier humans bypass; agents and explicit strict-tier operators get the gate.
  - New `.github/workflows/totem-doctor.yml` template runs `doctor --strict` on PR + push to main. Cohort repos can copy or reference.

  Exit-code decision lives at the CLI edge — `doctorCommand` returns `DiagnosticResult[]` and does not touch `process.exit` / `process.exitCode`.

  **Calibration fix bundled.** `checkEmbeddingConfig` previously reported `fail` when the configured embedder's env key (`OPENAI_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_API_KEY`) was missing. That misclassified an operator-setup state as a repo defect — empirically surfaced when `totem doctor --strict` ran in CI on this PR (CI intentionally lacks the keys). Both branches now return `warn`, mirroring `checkOllama`'s warn-on-unreachable pattern. The repo's config is correct; the local environment is incomplete.

## 1.37.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.36.0

Coordinated cohort bump — no direct changes to this pack. See `@mmnto/cli`'s
CHANGELOG.md for the `totem hook` namespace entry.

## 1.35.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.34.3

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.34.2

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.34.1

Coordinated cohort bump — no direct changes to this pack. See `@mmnto/totem`'s
CHANGELOG.md for the `generateLessonHeading`/`truncateHeading` mid-clause truncation fix.

## 1.34.0

Coordinated cohort bump — no direct changes to this pack. See `@mmnto/cli`'s
CHANGELOG.md for the `totem init` Ollama floor probe entry.

## 1.33.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.32.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.31.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.30.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.30.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.29.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.28.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.28.0

### Minor Changes

- bd3fd71: `totem sync` Phase A / Phase B architectural separation (mmnto-ai/totem#1811, ADR-101).

  `totem sync` decomposes into two independently-runnable phases:
  - **Phase A** — deterministic pack-resolution + `installed-packs.json` write (no API key required, runs in CI).
  - **Phase B** — vector-store embedding sync (still requires the embedding key; unchanged).

  New mutually-exclusive flags on `totem sync`:
  - `--packs-only` (Lite tier): write the pack manifest only; skip embedding sync, prune, the global registry update, and the `review-extensions.txt` write. Designed for CI environments without API keys after a `@mmnto/totem` cohort bump where pack-resolution alone needs to run before `totem lint` recognizes newly registered Tree-sitter languages.
  - `--index-only` (Standard tier): run only the embedding sync; skip pack-resolution. Use when `installed-packs.json` is already current and only the vector store needs to re-embed.

  `--packs-only` hard-errors when combined with `--index-only`, `--full`, or `--prune` — Phase B is skipped under `--packs-only`, so those flags would silently no-op. `--index-only` composes with `--full` and `--prune` since all three modify Phase B.

  The CLI orchestrator now writes `installed-packs.json` BEFORE invoking `runSync` so `--packs-only` can short-circuit cleanly. The default flag-less behavior is observably equivalent to prior releases.

  UX nudge for stale manifests: when a rule expects a Tree-sitter language that isn't registered, the rule-engine now consults `installed-packs.json`'s cohort field and surfaces a structured `STALE_MANIFEST` `TotemError` pointing at `totem sync --packs-only` whenever the manifest is missing, pre-1.27.0, or written by an engine whose `major.minor` differs from the running version. Patch-level cohort drift passes (caret-range pack semver tolerance). Cohort-match falls through to the original "install the pack" `TotemParseError`.

  Schema: `InstalledPacksManifestSchema` gains an optional `cohort: string` field (semver). Pre-1.27.0 manifests without the field continue to parse cleanly. Stamped at write time by `writeInstalledPacksManifest()` from `resolveEngineVersion()`; tests can pre-populate the field to override the stamp.

  New public surfaces (additive):
  - `resolveEngineVersion(): string`
  - `detectStaleManifest(opts): StaleManifestDetection | null`
  - `staleManifestError(detection, context): TotemError`
  - `TotemErrorCode` adds `'STALE_MANIFEST'` and `'FLAG_CONFLICT'`.

## 1.27.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.26.1

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.26.0

### Minor Changes

- c00dc7b: **ADR-097 § Q6 amended — engine-version constraint moves from `peerDependencies` to `engines` (closes #1803).**

  Pack manifest resolver (`pack-manifest-writer.ts:readEngineRange`, formerly `readPeerEngineRange`) now reads `engines['@mmnto/totem']` from the resolved pack's `package.json` instead of `peerDependencies['@mmnto/totem']`. The boot-time engine-version cross-check (`pack-discovery.ts:assertEngineRangeSatisfied`) reads the same value via `installed-packs.json#packs[].declaredEngineRange` and continues to fail loud on semver mismatch.

  **Why the move:**
  - `engines` is npm-canonical for engine-version constraints. `peerDependencies` is for actual peer packages the consumer must install (e.g., `@ast-grep/napi`). Mechanism mapping is now correct.
  - Symmetry across the cohort. Internal and future external packs declare `engines.@mmnto/totem` consistently; `peerDependencies` is uniformly for actual peer packages only.
  - Closes the structural collision with `mmnto-ai/totem#1777` (the `1.22.0 → 2.0.0` wiggle root cause): a fixed-group sibling pack cannot peer-dep `@mmnto/totem` without triggering a changesets MAJOR cascade. The `engines` field is not touched by changesets fixed-group auto-bump, so the wiggle stays prevented even with a declared engine constraint.

  **Migration shape:**
  - `@mmnto/pack-rust-architecture` and `@mmnto/pack-agent-security` now declare `"engines": { "@mmnto/totem": "^1.25.0" }`. Neither declares `@mmnto/totem` in `peerDependencies` (locked by `structure.test.ts` invariants in both packs).
  - The `not-a-pack` warning in `totem sync` was reworded to point at the actual gap: `"missing engines['@mmnto/totem'] declaration — pack cannot satisfy the engine-version cross-check (ADR-097 § 5 Q6). Add '"engines": { "@mmnto/totem": "^<version>" }' to the pack's package.json and republish."` Pre-#1803 text was misleading per `mmnto-ai/totem#1803`'s reproducer (it claimed the registration callback was missing when the callback was correctly exported).
  - No fallback to the legacy `peerDependencies['@mmnto/totem']` slot. Pre-1.26.0 packs that declared the engine constraint via peerDeps (none known to exist outside the `@mmnto/*` cohort, all of which are migrated in this cohort) must republish with `engines` declared.

  Closes #1803.

### Patch Changes

- 9f0535d: **Fix `engines['@mmnto/totem']` constraint floor — `^1.25.0` → `^1.26.0`.**

  GCA HIGH catch on the auto-generated Version Packages PR (#1808). The engines-field reader (`pack-manifest-writer.ts:readEngineRange`) ships in `@mmnto/totem@1.26.0`. Engines pre-1.26.0 read `peerDependencies['@mmnto/totem']` and would silently treat these packs as `not-a-pack` (the engines field is invisible to them). Declaring compatibility with `^1.25.0` was technically incorrect — a 1.25.0 engine cannot satisfy these packs even though caret-semver would let it match.

  Tightening the floor to `^1.26.0` makes the constraint match actual runtime compatibility. Fixed-group co-versioning makes this a documentation / safety-rail correction in practice (consumers pinned to a 1.26.x pack pull in the matching 1.26.x engine via the cohort), but the declared range should reflect reality.

  No code change. Constraint-only tightening.

## 1.25.0

_Cohort-link bump (no direct package changes). See `.changeset/config.json` for the fixed-cohort definition._

## 1.24.0

### Minor Changes

- 67c3ad3: **ADR-091 § Bootstrap Semantics: pack pending-verification install→lint promotion (#1684)**

  Closes the cloud-compile bootstrap gap that ADR-091 § Bootstrap Semantics defined: pack rules cannot be trusted to fire on the consumer's codebase until Stage 4 verifies them locally, so they now enter the consumer's manifest as `'pending-verification'` and the next `totem lint` runs the verifier and promotes them per outcome.

  **`CompiledRule.status` enum extended** with a fourth lifecycle value `'pending-verification'` alongside `'active' | 'archived' | 'untested-against-codebase'`. The lint-execution path (`loadCompiledRules`) treats it as inert exactly like `'archived'` and `'untested-against-codebase'`; the admin path (`loadCompiledRulesFile`) returns it unfiltered so the promotion interceptor can find pending entries.

  **`totem install pack/<name>`** now stamps every pack rule `'pending-verification'` regardless of the status the pack shipped with. The pack's authoring environment cannot have run Stage 4 against the consumer's codebase, so the cloud-compile status is meaningless on the consumer side. The install command appends `Run \`totem lint\` to activate pack rules` to its output as the activation hint.

  **`.totem/verification-outcomes.json`** is the new committable side-table that memoizes Stage 4 outcomes across runs. The first lint run after install reads pending rules from the manifest, invokes the Stage 4 verifier on each, maps the outcome to one of the four terminal lifecycle values per Invariant #3, atomically writes the outcomes file with canonical-key-order serialization (Invariant #11 — byte-stable across runs so consumer repos see no phantom diffs), and saves the mutated manifest. Subsequent lint runs read the recorded outcome from the file and skip re-verification (Invariant #4); a pack content update produces a new `lessonHash` which has no recorded outcome, so the verifier runs again (Invariant #5).

  **Per-rule verifier-throw isolation** (Invariant #7): one failing rule's verifier-throw does not abort the lint pass; that rule remains `'pending-verification'` and the next lint retries.

  **Empty-pending fast path** (Invariant #9): the common-case lint pass with zero pending rules pays no verification cost and skips the outcomes-file read entirely.

  **New public API** in `@mmnto/totem`:
  - `promotePendingRules(rules, deps)` and `applyOutcomeToRule(rule, entry)` — the core interceptor.
  - `readVerificationOutcomes(filePath, onWarn?)` and `writeVerificationOutcomes(filePath, outcomes)` — the persistence layer.
  - `VerificationOutcomeEntrySchema`, `VerificationOutcomesFileSchema`, `Stage4OutcomeStored` — Zod schemas.
  - `VerificationOutcomesStore`, `VerificationOutcomesFile`, `VerificationOutcomeEntry`, `Stage4OutcomeStoredValue`, `PromotePendingRulesDeps`, `PromotePendingRulesResult` — types.

  **Naming-collision context (option B):** the original ADR-091 draft specified `.totem/rule-metrics.json` for the verification-outcomes file, but `packages/core/src/rule-metrics.ts` already exists as a per-machine telemetry-cache module (`triggerCount`, `suppressCount`, `evaluationCount`) with a gitignored `.totem/cache/rule-metrics.json` lifetime. ADR-091 § 65 was amended to specify `.totem/verification-outcomes.json` instead — separate filename for the new committable verification state, separate module name (`verification-outcomes.ts`) for the new schemas + persistence layer.

## 1.23.0

### Minor Changes

- 94ea4a8: **Pack v0.1 alpha pilot: `@mmnto/pack-rust-architecture` lift + ADR-091/097 substrate completion (#1773)**

  First non-trivial consumer of the ADR-097 § 10 Pack v0.1 substrate (#1768/#1769/#1770 in 1.22.0). Validates the substrate end-to-end by registering Rust as a language extension and dispatching ast-grep rules against `.rs` source.

  **`@mmnto/pack-rust-architecture@1.23.0`** — new package (`private: true`)
  - 8 baseline lessons sourced from `mmnto-ai/liquid-city#134` (slice-6 vehicle-agent + dispersion review cycle, lc-Claude attribution preserved)
  - Synchronous CJS `register.cjs` wires Rust into both engine paths: `api.registerLanguage('.rs', 'rust', wasmLoader)` for the web-tree-sitter side and `napi.registerDynamicLanguage({ rust })` for the @ast-grep/napi side (v0.1 side-channel, see `@mmnto/totem#1774`)
  - Bundled `tree-sitter-rust.wasm` (1.1 MB) sourced from `@vscode/tree-sitter-wasm@0.3.1` (MIT, Microsoft) via `prepare`-time copy
  - `compiled-rules.json` ships one tracer-bullet seed rule (`lesson-8cefba95`, Bevy hot-path `Local<Vec<T>>` per-tick allocation) — full LLM-compile of the 8-lesson set deferred to a focused follow-up since γ (per-language `KIND_ALLOW_LIST`, #1655) is needed before LLM-compile of Rust patterns avoids TS-grammar hallucinations
  - Runtime integration tests boot the pack via `loadInstalledPacks({ inMemoryPacks })` and verify the seed rule fires on `.rs` source through the full substrate path

  **`@mmnto/totem` — #1654 fix: thread target Lang through the compile-time pattern validator**

  Pre-#1654, `validateAstGrepPattern` always parsed under `Lang.Tsx` regardless of the rule's `fileGlobs`, and `inferBadExampleExts` (smoke gate) used a TS/JS-only regex that silently fell back to the default set for non-TS rules. A Rust pattern would either false-pass under TSX (the `ResMut<TacticalState>` exhibit) or false-fail with a TSX-parser error.
  - `validateAstGrepPattern(pattern, fileGlobs?)` now resolves the target Lang via `resolveAstGrepLangs(fileGlobs)` and accepts the pattern when any one Lang accepts it. Falls back to `Lang.Tsx` when fileGlobs is empty or no glob carries a registered extension (preserves legacy unscoped-rule semantics).
  - `inferBadExampleExts` extracts any trailing extension from `fileGlobs` (not just TS/JS); runtime's `extensionToLang` filters out unmapped extensions inside `matchAstGrepPattern` so unmapped extensions cleanly return zero matches without parsing under the wrong grammar.
  - New `resolveAstGrepLangs` helper exported alongside `extensionToLang` from `ast-grep-query.ts`.
  - 6 new regression tests covering the LC false-positive exhibit and the TS-fallback preservation invariant.

  **Substrate-extension follow-up filed as #1774 (tier-2, investigation)**: lift the napi-side language registration into `PackRegistrationAPI.registerNapiLanguage` once N≥2 pack consumers exist. PR-B's side-channel pattern in `register.cjs` is the time-boxed precedent that gathers design data; the side-channel is documented as visible debt in the pack's README.

### Patch Changes

- d4e2eb1: **Fix #1776 wiggle — remove `@mmnto/totem` peerDep from `@mmnto/pack-rust-architecture`.**

  The first Version Packages auto-cut after PR #1775 pre-empted `1.22.0 → 2.0.0` instead of `1.22.0 → 1.23.0` despite all changesets being declared `minor`. Root cause: `@mmnto/pack-rust-architecture` declared `peerDependencies['@mmnto/totem']: ^1.22.0`, which combined with the changesets `fixed` group creates a circular constraint — the pack's peerDep range update on a totem minor bump triggers a MAJOR cascade per the changesets peerDep-update policy, and the cascade lifts every fixed-group member to a major bump.

  Fix mirrors the pattern in `@mmnto/pack-agent-security`: fixed-group packs do not declare `@mmnto/totem` as a peerDep — version harmony is guaranteed at publish time by the fixed group itself, not by peerDep range pinning. `@ast-grep/napi` (external, not in the fixed group) remains a peerDep as expected.

  Test `structure.test.ts` updated to assert the exact-key equality of `peerDependencies` so a regression in this rule is caught at unit-test time, not at next Version Packages auto-cut.

  No runtime behavior change. Pack still registers Rust into both engine paths via `register.cjs`.

All notable changes to `@mmnto/pack-rust-architecture` will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] — 2026-04-30

### Added

Initial release. 8 baseline architectural lessons for Rust + Bevy ECS consumers, sourced from `mmnto-ai/liquid-city` PR #134's slice-6 review cycle (vehicle-agent contact + dispersion implementation) plus 2 hand-authored seeds.

**Numeric safety (3 lessons):**

- `lesson-2d305b47` — `linvel.norm()` overflow to `f32::INFINITY` despite finite vector components; `is_finite()` guard + regression test pattern.
- `lesson-d020574f` — Float stride loop-bound DoS: validate finiteness, then cast to integer, then `saturating_mul` against `MAX_TOTAL_CELLS`.
- `lesson-c79543ba` — Tuning constants with runtime `assert!` guards need matching `const _: () = assert!(...)` at the declaration site for compile-time enforcement.

**Compile-time discipline (1 lesson):**

- `lesson-de45dee2` — Float arithmetic methods (`.floor()`, `.ceil()`, `.sqrt()`, `.powf()`, `.powi()`, `.abs()`, trig/log family) are unavailable in Rust const-eval (1.95). Const-assert rewrites use direct ops + cast (divide-then-cast, not pre-cast).

**Bevy ECS (3 lessons):**

- `lesson-8cefba95` — Bevy hot-path: `Local<Vec<T>>` system parameter with `.clear()` + `.extend()` instead of per-tick `query.iter().collect()`.
- `lesson-b25f0c4a` — Bevy schedule `.before/.after` edges must encode explicit producer-consumer or wake-gate contracts; companion rule on Bevy 0.14's `.chain()` ~20-system tuple-trait limit.
- `lesson-691fbb72` — Determinism tests must use 2+ archetypes for sort-by-`Entity` ID to be load-bearing; single-archetype fixtures pass vacuously.

**Testing discipline (1 lesson):**

- `lesson-9bc7ac4a` — Test world builders must install resources / map data in the same order as production; extract a shared base builder so production and test paths share the sequenced setup.

### Sources

- 6 lessons via `totem review-learn` extraction on `mmnto-ai/liquid-city#134` (Sonnet 4.6, 8.7k in / 1.3k out tokens).
- 2 lessons hand-authored to seed Bucket B1 + B2 territory per `audits/internal/2026-04-30-ecosystem-churn-diagnosis.md` § 4 dev-Gemini's three-bucket diagnosis.

### Notes

- `private: true` for the initial release, consistent with `@mmnto/pack-agent-security` precedent.
- `compiled-rules.json` not included in this draft; regenerated by the totem CLI in the package workspace once the lessons are at `packages/pack-rust-architecture/lessons/`.
- ADR-097 Stage 1 pilot. Stage 2 cycles will harvest from additional consumers (totem itself, future Rust + Bevy adopters) for v0.2.
