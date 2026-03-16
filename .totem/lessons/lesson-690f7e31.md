## Lesson — Project conventions require log.error to use a mandatory

**Tags:** logging, style-guide, observability

Project conventions require `log.error` to use a mandatory 'Totem Error' tag for system-wide consistency, while other levels like `log.warn` or `log.info` must use command-specific tags (e.g., 'Init'). Mixing these up or using generic tags for warnings breaks the automated formatting and traceability defined in the architectural style guide.
