# Cloud Compilation

> **Status (1.25.0):** Cloud compilation is **off the recommended path**. The cloud worker currently routes through Gemini Pro, which benchmarked lower for compile correctness than Claude Sonnet (73% vs 90% per Strategy #73). It also does not benefit from the prompt-caching layer that local Anthropic compile uses. Migration of the cloud worker to Claude Sonnet is tracked as [mmnto-ai/totem#1221](https://github.com/mmnto-ai/totem/issues/1221) and remains open. Use local compilation (the default) for production work.

Totem supports offloading rule compilation to a self-hosted Cloud Run worker for parallel fan-out. This is optional infrastructure for teams that want bulk-compile throughput at the cost of compile quality. Local compilation works out of the box with no additional infrastructure and is the canonical path.

## Local Compilation (Default, Recommended)

```bash
totem lesson compile
```

All users get local compilation by default. It uses the configured LLM orchestrator (Anthropic, Gemini, or others) to compile lessons one at a time. With the [Context Caching](context-caching.md) layer enabled on an Anthropic provider, bulk recompiles stay cache-warm end to end.

Reference benchmarks from Strategy #73 (438-lesson sample): Sonnet 4.6 produced 90% structurally-correct rules at 2.4 seconds per lesson; Gemini Pro produced 73% at 19.6 seconds per lesson. The local-Sonnet path is the basis for the curated 455-rule set the project ships today.

## Cloud Compilation (Self-Hosted, Off-Path)

For teams compiling large lesson sets where throughput dominates correctness, the `totem-compile-worker` can be deployed to a self-hosted Cloud Run instance for parallel fan-out:

```bash
totem lesson compile --cloud <your-cloud-run-url>
```

The `--cloud` flag sends lessons to your endpoint in parallel, reducing compilation wall-clock time for bulk operations. Compile quality follows the cloud worker's current model (Gemini Pro) and does not benefit from prompt caching.

### Deploying Your Own Worker

See the [totem-compile-worker](https://github.com/mmnto-ai/totem-compile-worker) repository for deployment instructions.

### Authentication

The cloud endpoint uses GCP identity tokens. Authenticate before invoking:

```bash
gcloud auth login
```

## Performance vs Quality

| Scenario                    | Local (Sonnet, default) | Cloud (Gemini, self-hosted) |
| --------------------------- | ----------------------- | --------------------------- |
| Compile correctness         | ~90% per Strategy #73   | ~73% per Strategy #73       |
| 1-5 lessons                 | ~5-10s                  | Not worth the overhead      |
| 10+ lessons                 | ~60-120s                | ~7-15s                      |
| Full recompile (300+ rules) | ~30 min cache-warm      | ~2 min                      |

The cloud worker exists for environments where wall-clock matters more than per-rule precision. For most teams the local Sonnet path is faster end to end once you account for the iteration cost of fixing noisy rules that the lower-correctness cloud worker emits.

## When the Cloud Worker Becomes Recommended

The cloud-vs-local recommendation flips when [mmnto-ai/totem#1221](https://github.com/mmnto-ai/totem/issues/1221) ships and the cloud worker routes through Claude Sonnet. At that point cloud will combine Sonnet's correctness with parallel fan-out throughput. This document will get updated when the migration lands.
