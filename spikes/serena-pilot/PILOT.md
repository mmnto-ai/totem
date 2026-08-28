# Serena pilot — retrieval-only, pinned, measured against a ripgrep baseline

**Verdict: FAIL.** Serena did not clear the kill threshold on either half of the
bar, and missed one ground-truth answer that ripgrep found.

| Kill-threshold conjunct                        | Result                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Median tool-output bytes drop ≥ 25%            | **NO** — median 2283 B vs baseline 1527 B (**49.5% worse**)      |
| …**OR** median wall time drops ≥ 25%           | **NO** — median 1233 ms vs baseline 59 ms (**~20× slower**)      |
| Zero missed baseline answers on the serena arm | **NO** — T3 missed `spikes/spine-adopt/src/shipped-verdicts.mts` |
| Retrieval-only bound verified                  | **YES** — 10 tools exposed, zero editing/shell/memory verbs      |
| Zero mutation of the checkout                  | **YES** — verified (see _Zero mutation_)                         |
| Clean uninstall                                | **YES** — verified (see _Uninstall_)                             |

Two of the six conjuncts fail, and they are the two the pilot was run to test.

---

## Resolved pin

| Field                    | Value                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Requested                | `serena v1.7.0`                                                                                                                   |
| Source                   | `git+https://github.com/oraios/serena@v1.7.0`                                                                                     |
| **Resolved commit**      | `949a27ef1e5fda1a6e7b561e777bcece345c6ffd`                                                                                        |
| Commit date / subject    | 2026-08-09 — “Release v1.7.0”                                                                                                     |
| `pyproject.toml` version | `1.7.0` (confirms the tag is not a moved label)                                                                                   |
| Resolver                 | `uv 0.12.7 (61291a8ca)`                                                                                                           |
| Language backend         | serena-managed `typescript-language-server`, using the **workspace** TypeScript 5.9.3 (`node_modules/typescript/lib/tsserver.js`) |

