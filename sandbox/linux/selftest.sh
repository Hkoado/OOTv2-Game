#!/usr/bin/env bash
# Sandbox acceptance: only trusted fixtures; never student code.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
runner="$here/run-bot.sh"
fixtures="$root/sandbox/fixtures"
cgroup_root="${OOTV2_CGROUP_ROOT:-/sys/fs/cgroup/ootv2-sandbox}"
tmp="$(mktemp -d /tmp/ootv2-selftest.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
pass=0; fail=0
ok() { printf 'PASS %s\n' "$1"; pass=$((pass + 1)); }
no() { printf 'FAIL %s: %s\n' "$1" "$2"; fail=$((fail + 1)); }
code=0
run() {
  local name="$1" bot="$2" timeout="$3"; shift 3
  "$runner" --bot "$bot" --timeout-ms "$timeout" --metrics "$tmp/$name.json" "$@" \
    > "$tmp/$name.out" 2> "$tmp/$name.err"
  code=$?
}
metric() { /usr/bin/python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2]))' "$1" "$2"; }

printf '{"n":1}\n{"n":2}\n' > "$tmp/requests.jsonl"
"$runner" --bot "$fixtures/echo_bot.py" --timeout-ms 3000 --metrics "$tmp/echo.json" \
  < "$tmp/requests.jsonl" > "$tmp/echo.out" 2> "$tmp/echo.err"
code=$?
if [ "$code" -eq 0 ] && grep -q '"echo": 1' "$tmp/echo.out" && grep -q '"echo": 2' "$tmp/echo.out"; then
  ok "benign JSONL round-trip"
else
  no "benign JSONL round-trip" "exit=$code out=$(head -c 200 "$tmp/echo.out") err=$(head -c 200 "$tmp/echo.err")"
fi
[ "$(metric "$tmp/echo.json" memoryPeakBytes)" -gt 0 ] 2>/dev/null \
  && ok "metrics collected" || no "metrics collected" "missing memoryPeakBytes"
[ "$(metric "$tmp/echo.json" seccomp)" = "deny-list.v1" ] \
  && ok "seccomp mode recorded" || no "seccomp mode recorded" "missing seccomp field"

run seccomp "$fixtures/syscall_probe.py" 5000 </dev/null
if [ "$code" -eq 0 ] && /usr/bin/python3 - "$tmp/seccomp.out" <<'PY'
import json
import sys
report = json.load(open(sys.argv[1]))
assert report["seccomp"] == "2", report["seccomp"]
assert report["blocked"] is True, report["checks"]
for name in ("ptrace", "mount", "unshare", "keyctl", "bpf", "io_uring_setup"):
    check = report["checks"][name]
    assert check["result"] == -1 and check["errno"] == 1, (name, check)
PY
then
  ok "seccomp deny-list blocks escape syscalls"
else
  no "seccomp deny-list blocks escape syscalls" "exit=$code $(head -c 300 "$tmp/seccomp.out")"
fi

run seccomp_off "$fixtures/syscall_probe.py" 5000 --seccomp-mode off </dev/null
if [ "$code" -eq 0 ] && [ "$(metric "$tmp/seccomp_off.json" seccomp)" = "off" ] \
  && /usr/bin/python3 -c 'import json,sys; assert json.load(open(sys.argv[1]))["seccomp"] == "0"' "$tmp/seccomp_off.out"; then
  ok "seccomp-mode off is explicit and recorded"
else
  no "seccomp-mode off is explicit and recorded" "exit=$code"
fi

run probe "$fixtures/probe.py" 5000 </dev/null
if [ "$code" -eq 0 ] && /usr/bin/python3 - "$tmp/probe.out" <<'PY'
import json
import sys
report = json.load(open(sys.argv[1]))
assert "/mnt" not in report["root"], report["root"]
assert "/home" not in report["root"], report["root"]
assert "SUPABASE_SERVICE_ROLE_KEY" not in report["envKeys"], report["envKeys"]
assert "SUPABASE_URL" not in report["envKeys"], report["envKeys"]
checks = report["checks"]
assert checks["readRepo"]["ok"] is False, checks["readRepo"]
assert checks["readWindows"]["ok"] is False, checks["readWindows"]
assert checks["readShadow"]["ok"] is False, checks["readShadow"]
assert checks["readRootHome"]["ok"] is False, checks["readRootHome"]
assert checks["writeUsr"]["ok"] is False, checks["writeUsr"]
assert checks["writeTmp"]["ok"] is True, checks["writeTmp"]
assert checks["network"]["ok"] is False, checks["network"]
assert checks["fork"]["ok"] is True, checks["fork"]
PY
then
  ok "filesystem/network/env isolation"
else
  no "filesystem/network/env isolation" "exit=$code $(head -c 300 "$tmp/probe.err")"
fi

run fork "$fixtures/forkbomb.py" 1500 </dev/null
[ "$code" -ne 0 ] && ok "fork bomb bounded (exit=$code)" || no "fork bomb bounded" "exit=0"

run mem "$fixtures/memhog.py" 3000 --memory-bytes 67108864 </dev/null
mem_ok=0
[ "$code" -ne 0 ] && mem_ok=1
[ "$mem_ok" -eq 1 ] && ok "memory limit enforced (exit=$code)" || no "memory limit enforced" "exit=0"

start_ms=$(date +%s%3N)
run cpu "$fixtures/cpuhog.py" 1200 --cpu-max "20000 100000" </dev/null
elapsed=$(( $(date +%s%3N) - start_ms ))
if [ "$code" -eq 124 ] && [ "$elapsed" -lt 5000 ]; then
  ok "CPU/wall timeout (exit=124, ${elapsed}ms)"
else
  no "CPU/wall timeout" "exit=$code elapsed=${elapsed}ms"
fi
cpu_use=$(metric "$tmp/cpu.json" cpuUsageUsec)
[ "$cpu_use" -lt 2000000 ] 2>/dev/null && ok "CPU accounting bounded (${cpu_use}us)" \
  || no "CPU accounting bounded" "usage=${cpu_use}us"

start_ms=$(date +%s%3N)
"$runner" --bot "$fixtures/flood.py" --timeout-ms 1000 2> "$tmp/flood.err" </dev/null \
  | head -c 65536 > "$tmp/flood.out"
flood_code=${PIPESTATUS[0]}
flood_ms=$(( $(date +%s%3N) - start_ms ))
size=$(stat -c %s "$tmp/flood.out")
if [ "$flood_code" -ne 0 ] && [ "$flood_ms" -lt 5000 ] && [ "$size" -le 65536 ]; then
  ok "stdout flood cut (exit=$flood_code, ${size}B, ${flood_ms}ms)"
else
  no "stdout flood cut" "exit=$flood_code size=$size elapsed=${flood_ms}ms"
fi

start_ms=$(date +%s%3N)
run sleep "$fixtures/sleep.py" 700 </dev/null
elapsed=$(( $(date +%s%3N) - start_ms ))
[ "$code" -eq 124 ] && [ "$elapsed" -lt 3000 ] && ok "wall timeout on sleep (${elapsed}ms)" \
  || no "wall timeout on sleep" "exit=$code elapsed=${elapsed}ms"

left=$(ls -A "$cgroup_root" 2>/dev/null | wc -l)
[ "$left" -eq 0 ] && ok "cgroup cleanup" || no "cgroup cleanup" "$left entries left"
if pgrep -f '/work/bot.py' >/dev/null 2>&1; then
  no "process cleanup" "leftover bot process"
else
  ok "process cleanup"
fi

printf 'RESULT pass=%s fail=%s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
