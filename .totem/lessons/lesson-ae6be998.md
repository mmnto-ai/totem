## Lesson — Git output can vary by system locale, causing parsing logic

**Tags:** git, i18n, parsing

Git output can vary by system locale, causing parsing logic to fail. Forcing a neutral locale like `LC_ALL=C` ensures consistent output format across different environments.
