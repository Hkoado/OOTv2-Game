#!/usr/bin/env bash
# Guest-side control for the OOTv2 judge VM. Run on the VM (sudo for start/stop).
# Usage: workerctl.sh status|health|version|start|stop|restart|logs [lines]
set -euo pipefail
root=/srv/ootv2
service=ootv2-github-worker.service
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
      /usr/bin/python3 -c 'import json;d=json.load(open("/run/ootv2-sandbox-attestation.json"));print(f"attestation={d.get(\"result\")} expires={d.get(\"expiresAt\")}")'
    else
      echo 'attestation=missing'
    fi
    ;;
  health)
    need_release
    cd "$root/current"
    # Credentials must come from the root-owned EnvironmentFile, not an operator shell.
    if [ -f "$env_file" ]; then
      set -a
      # shellcheck disable=SC1090
      . "$env_file"
      set +a
    fi
    "$node" tools/cli/worker-health.js
    ;;
  start)
    require_sudo
    need_release
    # Refuse to enable a worker that cannot possibly process a job.
    mode="$(stat -c %a "$env_file" 2>/dev/null || echo missing)"
    if [ "$mode" != '600' ]; then echo "worker_env_mode_invalid:$mode"; exit 78; fi
    # Fail fast with a readable reason instead of a systemd restart loop.
    cd "$root/current"
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
    if ! "$node" tools/cli/worker-health.js; then echo 'worker_start_refused: health check failed'; exit 79; fi
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
    systemctl restart "$service"
    sleep 3
    echo "worker=$(systemctl is-active "$service" 2>/dev/null || true)"
    ;;
  logs)
    case "$lines" in ''|*[!0-9]*) echo 'invalid_line_count'; exit 64 ;; esac
    journalctl -u "$service" -n "$lines" --no-pager
    ;;
  *)
    echo 'usage: workerctl.sh status|health|version|start|stop|restart|logs [lines]' >&2
    exit 64
    ;;
esac
