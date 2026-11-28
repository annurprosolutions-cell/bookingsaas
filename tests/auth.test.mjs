// F-02 / F-14: login Google, sesi, trial automatik, /api/me
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, fakeGoogle, call, login, NOW, ORIGIN } from './helpers.mjs';
import { signSession } from '../worker/lib/crypto.js';

const kvKeys = (env, prefix) => [...env.REGISTRY._map.keys()].filter((k) => k.startsWith(prefix));
const kvJson = (env, k) => JSON.parse(env.REGISTRY._map.get(k));

test('login pertama: tenant draf, refresh token berenkripsi, trial 14 hari, sesi', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { status, j } = await login(env, g);
  assert.equal(status, 200, JSON.stringify(j));
  assert.equal(j.ok, true);
  assert.equal(j.perluSetup, true);
  assert.equal(j.email, 'ujian@gmail.com');
  assert.ok(j.sesi);

  const tid = env.REGISTRY._map.get('owner:ujian@gmail.com');
  assert.match(tid, /^[a-z2-7]{12}$/);
  const t = kvJson(env, 'tenant:' + tid);
  assert.deepEqual([t.slug, t.sheetId, t.conn, t.status, t.schema], ['', '', 'ok', 'aktif', 1]);
  assert.equal(t.ownerEmail, 'ujian@gmail.com');
  assert.match(t.rt, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(![...env.REGISTRY._map.values()].some((v) => v.includes('rt-rahsia-123')), 'refresh token mentah tiada dalam KV');
  assert.ok(!JSON.stringify(j).includes('rt-rahsia-123'), 'refresh token tidak dihantar ke pelayar');

  const lic = kvJson(env, 'email:ujian@gmail.com');
  assert.deepEqual([lic.plan, lic.expires], ['percubaan', '2026-12-14']);
  assert.equal(env.REGISTRY._map.get('trial:ujian@gmail.com'), '2026-12-01');
});

test('login kedua (Google tidak beri refresh token): akaun sama, tiada trial kedua', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  await login(env, g);
  const licAsal = env.REGISTRY._map.get('email:ujian@gmail.com');
  const g2 = fakeGoogle({ refreshToken: null });
  const { j } = await login(env, g2, { now: NOW + 86400000 * 3 });
  assert.equal(j.ok, true);
  assert.equal(kvKeys(env, 'tenant:').length, 1);
  assert.equal(env.REGISTRY._map.get('email:ujian@gmail.com'), licAsal);
});

test('klik berganda: dua login serentak hanya mencipta satu studio', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const r = await Promise.all([login(env, g), login(env, g), login(env, g)]);
  assert.ok(r.every((x) => x.j.ok));
  assert.equal(kvKeys(env, 'tenant:').length, 1);
  const tid = env.REGISTRY._map.get('owner:ujian@gmail.com');
  assert.ok(env.REGISTRY._map.has('tenant:' + tid));
});

test('studio baharu tanpa refresh token: akses ditarik balik dan diminta cuba lagi', async () => {
  const g = fakeGoogle({ refreshToken: null });
  const env = makeEnv(g);
  const { j } = await login(env, g);
  assert.equal(j.kod, 'tiada-refresh-token');
  assert.ok(g.state.revoked.includes('at-kod'));
  assert.equal(kvKeys(env, 'tenant:').length, 0);
});

test('kotak Google Drive tidak ditanda: tiada akaun dicipta', async () => {
  const g = fakeGoogle({ scope: 'openid https://www.googleapis.com/auth/userinfo.email' });
  const env = makeEnv(g);
  const { j } = await login(env, g);
  assert.equal(j.kod, 'tiada-skop-drive');
  assert.ok(g.state.revoked.includes('at-kod'));
  assert.equal(kvKeys(env, 'tenant:').length, 0);
});

test('penanda trial wujud (pernah trial dahulu): tiada trial baharu', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  await env.REGISTRY.put('trial:ujian@gmail.com', '2026-01-01');
  const { j } = await login(env, g);
  assert.equal(j.ok, true);
  assert.equal(env.REGISTRY._map.get('email:ujian@gmail.com'), undefined);
  const me = await call(env, g, '/api/me', { token: j.sesi });
  assert.equal(me.j.licence.state, 'tiada');
  assert.equal(me.j.licence.reason, 'tiada');
});

test('TRIAL_DAYS=0: tiada trial', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g, { TRIAL_DAYS: '0' });
  await login(env, g);
  assert.equal(env.REGISTRY._map.get('email:ujian@gmail.com'), undefined);
});

