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

| Concept                  | Shipped Name                                          |
| ------------------------ | ----------------------------------------------------- |
| Query the index          | `search_knowledge(query, type_filter?, max_results?)` |
| Persist a lesson         | `add_lesson(lesson, context_tags)`                    |
| Reset context            | `reset()` — deferred to Phase 2                       |
| Re-index from source     | `totem sync`                                          |
| First-time project setup | `totem init`                                          |

### MCP Interface (Phase 1 — two tools only)

- `search_knowledge(query, type_filter?, max_results?)` — read path
- `add_lesson(lesson, context_tags)` — write path (appends to `.totem/lessons.md` in the consuming project)
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
- Embedding provider (openai or ollama)

### `totem init`

Auto-scaffolds a `totem.config.ts` by scanning the target repo:

- Detects `tsconfig.json` → sets TypeScript glob
- Detects `docs/`, `specs/`, `context/` → sets markdown globs
- Prompts: "Enter your OpenAI API key (or press Enter to configure local Ollama later)"
- Generates a working config with zero manual editing required

### `.totem/` Directory (in consuming project)

- `.totem/lessons.md` — version-controlled lessons from the learning loop
- Committed to git, reviewed in PR diffs
- Re-indexed by `totem sync`

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
2. **`add_lesson`** appends the lesson to `.totem/lessons.md` (a committed file in the consuming project)
3. **Human reviews** the lesson in the PR diff — delete bad lessons before merge
4. **`totem sync`** re-indexes after merge — bad lessons erased, good lessons persisted
5. **Shield queries Totem** before next push: "What traps exist for this type of code?"

---

## Embedding Provider DX

### Error Handling

If `totem sync` runs without a configured provider:

```
[Totem Error] No embedding provider configured.
Set OPENAI_API_KEY in your .env or configure 'ollama' in totem.config.ts.
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

### Environment

- **Platform:** Windows 11 + Git Bash
- **Package manager:** pnpm (ALWAYS — never npm or yarn)
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

### npm Scope

- `@mmnto` org on npmjs.com (created)
- `@mmnto-ai` org claimed for brand protection

---

## Implementation Phases

### Phase 1: Scaffold (current)

- Set up Turborepo with three packages (core, cli, mcp)
- Define `totem.config.ts` schema and types
- Implement `totem init` with project auto-detection
- Configure `.gitignore` for `.lancedb`

### Phase 2: Ingest Pipeline

- Build Breadcrumb Injector for session logs **first** (most critical)
- Build TypeScript AST chunker
- Build Markdown heading chunker with frontmatter metadata
- Build schema file and test file chunkers
- Implement `totem sync` (full + incremental)
- Support both OpenAI and Ollama providers

### Phase 3: MCP Server

- Implement `search_knowledge` and `add_lesson` tools
- Expose over stdio
- Test retrieval quality

### Phase 4: satur8d Integration (happens in satur8d repo)

- `pnpm link` totem into satur8d
- Upgrade oracle, spec, shield to use Totem
- Set up post-merge git hook

### Phase 5 (Future): reset() + Ephemeral Memory

- Add TTL/ephemeral flags to stored entries
- Implement `reset()` MCP tool

---

## Non-Goals (Phase 1)

- `reset()` / ephemeral memory partitioning
- Real-time indexing (batch re-index is fine)
- Cloud hosting (local-first)
- LLM-based pre-summarization of chunks (smart Node.js script is sufficient)
- Pre-built index artifacts (re-indexing is fast enough at current scale)
