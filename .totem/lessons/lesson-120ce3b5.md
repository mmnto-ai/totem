## Lesson — Including empty strings in branch whitelists can cause

**Tags:** security, git, automation

Including empty strings in branch whitelists can cause security gates to silently bypass if branch resolution fails; explicit matching ensures that environment detection errors result in a hard block.
