## Lesson — Avoid changing established terminology in agent

**Tags:** documentation, testing, maintenance

Avoid changing established terminology in agent instructions if automated drift-detection tests assert exact string matches across multiple agent files. The architectural churn of updating several configuration files and tests often outweighs the benefit of minor semantic improvements like "bodies" versus "descriptions."
