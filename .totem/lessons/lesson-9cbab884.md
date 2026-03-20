## Lesson — Projects using native bindings (Rust, N-API, WASM)

**Tags:** ci, native-bindings, cross-platform

Projects using native bindings (Rust, N-API, WASM) and heavy filesystem I/O must run CI across all target platforms to catch OS-specific bugs. This prevents platform-specific issues, such as Windows-specific process signal handling, from reaching production.
