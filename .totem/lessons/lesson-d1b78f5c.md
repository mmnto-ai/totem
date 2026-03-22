## Lesson — Rename general-purpose callbacks like onWarn if their scope

**Tags:** api-design, refactoring, dx

Rename general-purpose callbacks like `onWarn` if their scope narrows to specific events like file skipping due to architecture changes. Precise naming prevents developer confusion regarding whether a callback handles core execution failures or peripheral metadata warnings.
