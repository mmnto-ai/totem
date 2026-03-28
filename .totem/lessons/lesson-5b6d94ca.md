## Lesson — When shield finds false positives on synchronous adapter

**Tags:** shield, false-positive, async, adapter

When shield finds false positives on synchronous adapter methods (e.g., flagging missing `await` on `replyToComment` which returns `void`), check the return type in `packages/cli/src/adapters/pr-adapter.ts` before adding `await`. Call sites are in `packages/cli/src/commands/triage-pr.ts` and `packages/cli/src/services/deferred-issuer.ts`. The Gemini shield model frequently assumes adapter calls are async network operations when they're actually synchronous `safeExec` wrappers.

**Source:** mcp (added at 2026-03-28T07:11:27.941Z)
