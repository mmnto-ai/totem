#!/usr/bin/env bash
# Records the proof-kit demo as an asciinema cast. The cast is an OUTPUT of
# the kit's real scripts — the same ones CI runs — not a staged demo.
# Local-only: needs asciinema on PATH, and a provider API key in the host
# repo's .env for the compile half (see compile-fixture.mjs).
set -euo pipefail
cd "$(dirname "$0")/../.."

asciinema rec --overwrite \
  -c "sh -c 'node examples/proof-kit/compile-fixture.mjs && node examples/proof-kit/run.mjs'" \
  examples/proof-kit/proof-kit.cast

echo "wrote examples/proof-kit/proof-kit.cast"
