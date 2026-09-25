## Lesson — Scale a uniqueness claim for a derived filename to what the code makes true

**Tags:** manual, fs, docs

A claim of uniqueness for a derived filename is scaled to what the code makes true: an underscore join keeps a-b/c and a/b-c apart, but a repository name may contain an underscore, an Enterprise Managed User handle is handle_shortcode, and punctuation sanitizes to dashes, so two repositories can still share a stem; say so and name the override flag (leg 3 on mmnto-ai/totem#2965).
