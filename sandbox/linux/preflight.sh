#!/usr/bin/env bash
# Sandbox preflight for the dedicated WSL distro. Read-only checks + versions.
set -euo pipefail
echo "kernel=$(uname -r)"
echo "distro=$(source /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
echo "uid=$(id -u)"
echo "python=$("${OOTV2_PYTHON:-/usr/bin/python3}" --version 2>&1)"
echo "bwrap=$("${OOTV2_BWRAP:-/usr/bin/bwrap}" --version 2>&1)"
echo "cgroup_controllers=$(cat /sys/fs/cgroup/cgroup.controllers)"
echo "cgroup2=$(stat -fc %T /sys/fs/cgroup)"
echo "max_user_namespaces=$(cat /proc/sys/user/max_user_namespaces)"
[ -r /sys/fs/cgroup/cgroup.controllers ] || { echo "cgroup_v2_missing"; exit 78; }
grep -qw memory /sys/fs/cgroup/cgroup.controllers || { echo "cgroup_memory_missing"; exit 78; }
grep -qw pids /sys/fs/cgroup/cgroup.controllers || { echo "cgroup_pids_missing"; exit 78; }
[ -x "${OOTV2_BWRAP:-/usr/bin/bwrap}" ] || { echo "bwrap_missing"; exit 78; }
[ -x "${OOTV2_PYTHON:-/usr/bin/python3}" ] || { echo "python_missing"; exit 78; }
echo "preflight=ok"
