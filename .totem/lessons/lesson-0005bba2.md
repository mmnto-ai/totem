## Lesson — When manually parsing CLI arguments, verify that a flag's

**Tags:** nodejs, cli, parsing

When manually parsing CLI arguments, verify that a flag's value exists and does not start with a hyphen to avoid interpreting the next flag as its parameter. Simple `indexOf` lookups are prone to this error, which can cause silent failures or confusing behavior when required arguments are omitted.
