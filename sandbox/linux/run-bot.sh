#!/usr/bin/env bash
# Linux sandbox launcher for trusted dev acceptance. NOT a production sandbox:
# no seccomp profile yet, no OS-level attestation, no student-code gate.
# Usage: run-bot.sh --bot /abs/bot.py [--timeout-ms 10000] [--memory-bytes N]
#        [--pids 32] [--cpu-max "50000 100000"] [--metrics /abs/metrics.json]
# stdin/stdout/stderr are passed through unchanged; stdout is reserved for bot JSONL.
set -euo pipefail

BWRAP="${OOTV2_BWRAP:-/usr/bin/bwrap}"
PYTHON="${OOTV2_PYTHON:-/usr/bin/python3}"
CGROUP_ROOT="${OOTV2_CGROUP_ROOT:-/sys/fs/cgroup/ootv2-sandbox}"
bot="" timeout_ms=10000 memory_bytes=268435456 pids_max=32 cpu_max="50000 100000" metrics=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bot) bot="${2:-}"; shift 2 ;;
    --timeout-ms) timeout_ms="${2:-}"; shift 2 ;;
    --memory-bytes) memory_bytes="${2:-}"; shift 2 ;;
    --pids) pids_max="${2:-}"; shift 2 ;;
    --cpu-max) cpu_max="${2:-}"; shift 2 ;;
    --metrics) metrics="${2:-}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done
die() { echo "sandbox: $1" >&2; exit "${2:-78}"; }

