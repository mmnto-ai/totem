# Cloud Compilation

Totem supports offloading rule compilation to a self-hosted Cloud Run worker for parallel fan-out. This is optional — local compilation works out of the box with no additional infrastructure.

## Local Compilation (Default)

```bash
totem lesson compile
```

All users get local compilation by default. It uses the configured LLM orchestrator (Gemini, Anthropic, etc.) to compile lessons one at a time. Fast for small batches (1-5 lessons).

## Cloud Compilation (Self-Hosted)

For teams compiling large lesson sets (10+), you can deploy the `totem-compile-worker` to your own Cloud Run instance for parallel fan-out:

```bash
totem lesson compile --cloud <your-cloud-run-url>
```

The `--cloud` flag sends lessons to your endpoint in parallel, reducing compilation time by up to 25x for bulk operations.

### Deploying Your Own Worker

See the [totem-compile-worker](https://github.com/mmnto-ai/totem-compile-worker) repository for deployment instructions.

### Authentication

The cloud endpoint uses GCP identity tokens. Ensure you're authenticated:

```bash
gcloud auth login
```

## Performance

| Scenario                    | Local    | Cloud (self-hosted)    |
| --------------------------- | -------- | ---------------------- |
| 1-5 lessons                 | ~5-10s   | Not worth the overhead |
| 10+ lessons                 | ~60-120s | ~7-15s                 |
| Full recompile (300+ rules) | ~30 min  | ~2 min                 |
