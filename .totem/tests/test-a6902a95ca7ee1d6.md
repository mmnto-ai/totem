---
rule: a6902a95ca7ee1d6
file: packages/cli/build/example.sh
---

<!-- Use byte-level binary size checks -->

## Should fail

```ts
if [ "$MB" -gt 90 ]; then echo too big; fi
```

## Should pass

```ts
if [ "$SIZE" -gt "$HARD_LIMIT" ]; then echo too big; fi
```
