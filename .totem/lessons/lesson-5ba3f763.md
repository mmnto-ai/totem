## Lesson — The use of isolated catch blocks returning empty result

**Tags:** architecture, search, resilience

The use of isolated catch blocks returning empty result sets for optional linked indexes ensures that external configuration or connection failures never block primary local operations. This prioritizes system availability over exhaustive correctness when dealing with non-critical federated data sources.
