// Save relay checks (save key + short names). Run: node --test tests/
// Uses a fake GitHub, so it never touches the real live version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';

const ORIGIN = 'https://crowders-camps.github.io';
let saved = null;

// Fake GitHub contents API: one file, kept in memory.
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = init.method || 'GET';
  const j = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.includes('/git/ref/heads/')) return j({ object: { sha: 'abc' } });
  if (u.includes('/commits?')) return j([{ sha: 'aaaaaaa', commit: { message: 'v3: Pat Smith pushed live', committer: { date: '2026-11-16T12:00:00Z' } } }]);
  if (u.includes('/contents/') && method === 'GET') {
    if (!saved) return j({}, 404);
    return j({ sha: 's1', encoding: 'base64', content: Buffer.from(JSON.stringify(saved)).toString('base64') });
  }
  if (u.includes('/contents/') && method === 'PUT') {
    saved = JSON.parse(Buffer.from(JSON.parse(init.body).content, 'base64').toString());
    return j({});
  }
  return j({}, 404);
};

const env = (extra = {}) => ({ REPO: 'Crowders-Camps/test', BRANCH: 'live-data', DATA_PATH: 'data/live.json', ALLOWED_ORIGIN: ORIGIN, GITHUB_TOKEN: 't', ...extra });
const call = (path, { method = 'GET', key, body, ip = '1.1.1.1' } = {}, e = env()) => {
  const headers = { Origin: ORIGIN, 'CF-Connecting-IP': ip };
  if (key !== undefined) headers['X-Save-Key'] = key;
  return worker.fetch(new Request('https://relay.test' + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), e);
};
const push = (by = 'Pat') => ({ method: 'POST', body: { by, base: saved ? saved.v : 0, state: { a: 1 } } });

test('no SAVE_KEY set: works as before (rollout step)', async () => {
  saved = null;
  const r = await call('/live', push());
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('with SAVE_KEY: missing key refused for save and read', async () => {
  const e = env({ SAVE_KEY: 'right-key-123' });
  let r = await call('/live', push(), e);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'key_needed');
  r = await call('/live', {}, e);
  assert.equal(r.status, 401);
  r = await call('/history', {}, e);
  assert.equal(r.status, 401);
});

test('with SAVE_KEY: wrong key refused, right key works', async () => {
  const e = env({ SAVE_KEY: 'right-key-123' });
  let r = await call('/live', { ...push(), key: 'nope', ip: '2.2.2.2' }, e);
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, 'key_wrong');
  r = await call('/live', { ...push(), key: 'right-key-123', ip: '2.2.2.2' }, e);
  assert.equal(r.status, 200);
  r = await call('/live', { key: 'right-key-123' }, e);
  assert.equal(r.status, 200);
});

test('10 wrong keys then the visitor is blocked, even with the right key', async () => {
  const e = env({ SAVE_KEY: 'right-key-123' });
  for (let i = 0; i < 10; i++) assert.equal((await call('/live', { key: 'bad' + i, ip: '3.3.3.3' }, e)).status, 401);
  assert.equal((await call('/live', { key: 'right-key-123', ip: '3.3.3.3' }, e)).status, 429);
  assert.equal((await call('/live', { key: 'right-key-123', ip: '4.4.4.4' }, e)).status, 200);
});

test('browser preflight allows the key header', async () => {
  const r = await worker.fetch(new Request('https://relay.test/live', { method: 'OPTIONS', headers: { Origin: ORIGIN } }), env({ SAVE_KEY: 'x' }));
  assert.match(r.headers.get('Access-Control-Allow-Headers'), /X-Save-Key/);
});

test('names saved and shown as first name + last initial', async () => {
  const e = env();
  const r = await call('/live', push('Pat  Smith'), e);
  assert.equal((await r.json()).by, 'Pat S.');
  assert.equal(saved.by, 'Pat S.');
  const h = await (await call('/history', {}, e)).json();
  assert.equal(h.versions[0].by, 'Pat S.');
  assert.equal((await (await call('/live', push('JD'), e)).json()).by, 'JD');
});
