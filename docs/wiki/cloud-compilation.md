# Cloud Compilation

By default, `totem compile` executes locally via your configured LLM provider. However, this can be slow or hardware-intensive for massive rule sets.

To solve this, Totem supports **Cloud Compilation**, which offloads the heavy AST parsing and regex generation to a specialized Totem compile worker.

## Usage

Use the `--cloud` flag when compiling:

```bash
totem compile --cloud
```

This delegates the processing to the Totem infrastructure, reducing local execution time while returning the same deterministic `compiled-rules.json` file.
