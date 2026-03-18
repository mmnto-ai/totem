## Lesson — Loading large Tree-sitter WASM binaries at the module level

**Tags:** wasm, performance, nodejs

Loading large Tree-sitter WASM binaries at the module level can cause significant cold-start penalties in CLI tools. Implementing lazy loading for these components ensures that the performance of unrelated commands is not degraded by unnecessary binary initialization.
