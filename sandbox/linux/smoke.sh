#!/usr/bin/env bash
# Quick manual smoke for the Linux sandbox runner (run as root inside WSL).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
printf '{"n":1}\n{"n":2}\n' | "$here/run-bot.sh" --bot "$root/sandbox/fixtures/echo_bot.py" \
  --timeout-ms 3000 --metrics /tmp/ootv2-echo-metrics.json
echo "---metrics" >&2
cat /tmp/ootv2-echo-metrics.json >&2
