## Lesson — Do not delete .totem/lessons.md (load-bearing for 41+ rules)

**Tags:** governance, lessons, trap, totem-self
**Pattern:** \b(?:git\s+rm|rm)\s+[^\n]{0,40}\.totem/lessons\.md\b
**Engine:** regex
**Scope:** **/*.sh, **/*.bash, **/*.zsh, **/*.md, **/*.ts, **/*.js, **/*.cjs, **/*.mjs, .claude/**/*, !**/*.test.*, !**/*.spec.*, !.totem/lessons/**, !.totem/lessons.md, !.totem/tests/**
**Severity:** error

# Do not delete `.totem/lessons.md` — it sources 41+ production rules

## What happened

During the 1.13.0 postmerge cleanup (mmnto/totem#1234 follow-up, 2026-04-06),
an agent tried to delete `.totem/lessons.md` because the lesson headings in
that file are ISO timestamps (a parser quirk from MCP batch ingestion via
the `add_lesson` tool). The instinct was "this is corrupt cruft, delete it."

The deletion was caught at the diff-review stage, but only AFTER `pnpm exec
totem lesson compile` had already pruned **51 rules** (41 with timestamp
headings + 10 adjacent) from `.totem/compiled-rules.json` because their
source lessons no longer existed on disk. The change was reverted via
`git checkout HEAD -- .totem/lessons.md .totem/compiled-rules.json`, but
the near-miss was 41 functional production rules — `os.tmpdir()` workspace
boundaries, `fs.createWriteStream($PATH)` stdio traps, regex anchoring,
LanceDB schema migration, MCP session lifecycle, and dozens more.

## Why the file looks like cruft (but isn't)

`.totem/lessons.md` is a single multi-lesson markdown file. Each section is
delimited by `## Lesson — <heading>`. When lessons are batch-ingested via
the MCP `add_lesson` tool without an explicit human-readable heading, the
heading defaults to the ingestion timestamp (e.g. `2026-03-02T09:18:21.092Z`).
These look like garbage — they're identifiers, not descriptions — but the
**body** of each section is a real, valuable lesson with concrete patterns
that compile into production rules.

41 of those sections currently produce live ast-grep rules in
`compiled-rules.json`. Many more are in the `nonCompilable` set as
intentionally archived. None of them are recoverable from anywhere else if
the file is deleted.

## The rule

This lesson compiles into a Pipeline 1 (manual) regex rule that fires on
any text matching `rm .totem/lessons.md`, `git rm .totem/lessons.md`,
`rm -rf .totem/lessons.md`, etc. across shell scripts, markdown docs,
TypeScript / JavaScript scripts, and Claude skill instructions. The rule
catches the destructive command at the point of intent — when a script,
documentation, skill, or commit message records the intent to delete the
file — *before* the deletion actually runs.

The rule does NOT scope to `.totem/lessons.md` itself or to other lesson
files, so this lesson and any future trap descriptions can quote the
dangerous command in their narrative without false-positiving.

**Example Hit:** `git rm .totem/lessons.md` — destructive command in any script
**Example Miss:** `rm .totem/lessons/lesson-cd27a5b0.md` — individual lesson file deletion is allowed

## What to do instead

If `.totem/lessons.md` ever needs cleanup:

1. **Edit, don't delete.** Open the file and remove specific `## Lesson —`
   sections that are truly garbage. Each section is independent; deleting
   one doesn't affect the others.
2. **Use `nonCompilable`.** If a specific lesson section produces a bad rule,
   compute its `lessonHash` (via `hashLesson(heading, body)` from
   `@mmnto/totem`) and add it to `compiled-rules.json#nonCompilable` —
   the compile pipeline will skip it forever without you having to touch
   the file.
3. **Heading rewrite is optional.** If the timestamp headings bother you,
   rewrite them to human-readable titles in-place. The lesson hash will
   change (since hash is computed from heading + body), so the old rules
   will be pruned and re-compiled under the new hashes. Plan for that
   churn before doing it.

## Why a lint rule and not a hook

Totem's thesis: deterministic constraints, not sticky notes. If an agent
made (or almost made) this mistake once, the right move is to encode the
constraint physically so the same agent (or the next one) cannot bypass it
by forgetting to read a memory file. A pre-push hook would also work, but
a compiled lint rule lives in `.totem/compiled-rules.json` alongside the
other ~395 production rules and runs everywhere `totem lint` runs — local
pre-push, CI, agent-driven workflows, everything.

**Source:** Salvaged from a near-miss on 2026-04-06 during the 1.13.0
postmerge lesson extract+compile cycle. Encoded as a lint rule to satisfy
totem's "use totem to govern totem" tenet (Gemini's framing).
