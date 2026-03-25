## Lesson — Library code should use an onWarn callback instead

**Tags:** architecture, dx, logging

Library code should use an onWarn callback instead of hardcoding console.warn to allow consumers to route or suppress output according to their own logging strategy.
