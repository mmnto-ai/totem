---
'@mmnto/cli': patch
---

fix(cli): `totem mail` no longer silently drops frontmatter-only dispatches over 2 KiB (#2118), and `totem mail --json` actually emits JSON (#2097).

`parseHeader` now parses to the closing `---` frontmatter delimiter instead of splitting on the first blank line — the old parser rejected any >2 KiB file without a blank-line separator, which silently dropped every cohort-convention dispatch (whole message in `subject:`, zero blank lines; 8/8 of the observed misses, up to 4,163 bytes of genuine frontmatter). The byte cap now bounds the closing-delimiter search window (16 KiB) instead of rejecting the file, and every mail-shaped parse rejection emits a structured warning (parity with the module's other failure paths) while non-mail-shaped strays stay silent by design. The `--json` flag was being swallowed by the program-level `--json` option (commander parent/child collision); the mail action now reads `optsWithGlobals()`.
