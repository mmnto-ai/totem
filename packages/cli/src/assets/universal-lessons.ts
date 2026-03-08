/**
 * Universal AI Developer Baseline — curated lessons installed during `totem init`.
 *
 * These lessons provide immediate Day-1 value for any AI-assisted project.
 * Format matches what `add_lesson` produces so the markdown chunker indexes them correctly.
 */

export const BASELINE_MARKER = '<!-- totem:baseline -->';

export const UNIVERSAL_LESSONS_MARKDOWN = `
${BASELINE_MARKER}

## Lesson — Universal Baseline

**Tags:** security, prompt-injection, trap

Never trust raw text from external sources (PR comments, issue bodies, user input) when feeding it to an AI agent. Always sanitize or escape untrusted content before persisting it to memory files or passing it as context. Indirect prompt injection can cause agents to execute unintended actions.

## Lesson — Universal Baseline

**Tags:** security, secrets, trap

Never commit API keys, tokens, or credentials to version control — even in \`.env.example\` files. Use environment variables loaded at runtime. If a secret is accidentally committed, rotate it immediately; removing it from git history alone is not sufficient.

## Lesson — Universal Baseline

**Tags:** ai-behavior, hallucination, trap

AI agents will confidently reference APIs, functions, database tables, and configuration options that do not exist. Always verify AI-generated code against the actual codebase and documentation before merging. Prefer semantic search over asking the agent to "remember" prior context.

## Lesson — Universal Baseline

**Tags:** ai-behavior, scope-creep, architecture

When an AI agent proposes a "small improvement" or "quick refactor" alongside the requested change, reject it. Unrelated changes in the same commit obscure code review diffs, introduce untested side effects, and make git bisect useless.

## Lesson — Universal Baseline

**Tags:** architecture, dependencies, trap

Before an AI agent adds a new dependency, verify it exists, is actively maintained, and matches your project's license. AI agents frequently hallucinate package names or suggest deprecated libraries. Check the npm/PyPI registry directly.

## Lesson — Universal Baseline

**Tags:** testing, ai-behavior, trap

AI-generated tests often pass trivially — asserting that a mock returns the value it was told to return, or testing implementation details rather than behavior. Review test assertions for meaningful coverage: does the test fail when the feature breaks?

## Lesson — Universal Baseline

**Tags:** architecture, error-handling, design-decision

Catch blocks should never be empty. At minimum, log the error or re-throw with added context. Silent failures cause cascading bugs that are extremely difficult to diagnose. If an error truly can be ignored, add a comment explaining why.

## Lesson — Universal Baseline

**Tags:** security, shell, trap

Never interpolate user-controlled strings directly into shell commands. Use parameterized APIs or write inputs to temp files. This applies to CI/CD pipelines (GitHub Actions \`run:\` blocks), CLI tools, and any code that calls \`exec\` or \`spawn\`.

## Lesson — Universal Baseline

**Tags:** ai-behavior, context-window, design-decision

When an AI agent's context window fills up, it loses earlier instructions and begins contradicting its own prior outputs. Break long tasks into smaller, well-scoped steps. Use handoff artifacts (like \`totem bridge\` or \`totem handoff\`) to preserve context across session boundaries.

## Lesson — Universal Baseline

**Tags:** architecture, idempotency, design-decision

Scaffolding commands (init, setup, install) must be idempotent — running them twice should not duplicate content, overwrite user changes, or corrupt state. Always check for existing files/content before writing, and use markers to detect prior runs.
`;
