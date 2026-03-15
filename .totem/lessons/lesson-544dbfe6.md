## Lesson — CLI tools executed via pnpm dlx or npx often lack optional

**Tags:** architecture, dependencies, pnpm

CLI tools executed via `pnpm dlx` or `npx` often lack optional peer-dependency SDKs in the temporary environment. Implement shell-based fallbacks to system binaries or local providers like Ollama to ensure functionality without requiring users to manually install SDKs.
