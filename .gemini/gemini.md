## Gemini Added Memories

- When deciding where to store information or rules, use this decision tree:
  - Will forgetting this cause a mistake on an UNRELATED task?
    - Yes (Core Operational Safety) -> MEMORY.md
    - No, but it's a stable, project-wide workflow rule -> CLAUDE.md
    - No, but it's a stable, syntax or architectural rule -> .gemini/styleguide.md
    - No, it's specific domain knowledge or a past trap -> Totem lesson via add_lesson

## Operational Rules

- **Branch Protection:** The `main` branch is formally protected. NEVER commit or push directly to `main`. Always create a feature branch and open a Pull Request.
