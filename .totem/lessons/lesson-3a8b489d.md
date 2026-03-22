## Lesson — Review metadata from third-party integrations

**Tags:** safety, typescript, github-api

Review metadata from third-party integrations can occasionally contain null or unexpected author fields. Failing to check for author existence before string manipulation (like `.includes()`) leads to runtime crashes during PR analysis.