[ "$(id -u)" = "0" ] || die "root_required"
[ "$(uname -s)" = "Linux" ] || die "linux_required"
[ -x "$BWRAP" ] || die "bwrap_missing"
[ -x "$PYTHON" ] || die "python_missing"
[ -n "$bot" ] && [ -f "$bot" ] && [ ! -L "$bot" ] || die "invalid_bot_path" 64
bot="$(realpath -e -- "$bot")"
size=$(stat -c %s -- "$bot")
[ "$size" -ge 1 ] && [ "$size" -le 262144 ] || die "invalid_bot_size" 64
case "$timeout_ms" in ''|*[!0-9]*) die "invalid_timeout" 64 ;; esac
case "$memory_bytes" in ''|*[!0-9]*) die "invalid_memory" 64 ;; esac
case "$pids_max" in ''|*[!0-9]*) die "invalid_pids" 64 ;; esac
[ "$timeout_ms" -ge 100 ] && [ "$timeout_ms" -le 120000 ] || die "invalid_timeout" 64
[ "$memory_bytes" -ge 33554432 ] && [ "$memory_bytes" -le 2147483648 ] || die "invalid_memory" 64
[ "$pids_max" -ge 4 ] && [ "$pids_max" -le 256 ] || die "invalid_pids" 64
case "$cpu_max" in *' '*) : ;; *) die "invalid_cpu_max" 64 ;; esac
if [ -n "$metrics" ]; then case "$metrics" in /*) : ;; *) die "invalid_metrics_path" 64 ;; esac; fi

[ -f /sys/fs/cgroup/cgroup.controllers ] || die "cgroup_v2_missing"
grep -qw memory /sys/fs/cgroup/cgroup.controllers || die "cgroup_memory_missing"
grep -qw pids /sys/fs/cgroup/cgroup.controllers || die "cgroup_pids_missing"
run_id="$(cat /proc/sys/kernel/random/uuid)"
mkdir -p "$CGROUP_ROOT" || die "cgroup_root_failed"
# Best effort: the root cgroup may already delegate these controllers.
printf '+cpu +memory +pids' > /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true
printf '+cpu +memory +pids' > "$CGROUP_ROOT/cgroup.subtree_control" 2>/dev/null || true
CG="$CGROUP_ROOT/$run_id"
mkdir "$CG" || die "cgroup_create_failed"
printf '%s' "$memory_bytes" > "$CG/memory.max" || die "cgroup_memory_failed"
printf '0' > "$CG/memory.swap.max" 2>/dev/null || true
printf '%s' "$pids_max" > "$CG/pids.max" || die "cgroup_pids_failed"
printf '%s' "$cpu_max" > "$CG/cpu.max" || die "cgroup_cpu_failed"
metrics_file="$metrics"; timed_out=0; watch_pid=""; bwrap_pid=""; final_status=0; metrics_written=0
write_metrics() {
  [ -n "$metrics_file" ] || return 0
  [ "$metrics_written" = 1 ] && return 0
  local mem_peak cpu_usage oom
  mem_peak=$(cat "$CG/memory.peak" 2>/dev/null || echo 0)
  cpu_usage=$(awk '/^usage_usec / { print $2 }' "$CG/cpu.stat" 2>/dev/null || echo 0)
  oom=$(awk '/^oom_kill / { print $2 }' "$CG/memory.events" 2>/dev/null || echo 0)
  printf '{"exitCode":%s,"memoryPeakBytes":%s,"cpuUsageUsec":%s,"oomKills":%s,"timedOut":%s}\n' \
    "${final_status:-0}" "${mem_peak:-0}" "${cpu_usage:-0}" "${oom:-0}" \
    "$([ "${final_status:-0}" = 124 ] && echo true || echo false)" > "$metrics_file" 2>/dev/null || true
  metrics_written=1
}
cleanup() {
  write_metrics
  for _ in 1 2 3 4 5 6 7 8; do
    if [ -r "$CG/cgroup.procs" ]; then
      while read -r pid; do
        [ -n "$pid" ] || continue
        [ "$pid" = "$$" ] && continue
        kill -KILL "$pid" 2>/dev/null || true
      done < "$CG/cgroup.procs"
    fi
    # Root cgroup may host the supervisor, so it can be removed afterwards.
    printf '%s' "$$" > /sys/fs/cgroup/cgroup.procs 2>/dev/null || true
    rmdir "$CG" 2>/dev/null && break
    sleep 0.05
  done
  rmdir "$CGROUP_ROOT" 2>/dev/null || true
  rm -f "${TIMEOUT_FLAG:-/nonexistent}" 2>/dev/null || true
}
on_signal() { timed_out=1; final_status=124; cleanup; exit 124; }
trap cleanup EXIT
trap on_signal INT TERM

ulimit -t 5 || die "rlimit_cpu_failed"
ulimit -f 4096 || die "rlimit_file_failed"
ulimit -n 64 || die "rlimit_fds_failed"

mount_args=(
  --die-with-parent --new-session --unshare-all --clearenv
  --ro-bind /usr /usr
  --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin --symlink usr/sbin /sbin
  --proc /proc --dev /dev
  --size 16777216 --tmpfs /tmp
  --dir /work --chdir /work
  --ro-bind "$bot" /work/bot.py
  --hostname ootv2-sandbox
  --setenv PATH /usr/bin:/bin --setenv LANG C.UTF-8 --setenv LC_ALL C.UTF-8
  --cap-drop ALL
)
[ -f /etc/ld.so.cache ] && mount_args+=(--ro-bind /etc/ld.so.cache /etc/ld.so.cache)
[ -f /etc/localtime ] && mount_args+=(--ro-bind /etc/localtime /etc/localtime)
watchdog() {
  sleep "$(awk -v ms="$timeout_ms" 'BEGIN { printf "%.3f", ms / 1000 }')"
  printf '1' > "$TIMEOUT_FLAG" 2>/dev/null || true
  kill -TERM "$$" 2>/dev/null || true
}
TIMEOUT_FLAG="${TMPDIR:-/tmp}/ootv2-sandbox-${run_id}.timeout"
watchdog &
watch_pid=$!
exec 3<&0
set +e
# The helper puts its own PID into the cgroup then execs bwrap: PID is preserved,
# so bwrap and every child inherit the limits while this supervisor stays outside.
/usr/bin/bash -c 'printf "%s" "$$" > "$1/cgroup.procs" || exit 78; shift; exec "$@"' \
  _ "$CG" "$BWRAP" "${mount_args[@]}" -- "$PYTHON" -I -S -B -X utf8 /work/bot.py <&3 &
bwrap_pid=$!
wait "$bwrap_pid"
status=$?
set -e
exec 3<&-
kill "$watch_pid" 2>/dev/null || true
wait "$watch_pid" 2>/dev/null || true
[ -f "$TIMEOUT_FLAG" ] && status=124 || true
rm -f "$TIMEOUT_FLAG" 2>/dev/null || true
final_status="$status"
write_metrics
exit "$status"
