# Totem Architecture & Workflows

Totem is designed as an "Invisible Exoskeleton" for development teams and AI agents. It operates not as a static tool, but as a continuous, self-healing loop that converts institutional knowledge into deterministic physical constraints.

This document contains several views of the architecture, ranging from high-level workflows to deep-dive structural layers.

---

## 1. The Flywheel (Observe → Learn → Enforce)

This is the core functional loop of Totem. It visualizes how friction identified during code review is systematically converted into a fast, local guardrail.

```mermaid
graph TD
    %% Define Styles
    classDef observe fill:#4b3a75,stroke:#9b72cf,stroke-width:2px,color:#fff
    classDef learn fill:#5e3a24,stroke:#e67c3b,stroke-width:2px,color:#fff
    classDef enforce fill:#1a4d2e,stroke:#34a853,stroke-width:2px,color:#fff
    classDef core fill:#2d2d2d,stroke:#888,stroke-width:1px,color:#fff

    %% The Flywheel
    subgraph "1. The Eye (Observe)"
        Shield[totem review<br/>LLM PR Review]:::observe
        Triage[Bot Triage<br/>CodeRabbit / GCA]:::observe
    end

    subgraph "2. The Brain (Learn)"
        Extract[totem extract<br/>Capture Markdown Lesson]:::learn
        Compile[totem lesson compile<br/>Generate Regex/AST]:::learn
    end

    subgraph "3. The Hand (Enforce)"
        Lint[totem lint<br/>Zero-LLM Check]:::enforce
        Hooks[Git Hooks<br/>pre-commit / pre-push]:::enforce
    end

    %% Connections
    Shield -->|Flags Issue| Extract
    Triage -->|Extracts Nits| Extract
    Extract -->|Writes| Compile
    Compile -->|Emits Rule| Lint
    Lint -->|Blocked by| Hooks

    %% The Self-Healing Path
    Hooks -.->|Developer Bypass| Ledger[(Trap Ledger)]:::core
    Ledger -.->|totem doctor --pr| Compile
```

---

## 2. The Agent Governance Pipeline

This diagram shows how Totem "weaponizes" project management to govern autonomous AI agents (like Claude Code or Gemini CLI), preventing them from reinventing wheels or suffering from "Session Start Amnesia."

```mermaid
sequenceDiagram
    participant Dev as Human / Architect
    participant Strategy as Strategy Repo (Governance OS)
    participant Agent as Local AI Agent
    participant Product as Main Codebase

    Note over Strategy: The "Kernel" of Governance
    Dev->>Strategy: Merges ADR / Proposal
    Strategy->>Strategy: totem lesson compile (Self-Governance)
    Strategy-->>Product: Exports Approved Architectural Rules

    Note over Agent, Product: The Agent Workflow
    Agent->>Product: Starts Session
    Product-->>Agent: Smart Briefing (Git State, Health, Reflexes)
    Note over Agent: Agent is "hydrated" with<br/>context before Turn 1

    Agent->>Product: totem spec <issue>
    Product-->>Agent: Spec injected with Shared Helpers (Prior Art)

    Agent->>Product: Writes Code
    Agent->>Product: git commit
    Product-->>Agent: Blocked! (totem lint caught native module import)
    Agent->>Product: Refactors to use Shared Helper
    Product-->>Agent: git commit success
```

---

## 3. The Self-Healing Engine

Totem assumes LLMs will hallucinate and developers will get frustrated. This diagram illustrates how the Trap Ledger turns a developer bypassing a guardrail into actionable telemetry that automatically tunes the system.

