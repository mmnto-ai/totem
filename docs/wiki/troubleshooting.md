# Troubleshooting

## Git Hooks

### Hooks not firing on Mac/Linux

If you clone a repository that was initialized on Windows and the git hooks fail to fire, Git may not recognize them as executable. The `chmod` permissions are often lost in translation between Windows and POSIX filesystems.

**Fix:**

<!-- docs CHMOD_HOOKS -->

```bash
chmod +x .git/hooks/pre-commit .git/hooks/pre-push .git/hooks/post-merge .git/hooks/post-checkout
```

<!-- /docs -->

This applies the execute permission that POSIX systems require. Windows users are unaffected — Git Bash executes hooks regardless of the permission bit.

### Hooks not firing with Husky

If your project uses Husky, Totem's `install-hooks.js` detects `.husky/` and skips direct `.git/hooks/` installation. Add Totem's hook commands to your Husky config instead:

```bash
# .husky/pre-push
pnpm exec totem lint
```

## Ollama

### Model not found errors

If `totem sync` or `totem shield` fails with "model not installed" when using Ollama, the required model hasn't been pulled yet.

**Fix:**

```bash
# For embeddings (default model)
ollama pull nomic-embed-text

# For orchestration (use whatever model you configured)
ollama pull gemma2:27b
```

## Embeddings

### Dimension mismatch after switching providers

If you switch embedding providers (e.g., from OpenAI 1536d to Gemini 768d), the existing `.lancedb` index becomes incompatible.

**Fix:**

```bash
# macOS / Linux
rm -rf .lancedb

# Windows (PowerShell)
Remove-Item -Recurse -Force .lancedb

# Then resync
totem sync
```

This rebuilds the index from scratch with the new dimensions.
