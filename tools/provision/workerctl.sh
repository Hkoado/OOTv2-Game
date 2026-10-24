#!/usr/bin/env bash
# Guest-side control for the OOTv2 judge VM. Run on the VM (sudo for start/stop).
# Usage: workerctl.sh status|health|version|attest|start|stop|restart|logs [lines]
set -euo pipefail
root=/srv/ootv2
queue="${OOTV2_WORKER_SERVICE:-github}"
case "$queue" in
  github) service=ootv2-github-worker.service ;;
  judge) service=ootv2-official-worker.service ;;
  *) echo invalid_worker_service; exit 64 ;;
esac
node=/opt/ootv2-node/bin/node
env_file=/etc/ootv2/worker.env
action="${1:-status}"
lines="${2:-100}"

need_release() {
  [ -L "$root/current" ] && [ -x "$node" ] || { echo 'release_not_installed'; exit 78; }
}
require_sudo() {
  [ "$(id -u)" = 0 ] || { echo 'run_with_sudo'; exit 77; }
}
# Read-only readiness for the service actually being controlled: intake tables are not
# required on a judge guest, and official tables are not required on an intake host.
health_scope() {
  cd "$root/current"
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
  fi
  export NODE_ENV=production
  if [ "$queue" = judge ]; then
    export OOTV2_CAMPUS_SANDBOX=linux-sandbox
    export OOTV2_SANDBOX_RUNNER=/srv/ootv2/current/sandbox/linux/run-bot.sh
    export OOTV2_SANDBOX_ATTESTATION=/run/ootv2-sandbox-attestation.json
  fi
  "$node" tools/cli/worker-health.js --scope="$queue"
}
# A judge must never consume work without a fresh host attestation. The timer is what
# refreshes it; a failed refresh stops the start instead of leaving a silent stale receipt.
require_attestation() {
  systemctl enable ootv2-attest.timer >/dev/null 2>&1 || true
  systemctl start ootv2-attest.timer || { echo 'attestation_timer_failed'; exit 79; }
  if ! systemctl start ootv2-attest.service; then
    journalctl -u ootv2-attest.service -n 30 --no-pager >&2 || true
    echo 'attestation_failed'
    exit 79
  fi
}
# Không đặt backslash trước nháy kép bên trong chuỗi nháy đơn của shell: backslash là ký tự
# thật và Python sẽ báo "unexpected character after line continuation".
print_attestation() {
  # `/run/ootv2-sandbox-attestation.json` là root-only: lệnh read-only không có sudo vẫn phải
  # chạy được thay vì chết vì PermissionError.
  if [ ! -r /run/ootv2-sandbox-attestation.json ]; then
    echo 'attestation=unreadable (run with sudo)'
    return 0
  fi
  /usr/bin/python3 -c 'import json;d=json.load(open("/run/ootv2-sandbox-attestation.json"));print("attestation=%s expires=%s" % (d.get("result"), d.get("expiresAt")))'
}


case "$action" in
  status)
    need_release
    echo "release=$(readlink -f "$root/current")"
    echo "worker=$(systemctl is-active "$service" 2>/dev/null || true)"
    echo "enabled=$(systemctl is-enabled "$service" 2>/dev/null || true)"
    echo "attestation_timer=$(systemctl is-active ootv2-attest.timer 2>/dev/null || true)"
    ;;
  version)
    need_release
    echo "release=$(readlink -f "$root/current")"
    "$node" --version
    /usr/bin/python3 --version
    if [ -f /run/ootv2-sandbox-attestation.json ]; then
      print_attestation
    else
      echo 'attestation=missing'
    fi
    ;;
  health)
    need_release
    health_scope
    ;;
  attest)
    require_sudo
    need_release
    require_attestation
    print_attestation
    ;;
  start)
    require_sudo
    need_release
    # Refuse to enable a worker that cannot possibly process a job.
    mode="$(stat -c %a "$env_file" 2>/dev/null || echo missing)"
    if [ "$mode" != '600' ]; then echo "worker_env_mode_invalid:$mode"; exit 78; fi
    if [ "$queue" = judge ]; then require_attestation; fi
    # Fail fast with a readable reason instead of a systemd restart loop.
    if ! health_scope; then echo 'worker_start_refused: health check failed'; exit 79; fi
    before="$(systemctl is-active "$service" 2>/dev/null || true)"
    systemctl enable "$service" >/dev/null 2>&1 || true
    systemctl start "$service"
    sleep 3
    after="$(systemctl is-active "$service" 2>/dev/null || true)"
    if [ "$after" = 'active' ]; then
      echo "worker=active (was ${before:-inactive})"
    else
      echo "worker=failed"
      journalctl -u "$service" -n 30 --no-pager >&2 || true
      exit 1
    fi
    ;;
  stop)
    require_sudo
    systemctl stop "$service"
    systemctl disable "$service" >/dev/null 2>&1 || true
    echo 'worker=inactive (disabled)'
    ;;
  restart)
    require_sudo
    need_release
    if [ "$queue" = judge ]; then require_attestation; fi
    if ! health_scope; then echo 'worker_restart_refused: health check failed'; exit 79; fi
    systemctl restart "$service"
    sleep 3
    systemctl is-active --quiet "$service" || { echo worker_restart_failed; exit 79; }
    echo 'worker=active'
    ;;
  logs)
    case "$lines" in ''|*[!0-9]*) echo 'invalid_line_count'; exit 64 ;; esac
    journalctl -u "$service" -n "$lines" --no-pager
    ;;
  *)
    echo 'usage: workerctl.sh status|health|version|attest|start|stop|restart|logs [lines]' >&2
    exit 64
    ;;
esac
