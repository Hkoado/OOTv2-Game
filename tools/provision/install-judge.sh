#!/usr/bin/env bash
# Dedicated Ubuntu guest only: base runtime + one immutable release.
# Idempotent for updates. Never enables the worker; the operator starts it explicitly.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo root_required; exit 78; }
! uname -r | grep -qi microsoft || { echo wsl_is_not_a_judge_vm; exit 78; }
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] || { echo ubuntu_24_04_required; exit 78; }

staging=/home/ootv2/staging
source_env=/home/ootv2/worker.env
[ -f "$source_env" ] && [ ! -L "$source_env" ] || { echo environment_missing; exit 78; }
[ -d "$staging" ] || { echo staging_missing; exit 78; }

# --- base packages (skip the apt round-trip when already satisfied) ---
if ! dpkg -s bubblewrap python3-seccomp xz-utils curl ca-certificates >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y bubblewrap python3-seccomp ca-certificates curl xz-utils
fi
/usr/bin/python3 -c 'import sys, seccomp; assert sys.version_info >= (3,12)' \
  || { echo python312_with_seccomp_required; exit 78; }

# --- official Node 22 distribution, checksum verified, idempotent ---
export PATH=/opt/ootv2-node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
if [ -x /opt/ootv2-node/bin/node ] \
  && /opt/ootv2-node/bin/node -e 'process.exit(process.versions.node.startsWith("22.")?0:1)' 2>/dev/null; then
  echo 'node=present'
else
  case "$(uname -m)" in x86_64) arch=x64;; *) echo unsupported_architecture; exit 78;; esac
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  base=https://nodejs.org/dist/latest-v22.x
  curl --fail --location --proto '=https' "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  file="$(awk -v suffix="linux-$arch.tar.xz" '$2 ~ suffix"$" {print $2}' "$tmp/SHASUMS256.txt")"
  [[ "$file" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]] || { echo invalid_node_manifest; exit 78; }
  curl --fail --location --proto '=https' "$base/$file" -o "$tmp/$file"
  (cd "$tmp"; grep "  $file$" SHASUMS256.txt | sha256sum --check)
  rm -rf /opt/ootv2-node.new /opt/ootv2-node.old
  mkdir -p /opt/ootv2-node.new
  tar -xJf "$tmp/$file" --strip-components=1 -C /opt/ootv2-node.new
  if [ -d /opt/ootv2-node ]; then mv /opt/ootv2-node /opt/ootv2-node.old; fi
  mv /opt/ootv2-node.new /opt/ootv2-node
  rm -rf /opt/ootv2-node.old
  echo "node=installed $(/opt/ootv2-node/bin/node --version)"
fi

# --- service account and directories ---
if ! id -u ootv2-worker >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/ootv2 --shell /usr/sbin/nologin --user-group ootv2-worker
fi
install -d -m 0755 /srv/ootv2
install -d -m 0700 /etc/ootv2
install -d -m 0750 -o ootv2-worker -g ootv2-worker /var/lib/ootv2

# Stop before replacing runtime; a failed install never restarts an unverified worker.
systemctl stop ootv2-github-worker.service 2>/dev/null || true

# Allow only runtime credentials/settings. DDL PAT/DB URL never enters the worker.
python3 - "$source_env" <<'PY'
import pathlib, re, sys
allowed = {'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OOTV2_GITHUB_TOKEN'}
selected = {}
for line in pathlib.Path(sys.argv[1]).read_text(encoding='utf-8-sig').splitlines():
    match = re.fullmatch(r'([A-Z0-9_]+)=(.*)', line.strip())
    if match and match[1] in allowed:
        selected[match[1]] = match[2]
if not all(selected.get(k) for k in ('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY')):
    raise SystemExit('required_worker_credentials_missing')
for value in selected.values():
    if any(ch in value for ch in ('\r', '\n', '\0')):
        raise SystemExit('invalid_worker_environment')
target = pathlib.Path('/etc/ootv2/worker.env')
target.write_text(''.join(f'{k}={v}\n' for k, v in selected.items()), encoding='utf8')
target.chmod(0o600)
PY
rm -f "$source_env"

# Release swap: installs code into /srv/ootv2/releases/<id> and atomically repoints
# /srv/ootv2/current. Rollback restores the previous release if the swap breaks.
bash "$staging/tools/provision/deploy-release.sh" "$staging"

release=/srv/ootv2/current
install -m 0644 "$release/tools/provision/ootv2-attest.service" /etc/systemd/system/
install -m 0644 "$release/tools/provision/ootv2-attest.timer" /etc/systemd/system/
install -m 0644 "$release/tools/provision/ootv2-github-worker.service" /etc/systemd/system/
systemctl daemon-reload

# Attestation is refreshed every 12h; it does not start the judge worker.
systemctl enable --now ootv2-attest.timer
systemctl start ootv2-attest.service || echo 'attestation_failed: fix sandbox before trusting this VM'

cd "$release"
set -a
# shellcheck disable=SC1091
. /etc/ootv2/worker.env
set +a
if ! node tools/cli/worker-health.js; then
  echo 'VM_RUNTIME_INSTALLED_BUT_HEALTH_BLOCKED: fix schema/Storage before starting the worker.'
  exit 79
fi

cat <<'DONE'
VM_RUNTIME_INSTALLED
  release: /srv/ootv2/current
  worker service installed but NOT enabled.
  Next (on the VM): sudo /srv/ootv2/current/tools/provision/workerctl.sh start
  Status/logs:      sudo /srv/ootv2/current/tools/provision/workerctl.sh status|logs
Note: this service only performs GitHub source intake + static validation.
Match execution (Campus runner) is NOT part of it; do not present it as a bot judge.
DONE
