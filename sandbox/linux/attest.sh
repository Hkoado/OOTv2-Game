#!/usr/bin/env bash
# Host attestation for the Linux sandbox. Run on the judge VM as root.
# Writes a short-lived JSON receipt; the Node factory refuses to start without it.
# This proves the profile ran here, not that the VM is immune to kernel bugs.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
runner="$here/run-bot.sh"
fixtures="$root/sandbox/fixtures"
out="${1:-/run/ootv2-sandbox-attestation.json}"
full=0
[ "${2:-}" = "--full" ] && full=1
tmp="$(mktemp -d /tmp/ootv2-attest.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
[ "$(id -u)" = "0" ] || { echo "attest: root required" >&2; exit 78; }

"$here/preflight.sh" > "$tmp/preflight.txt" 2>&1 || { cat "$tmp/preflight.txt" >&2; exit 78; }
profile="/run/ootv2-sandbox-seccomp/$(uname -m).bpf"
[ -s "$profile" ] || { echo "attest: seccomp profile missing" >&2; exit 78; }
sha="$(sha256sum "$profile" | awk '{ print $1 }')"

if ! printf '' | "$runner" --bot "$fixtures/syscall_probe.py" --timeout-ms 5000 \
  --metrics "$tmp/probe.json" > "$tmp/probe.out" 2> "$tmp/probe.err"; then
  echo "attest: seccomp probe failed" >&2
  cat "$tmp/probe.err" >&2
  exit 78
fi

selftest_result="not_run"
if [ "$full" = 1 ]; then
  "$here/selftest.sh" > "$tmp/selftest.txt" 2>&1 || { cat "$tmp/selftest.txt" >&2; exit 78; }
  selftest_result="$(tail -n 1 "$tmp/selftest.txt")"
fi

TMPDIR_ATTEST="$tmp" OUT="$out" SHA="$sha" FULL="$full" SELFTEST="$selftest_result" RUNNER="$runner" \
/usr/bin/python3 - <<'PY'
import datetime
import json
import os
import platform
import hashlib
import tempfile

def read(name):
    with open(os.path.join(os.environ["TMPDIR_ATTEST"], name), encoding="utf-8") as handle:
        return handle.read().strip()

report = json.loads(read("probe.out"))
metrics = json.load(open(os.path.join(os.environ["TMPDIR_ATTEST"], "probe.json"), encoding="utf-8"))
preflight = dict(line.split("=", 1) for line in read("preflight.txt").splitlines() if "=" in line)
now = datetime.datetime.now(datetime.timezone.utc)
attestation = {
    "profile": "ootv2-sandbox-attestation.v1",
    "result": "pass",
    "createdAt": now.isoformat().replace("+00:00", "Z"),
    "expiresAt": (now + datetime.timedelta(hours=24)).isoformat().replace("+00:00", "Z"),
    "host": {
        "kernel": platform.release(),
        "arch": platform.machine(),
        "wsl": "microsoft" in platform.release().lower(),
        "distro": preflight.get("distro", ""),
    },
    "versions": {
        "bubblewrap": preflight.get("bwrap", ""),
        "python": preflight.get("python", ""),
        "libseccomp": "python3-seccomp",
    },
    "cgroupControllers": preflight.get("cgroup_controllers", "").split(),
    "seccomp": {
        "mode": metrics.get("seccomp"),
        "sha256": os.environ["SHA"],
        "blocked": len(report["checks"]),
        "probe": report.get("blocked") is True and report.get("seccomp") == "2",
    },
    "selftest": {"full": os.environ["FULL"] == "1", "result": os.environ["SELFTEST"]},
    "artifacts": {
        name: hashlib.sha256(open(filename, "rb").read()).hexdigest()
        for name, filename in {
            "runner": os.environ["RUNNER"],
            "generator": os.path.join(os.path.dirname(os.environ["RUNNER"]), "seccomp-profile.py"),
        }.items()
    },
    "limitations": [
        "Deny-list seccomp, not an allowlist",
        "No protection against kernel vulnerabilities",
        "WSL is dev-only and rejected by the production factory",
    ],
}
assert attestation["seccomp"]["probe"] is True, report
assert attestation["seccomp"]["mode"] == "deny-list.v1", metrics
if attestation["host"]["wsl"]:
    attestation["result"] = "dev-only"
output = os.environ["OUT"]
fd, pending = tempfile.mkstemp(prefix=".ootv2-attest-", dir=os.path.dirname(output))
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(attestation, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(pending, output)
finally:
    if os.path.exists(pending):
        os.unlink(pending)
print(json.dumps({"result": attestation["result"], "output": os.environ["OUT"],
                  "wsl": attestation["host"]["wsl"], "seccomp": attestation["seccomp"]}))
PY
