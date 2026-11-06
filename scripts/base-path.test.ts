import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizeBasePath, stripBasePath, withBasePath } from '../shared/base-path';
import worker from '../src/index';
import type { Env } from '../src/types';
import { handlePublicRoute } from '../src/router-public';
import { applyCors } from '../src/utils/response';
import { buildDirectUploadUrl } from '../src/utils/direct-upload';

test('normalizes and validates deployment prefixes', () => {
  assert.equal(normalizeBasePath(), '');
  assert.equal(normalizeBasePath('/'), '');
  assert.equal(normalizeBasePath('/abc/nested'), '/abc/nested');
  for (const path of ['abc', '/abc/', '//abc', '/a/../b', '/a?b', '/a%2fb', '/a b']) {
    assert.throws(() => normalizeBasePath(path));
  }
  assert.equal(stripBasePath('/abc', '/abc'), '/');
  assert.equal(stripBasePath('/abc/api/config', '/abc'), '/api/config');
  assert.equal(stripBasePath('/abcd', '/abc'), null);
  assert.equal(withBasePath('/api', '/abc'), '/abc/api');
});

test('worker isolates prefix, maps assets, and injects public URLs', async () => {
  const seen: string[] = [];
  const env = {
    BASE_PATH: '/abc',
    ASSETS: { fetch: async (request: Request) => {
      const path = new URL(request.url).pathname;
      seen.push(path);
      if (path === '/manifest.webmanifest') return Response.json({ id: '/', scope: '/', start_url: '/vault', icons: [{ src: '/icon.png' }] });
      return new Response('<html><head><link href="/manifest.webmanifest"><script src="./assets/app.js"></script></head></html>', { headers: { 'Content-Type': 'text/html' } });
    } },
  } as unknown as Env;
  const ctx = {} as ExecutionContext;
  assert.equal((await worker.fetch(new Request('https://example.test/abcd'), env, ctx)).status, 404);
  assert.equal((await worker.fetch(new Request('https://example.test/abc'), env, ctx)).status, 308);
  const response = await worker.fetch(new Request('https://example.test/abc/vault/totp'), env, ctx);
  const html = await response.text();
  assert.match(html, /content="\/abc"/);
  assert.match(html, /href="\/abc\/manifest.webmanifest"/);
  assert.match(html, /src="\/abc\/assets\/app.js"/);
  const manifest = await (await worker.fetch(new Request('https://example.test/abc/manifest.webmanifest'), env, ctx)).json() as any;
  assert.equal(manifest.start_url, '/abc/vault');
  assert.equal(manifest.icons[0].src, '/abc/icon.png');
  assert.deepEqual(seen, ['/vault/totp', '/manifest.webmanifest']);
  assert.equal((await worker.fetch(new Request('https://example.test/'), { ...env, BASE_PATH: '/bad/' }, ctx)).status, 500);
});


test('API configuration, upload URLs, and connector security use the public prefix', async () => {
  const env = { BASE_PATH: '/abc' } as Env;
  const request = new Request('https://example.test/abc/api/config', { headers: { 'X-NodeWarden-Base-Path': '/abc' } });
  const response = await handlePublicRoute(request, env, '/api/config', 'GET', async () => null);
  assert.ok(response);
  const config = await response.json() as any;
  assert.equal(config.environment.api, 'https://example.test/abc/api');
  assert.equal(config.environment.identity, 'https://example.test/abc/identity');
  assert.equal(config.environment.notifications, 'https://example.test/abc/notifications');
  assert.match(buildDirectUploadUrl(request, '/api/ciphers/1', 'token'), /^https:\/\/example\.test\/abc\/api\//);
  const connector = applyCors(new Request('https://example.test/abc/webauthn-connector.html'), new Response('ok'), env);
  assert.equal(connector.headers.get('X-Frame-Options'), null);
});
