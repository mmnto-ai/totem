## Lesson — The ignorePatterns field in totem.config.ts is shared

**Tags:** configuration, indexing, validation

The `ignorePatterns` field in `totem.config.ts` is shared between `totem sync` and `totem shield`. Using it to suppress validation violations for specific directories will inadvertently prevent those files from being indexed into the vector database.
