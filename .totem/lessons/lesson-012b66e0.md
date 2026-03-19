## Lesson — Generic function names like applyRules in a facade

**Tags:** api-design, documentation, refactoring

Generic function names like `applyRules` in a facade can mislead developers into assuming they handle all rule types when they may only implement a subset. Use specific naming or high-visibility JSDoc to clarify which engines are supported to prevent incorrect API usage.
