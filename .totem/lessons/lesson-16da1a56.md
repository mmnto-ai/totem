## Lesson — Vector databases like LanceDB may silently accept query

**Tags:** vector-db, lancedb, embeddings

Vector databases like LanceDB may silently accept query vectors with incorrect dimensions, leading to semantically meaningless results rather than runtime errors. Persisting provider and dimension metadata during ingestion allows the system to verify compatibility before executing searches.
