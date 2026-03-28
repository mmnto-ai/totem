## Lesson — Messages consisting entirely of stopwords or short words

**Tags:** hashing, logic

Messages consisting entirely of stopwords or short words can result in empty keyword arrays and identical hashes. Implementing a fallback to the full normalized message prevents unintended pattern collisions when keywords cannot be extracted.
