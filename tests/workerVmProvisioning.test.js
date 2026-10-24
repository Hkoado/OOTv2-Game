import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Windows VM provisioning requests and verifies an empty SSH key passphrase', () => {
  const script = readFileSync(new URL('../tools/vm/New-JudgeVM.ps1', import.meta.url), 'utf8');
  assert.match(script, /Diagnostics\.ProcessStartInfo/);
  assert.match(script, /-N "" -C ootv2-local-judge/);
  assert.match(script, /ssh-keygen\.exe -y -f \$key/);
  assert.doesNotMatch(script, /ssh-keygen\.exe -t ed25519.*-N/);
  assert.match(script, /Expected an absolute local drive path/);
  assert.match(script, /return "\/mnt\/\$drive\/\$tail"/);
});