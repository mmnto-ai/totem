---
'@mmnto/totem': minor
'@mmnto/mcp': patch
'@mmnto/cli': patch
---

Totem now resolves its own CLI explicitly before it spawns it (mmnto-ai/totem#3008). The MCP tools `verify_execution` and `add_lesson`, and the CLI's `totem add-lesson` and `totem lesson add`, no longer pick a package-manager command from the lockfile, and they never run a bare `npx totem`, which names an unrelated registry package.

The MCP tools look for the workspace build (`packages/cli/dist/index.js`, guarded on `packages/cli/package.json` naming `@mmnto/cli`), then the pinned install (`node_modules/@mmnto/cli/dist/index.js`), both walking up from the project root, then a global installed by npm in one of its two layouts on PATH (the `totem` shim beside `node_modules` on Windows, the `totem` link elsewhere). An install is recognised by its path, `node_modules/@mmnto/cli`, so a fork installed under that alias keeps working and the label names it; where there is no such path (the workspace build, a linked global) the manifest's top-level name decides. They start the entry they find with `node` and no shell. When none resolves they spawn nothing and refuse, naming the places they looked and the cure: add `@mmnto/cli` to the project, or install it globally with `npm i -g @mmnto/cli`. `verify_execution` then returns `Verification: NOT RUN`, and on a run its result starts with a `CLI:` line that names the version and tier; `add_lesson`'s reply names the CLI its sync ran at the end of its sync sentence, so the reply still leads with the saved lesson. When an unverified `totem` earlier on PATH was skipped in favour of an npm-layout global, the label says so. A read failure inside the resolver is a refusal as well, naming the error, so that failure no longer makes `add_lesson` report a saved lesson as a failed write; an unreadable file in one PATH directory does not stop the scan before a valid install later on PATH. The CLI's two lesson commands start their background sync by spawning the running CLI itself with `node`.

What stops working: a project whose CLI is reachable only through its package manager (Yarn Plug'n'Play, pnpm `node-linker=pnp`) and a global installed outside npm's two layouts (`pnpm add -g`, Volta). Each now gets the refusal; a `totem` found on PATH that cannot be verified as an npm-layout install of `@mmnto/cli` is named in it and not run.

The lite build's `totem lesson add` starts no background sync, because the lite build has no `sync` command. It prints one line saying the index was not refreshed and that `totem sync` needs the full CLI.

`verify_execution` now declares `openWorldHint: false`, because it reaches no registry.

`@mmnto/totem` exports `resolveTotemCli`, `resolveLocalEntry` and `resolveGlobalEntry`, also from the subpath `@mmnto/totem/cli-resolve`.
