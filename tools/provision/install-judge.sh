#!/usr/bin/env bash
# Dedicated Ubuntu guest only. Installs runtime; never enables a legacy judge.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo root_required; exit 78; }
! uname -r | grep -qi microsoft || { echo wsl_is_not_a_judge_vm; exit 78; }
. /etc/os-release
[ "$ID" = ubuntu ] && [ "$VERSION_ID" = 24.04 ] || { echo ubuntu_24_04_required; exit 78; }
staging=/home/ootv2/staging
source_env=/home/ootv2/worker.env
[ -f "$source_env" ] && [ ! -L "$source_env" ] || { echo environment_missing; exit 78; }
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y bubblewrap python3-seccomp ca-certificates curl xz-utils
/usr/bin/python3 -c 'import sys, seccomp; assert sys.version_info >= (3,12)'
# Official Node distribution, checksum verified; no curl|bash installer.
case "$(uname -m)" in x86_64) arch=x64;; *) echo unsupported_architecture; exit 78;; esac
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
base=https://nodejs.org/dist/latest-v22.x
curl --fail --location --proto '=https' "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
file="$(awk -v suffix="linux-$arch.tar.xz" '$2 ~ suffix"$" {print $2}' "$tmp/SHASUMS256.txt")"
[[ "$file" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]] || { echo invalid_node_manifest; exit 78; }
curl --fail --location --proto '=https' "$base/$file" -o "$tmp/$file"
(cd "$tmp"; grep "  $file$" SHASUMS256.txt | sha256sum --check)
mkdir -p /opt/ootv2-node
tar -xJf "$tmp/$file" --strip-components=1 -C /opt/ootv2-node
export PATH=/opt/ootv2-node/bin:/usr/sbin:/usr/bin:/sbin:/bin
install -d -m 0755 /srv/ootv2
install -d -m 0700 /etc/ootv2 /var/lib/ootv2
# Stop before replacing runtime; failed installations never restart an old/unverified worker.
systemctl stop ootv2-official-worker.service ootv2-github-worker.service 2>/dev/null || true
cp -a "$staging/." /srv/ootv2/
chown -R root:root /srv/ootv2
find /srv/ootv2/sandbox/linux -name '*.sh' -exec chmod 755 {} +
find /srv/ootv2/tools/provision -name '*.sh' -exec chmod 755 {} +
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
target = pathlib.Path('/etc/ootv2/worker.env')
target.write_text(''.join(f'{k}={v}\n' for k, v in selected.items()), encoding='utf8')
target.chmod(0o600)
PY
rm -f "$source_env"
cd /srv/ootv2
npm ci --omit=dev --ignore-scripts
node --check server/worker.js
install -m 0644 tools/provision/ootv2-attest.service /etc/systemd/system/
install -m 0644 tools/provision/ootv2-attest.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ootv2-attest.timer
systemctl start ootv2-attest.service
node tools/cli/verify-shared-db.js
echo 'VM_RUNTIME_INSTALLED: attestation and DB checked. Official worker is NOT enabled until its fenced runner is installed and accepted.'
