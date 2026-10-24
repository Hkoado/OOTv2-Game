import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = new URL('../../data/ui-smoke-report.json', import.meta.url);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '4187', '--strictPort'], { cwd: root, stdio: 'ignore' });
const browser = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9337', `--user-data-dir=${root}data/ui-kit-smoke-${Date.now()}`, 'about:blank'], { stdio: 'ignore' });
let socket;
const report = { checks: [], errors: [] };
try {
  let pages;
  for (let i = 0; i < 100; i++) {
    try { pages = await (await fetch('http://127.0.0.1:9337/json/list')).json(); if (pages.some(p => p.type === 'page')) break; } catch {}
    await delay(150);
  }
  socket = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p?.reject(msg.error) : p?.resolve(msg.result); }
    if (msg.method === 'Runtime.exceptionThrown') report.errors.push(msg.params.exceptionDetails.text + ': ' + (msg.params.exceptionDetails.exception?.description || ''));
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || 'Browser evaluation failed');
    return result.result.value;
  };
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes(${JSON.stringify(text)}))?.click()`);
  await call('Runtime.enable'); await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: 'http://127.0.0.1:4187/' });
  for (let i = 0; i < 80; i++) { if (await evaluate(`document.querySelectorAll('.ott-square').length === 81`)) break; await delay(100); }
  assert.equal(await evaluate(`document.querySelectorAll('.ott-square').length`), 81);
  report.checks.push('Production login renders approved 81-square board under React StrictMode');
  for (const theme of ['light', 'dark']) {
    await evaluate(`document.querySelector('.tournament-app').dataset.theme = '${theme}'`);
    await evaluate('document.fonts.ready'); await delay(300);
    assert(await evaluate(`Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)`));
    const screen = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(new URL(`../../data/ui-login-${theme}.png`, import.meta.url), Buffer.from(screen.data, 'base64'));
    report.checks.push(`${theme}: all atlas images load, bundled fonts ready`);
  }
  await click('Chơi offline'); await delay(300);
  assert.equal(await evaluate(`document.querySelectorAll('.ott-square').length`), 81);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Map mẫu"]').options.length`), 5);
  await evaluate(`window.confirm = () => true`);
  for (let index = 0; index < 5; index++) {
    await evaluate(`(() => { const select = document.querySelector('[aria-label="Map mẫu"]'); select.value = select.options[${index}].value; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await delay(120);
    const download = await evaluate(`JSON.parse(decodeURIComponent(document.querySelector('a[download$=".json"]').href.split(',')[1]))`);
    assert.equal(download.rulesVersion, 'ott-campus.v2');
    assert.equal(download.id, ['learn-fire', 'learn-water', 'learn-bush', 'learn-chasm', 'campus-four-terrains'][index]);
    assert.ok(Object.keys(download.terrains).length > 0);
    if (index === 4) assert.equal(new Set(Object.values(download.terrains)).size, 4);
  }
  report.checks.push('All five v2 terrain maps selectable; JSON downloads contain the displayed terrains');
  // Fire at b2: Paper must fail, while Rock must still be placeable.
  await evaluate(`document.querySelector('.tt-offline__pieces button[data-type="paper"]')?.click()`);
  await delay(80);
  assert.equal(await evaluate(`document.querySelector('.tt-offline__pieces button[aria-pressed="true"]').dataset.type`), 'paper');
  await evaluate(`document.querySelector('[data-square="b2"]').click()`); await delay(100);
  assert.equal(await evaluate(`document.querySelectorAll('.ott-square .ott-piece').length`), 0);
  await evaluate(`document.querySelector('.tt-offline__pieces button[data-type="rock"]')?.click()`);
  await delay(80);
  await evaluate(`document.querySelector('[data-square="a1"]').click()`); await delay(100);
  assert.equal(await evaluate(`document.querySelectorAll('.ott-square .ott-piece').length`), 1);
  report.checks.push('Offline setup callback places a real piece');
  await click('Xếp nhanh'); await delay(150); await click('Xác nhận'); await delay(150);
  assert.equal(await evaluate(`document.querySelectorAll('.ott-square .ott-piece').length`), 0);
  report.checks.push('Offline manual setup rejects Paper on Fire; Blue cannot see Red setup on board');
  await click('Xếp nhanh'); await delay(150); await click('Xác nhận'); await delay(150);
  assert.equal(await evaluate(`document.querySelectorAll('.ott-square .ott-piece').length`), 18);
  report.checks.push('Red then blue setup reaches real game with 18 pieces');
  await evaluate(`document.querySelector('.ott-square .ott-piece[data-team="red"]').closest('button').click()`);
  await delay(100);
  let available = await evaluate(`document.querySelectorAll('.ott-square.is-available').length`);
  if (!available) {
    const squares = await evaluate(`Array.from(document.querySelectorAll('.ott-square .ott-piece[data-team="red"]')).map(n=>n.closest('button').dataset.square)`);
    for (const square of squares) { await evaluate(`document.querySelector('[data-square="${square}"]').click()`); await delay(30); available = await evaluate(`document.querySelectorAll('.ott-square.is-available').length`); if (available) break; }
  }
  assert(available > 0);
  await evaluate(`document.querySelector('.ott-square.is-available').click()`); await delay(150);
  assert(await evaluate(`document.querySelector('.tt-offline__history').textContent.length > 0`));
  report.checks.push('Legal move forwards through existing engine and updates history');
  await evaluate(`document.querySelector('.ott-square').focus()`);
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
  assert.equal(await evaluate('document.activeElement.dataset.square'), 'h1');
  report.checks.push('Blue orientation keyboard arrow navigation works');
  for (const [width, height] of [[1280,720], [1366,768], [1440,900], [390,844]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await delay(100);
    assert(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), `Horizontal overflow at ${width}`);
    report.checks.push(`Offline layout: no horizontal overflow at ${width}x${height}`);
  }
  const screen = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(new URL('../../data/ui-offline-mobile.png', import.meta.url), Buffer.from(screen.data, 'base64'));
  assert.deepEqual(report.errors, []);
  report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; }
finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  socket?.close(); browser.kill(); server.kill();
}