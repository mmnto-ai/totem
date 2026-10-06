## Lesson — The ignore writer keeps the default set beside a custom dir

**Tags:** init, gitignore, config
**Scope:** packages/cli/src/commands/init.ts

`totem init` writes the local-state ignore lines for the configured `totemDir`, and always writes the default set as well. Two writers still hard-code the default directory whatever the config says, the secret store that add-secret writes and the ledger the session-start hook templates append to, so dropping the default lines for a custom directory would leave their files unignored. The default set goes once those writers read the configured directory (mmnto-ai/totem#3015). A configured directory that is the repository root, or is not a plain directory name, is refused with a summary row instead of being turned into an ignore pattern (mmnto-ai/totem#3013).
