#!/usr/bin/env bash
# WSL is used ONLY to prepare a disk/seed. Judging runs on the Hyper-V guest.
#
# Image acquisition must survive an interrupted download without ever accepting a
# truncated disk:
#   - the manifest (and therefore the exact build) is re-read on every attempt, so a
#     partial download is never stitched onto a different `noble/current` build;
#   - the partial file is named after the checksum it belongs to;
#   - retries resume (`-C -`), but a checksum mismatch discards the partial;
#   - conversion writes to a staging name and only then claims `judge.vhdx`.
set -euo pipefail
out="$(realpath -m -- "$1")"
key="$(realpath -e -- "$2")"
mkdir -p "$out"
for tool in qemu-img cloud-localds curl sha256sum awk; do
  command -v "$tool" >/dev/null || { echo "image_tool_missing:$tool"; exit 78; }
done
cd "$out"

base=https://cloud-images.ubuntu.com/noble/current
file=noble-server-cloudimg-amd64.img
curl_opts=(--fail --silent --show-error --location --proto '=https' --tlsv1.2
  --connect-timeout 20 --retry 3 --retry-delay 5 --retry-all-errors)

seed_only=0
[ "${3:-}" = '--seed-only' ] && seed_only=1

staging=()
cleanup() {
  local f
  for f in ${staging[@]+"${staging[@]}"}; do rm -f -- "$f"; done
}
trap cleanup EXIT

vhdx_stage=judge.vhdx.stage
seed_stage=seed.vhdx.stage
seed_image_stage=seed.img.stage

# Write the cloud-init seed (NoCloud/cidata). `linux-cloud-tools-virtual` brings hv_kvp_daemon
# so Hyper-V can report the guest IPv4 address, and the last runcmd prints the PUBLIC host key
# fingerprint to the console so the operator can pin known_hosts without any password.
build_seed() {
  python3 - "$key" <<'PY'
import json, pathlib, sys, uuid
key = pathlib.Path(sys.argv[1]).read_text().strip()
if not key.startswith('ssh-ed25519 ') or '\n' in key:
    raise SystemExit('Expected one ed25519 public key')
# Prints the PUBLIC host key fingerprint on the tty1 login banner (/etc/issue.d is read by
# agetty, and /etc/issue is patched too in case issue.d is not honoured). This lets the
# operator pin known_hosts from the console without any guest password.
banner = '''#!/bin/sh
set -eu
pub="$(cat /etc/ssh/ssh_host_ed25519_key.pub)"
fp="$(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub | cut -d' ' -f2)"
mkdir -p /etc/issue.d
printf 'HOSTKEY %s\\n' "$fp" > /etc/issue.d/10-hostkey.issue
grep -qxF "HOSTKEY $fp" /etc/issue 2>/dev/null || printf 'HOSTKEY %s\\n' "$fp" >> /etc/issue
for dev in /dev/console /dev/ttyS0; do
  [ -c "$dev" ] || continue
  printf 'OOTV2_FINGERPRINT %s\\n' "$fp" > "$dev" || true
  printf 'OOTV2_PUBKEY %s\\n' "$pub" > "$dev" || true
done
'''
config = {'users': [{'name': 'ootv2', 'groups': ['sudo'], 'sudo': ['ALL=(ALL) NOPASSWD:ALL'],
                    'shell': '/bin/bash', 'lock_passwd': True, 'ssh_authorized_keys': [key]}],
          'ssh_pwauth': False, 'disable_root': True, 'package_update': True,
          # cloud-init mặc định xoá + sinh lại host key mỗi lần instance-id đổi, làm known_hosts
          # đã pin thành sai. Host key phải ổn định thì mới pin được.
          'ssh_deletekeys': False,
          'growpart': {'mode': 'auto', 'devices': ['/']},
          'packages': ['openssh-server', 'bubblewrap', 'python3-seccomp', 'ca-certificates',
                       'curl', 'xz-utils', 'qemu-guest-agent', 'linux-cloud-tools-virtual'],
          'write_files': [{'path': '/usr/local/sbin/ootv2-hostkey-banner',
                           'permissions': '0755', 'content': banner}],
          'runcmd': [['systemctl', 'enable', '--now', 'ssh'],
                     ['systemctl', 'enable', '--now', 'qemu-guest-agent'],
                     ['systemctl', 'enable', '--now', 'hv-kvp-daemon'],
                     ['/usr/local/sbin/ootv2-hostkey-banner']]}
pathlib.Path('user-data.stage').write_text('#cloud-config\n' + json.dumps(config), encoding='utf8')
pathlib.Path('meta-data.stage').write_text(json.dumps({'instance-id': str(uuid.uuid4()),
                                              'local-hostname': 'ootv2-judge'}), encoding='utf8')
PY
  cloud-localds "$seed_image_stage" user-data.stage meta-data.stage
  qemu-img convert -f raw -O vhdx "$seed_image_stage" "$seed_stage"
  mv -f user-data.stage user-data
  mv -f meta-data.stage meta-data
  rm -f -- "$seed_image_stage"
}

