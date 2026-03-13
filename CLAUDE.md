# @mmnto/totem — Claude Code Configuration

## What Is This?

Totem is a persistent memory and context layer for AI agents. Built on MCP (Model Context Protocol), it replaces brute-force context stuffing with semantic retrieval over code, session history, specs, and design tokens.

**"Your AI forgets. Totem remembers."**

- **GitHub:** `mmnto-ai/totem`
- **npm:** `@mmnto/totem`, `@mmnto/cli`, `@mmnto/mcp`
- **First consumer:** [satur8d/satur8d](https://github.com/satur8d/satur8d) (sports analytics platform)
- **Architecture proposal:** See `satur8d` repo at `proposals/totem-architecture.md`
- **Tracking issue:** satur8d/satur8d#643

---

## Architecture Decisions (Locked)

These are finalized. Do not revisit or suggest alternatives.

### Infrastructure

- **Vector DB:** LanceDB — embedded, in-process Node.js, zero infrastructure. Creates a local `.lancedb` folder (like SQLite).
- **LanceDB versioning:** blow away + re-index. No migrations. `.lancedb` is a build artifact like `node_modules`.
- **Embedding model (default):** OpenAI `text-embedding-3-small` — lowest onboarding friction for multi-dev teams (designers don't need Ollama)
- **Embedding model (alternative):** Ollama `nomic-embed-text` — supported via config for offline/power users
- **Unified store:** single LanceDB index with metadata type filtering (`code | session_log | spec`). No separate databases.

### Package Structure (Turborepo monorepo)

```
packages/
  core/     → @mmnto/totem   — LanceDB + chunking logic
  cli/      → @mmnto/cli     — totem init, totem sync, totem search, totem stats
  mcp/      → @mmnto/mcp     — stdio MCP server
```

### Naming Convention (Vanilla)

The `anchor/spin/kick` metaphor from the Inception-inspired philosophy lives in docs only. All shipped interfaces use standard, self-documenting names:

| Concept                  | Shipped Name                                               |
| ------------------------ | ---------------------------------------------------------- |
| Query the index          | `search_knowledge(query, type_filter?, max_results?)`      |
| Persist a lesson         | `add_lesson(lesson, context_tags)`                         |
| Reset context            | `reset()` — deferred to Phase 2                            |
| Re-index from source     | `totem sync`                                               |
| First-time project setup | `totem init`                                               |
| Detect config tier       | `getConfigTier(config)` → `'lite' \| 'standard' \| 'full'` |
| Guard embedding access   | `requireEmbedding(config)` → throws friendly error         |
| Compile lessons to rules | `totem compile` → `.totem/compiled-rules.json`             |
| Deterministic CI gate    | `totem shield --deterministic` → zero-LLM enforcement      |

### MCP Interface (Phase 1 — two tools only)

- `search_knowledge(query, type_filter?, max_results?)` — read path
- `add_lesson(lesson, context_tags)` — write path (writes to `.totem/lessons/` in the consuming project)
- `sync` and `stats` are CLI-only — no MCP exposure

---

## Chunking Strategy

All chunking is **syntactic** (structure-aware), never blind character splitting.

### TypeScript & React

- Chunk by function, class, interface, component, hook using AST parser
- **Context injection:** prepend `File: <path> | Context: The '<name>' function` before embedding

### Markdown (Specs, Docs, Design Tokens)

- Chunk by `##` and `###` headings
- **Metadata injection:** parse frontmatter for status/date: `{ type: "spec", id: "spec-258", status: "implemented", date: "2025-10-12" }`

### Session Logs

- **Hierarchical Markdown Chunking** — preserve parent heading breadcrumbs for every paragraph/bullet
- **Breadcrumb injection:** `[Session 142 > Traps > Next.js Caching] We found that...`
- This is the **most critical** chunker — build first

### Database Schema Files

- Chunk by exported table/relation

### Test Files

- Chunk by `describe`/`it` blocks (tests as documentation)

### Libraries to Use

- Markdown AST: `mdast` / `remark`
- TypeScript AST: `langchain/text_splitters` (RecursiveCharacterTextSplitter for TS) or lightweight AST parser
- Validation: Zod for LanceDB schema typing

---

## Configuration Model

### `totem.config.ts`

Lives at the root of the **consuming project** (not in this repo). Defines:

- Glob patterns for ingest targets
- Chunking strategy per file type
- Embedding provider (openai or ollama) — **optional** (omitted in Lite tier)
- Orchestrator (shell, gemini, or anthropic) — **optional** (omitted in Standard/Lite tiers)
- Docs array for `totem docs` auto-update targets — **optional**

### Configuration Tiers

| Tier         | Requirements                     | Available Commands                      |
| ------------ | -------------------------------- | --------------------------------------- |
| **Lite**     | Zero API keys                    | `init`, `add-lesson`, `bridge`, `eject` |
| **Standard** | Embedding key (OpenAI or Ollama) | Lite + `sync`, `search`, `stats`        |
| **Full**     | Embedding + Orchestrator         | All commands                            |

Tier is determined by `getConfigTier(config)` from `@mmnto/totem`. Commands that require embeddings call `requireEmbedding(config)` which throws a friendly error directing users to upgrade.

### `totem init`

Auto-scaffolds a `totem.config.ts` by scanning the target repo:

- Detects `tsconfig.json` → sets TypeScript glob
- Detects `docs/`, `specs/`, `context/` → sets markdown globs
- **Auto-detects `OPENAI_API_KEY`** in env or `.env` → skips prompt, uses OpenAI embeddings
- Falls back to prompting for API key; pressing Enter generates a Lite tier config
- Generates a working config with zero manual editing required

### `.totem/` Directory (in consuming project)

- `.totem/lessons/` — directory of per-lesson files (one lesson per `.md` file)
  - `baseline.md` — Universal AI Developer Baseline lessons (installed by `totem init`)
  - `lesson-<hash>.md` — individual lessons (deterministic filenames via SHA-256)
- `.totem/lessons.md` — **legacy** single-file format (read during deprecation, new writes go to `lessons/`)
- Committed to git, reviewed in PR diffs
- Re-indexed by `totem sync`
- Run `totem migrate-lessons` to convert legacy `lessons.md` to the directory format

### `.lancedb/` (in consuming project)

- Gitignored. Build artifact.
- Blown away and re-indexed when chunking strategy changes.

---

## Multi-Developer Sync

- `.lancedb` gitignored; source of truth = committed markdown/code files
- `totem sync` triggered by post-merge git hook (incremental via git diff)
- Cold start: seconds via OpenAI (default), 1-3 min via Ollama
- Full re-index only on fresh clone; post-merge hook does incremental updates only
- **Linked Dev Loop:** use `pnpm link` to develop totem alongside consumer projects without publishing to npm

---

## Learning Loop (Shift-Left PR Reviews)

The highest-value differentiator. Closes the gap where AI makes the same mistake across multiple PRs.

1. **Claude auto-extracts lessons** from failed PR reviews / Shield checks
2. **`add_lesson`** writes the lesson to `.totem/lessons/` (a committed directory in the consuming project)
3. **Human reviews** the lesson in the PR diff — delete bad lessons before merge
4. **`totem sync`** re-indexes after merge — bad lessons erased, good lessons persisted
5. **Shield queries Totem** before next push: "What traps exist for this type of code?"

---

## Embedding Provider DX

### Error Handling

If any command requiring embeddings runs without a configured provider, `requireEmbedding()` throws:

```
[Totem Error] No embedding provider configured.
This command requires embeddings (Lite tier does not support it).
Set OPENAI_API_KEY in your .env and re-run `totem init`, or add an 'embedding' block to totem.config.ts.
```

### Provider Config (in totem.config.ts)

```typescript
// OpenAI (default)
embedding: { provider: 'openai', model: 'text-embedding-3-small' }

// Ollama (offline/power user)
embedding: { provider: 'ollama', model: 'nomic-embed-text', baseUrl: 'http://localhost:11434' }
```

---

## Development Workflow

### Git & Branching

- **Branch Protection:** The `main` branch is formally protected. NEVER commit or push directly to `main`.
- **Workflow:** Always create a feature branch, commit your changes there, and open a Pull Request. Direct pushes to `main` bypass the Shift-Left safety checks (Pre-Push CI and PR Review Bots).
- **Never amend commits** on feature branches — create new commits for each fix round.
- **Use `Closes #NNN`** in PR descriptions to auto-close issues on merge.

### Environment

- **Platform:** Windows 11 + Git Bash
- **Package manager:** pnpm (ALWAYS — never npm or yarn). **Never use `npx`** — use `pnpm dlx` instead.
- **Monorepo tool:** Turborepo
- **Language:** TypeScript (strict mode)

### Key Commands (once scaffolded)

```bash
pnpm install              # Install deps
pnpm build                # Build all packages
pnpm test                 # Run tests
pnpm dev                  # Watch mode
```

### Code Style

- TypeScript strict mode
- `kebab-case.ts` for files, `PascalCase.tsx` for React (if any)
- Use `err` (never `error`) in catch blocks
- Extract magic numbers into named constants
- No empty catch blocks — always log or throw
- Zod for runtime validation at boundaries
- Always run `pnpm run format` before committing new files

### Contributor Principles

- **Consumer-first thinking:** Changes to AI reflexes, hooks, or prompts must update the `AI_PROMPT_BLOCK` template in `init.ts` — not just the local dev environment. Consumers must get updates out of the box.
- **GCA decline → lesson reflex:** When declining a recurring GCA review suggestion, add a lesson with the `review-guidance` tag and update `.gemini/styleguide.md` §6 on the same PR. This keeps the styleguide current without manual maintenance.
- **Publishing:** Changesets + npm OIDC trusted publishing. Use `RELEASE_TOKEN` PAT for PRs (org blocks `GITHUB_TOKEN` from creating PRs). Use `pnpm run version` (never bare `pnpm version` — resolves to pnpm built-in). Changeset interactive CLI doesn't work with piped stdin — write files manually to `.changeset/`.

### npm Scope

- `@mmnto` org on npmjs.com (created)
- `@mmnto-ai` org claimed for brand protection

---

## Implementation Phases

Phase numbering follows `docs/roadmap.md` (the canonical source of truth).

### Foundations + Phase 1 (Onboarding) + Phase 2 (Core Stability): Complete

- Turborepo monorepo with three packages (core, cli, mcp)
- Syntax-aware chunkers (TypeScript AST, Markdown headings, session logs, schema files, test files)
- `totem sync` (full + incremental), OpenAI and Ollama providers
- MCP server with `search_knowledge` and `add_lesson`
- CLI orchestrator commands: `spec`, `shield`, `triage`, `briefing`, `handoff`, `extract`, `bridge`, `wrap`, `docs`, `eject`
- Shield GitHub Action for CI/CD enforcement (#180)
- Interactive multi-select for `totem extract` (#168)
- CLI command renames: `learn` → `extract`, remove `anchor` alias (#185)
- Published on npm, dogfooded in satur8d

### Phase 3: Workflow Expansion (current)

- ~~Minimum Viable Configuration tiers (#187)~~ — **Done.** Lite/Standard/Full tiers with env auto-detection.
- ~~Automated doc sync (#190)~~ — **Done.** `totem docs` command with per-doc LLM passes, integrated into `totem wrap` as Step 4/4.
- ~~Drift Detection for self-cleaning memory (#181)~~ — **Done.**
- ~~Native API Orchestrator (#229)~~ — **Done.** Gemini + Anthropic direct SDK calls with BYOSD optional peer deps.
- See `docs/roadmap.md` and `docs/active_work.md` for full priority list

### Phase 4 (Future): Enterprise Expansion

- Federated Memory / Mothership Pattern (#123)
- Tree-sitter multi-language chunking (#182)
- Cross-file Knowledge Graph (#183)
- Automated onboarding (`totem onboard`) (#124)

---

## Non-Goals (Phase 1)

- `reset()` / ephemeral memory partitioning
- Real-time indexing (batch re-index is fine)
- Cloud hosting (local-first)
- LLM-based pre-summarization of chunks (smart Node.js script is sufficient)
- Pre-built index artifacts (re-indexing is fast enough at current scale)

## Totem AI Integration (Auto-Generated)

You have access to the Totem MCP for long-term project memory. You MUST operate with the following reflexes:

### Memory Reflexes

1. **BLOCKING — Pull Before Coding:** Before writing or modifying code that touches more than one file, you MUST call `search_knowledge` with a query describing what you're about to change. This is not optional. The vector DB contains traps, edge cases, and architectural constraints that prevent rework. Skip this and you risk repeating a mistake that's already been solved.
2. **Pull Before Planning:** Before writing specs, architecture, or fixing complex bugs, use `search_knowledge` to retrieve domain constraints and past traps. For `totem spec`, this happens automatically via lesson pre-injection — but for ad-hoc planning, you must call it manually.
3. **Pull on Session Start:** At the beginning of every session, call `search_knowledge` with a broad query about the current task or area of work. The vector DB is your institutional memory — use it before relying on your own context window.
4. **Proactive Anchoring (The 3 Triggers):** You must autonomously call `add_lesson` when any of the following occur — do NOT wait for the user to ask:
   - **The Trap Trigger:** If you spend >2 turns fixing a bug caused by a framework quirk, unexpected API response, or edge case. (Anchor the symptom + fix).
   - **The Pivot Trigger:** If the user introduces a new architectural pattern or deprecates an old one. (Anchor the rule).
   - **The Handoff Trigger:** At the end of a session or when wrapping up a complex feature, extract the non-obvious lessons learned and anchor them.
5. **Tool Preference (MCP over CLI):** Always prioritize using dedicated MCP tools (e.g., GitHub, Supabase, Vercel) over executing generic shell commands (like `gh issue view` or `curl`). MCP tools provide structured, un-truncated data optimized for your context window. Only fall back to bash execution if an MCP tool is unavailable or fails.

Lessons are automatically re-indexed in the background after each `add_lesson` call — no manual sync needed.

### Memory Classification

When deciding where to store information or rules, use this decision tree:

- If forgetting this causes a mistake on an UNRELATED task (Core Safety): Store in your root agent memory file (e.g., CLAUDE.md or .gemini/gemini.md).
- If it's a stable, project-wide workflow rule: Store in project config (e.g., CLAUDE.md).
- If it's a stable syntax/style pattern: Store in the project's styleguide or linter rules.
- If it's domain knowledge, an edge case, or a past trap: You MUST use the Totem `add_lesson` tool to anchor it into the project's LanceDB.

### Workflow Orchestrator Rituals

[FOR LOCAL CLI/TERMINAL AGENTS ONLY] Do not attempt to run these commands if you are a headless bot or operating in a cloud PR environment (e.g., Gemini Code Assist on GitHub).
Totem provides CLI commands that map to your development lifecycle. Use them at these moments:

1. **Start of Session:** Run `totem briefing` to get oriented with current branch state, open PRs, and recent context. Run `totem triage` if you need to pick a new task.
2. **Before Implementation:** Run `totem spec <issue-url-or-topic>` to generate an architectural plan and review related context before writing code.
3. **Before PR/Push:** Run `totem shield` to analyze uncommitted changes against project knowledge — catches architectural drift and pattern violations.
4. **End of Session:** Run `totem handoff` to generate a snapshot for the next agent session with current progress and open threads.

### Cloud / PR Review Bots

[FOR CLOUD BOTS ONLY — e.g., Gemini Code Assist, GitHub Copilot PR Review]
You do NOT have access to the local CLI. Instead, use the Totem MCP tools directly:

1. **Before reviewing a PR:** Call `search_knowledge` with queries about the files and patterns being changed to check for known traps and architectural constraints.
2. **Before suggesting changes:** Call `search_knowledge` to verify your suggestion aligns with established project patterns and past lessons.
3. **When you spot a recurring issue:** Call `add_lesson` to persist the trap so future reviews catch it automatically.