test('CSRF dan kaedah: tanpa X-Requested-With 400, origin asing 403, GET 405', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  assert.equal((await login(env, g, { headers: { 'x-requested-with': '' } })).status, 400);
  assert.equal((await login(env, g, { headers: { origin: 'https://jahat.example' } })).status, 403);
  assert.equal((await call(env, g, '/api/auth/google')).status, 405);
});

test('emel Google belum disahkan ditolak', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const orig = g.fetch;
  g.fetch = async (u, init) => {
    const r = await orig(u, init);
    if (u === 'https://oauth2.googleapis.com/token' && new URLSearchParams(init.body).get('grant_type') === 'authorization_code') {
      const b = await r.json();
      const p = JSON.parse(Buffer.from(b.id_token.split('.')[1], 'base64url'));
      p.email_verified = false;
      b.id_token = ['x', Buffer.from(JSON.stringify(p)).toString('base64url'), 'y'].join('.');
      return new Response(JSON.stringify(b), { status: 200 });
    }
    return r;
  };
  const { status, j } = await login(env, g);
  assert.equal(status, 401);
  assert.equal(j.kod, 'login-tidak-sah');
  assert.equal(kvKeys(env, 'tenant:').length, 0);
});

test('platform belum lengkap dipasang: 503 dengan mesej jelas', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g, { GOOGLE_CLIENT_SECRET: '' });
  const { status, j } = await login(env, g);
  assert.equal(status, 503);
  assert.equal(j.kod, 'belum-setup');
});

test('/api/me: tanpa sesi, sesi diusik, sesi tamat -> 401', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { j } = await login(env, g);
  assert.equal((await call(env, g, '/api/me')).status, 401);
  assert.equal((await call(env, g, '/api/me', { token: j.sesi.slice(0, -2) + 'xx' })).status, 401);
  assert.equal((await call(env, g, '/api/me', { token: j.sesi, now: NOW + 15 * 86400000 })).status, 401);
  assert.equal((await call(env, g, '/api/me', { token: j.sesi })).status, 200);
});

test('/api/me: sesi sah tetapi emel tidak sepadan dengan pemilik tenant -> 401 (tiada IDOR)', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  await login(env, g);
  const tid = env.REGISTRY._map.get('owner:ujian@gmail.com');
  const palsu = await signSession({ tid, email: 'penyerang@gmail.com', exp: NOW / 1000 + 3600 }, env.SESSION_SECRET);
  assert.equal((await call(env, g, '/api/me', { token: palsu })).status, 401);
  const tiada = await signSession({ tid: 'tiadatid0000', email: 'ujian@gmail.com', exp: NOW / 1000 + 3600 }, env.SESSION_SECRET);
  assert.equal((await call(env, g, '/api/me', { token: tiada })).status, 401);
});

test('/api/me: studio draf menunjukkan perluSetup dan status trial', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { j } = await login(env, g);
  const me = await call(env, g, '/api/me', { token: j.sesi });
  assert.equal(me.j.studio.perluSetup, true);
  assert.equal(me.j.studio.url, '');
  assert.equal(me.j.licence.plan, 'percubaan');
  assert.equal(me.j.licence.state, 'aktif');
  assert.equal(me.j.licence.daysLeft, 13);
  assert.equal(me.j.licence.notice.level, 'info');
  assert.equal(me.j.buyUrl, 'https://annurprosolutions1.bcl.my/form/annur-booking');
  assert.ok(!JSON.stringify(me.j).includes('"rt"'), 'refresh token tidak didedahkan');
  assert.ok(!('tid' in me.j.studio));
});

test('logout: 200 (sesi dibuang di klien)', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  assert.equal((await call(env, g, '/api/auth/logout', { method: 'POST', body: {} })).status, 200);
  assert.ok(ORIGIN);
});

test('kod Google tamat/digunakan semula: mesej login biasa, bukan "sambungan terputus"', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const orig = g.fetch;
  g.fetch = async (u, init) => {
    if (u === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }), { status: 400 });
    return orig(u, init);
  };
  const { status, j } = await login(env, g);
  assert.equal(status, 400);
  assert.equal(j.kod, 'kod-tidak-sah');
  g.fetch = async (u, init) => {
    if (u === 'https://oauth2.googleapis.com/token') return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
    return orig(u, init);
  };
  const r2 = await login(env, g);
  assert.equal(r2.status, 503);
  assert.equal(r2.j.kod, 'belum-setup');
});
