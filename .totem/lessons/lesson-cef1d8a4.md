## Lesson — When using Tree-sitter in WebAssembly environments, objects

**Tags:** wasm, tree-sitter, memory-management

When using Tree-sitter in WebAssembly environments, objects like queries, trees, and parsers must be explicitly cleaned up using the .delete() method. This is required because the JavaScript garbage collector cannot see or manage memory allocated within the WASM heap, leading to leaks if not manually handled.
