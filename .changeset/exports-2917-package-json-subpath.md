---
'@mmnto/cli': patch
'@mmnto/totem': patch
'@mmnto/mcp': patch
'@mmnto/pack-agent-security': patch
'@mmnto/pack-agent-workflow': patch
'@mmnto/pack-rust-architecture': patch
---

The exports maps of `@mmnto/cli`, `@mmnto/totem` and `@mmnto/mcp` expose the `./package.json` subpath, so `require('@mmnto/cli/package.json').version` and `import.meta.resolve('@mmnto/totem/package.json')` resolve instead of throwing ERR_PACKAGE_PATH_NOT_EXPORTED (mmnto-ai/totem#2917). Additive: every existing subpath and condition is unchanged, and `@mmnto/pack-rust-architecture` already carried the key. A workspace lock in core asserts the key on every published package's source manifest and resolves it through Node's own resolver, red on the previous maps; the packed-tarball arm covers `@mmnto/totem`, and `npm pack --dry-run` shows `package.json` in all three tarballs. Consumers that read the installed version by walking `node_modules` by path can use the package specifier from this version.
