---
'@mmnto/cli': patch
---

fix(hooks): generated git hooks resolve the pinned / in-tree totem build before a volatile ambient global (mmnto-ai/totem#2053 / mmnto-ai/totem#2055).

`buildResolveBlock` checked `command -v totem` (the PATH-global) **first**, contradicting its own "prefer local workspace build" comment — so in a dev monorepo the hook ran a stale globally-installed `@mmnto/cli` against HEAD code, enforcing a 2-versions-stale ruleset (the `lesson-1ef06d16` global-vs-local divergence root cause).

The generated resolve cascade is now, in order: workspace-HEAD (`node packages/cli/dist/index.js`) → pinned `node_modules/@mmnto/cli/dist/index.js` → `pnpm exec totem` → `command -v totem` (PATH) → package-manager `dlx` fallback. Each pinned tier is **identity-guarded on the `@mmnto/cli` package** (tier-1 greps the package name + built dist; tier-2 targets `@mmnto/cli`'s own entry rather than a bare `totem` bin name a colliding package could shadow). Preferring the lockfile-pinned / in-tree build over a volatile ambient global is Tenet 14 (never tie governance to volatile state) applied at the resolver; ADR-072 §2's "PATH beats dlx" intent is preserved. Fixes all generated hooks (pre-push, post-merge, post-checkout) through the shared block. Scoped to the template only — already-installed stale hooks self-heal via the versioned-hooks upgrade (mmnto-ai/totem#1854).
