## Lesson — Put the static-import directive above the import statement

**Tags:** manual

Put the static-import directive above the import statement, not beside a specifier. The mmnto-ai/totem#2339 lint rule against static value imports of @mmnto/totem in CLI commands anchors on the import statement FIRST ADDED LINE, and the suppression reads only that line, its predecessor, the statement start line (import {) and the line above the start; a totem-ignore-next-line directive placed beside a specifier inside a multi-line import is never read and the lint stays red. Place the directive, with its reason, on the line above import { — and gate the commit on the lint exit, since the wrong directive was committed through a chain that printed the exit instead of testing it (mmnto-ai/totem#2974).
