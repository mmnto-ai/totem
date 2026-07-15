#!/usr/bin/env bash
# Records the proof-kit demo as an asciinema cast. The cast is an OUTPUT of
# the kit's real scripts — the same ones CI runs — not a staged demo.
# Local-only: needs asciinema on PATH, and a provider API key in the host
# repo's .env for the compile half (see compile-fixture.mjs).
set -euo pipefail
cd "$(dirname "$0")/../.."

# stdin must be closed for the recorded command: under asciinema's pty stdin
# stays open forever, and the compile's vendor-CLI arm blocks reading it — the
# recording hangs at 0% with no error. </dev/null makes it proceed headless.
asciinema rec --overwrite \
  -c "sh -c 'node examples/proof-kit/compile-fixture.mjs && node examples/proof-kit/run.mjs' </dev/null" \
  examples/proof-kit/proof-kit.cast

echo "wrote examples/proof-kit/proof-kit.cast"
