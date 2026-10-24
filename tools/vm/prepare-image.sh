#!/usr/bin/env bash
# WSL is used ONLY to prepare a disk/seed. Judging runs on the Hyper-V guest.
set -euo pipefail
out="$(realpath -m -- "$1")"
key="$(realpath -e -- "$2")"
mkdir -p "$out"
command -v qemu-img >/dev/null
command -v cloud-localds >/dev/null
command -v curl >/dev/null
cd "$out"
base=https://cloud-images.ubuntu.com/noble/current
file=noble-server-cloudimg-amd64.img
curl --fail --location --proto '=https' --tlsv1.2 "$base/SHA256SUMS" -o SHA256SUMS
expected="$(awk -v name="$file" '$2==name || $2=="*"name {print $1}' SHA256SUMS)"
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { echo invalid_image_checksum; exit 1; }
if ! [ -f "$file" ] || ! printf '%s  %s\n' "$expected" "$file" | sha256sum --check --status; then
  curl --fail --location --proto '=https' --tlsv1.2 "$base/$file" -o "$file.part"
  printf '%s  %s\n' "$expected" "$file.part" | sha256sum --check
  mv "$file.part" "$file"
fi
if [ -e judge.vhdx ]; then echo 'judge.vhdx already exists; refusing to replace'; exit 1; fi
qemu-img convert -f qcow2 -O vhdx "$file" judge.vhdx
qemu-img resize -f vhdx judge.vhdx 40G
python3 - "$key" <<'PY'
import json, pathlib, sys, uuid
key = pathlib.Path(sys.argv[1]).read_text().strip()
if not key.startswith('ssh-ed25519 ') or '\n' in key:
    raise SystemExit('Expected one ed25519 public key')
config = {'users': [{'name': 'ootv2', 'groups': ['sudo'], 'sudo': ['ALL=(ALL) NOPASSWD:ALL'],
                    'shell': '/bin/bash', 'lock_passwd': True, 'ssh_authorized_keys': [key]}],
          'ssh_pwauth': False, 'disable_root': True, 'package_update': True,
          'packages': ['openssh-server', 'bubblewrap', 'python3-seccomp', 'ca-certificates', 'curl', 'xz-utils'],
          'runcmd': [['systemctl', 'enable', '--now', 'ssh']]}
pathlib.Path('user-data').write_text('#cloud-config\n' + json.dumps(config), encoding='utf8')
pathlib.Path('meta-data').write_text(json.dumps({'instance-id': str(uuid.uuid4()),
                                              'local-hostname': 'ootv2-judge'}), encoding='utf8')
PY
cloud-localds seed.img user-data meta-data
qemu-img convert -f raw -O vhdx seed.img seed.vhdx
echo IMAGE_PREPARED
