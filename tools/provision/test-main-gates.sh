#!/usr/bin/env bash
# Fixture-only acceptance in a private mount namespace on the existing judge VM.
# NO DB credentials, service restart, release swap or production receipt changes.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
[ "$(id -u)" = 0 ] || { echo root_required >&2; exit 77; }
if [ "${1:-}" != --isolated ]; then
  [ "${1:-}" = --fixtures-only ] || { echo 'usage: test-main-gates.sh --fixtures-only' >&2; exit 64; }
  exec /usr/bin/env -i PATH=/opt/ootv2-node/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    /usr/bin/unshare --mount --propagation private /bin/bash "$0" --isolated
fi
[ "$(readlink /proc/self/ns/mnt)" != "$(readlink /proc/1/ns/mnt)" ] || { echo private_namespace_required >&2; exit 78; }
mount -t tmpfs -o mode=0755,size=32m tmpfs /run
export NODE_ENV=production OOTV2_ISOLATED_DRILL=1
export OOTV2_CAMPUS_SANDBOX=linux-sandbox
export OOTV2_SANDBOX_RUNNER="$root/sandbox/linux/run-bot.sh"
export OOTV2_SANDBOX_ATTESTATION=/run/ootv2-sandbox-attestation.json
export OOTV2_CGROUP_ROOT="/sys/fs/cgroup/ootv2-drill-$(cat /proc/sys/kernel/random/uuid)"
export OOTV2_SANDBOX_CGROUP_ROOT="$OOTV2_CGROUP_ROOT"
cleanup() {
  if [ -d "$OOTV2_CGROUP_ROOT" ]; then
    find "$OOTV2_CGROUP_ROOT" -mindepth 1 -maxdepth 1 -type d -exec sh -c 'echo 1 > "$1/cgroup.kill"; rmdir "$1"' _ '{}' \; || true
    rmdir "$OOTV2_CGROUP_ROOT" || true
  fi
}
trap cleanup EXIT
cd "$root"
bash sandbox/linux/attest.sh "$OOTV2_SANDBOX_ATTESTATION" --full
node tools/cli/sandbox-main-gates.js