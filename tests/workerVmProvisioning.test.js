import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function findBash() {
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files\\Git\\usr\\bin\\bash.exe']
    : ['/bin/bash', '/usr/bin/bash'];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  const probe = spawnSync('bash', ['-c', 'exit 0']);
  return probe.status === 0 ? 'bash' : null;
}

test('sandbox watchdog is reaped without inheriting bot protocol pipes', () => {
  const script = read('sandbox/linux/run-bot.sh');
  assert.match(script, /watchdog <\/dev\/null >\/dev\/null 2>&1 &/);
  assert.match(script, /sleeper=\$!/);
  assert.ok(script.includes('kill "$sleeper"'));
  assert.ok(script.includes('wait "$sleeper"'));
});

test('main-gate drill isolates mounts, environment and cgroups without deploying services', () => {
  const script = read('tools/provision/test-main-gates.sh');
  assert.match(script, /env -i/);
  assert.match(script, /unshare --mount --propagation private/);
  assert.match(script, /mount -t tmpfs .* \/run/);
  assert.match(script, /ootv2-drill-/);
  assert.doesNotMatch(script, /systemctl|SUPABASE_SERVICE_ROLE_KEY|ln -s/);
  assert.match(read('sandbox/linux/selftest.sh'), /ls -A "\$cgroup_root"/);
});

