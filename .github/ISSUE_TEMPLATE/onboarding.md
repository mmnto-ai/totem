---
name: Onboarding
about: Template for onboarding new core contributors to the Totem repository
title: 'Onboarding: Welcome to Totem'
labels: ['onboarding']
assignees: ''
---

Welcome to the Totem project! 🎉

Since you're jumping in as a core contributor, here is the full onboarding rundown. We're building a highly-orchestrated AI workflow tool (Totem), and we aggressively dogfood it. This means the repo itself is heavily augmented with our own local AI memory (LanceDB) and Git hooks. 

### 1. Workspace & Toolchain
We are a `pnpm` monorepo. 
```bash
# 1. Clone the main repo AND the private strategy submodule
git clone --recurse-submodules https://github.com/mmnto-ai/totem.git
cd totem

# 2. Setup your environment variables for embeddings (required for totem sync)
# Copy the example or create a .env file with your OPENAI_API_KEY
echo "OPENAI_API_KEY=your_key_here" > .env

# 3. Install dependencies (strictly use pnpm, never npm/yarn)
pnpm install

# 4. Build the core, CLI, and MCP packages
pnpm build

# 5. Build your local AI vector index (creates the .lancedb directory)
node packages/cli/dist/index.js sync

# 6. Verify everything is working by running the tests
pnpm test
```

### 2. The Private Strategy Submodule
The `.strategy` folder is actually a Git submodule pointing to the private `mmnto-ai/totem-strategy` repository. This keeps sensitive docs out of the public open-source project.
- You must be explicitly invited to the `mmnto-ai/totem-strategy` repository to pull these files.
- You can navigate into `.strategy/`, edit files, and run standard `git commit` and `git push` commands just for the strategy repo.
- When the submodule pointer updates, you'll need to commit that pointer change in the main `totem` repo.

### 3. AI Setup & Dogfooding
To actually *use* Totem while building Totem (which is how we catch all our bugs):
1. Copy `.mcp.json.example` to `.mcp.json` and configure your local orchestrator settings if necessary.
2. We heavily rely on Gemini CLI and Claude Code locally. The `.gemini/` and `.claude/` directories contain the custom system prompts and hooks we use to govern the agents.
3. The `.totem/lessons.md` file is our active brain. It contains all the "traps" and architectural rules we've learned so far. The agents read this automatically. 

### 4. Core Rituals
If you dive into the code, note that `main` is protected.
We enforce these AI-assisted Git rituals:
*   **Always create a feature branch** and open a Pull Request (GCA auto-reviews PRs).
*   `totem spec <issue-url>` before writing code.
*   `totem shield` before pushing your branch to catch architectural drift against our stored lessons.

*Note: As a new contributor, you will be prompted by the CLA Assistant bot to sign the Contributor License Agreement on your first PR. Just reply to its comment to sign it.*

Let the team know if you hit any snags getting the local LanceDB or `pnpm` workspace humming. Glad to have you!