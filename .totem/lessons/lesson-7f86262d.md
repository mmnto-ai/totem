## Lesson — Judge a refusal's reason on the text the acceptance regex saw, in its case

**Tags:** manual, parsing, url

A refusal's reason is judged on the same text the acceptance regex saw: strip the scheme and the host up to the first slash, question mark or hash, drop everything from the first question mark or hash, and probe case-insensitively when the form regex is case-insensitive; a reason probed on the whole input describes a query or fragment, and one probed in a different case misnames the defect (legs 2 and 3 on mmnto-ai/totem#2965).
