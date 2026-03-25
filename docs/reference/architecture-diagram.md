# Totem Architecture

This diagram visualizes the core architecture of the Totem platform, separating the flow of code, memory, and governance into three distinct layers: The Semantic Overlay, The Deterministic Substrate, and The Memory Mesh.

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
        Shield[totem shield<br/>LLM PR Review]
        Triage[/review-reply<br/>Multi-Bot Triage/]
        Hints[Smart Hints<br/>// shield-context:]
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