if [ "$seed_only" = 1 ]; then
  # Rebuild only the seed with a new instance-id (cloud-init re-runs) - the VM must be OFF.
  [ -e judge.vhdx ] || { echo seed_only_requires_existing_root_disk; exit 1; }
  echo 'seed_only: rebuild cloud-init seed; power the VM off first'
  build_seed
  mv -f "$seed_stage" seed.vhdx
  echo SEED_REBUILT
  exit 0
fi

manifest_checksum() {
  curl ${curl_opts[@]+"${curl_opts[@]}"} "$base/SHA256SUMS" -o SHA256SUMS.next
  local expected
  expected="$(awk -v name="$file" '$2==name || $2=="*"name {print $1}' SHA256SUMS.next)"
  [[ "$expected" =~ ^[a-f0-9]{64}$ ]] || { echo invalid_image_checksum; exit 1; }
  mv -f SHA256SUMS.next SHA256SUMS
  printf '%s' "$expected"
}

verify() { printf '%s  %s\n' "$1" "$2" | sha256sum --check --status; }

expected="$(manifest_checksum)"
# A partial from another build (including the legacy `$file.part` name) can never be
# completed into this one, and is never treated as the image.
for stale in "$file"*.part; do
  [ -e "$stale" ] || continue
  case "$stale" in
    "$file.$expected.part") : ;;
    *) rm -f -- "$stale" ;;
  esac
done

if [ -f "$file" ] && verify "$expected" "$file"; then
  echo image=reused
else
  part="$file.$expected.part"
  attempt=1
  while :; do
    [ -f "$part" ] && verify "$expected" "$part" && break
    echo "image=downloading attempt=$attempt"
    if curl ${curl_opts[@]+"${curl_opts[@]}"} --speed-limit 1024 --speed-time 60 \
      -C - "$base/$file" -o "$part"; then
      verify "$expected" "$part" && break
      echo "image_checksum_mismatch:attempt=$attempt" >&2
      rm -f -- "$part"
    else
      echo "image_download_interrupted:attempt=$attempt (partial kept for resume)" >&2
    fi
    if [ "$attempt" -ge 3 ]; then
      echo image_download_incomplete
      exit 1
    fi
    attempt=$((attempt + 1))
    # The published build may have changed while we were downloading it.
    expected="$(manifest_checksum)"
    case "$part" in
      "$file.$expected.part") : ;;
      *) rm -f -- "$part"; part="$file.$expected.part" ;;
    esac
  done
  verify "$expected" "$part"
  mv -f "$part" "$file"
  echo image=downloaded
fi

if [ -e judge.vhdx ] && [ -e seed.vhdx ]; then
  # Both disks already prepared (e.g. an earlier -PrepareOnly run): never rewrite them, the
  # VM may already own these files.
  echo image=disks_already_prepared
  exit 0
fi
if [ -e judge.vhdx ] || [ -e seed.vhdx ]; then
  echo 'incomplete_disk_set_present: refusing to replace a disk the VM may own'
  exit 1
fi
vhdx_stage=judge.vhdx.stage
seed_stage=seed.vhdx.stage
seed_image_stage=seed.img.stage
staging+=("$vhdx_stage" "$seed_stage" "$seed_image_stage" "user-data.stage" "meta-data.stage")
# Convert once, no resize: `qemu-img resize` cannot grow vhdx, and growing it through a raw
# intermediate rewrites tens of GB over the 9p mount. Hyper-V resizes the disk on the Windows
# side (Resize-VHD) before the VM is created.
qemu-img convert -f qcow2 -O vhdx "$file" "$vhdx_stage"
build_seed
# Only a fully converted disk may take the final name; a half-written one never does.
mv -f "$vhdx_stage" judge.vhdx
mv -f "$seed_stage" seed.vhdx
echo IMAGE_PREPARED
