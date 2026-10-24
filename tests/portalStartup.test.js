import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { renderToString } from 'react-dom/server';
import { createServer } from 'vite';

test('CampusPortal renders login on first load without an API or session', async (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  globalThis.window = {
    location: { hash: '' },
    localStorage: { getItem: () => null },
  };
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
  });

  const server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, watch: { ignored: ['**/data/**'] } },
    appType: 'custom',
  });
  t.after(() => server.close());

  // Load the real JSX import graph: a successful Vite build alone cannot catch
  // callbacks referencing a later const in their eagerly evaluated hook deps.
  const { default: App } = await server.ssrLoadModule('/src/App.jsx');
  const html = renderToString(App());
  assert.match(html, /tt-login/);
  assert.match(html, /name="username"/);
  assert.match(html, /name="password"/);
  assert.match(html, /Chơi offline/);
  // The imperative board mounts in useLayoutEffect, checked by browser smoke.
  assert.match(html, /tt-login__board/);
});