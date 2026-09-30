## Lesson — A trailing-text probe after a number excludes digits, or it backtracks into the number

**Tags:** manual, regex

A probe for text after a number excludes digits from its following-character class, or the regex backtracks inside the number and reads its last digit as trailing text (mmnto-ai/totem#2965, caught by the targeted run before the commit).
