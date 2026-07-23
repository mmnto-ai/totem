## Lesson — Field-shy external-API responses are auth-class, never safe

**Tags:** manual

Field-shy external-API responses are auth-class, never safe defaults. When a sensor or detector consumes fetched data, an absent field (bypass_actors, a strict-policy flag, a non-array list body) must degrade the verdict to cannot-verify/unknown - treating absence as the safe value (empty list, skipped comparison, empty union) lets the sensor certify a posture it never observed. Split observed problems (real drift, warn) from unobserved fields (auth-class, unknown), and let observed drift outrank the observability gap. Ground: four same-class findings on PR mmnto-ai/totem#2486 (the Prop 296 s14 posture probes), fixed in commit 2c4d6057.
