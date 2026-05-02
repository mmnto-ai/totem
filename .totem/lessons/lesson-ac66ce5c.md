## Lesson — Alpha-pilot publish exemption from Sigstore gating

**Tags:** security, review-guidance, alpha-pilot
**Scope:** packages/pack-*/package.json

This is a **bounded exemption**, not a general policy. During ADR-097 § Stage 1 alpha-pilot publishes only — and only while the Sigstore + in-toto verification gate is open, ticketed (currently `mmnto-ai/totem#1492`), and pre-implementation — pack publish-flips (`private: true → false`) may proceed without the cryptographic-signing gate satisfied. The exemption is conditional on (a) the alpha-pilot phase being active, (b) the gate ticket being explicitly open and tracked, and (c) the gating ticket itself authorizing the deferral. When `#1492` ships, every pack package (including those that flipped during alpha) re-flows through the gate as part of normal publish discipline. Outside this exception, security gates must be satisfied before publish.
