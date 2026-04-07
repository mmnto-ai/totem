# Installation Guide

Totem offers two installation paths: the standard Node.js package (recommended for full AI governance) and a Standalone Binary (recommended for pure linting in non-JS environments like Rust or Go).

## 1. Standard Installation (Requires Node.js)

If you have Node.js and a package manager (`npm`, `pnpm`, or `yarn`) installed, you do not need to globally install Totem. You can execute it on-demand:

```bash
# Recommended
pnpm dlx @mmnto/cli init
pnpm dlx @mmnto/cli lint
```

This ensures you are always running the latest version of the Codebase Immune System, with full access to the LanceDB vector database and LLM orchestrator.

## 2. Standalone Binary (Totem Lite)

For developers working in pure Rust, Go, or Python environments who do not want to install a Node.js runtime, Totem 1.12.0 introduced the **Totem Lite** binary.

This is a single, cross-platform executable containing the full AST-grep engine and zero-LLM enforcement capabilities.

### Installation

Download the binary for your architecture from the [GitHub Releases](https://github.com/mmnto-ai/totem/releases) page and add it to your `PATH`.

**Linux (x64):**

```bash
curl -L https://github.com/mmnto-ai/totem/releases/latest/download/totem-lite-linux-x64 -o totem
chmod +x totem
sudo mv totem /usr/local/bin/
```

**macOS (ARM64 / Apple Silicon):**

```bash
curl -L https://github.com/mmnto-ai/totem/releases/latest/download/totem-lite-darwin-arm64 -o totem
chmod +x totem
sudo mv totem /usr/local/bin/
```

**Windows (x64):**
Download `totem-lite-win32-x64.exe` from the Releases page and add the containing folder to your System `PATH` environment variable.

### Command Availability in Totem Lite

To keep the binary size manageable (~35MB), the Lite tier excludes the heavy C++ native bindings for the Vector Database and the LLM SDKs.

- **Fully Supported:** `totem init`, `totem lint`, `totem hooks`, `totem compile`, `totem doctor`, `totem status`, `totem rule` commands.
- **Excluded:** `totem review`, `totem extract`, `totem sync`, `totem spec`, `totem triage` (These will exit with code `78` and prompt you to use the full `npx @mmnto/cli` version).
