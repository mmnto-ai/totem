## Lesson — When selecting the "most recent N" commits from Git

**Tags:** git, topo-order, bounded-windows, predictable-robustness, advisory-rule-candidate

**Applies-to:** infrastructure

When selecting the "most recent N" commits from Git history, never rely on default commit-date order; request `git log --topo-order` and slice the ancestry-ordered list. Exception: unbounded queries over the complete reachable set, or windows explicitly defined by wall-clock dates. (Sweep TOTEM-SWEEP-010; anchor: #2197 @ 47a1fd39. Flagged for the ADR-111 mint path when the miner picks up candidates — its miss corpus must include explicitly wall-clock-defined windows.)

**Source:** mcp (added at 2026-07-12T03:09:07.634Z)