**Finding — the MCP handshake does not identify the pin.** `initialize` returns
`serverInfo: {"name":"Serena","version":"1.28.1"}`. `1.28.1` is the **`mcp`
Python SDK** version (`mcp==1.28.1` in serena's `pyproject.toml`), not serena's.
Anything that verifies a serena pin over MCP must do it out-of-band — from the
uv build log or the resolved commit — because the in-band version string names a
different package entirely.

---

## Exposed-tool verification (the retrieval-only bound)

Asserted at runtime from `tools/list`, not assumed. Exactly **10** tools:

```
find_declaration   find_file             find_implementations
find_referencing_symbols                 find_symbol
get_diagnostics_for_file                 get_symbols_overview
list_dir           read_file             search_for_pattern
```

Editing verbs exposed: **none**. Shell verbs: **none**. Memory verbs: **none**.
Corroborated server-side in serena's own log:

```
serena.mcp:_set_mcp_tools:307 - Starting MCP server with 10 tools:
['read_file', 'list_dir', 'find_file', 'search_for_pattern',
 'get_symbols_overview', 'find_symbol', 'find_referencing_symbols',
 'find_implementations', 'find_declaration', 'get_diagnostics_for_file']
```

### Finding: `read_only: true` does **not** narrow the advertised tool list

This is the pilot's most transferable configuration finding, and it cost a
config iteration to discover. Serena computes **two** tool sets
(`src/serena/agent.py`):

```
_exposed_tools = base_toolset.to_available_tools(...)        # global config + CONTEXT only
_active_tools  = base_toolset.apply(*modes)
                             .apply(project_config)
                             .without_editing_tools()        # if project read_only
```

`tools/list` advertises the **exposed** set. So the obvious levers —
project-level `read_only: true`, project-level `excluded_tools`, and
`--mode planning` — do **not** remove a tool from the advertised list. They only
make a call to it fail. A first configuration using exactly those levers
advertised all **28** default tools, including `create_text_file`,
`execute_shell_command` and the full memory surface.

Two further traps in the same area:

- **`base_modes` is not overridable from the CLI.** The shipped global default is
  `base_modes: [interactive, editing]`, and the full mode set is
  `base_modes + default_modes + added_modes`. `--mode` overrides only
  `default_modes`, so `editing` stays active unless the **global config** clears
  `base_modes`. Passing `--mode planning` alone does not disable editing.
- **The `claude-code` context over-excludes for measurement purposes**: it drops
  `search_for_pattern`, `read_file`, `find_file` and `list_dir` on the assumption
  the CLI agent has its own. That would have removed the very tool T6 needs.

The bound was ultimately expressed where it is actually honoured — a **custom
context** (`config/totem-pilot.yml`) with explicit `excluded_tools` plus
`single_project: true`, which also disables `activate_project` so the server
cannot be re-pointed at another checkout mid-session.

**Adoption consequence:** a reviewer who confirms "we set `read_only: true`" has
_not_ confirmed the agent cannot be handed an editing verb. The check that means
something is `tools/list`.

---

## Indexing cost, measured separately

Serena starts lazily: `initialize` returns before the language server is
spawned, so the first symbol-level call pays for LSP launch plus workspace
indexing.

| Phase                   | Cold (`.serena/cache` deleted) | Warm    |
| ----------------------- | ------------------------------ | ------- |
| `initialize`            | 3205 ms                        | 3532 ms |
| First `find_symbol`     | 6631 ms                        | 1057 ms |
| Same call repeated      | 984 ms                         | 968 ms  |
| **Attributed indexing** | **5646 ms**                    | 88 ms   |

One-time costs not in that table: resolving and building the pinned package
(**21.3 s**, 74 packages), and serena's first-run download of its managed
TypeScript language server (**24.8 MB**, 150 files). Language-server startup
itself was fast and reliable — `0.574 s`, no Windows-specific failure. The
`>10 min` hang guard in the brief was never triggered by serena.

---

## The matched task set

Ground truth was derived with exhaustive ripgrep **before** either arm ran, then
hand-checked line by line.

Both arms see the same corpus: `dist/` and `node_modules/` are gitignored, and
ripgrep honours `.gitignore` by default while serena is configured with
`ignore_all_files_in_gitignore: true`.

The baseline is deliberately the **generous** sequence an agent would actually
run — a `-l` file-spread pass then a narrowed `-n` pass, rather than one broad
noisy dump. Making the baseline cheap is what would have made a serena win
credible.

### Results (warm run; cold run is byte-identical, differing only in latency)

| Task       | Kind                  | Serena B |   Base B |    Bytes Δ | Serena ms | Base ms |     Time Δ | Missed S/B | False-pos S/B |
| ---------- | --------------------- | -------: | -------: | ---------: | --------: | ------: | ---------: | :--------: | :-----------: |
| T1         | definition            |      175 |       81 |  **−116%** |       971 |      30 |     −3137% |   0 / 0    |     0 / 0     |
| T2         | references            |    25096 |     6103 |  **−311%** |      3994 |      59 |     −6707% |   0 / 0    |     1 / 1     |
| T3         | cross-package callers |     9088 |     3094 |  **−194%** |      1247 |      60 |     −1962% | **1** / 0  |     0 / 1     |
| T4         | rename blast radius   |     7323 |     3540 |  **−107%** |      1238 |      58 |     −2023% |   0 / 0    |     0 / 1     |
| T5         | type usage            |     2176 |      907 |  **−140%** |      1220 |      61 |     −1908% |   0 / 0    |     0 / 1     |
| T6         | module consumers      |      938 |     1527 | **+38.6%** |       367 |      59 |      −525% |   0 / 0    |     0 / 3     |
| T7         | symbol + uses         |     2283 |     1302 |   **−75%** |      1233 |      60 |     −1945% |   0 / 0    |     0 / 2     |
| **MEDIAN** |                       | **2283** | **1527** | **−49.5%** |  **1233** |  **59** | **−1997%** |            |               |

Positive Δ = serena better. Serena beat the baseline on bytes in **one** of
seven tasks (T6), and on time in **none**.

All 7 tasks ran. No task was dropped.

### Why serena loses on bytes

The intuition behind the pilot was that a symbol index returns a small precise
answer where grep returns a noisy dump. That held for exactly one task shape.
For reference enumeration, serena returns each referencing symbol **with its
containing symbol's name path, body location, and a `content_around_reference`
snippet** — three lines of source per hit. Ripgrep returns one line per hit. On
T2 (48 call sites) that is 25 KB versus 6 KB. Serena's output is _richer_, and
for a human reader arguably better, but the pilot's bar was bytes, and richer
loses.

### The one real serena miss (T3)

`spikes/spine-adopt/src/shipped-verdicts.mts` calls
`core.applyRulesToAdditionsBounded(...)` at lines 178, 485 and 573 — genuine
calls, not prose. Serena did not report the file. The root tsconfig declares
`"rootDir": "src"`, so `spikes/**/*.mts` sits outside the TypeScript project
graph and is invisible to the language server. **Symbol-grade retrieval is
bounded by the build graph; text search is not.** In a repo that keeps live code
outside `tsconfig` — as this one does — that is a correctness gap, not a
tuning detail.

### Where serena wins: precision

Across the set, serena produced **1** false positive and the baseline **9**:

| Task | Baseline false positives                                   | Why they are wrong                             |
| ---- | ---------------------------------------------------------- | ---------------------------------------------- |
| T3   | `rule-engine.ts`                                           | import/re-export, not a caller                 |
| T4   | `compile-smoke-gate.test.ts`                               | symbol named only in comments (lines 518, 681) |
| T5   | `facts.mts`                                                | named only in a comment (line 6)               |
| T6   | `compiler-schema.ts`, `regex-validation.ts`, `sys/glob.ts` | named only in comments                         |
| T7   | `compile-smoke-gate.ts`, `compile-smoke-gate.test.ts`      | named only in comments (236, 602)              |

This is the asymmetry the byte count hides. An agent doing a rename from
ripgrep output is handed files whose only "reference" is prose in a comment.
Serena's answers were reference-accurate. The pilot's kill threshold does not
score precision, so this does not rescue the verdict — but it is the one result
that would justify revisiting the question with a different bar.

**Ground-truth revision, stated plainly.** The initial ground truth was derived
with `rg -w`, which cannot distinguish a code reference from the symbol's name
appearing in prose. Four entries turned out to be comment-only mentions,
verified by reading the cited lines. They were removed under one rule applied
uniformly to every task — _a mention inside a comment is not a reference_ — and
re-listed as decoys. This revision happened **after** a first scoring pass and
it moved numbers in serena's favour (removing 3 serena misses) while creating
the baseline false positives above, so it is recorded here rather than quietly
applied. The single remaining serena miss (T3) survived the revision.

---

## Friction rows, verbatim

**1. Harness bug, not a serena finding — ripgrep blocked on stdin (cost ~12 min).**
The first full run appeared to hang. Serena's log went quiet after T1 and both
the serena process and the language server sat at ~0.08 s CPU per 10 s. The
cause was in the pilot's own baseline arm: `spawn(rg, args)` with piped stdio
and **no path argument**. With no path and a non-TTY stdin, ripgrep searches
_stdin_ and blocks forever. Evidence: `rg` PID 62000, started 22:55:48 —
exactly T1's baseline — 0.02 s CPU after 12 minutes. Fixed by passing an
explicit `.` and setting `stdio[0] = 'ignore'`. **Recorded because it initially
looked like a Windows/LSP stall and would have been reported as one.**

**2. Harness bug — `find_symbol` matches nested name paths.**
Chaining `find_symbol` → `find_referencing_symbols` naively picked the first
result as "the definition". For `applyRulesToAdditionsBounded` that was
`runCompiledRules/applyRulesToAdditionsBounded` (kind `Constant`, a local alias
in the CLI package) rather than the real `Function`. The reference search was
then run against the wrong file. Fixed by preferring an exact, un-nested
`name_path` of a definition-ish kind in a non-test file.

**3. Observed once, did not reproduce — silently incomplete reference results.**
On the first-ever run against this project, `find_referencing_symbols` for
`requiresSuppressesMatch` returned `{}` — 2 bytes, `isError=false` — for a
symbol with five cross-file consumers. An isolated re-run of the identical call
returned all five (7140 bytes), and two subsequent full runs (one with the
symbol cache deleted) returned the complete set every time. The condition was
not reproduced and the artifact from that run was not retained, so this is
logged as an observation rather than a measured result. It is recorded because
of its _shape_: the failure returned **success with fewer results**, not an
error. A silently-truncated reference set is the most dangerous failure mode a
retrieval tool can have, since nothing downstream can detect it.

**4. Not encountered.** The brief anticipated TypeScript language-server startup
failure, indexing hangs >10 min, or tool errors on Windows. None occurred. LSP
startup was 0.574 s and every tool call returned `isError=false`. Windows
viability was not the reason this pilot failed.

---

## Zero mutation

`git status --porcelain` before the run: **empty** (clean tree) at
`c7c59334a3ae58e256187b865440955cf3a6d0dd`, branch `wt/spine-spike`.

Serena created `<worktree>/.serena/` — **66.2 MB** across 4 files, almost all of
it `cache/typescript/document_symbols.pkl` (53 MB) and
`raw_document_symbols.pkl` (16 MB).

**Finding:** serena writes a `.gitignore` _inside_ `.serena/` containing
`/cache` and `/project.local.yml`. Had `.serena/` ever been committed, 66 MB of
pickled cache would have been invisible to `git status` from then on. In this
run the directory itself was untracked, so `git status` did show `?? .serena/`
— but it showed one line, not 66 MB. **A `git status --porcelain` diff alone is
not sufficient evidence of zero mutation for this tool**; the verification must
also sweep the filesystem, which `src/verify-clean.ps1` does.

### Verification result

After removing serena's residue:

```
filesystem sweep for .serena* in the checkout   ->  none (pass)
git status --porcelain                          ->  ?? spikes/serena-pilot/
git status --porcelain --untracked-files=no     ->  (empty)
git rev-parse HEAD                              ->  c7c59334a3ae58e256187b865440955cf3a6d0dd
git rev-parse --abbrev-ref HEAD                 ->  wt/spine-spike
```

The single untracked entry is this pilot's own authored directory, which the
brief scoped the work to. **No tracked file was modified**, HEAD and branch are
unchanged, and nothing serena wrote survives in the checkout.

Provenance note: the authoritative pre-run capture (an **empty** porcelain, taken
before serena was ever started) and the post-run checks above were both run
inline as shown. `src/verify-clean.ps1` packages the same two checks for reuse
and was exercised afterwards against the post-cleanup tree — it is the reusable
form of this verification, not the run that produced the result above.

---

## Uninstall

Everything serena wrote, and where:

| Location                    | Size         | Inside checkout? | Disposition                                                   |
| --------------------------- | ------------ | ---------------- | ------------------------------------------------------------- |
| `<worktree>/.serena/`       | 66.2 MB      | **yes**          | deleted; absence verified                                     |
| `$SERENA_HOME` (scratchpad) | 25.3 MB      | no               | deleted; 24.8 MB of it the managed TS language server         |
| `~/.serena/`                | 0 files      | no               | two empty dirs; see note                                      |
| `%LOCALAPPDATA%\uv\cache`   | 232.5 MB     | no               | `uv cache clean` — executed, "Removed 13232 files (232.5MiB)" |
| `%APPDATA%\uv\tools`        | 2 files, 0 B | no               | removed; see note                                             |

All four locations were re-checked after removal:

```
C:\Users\jmatt\AppData\Local\uv\cache      ABSENT (pass)
C:\Users\jmatt\AppData\Roaming\uv\tools    ABSENT (pass)
C:\Users\jmatt\.serena                     ABSENT (pass)
<worktree>\.serena                         ABSENT (pass)
uv --version                               uv 0.12.7 (61291a8ca)   <- deliberately retained
```

Note on `%APPDATA%\uv\tools`: `uv tool list` reported **"No tools installed"** —
`uvx` runs from an ephemeral environment, so no persistent tool venv was ever
created and `uv tool uninstall` had nothing to act on. The directory held two
zero-content bookkeeping files (a `.gitignore` containing `*`, and an empty
`.lock`), created by this pilot's own `uv tool dir` probe. Since the directory
was confirmed absent before the pilot began, it was removed to restore the exact
pre-state; no data was lost.

**`SERENA_HOME` was redirected to a scratchpad path for the whole pilot**, which
is why the managed language-server install, the global config, the logs and the
memory directories all landed outside both the checkout and the user's home. By
default all of that goes to `~/.serena/`. Serena also supports
`project_serena_folder_location` to move the _per-project_ `.serena/` out of the
checkout — deliberately **not** used here, so the measured run would reflect
serena's out-of-the-box footprint on a repository.

Note on `~/.serena/`: it contained `memories/` and `memories/global/` — two
empty directories, no files. `SerenaPaths.__init__` unconditionally
`mkdir(parents=True, exist_ok=True)`s the global memories path, and pointing
`SERENA_HOME` at a fresh scratchpad path reproduced exactly that shape, so these
were created by the pilot's own first `serena --help` invocation. They were
removed. No file was deleted, because there were none.

The uv cache and tool venv are **machine-level, outside the checkout**. Both
directories were confirmed **absent before the pilot began**, so removing them
has no collateral: the entire 232.5 MB was pilot-created. `uv` itself is
owner-installed and stays — only its cache was cleared.

---

## Tenet-8 wiring note

**In this pilot, serena's output fed a measurement script, not an agent
context.** Every byte it returned was consumed by `run-pilot.mjs`, scored
against pre-derived ground truth, and never routed to a model. That is the only
reason the pilot could treat the output as inert.

Adoption would not have that property. Serena reads the working tree and returns
file contents, symbol bodies and `content_around_reference` snippets — text
whose provenance is the repository, including branches, dependencies, and
anything an agent-authored commit put there. Wired to an agent, serena is an
**untrusted context source**: its output is attacker-influenceable data, not
instructions, and must be framed as such at the boundary. Three specifics this
pilot surfaced:

- **The tool list is the enforcement point, not the config.** As above,
  `read_only: true` leaves editing verbs advertised. Any adoption must assert on
  `tools/list` at startup and fail closed, or it has not bounded the tool
  surface at all.
- **Keep projects untrusted.** `trusted_project_path_patterns` was left empty.
  A _trusted_ project may run `activation_command` — an arbitrary shell command
  read from the checkout's own `.serena/project.yml` — before the language
  backend starts. Trusting a project path means a file in the repository can
  execute code at server start. That is a supply-chain edge, and the empty list
  is the correct default.
- **Silent truncation defeats downstream checks.** Friction row 3 returned
  success with an empty result set. A consumer that treats "serena found no
  other references" as evidence of _absence_ would be wrong, and nothing in the
  response distinguishes that case.

---

## Retirement evidence for mmnto-ai/totem#647 and mmnto-ai/totem#662

Both parked issues want symbol-grade retrieval: a symbol index, and a "did you
mean Z" suggestion when a name is nearly matched. **On this evidence, serena
v1.7.0 does not retire either one, and the measurement says something sharper
than "not yet".**

The symbol-index intent is genuinely served on the _quality_ axis and only
there. Serena answered six of seven tasks with reference-accurate results and
one false positive, against the baseline's nine — it reliably distinguishes a
code reference from the symbol's name sitting in a comment, which is precisely
the discrimination a text index cannot make and the thing mmnto-ai/totem#647
exists to buy. But it costs ~20× the latency and 1.5× the bytes at the median,
it is bounded by the TypeScript project graph (T3: live `.mts` code outside
`rootDir` is simply invisible, where ripgrep sees it), and it carries a 66 MB
in-checkout cache plus a 5.6 s cold-index penalty. A symbol index that cannot
see part of the repository does not retire an issue about indexing the
repository.

For the "did you mean Z" intent of mmnto-ai/totem#662, the evidence is more
directly negative: nothing in the exposed surface does fuzzy or near-miss symbol
resolution. `find_symbol` offers `substring_matching`, which is substring
containment, not edit distance — it will not get from a misspelling to the
intended symbol. That capability would have to be built regardless of whether
serena is adopted, so mmnto-ai/totem#662 is untouched by this pilot.

The honest read: these issues stay parked, and serena is not the thing that
unparks them. If the byte-and-latency bar is the real constraint, ripgrep wins
and mmnto-ai/totem#647 should be re-scoped around precision rather than
retrieval cost — because _precision_ is the only axis on which this pilot found
a real gap, and it is the axis the kill threshold did not measure.

---

## Reproducing

```powershell
$env:SERENA_HOME = "<scratch>\serena-home"   # keeps everything out of ~ and the checkout
$env:TOTEM_RG    = "<path>\rg.exe"

Copy-Item config\serena_config.yml  $env:SERENA_HOME\serena_config.yml
Copy-Item config\totem-pilot.yml    $env:SERENA_HOME\contexts\totem-pilot.yml
Copy-Item config\project.yml        <worktree>\.serena\project.yml

node src\probe.mjs        # handshake + assert the retrieval-only tool list
node src\warmup.mjs       # indexing cost, isolated
$env:PILOT_RUN_LABEL="cold"; node src\run-pilot.mjs
$env:PILOT_RUN_LABEL="warm"; node src\run-pilot.mjs
node src\combine.mjs      # -> artifacts/serena-report.json

pwsh -NoProfile -File src\verify-clean.ps1 -Phase post
```

| File                                                                          | Role                                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/client.mjs`                                                              | zero-dependency MCP stdio client; per-call wall time + byte accounting  |
| `src/config.mjs`                                                              | pin, paths, spawn spec, tool-name groups for the bound check            |
| `src/tasks.mjs`                                                               | the 7 tasks, ground truth, decoys, both arms                            |
| `src/run-pilot.mjs`                                                           | runs both arms, scores, computes the verdict mechanically               |
| `src/probe.mjs`, `src/warmup.mjs`, `src/schemas.mjs`, `src/diagnose-refs.mjs` | bring-up, indexing, schema dump, the friction-row-3 falsification probe |
| `src/combine.mjs`, `src/verify-clean.ps1`                                     | canonical report; mutation/uninstall verification                       |
| `artifacts/serena-report.json`                                                | canonical result, both runs embedded                                    |

`bytes` is the UTF-8 length of the tool's returned **content** — what an agent
would be charged for in context — not the JSON-RPC envelope, which is recorded
separately as `envelopeBytes`.
