## Lesson — Shell execution wrappers that automatically trim output

**Tags:** shell, nodejs

Shell execution wrappers that automatically trim output must check result types before processing. Commands using 'inherit' or 'ignore' stdio may return undefined or Buffers, causing runtime errors if string methods are called directly.
