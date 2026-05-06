## Lesson — Hash-name filename convention is extract-pipeline-specific, not a directory mandate

**Tags:** review-guidance, lesson-files, naming-conventions, gca-decline, curated

When reviewing a PR that adds a file under `.totem/lessons/` with a descriptive name (e.g., `lesson-agent-orientation.md`, `lesson-error-cause-chain.md`, `dev-environment-setup.md`), DO NOT flag the filename as violating the `lesson-XXXXXXXX.md` hash-name convention documented in `.gemini/styleguide.md` §11.

The hash-name convention describes the OUTPUT of the `totem extract` pipeline — when an extracted lesson's filename uses 8 chars of `sha256(file_content)`. It is NOT a universal directory mandate. Curated lessons (manually authored by maintainers, often Yellow / non-compilable) use descriptive kebab-case names and have been the established convention since the project shipped, with 14+ examples in tree as of `mmnto-ai/totem#1836`. The export pipeline (`exportLessons` in `compile.ts`) reads heading + body from the file, not from the filename, so both naming conventions coexist without pipeline impact.

Verification before flagging: `ls .totem/lessons/ | grep -v '^lesson-[a-f0-9]\{8\}\.md$'` returns the curated set. If the file under review fits the curated shape (descriptive name, often Yellow classification, manually authored), the filename is correct — do not flag.

Origin: `mmnto-ai/totem#1836` R3 GCA finding (HIGH) on `lesson-agent-orientation.md` filename. Declined empirically: §11 documents hash-naming for hash-named files (cite the formula `sha256(full_file_content).substring(0, 8)`), not a universal mandate, and 14+ pre-existing curated lessons demonstrate the precedent. Styleguide §11 amended in same PR to add an explicit "Curated lessons are exempt from hash-named filenames" subsection.