test('Windows VM provisioning verifies an empty SSH key passphrase without a prompt', () => {
  const script = read('tools/vm/New-JudgeVM.ps1');
  assert.match(script, /Diagnostics\.ProcessStartInfo/);
  assert.match(script, /-N "" -C ootv2-local-judge/);
  // `ssh-keygen -y` chỉ có `-y [-f file]`; truyền `-P` làm nó thoát 1 nên không dùng.
  assert.doesNotMatch(script, /-y -P/);
  assert.match(script, /'-y -f "/);
  // Passphrase key bị phát hiện từ header bcrypt trước khi chạy ssh-keygen.
  assert.match(script, /bcrypt/);
  assert.match(script, /StandardInput\.Close\(\)/);
  assert.match(script, /WaitForExit\(\$TimeoutMs\)/);
  assert.match(script, /\.Kill\(\)/);
  // Retry không được tạo lại danh tính đang dùng tốt.
  assert.match(script, /does not match the private key/);
});

test('Windows VM provisioning translates paths with WSL instead of assuming /mnt', () => {
  const script = read('tools/vm/New-JudgeVM.ps1');
  assert.match(script, /'wslpath', '-a'/);
  // `wsl.exe` bỏ backslash trong argument (`D:\VM` → `D:VM`) nên wslpath nhận dạng `/`.
  assert.ok(script.includes("Replace('\\', '/')"), 'New-JudgeVM must translate with forward slashes');
  assert.match(script, /Invoke-Wsl/);
  assert.doesNotMatch(script, /return "\/mnt\//);
  assert.match(script, /Assert-WslVisible/);
  assert.match(script, /Expected an absolute local drive path/);
  assert.match(script, /Image preparation did not produce/);
  assert.match(script, /^exit 0$/m);
  // doctor phải kiểm cùng kiểu và không được để stderr của wsl.exe giết script.
  const worker = read('tools/vm/Worker.ps1');
  assert.match(worker, /\$ErrorActionPreference = 'Continue'/);
  assert.ok(worker.includes("Replace('\\', '/')"), 'doctor must translate with forward slashes');
});

test('image preparation resumes but never accepts a truncated or mismatched disk', () => {
  const script = read('tools/vm/prepare-image.sh');
  assert.match(script, /retry-all-errors/);
  assert.match(script, /-C -/);
  // Partial gắn với checksum của đúng build, không dùng lại partial của build khác.
  assert.match(script, /part="\$file\.\$expected\.part"/);
  assert.match(script, /image_download_incomplete/);
  assert.match(script, /invalid_image_checksum/);
  assert.match(script, /sha256sum --check --status/);
  // Conversion ghi vào tên staging rồi mới nhận tên cuối; vhdx không resize được bằng qemu-img
  // nên việc grow sang 40 GiB thuộc Resize-VHD của Hyper-V (có trong New-JudgeVM).
  assert.match(script, /vhdx_stage=judge\.vhdx\.stage/);
  assert.doesNotMatch(script, /^qemu-img resize/m);
  assert.doesNotMatch(script, /judge\.raw\.stage/);
  assert.doesNotMatch(script, /qemu-img convert -f qcow2 -O vhdx "\$file" judge\.vhdx/);
  // Chạy lại sau -PrepareOnly phải là idempotent, nhưng không bao giờ ghi đè disk VM có thể đang dùng.
  assert.match(script, /image=disks_already_prepared/);
  assert.match(script, /incomplete_disk_set_present/);
  // Seed rebuild riêng để đổi cloud-init mà không phải tải/convert lại root disk.
  assert.match(script, /--seed-only/);
  assert.match(script, /SEED_REBUILT/);
  // Fingerprint PUBLIC key hiện trên banner login (không cần mật khẩu guest, không phải cuộn)
  // và được phát cả ra serial console để host đọc mà không phải gõ tay.
  assert.match(script, /\/etc\/issue\.d\/10-hostkey\.issue/);
  assert.match(script, /ootv2-hostkey-banner/);
  assert.match(script, /ssh-keygen -lf \/etc\/ssh\/ssh_host_ed25519_key\.pub/);
  assert.match(script, /OOTV2_FINGERPRINT %s/);
  assert.match(script, /OOTV2_PUBKEY %s/);
  assert.match(script, /for dev in \/dev\/console \/dev\/ttyS0/);
  // Host key phải ổn định qua các lần cloud-init chạy lại, nếu không known_hosts đã pin sẽ sai.
  assert.match(script, /'ssh_deletekeys': False/);
  const ps = read('tools/vm/New-JudgeVM.ps1');
  assert.match(ps, /Resize-VHD -Path \$rootDisk -SizeBytes 40GB/);
  assert.match(ps, /Root disk is only/);
  // Host 16 GiB không cấp nổi 4 GiB tĩnh (0x800705AA) ⇒ dynamic memory với trần cố định.
  assert.match(ps, /-DynamicMemoryEnabled \$true/);
  assert.match(ps, /-MaximumBytes \(\$MemoryGiB \* 1GB\)/);
});

test('installer restores the services that were active before an update', () => {
  const installer = read('tools/provision/install-judge.sh');
  assert.match(installer, /OOTV2_PREVIOUS_ACTIVE/);
  assert.match(installer, /previous_active=\/run\/ootv2-previous-active/);
  // Chụp trạng thái TRƯỚC khi stop, nếu không update sẽ để worker cũ ở trạng thái tắt.
  assert.ok(installer.indexOf('systemctl is-active --quiet') < installer.indexOf('systemctl stop ootv2-github-worker'));
  assert.match(installer, /worker_env_restored_previous/);
  assert.match(installer, /worker-health\.js --scope=all/);
  const deploy = read('tools/provision/deploy-release.sh');
  assert.match(deploy, /OOTV2_PREVIOUS_ACTIVE/);
  assert.match(deploy, /attestation_after_rollback_failed/);
});

test('judge control refuses to start without schema readiness and a fresh attestation', () => {
  const ctl = read('tools/provision/workerctl.sh');
  assert.match(ctl, /worker-health\.js --scope="\$queue"/);
  assert.match(ctl, /require_attestation/);
  assert.match(ctl, /worker_start_refused/);
  assert.match(ctl, /attestation_failed/);
  const unit = read('tools/provision/ootv2-official-worker.service');
  assert.match(unit, /Wants=network-online\.target ootv2-attest\.service/);
});

test('target address survives a guest without the KVP daemon', () => {
  const worker = read('tools/vm/Worker.ps1');
  // Ubuntu cloud image không có hv_kvp_daemon ⇒ Hyper-V không báo IP; phải fallback ARP theo MAC.
  assert.match(worker, /Get-NetNeighbor/);
  assert.match(worker, /LinkLayerAddress/);
  assert.match(worker, /ToUpperInvariant\(\)/);
  assert.match(read('tools/vm/prepare-image.sh'), /linux-cloud-tools-virtual/);
});

test('Worker.ps1 mặc định điều khiển judge worker trên VM chấm', () => {
  const worker = read('tools/vm/Worker.ps1');
  // Mặc định 'github' từng làm `-Action status` báo inactive dù judge worker đang chạy.
  assert.match(worker, /\[ValidateSet\('github','judge'\)\]\[string\]\$Service = 'judge'/);
});

test('native ssh/scp calls cannot abort the installer through NativeCommandError', () => {
  const install = read('tools/vm/Install-Judge.ps1');
  // scp/ssh ghi progress ra stderr; nếu preference là Stop thì script chết im lặng, không exit code.
  assert.match(install, /function Invoke-Native/);
  assert.match(install, /\$ErrorActionPreference = 'Continue'/);
  assert.match(install, /Invoke-Native 'scp\.exe'/);
  assert.match(install, /Invoke-Native 'ssh\.exe'/);
  assert.match(install, /Invoke-Native 'tar\.exe'/);
  assert.doesNotMatch(install, /^\s*& scp\.exe/m);
  assert.doesNotMatch(install, /^\s*& ssh\.exe/m);
  const worker = read('tools/vm/Worker.ps1');
  assert.match(worker, /function Invoke-Guest/);
  assert.match(worker, /& ssh\.exe @options "\$\(\$cfg\.sshUser\)@\$Target" \$Command \| Out-Host/);
});

test('workerctl reports attestation without broken shell quoting', () => {
  const ctl = read('tools/provision/workerctl.sh');
  // `\"` bên trong chuỗi nháy đơn là backslash thật -> Python "unexpected character after
  // line continuation"; phải dùng %-format với nháy kép và một hàm dùng chung.
  assert.doesNotMatch(ctl, /\\"/);
  assert.match(ctl, /print_attestation\(\) \{/);
  assert.match(ctl, /attestation=%s expires=%s" % \(d\.get\("result"\), d\.get\("expiresAt"\)\)/);
  // File attestation là root-only: `version` không sudo phải báo unreadable thay vì exit 1.
  assert.match(ctl, /attestation=unreadable \(run with sudo\)/);
  assert.match(ctl, /\[ ! -r \/run\/ootv2-sandbox-attestation\.json \]/);
  const calls = ctl.match(/print_attestation/g) ?? [];
  assert.ok(calls.length >= 3, 'helper must be defined and used by version + attest');
});

test('shell provisioning scripts parse under bash', (t) => {
  const bash = findBash();
  if (!bash) return t.skip('bash is not available on this machine');
  for (const file of ['tools/vm/prepare-image.sh', 'tools/provision/install-judge.sh',
    'tools/provision/deploy-release.sh', 'tools/provision/workerctl.sh']) {
    const result = spawnSync(bash, ['-n', fileURLToPath(new URL(`../${file}`, import.meta.url))], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});