```mermaid
graph LR
    %% Styles
    classDef dev fill:#2d2d2d,stroke:#888,color:#fff
    classDef system fill:#1a4d2e,stroke:#34a853,color:#fff
    classDef data fill:#5e3a24,stroke:#e67c3b,color:#fff
    classDef action fill:#4b3a75,stroke:#9b72cf,color:#fff

    Developer((Developer)):::dev
    Lint[totem lint / review]:::system
    Override["totem-context directive<br/>or --override flag"]:::action
    Ledger[(Trap Ledger<br/>events.ndjson)]:::data
    Doctor[totem doctor --pr]:::system
    Nursery[Rule Nursery]:::action

    Developer -->|Gets blocked by| Lint
    Developer -->|Uses Escape Hatch| Override
    Override -->|Logs justification| Ledger
    Doctor -->|Analyzes| Ledger
    Doctor -->|Detects High Bypass Rate| Nursery
    Nursery -->|Auto-Downgrades to Warning| Lint
```

---

## 4. Deep Dive: Structural Layers

This diagram visualizes the separation of concerns within the codebase itself. It divides the system into the fuzzy semantic layer, the rigid deterministic layer, and the persistent memory mesh.

```mermaid
graph TD
    %% ─── USERS & AGENTS ───
    subgraph "The Actors"
        Dev[Human Developer]
        LocalAI[Local AI Agents<br/>Claude Code / Cursor]
        RemoteAI[Remote Review Bots<br/>CodeRabbit / GCA]
    end

    %% ─── THE SEMANTIC OVERLAY (Fuzzy, Contextual, LLM-Driven) ───
    subgraph "Layer 1: Semantic Overlay"
        Shield[totem review<br/>LLM PR Review]
        Triage[/review-reply<br/>Multi-Bot Triage/]
        Hints[Smart Hints<br/>// totem-context:]
        Extract[Pipeline 6<br/>Bot → Lesson Extraction]
    end

    %% ─── THE DETERMINISTIC SUBSTRATE (Rigid, Fast, Zero-LLM) ───
    subgraph "Layer 2: Deterministic Substrate"
        Lint[totem lint<br/>AST / Regex Engine]
        SARIF[SARIF / PR Comment<br/>Managed Summary]
        Hooks[Git Hooks<br/>pre-push / pre-commit]
        Compiler[Totem Compiler<br/>Lesson → compiled-rules.json]
        DLP[DLP Masking<br/>User-Defined Secrets]
    end

    %% ─── THE MEMORY MESH (Persistent State) ───
    subgraph "Layer 3: Memory Mesh"
        LanceDB[(LanceDB<br/>Vector Index)]
        Lessons[Lessons<br/>.totem/lessons/]
        Rules[Compiled Rules<br/>compiled-rules.json]
        Registry[Global Registry<br/>~/.totem/registry.json]
    end

    %% ─── AUTHORING FLOW ───
    Dev -->|Writes Code| Hooks
    LocalAI -->|Writes Code| Hooks
    Hints -.->|Surgical Override| Shield

    %% ─── MCP CONTEXT ───
    LocalAI <==>|MCP: search_knowledge| LanceDB

    %% ─── ENFORCEMENT ───
    Hooks -->|Triggers| Lint
    Lint -->|Reads| Rules
    Lint -->|Outputs| SARIF

    %% ─── COMPILATION ───
    Lessons -->|Compiles| Compiler
    Compiler -->|Emits| Rules
    Lessons -->|Embeds| LanceDB

    %% ─── REVIEW LOOP ───
    Shield -->|Reviews Diff| Dev
    RemoteAI -->|Posts Comments| Triage
    Triage -->|fix / defer / nit| RemoteAI
    Triage -->|extract| Extract
    Extract -->|Writes Nursery Lesson| Lessons

    %% ─── STYLING ───
    classDef semantic fill:#4b3a75,stroke:#9b72cf,stroke-width:2px,color:#fff
    classDef determin fill:#1a4d2e,stroke:#34a853,stroke-width:2px,color:#fff
    classDef storage fill:#5e3a24,stroke:#e67c3b,stroke-width:2px,color:#fff
    classDef actors fill:#2d2d2d,stroke:#888,stroke-width:1px,color:#fff

    class Shield,Triage,Hints,Extract semantic
    class Lint,SARIF,Hooks,Compiler,DLP determin
    class LanceDB,Lessons,Rules,Registry storage
    class Dev,LocalAI,RemoteAI actors
```
