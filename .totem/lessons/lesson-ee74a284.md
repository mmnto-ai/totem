## Lesson — Detection logic with fallbacks must be validated using test

**Tags:** testing, configuration, environment-variables

Detection logic with fallbacks must be validated using test cases where multiple valid API keys are present simultaneously. Simply testing individual keys fails to verify that the intended priority order is correctly enforced and prevents regressions in provider selection.
