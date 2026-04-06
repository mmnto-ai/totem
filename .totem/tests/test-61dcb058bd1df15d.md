---
rule: 61dcb058bd1df15d
file: src/example.sh
---

<!-- Do not delete .totem/lessons.md (load-bearing for 41+ rules) -->

## Should fail

```ts
`git rm .totem/lessons.md` — destructive command in any script
```

## Should pass

```ts
`rm .totem/lessons/lesson-cd27a5b0.md` — individual lesson file deletion is allowed
```
