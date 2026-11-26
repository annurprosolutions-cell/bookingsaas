import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/index.mjs';
import { makeEnv, req, ADMIN_TOKEN, fakeGoogle } from './helpers.mjs';

const get = (env, token) => handle(req('/api/platform/setup-check', { token }), env);

test('setup-check: tanpa ADMIN_TOKEN dipasang -> 503 dengan mesej jelas', async () => {
  const env = makeEnv(fakeGoogle(), { ADMIN_TOKEN: undefined });
  const r = await get(env, 'apa-apa');
  assert.equal(r.status, 503);
  assert.equal((await r.json()).kod, 'tiada-admin-token');
});

test('setup-check: tanpa token / token salah -> 401', async () => {
  const env = makeEnv(fakeGoogle());
  assert.equal((await get(env)).status, 401);
  assert.equal((await get(env, 'salah')).status, 401);
});

test('setup-check: semua lengkap -> ok, BCL_API_TOKEN "kemudian" tidak menggagalkan', async () => {
  const env = makeEnv(fakeGoogle());
  const r = await get(env, ADMIN_TOKEN);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true, JSON.stringify(j.gagal));
  const bcl = j.items.find((i) => i.nama === 'BCL_API_TOKEN');
  assert.equal(bcl.status, 'kemudian');
  assert.equal(j.items.find((i) => i.nama === 'TENANT_LOCK').status, 'ok');
  assert.equal(j.items.find((i) => i.nama === 'REGISTRY').status, 'ok');
  assert.equal(j.items.find((i) => i.nama === 'config.js').status, 'ok');
});

test('setup-check: TIDAK pernah memulangkan nilai rahsia', async () => {
  const env = makeEnv(fakeGoogle(), { BCL_API_TOKEN: 'bcl_rahsia_sangat_panjang_123' });
  const text = await (await get(env, ADMIN_TOKEN)).text();
  for (const k of ['GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'TOKEN_ENC_KEY', 'ADMIN_TOKEN', 'BCL_WEBHOOK_KEY', 'TURNSTILE_SECRET', 'BCL_API_TOKEN', 'OWNER_EMAILS']) {
    assert.ok(!text.includes(env[k]), k + ' bocor dalam respons');
  }
});

test('setup-check: binding dan secret hilang / salah format dilaporkan', async () => {
  const env = makeEnv(fakeGoogle(), {
    REGISTRY: undefined,
    TOKEN_ENC_KEY: 'terlalu-pendek',
    SESSION_SECRET: undefined,
    OWNER_EMAILS: 'bukan-emel',
    GOOGLE_CLIENT_ID: 'abc'
  });
  env.TENANT_LOCK = undefined;
  const j = await (await get(env, ADMIN_TOKEN)).json();
  assert.equal(j.ok, false);
  const s = Object.fromEntries(j.items.map((i) => [i.nama, i.status]));
  assert.equal(s.REGISTRY, 'tiada');
  assert.equal(s.TENANT_LOCK, 'tiada');
  assert.equal(s.TOKEN_ENC_KEY, 'salah');
  assert.equal(s.SESSION_SECRET, 'tiada');
  assert.equal(s.OWNER_EMAILS, 'salah');
  assert.equal(s.GOOGLE_CLIENT_ID, 'salah');
  assert.equal(s['config.js'], 'salah', 'config.js tidak sepadan dengan GOOGLE_CLIENT_ID');
  for (const n of ['REGISTRY', 'TENANT_LOCK', 'TOKEN_ENC_KEY', 'SESSION_SECRET']) assert.ok(j.gagal.includes(n));
});

test('setup-check: kaedah selain GET ditolak', async () => {
  const env = makeEnv(fakeGoogle());
  const r = await handle(req('/api/platform/setup-check', { method: 'POST', token: ADMIN_TOKEN, body: {} }), env);
  assert.equal(r.status, 405);
});

test('API tidak dikenali -> 404 JSON, /api/health ok', async () => {
  const env = makeEnv(fakeGoogle());
  assert.equal((await handle(req('/api/tiada'), env)).status, 404);
  const h = await handle(req('/api/health'), env);
  assert.equal(h.status, 200);
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
});
