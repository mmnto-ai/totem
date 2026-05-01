---
tags: ['rust', 'testing', 'initialization-order', 'simulation']
lifecycle: nursery
---

## Lesson — Test world builders that claim to replicate production

**Tags:** rust, testing, initialization-order, simulation

Test world builders that claim to replicate production topology must install resources and map data in the same order as production. Installing walls or impassable cells _after_ spawning agents means wall-skip logic is inoperative during spawn, silently diverging from production behavior even when the docstring claims equivalence. Enforce ordering by extracting a shared base builder so both production and test paths call the same sequenced setup.
