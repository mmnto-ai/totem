## Lesson — Memory protection limits must be applied consistently

**Tags:** nodejs, performance, security

Memory protection limits must be applied consistently to all external files being ingested, regardless of their location or extension. Neglecting root-level configuration files while guarding subdirectory files creates an inconsistent security posture and potential out-of-memory vectors.
