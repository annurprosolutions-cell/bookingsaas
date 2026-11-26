// Ujian prototaip (IPD 0.9) dengan Google palsu. Dibuang bersama kod spike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../worker/index.mjs';
import { makeEnv, fakeGoogle, req, ORIGIN } from './helpers.mjs';

const XHR = { 'x-requested-with': 'XMLHttpRequest', origin: ORIGIN };

async function login(env, google) {
  const r = await handle(req('/api/spike/exchange', { method: 'POST', body: { code: '4/kod' }, headers: XHR }), env, { fetch: google.fetch });
  return { status: r.status, j: await r.json() };
}
const post = (env, google, path, sesi, body = {}) =>
  handle(req(path, { method: 'POST', body, token: sesi, headers: XHR }), env, { fetch: google.fetch }).then(async (r) => ({ status: r.status, j: await r.json() }));

test('spike tidak aktif tanpa SPIKE_EMAILS', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g, { SPIKE_EMAILS: '' });
  const r = await handle(req('/api/spike/status'), env, { fetch: g.fetch });
  assert.equal(r.status, 404);
});

test('(a)+(b) tukar kod -> refresh token disimpan berenkripsi, Sheet dicipta, Drive nampak fail', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { status, j } = await login(env, g);
  assert.equal(status, 200, JSON.stringify(j));
  assert.equal(j.ok, true);
  assert.equal(j.refreshTokenBaru, true);
  assert.equal(j.sheetBaru, true);
  assert.equal(j.driveOk, true);
  assert.ok(j.sesi);
  const raw = await env.REGISTRY.get('spike:ujian@gmail.com');
  assert.ok(raw);
  assert.ok(!raw.includes('rt-rahsia-123'), 'refresh token mentah tidak boleh ada dalam KV');
  assert.ok(!JSON.stringify(j).includes('rt-rahsia-123'), 'refresh token tidak dihantar ke pelayar');
  const sh = g.state.sheets.get('sheet-1');
  assert.deepEqual(sh.tabs.Ujian[0], ['masa', 'sumber', 'run', 'nota']);
});

test('CSRF: tanpa X-Requested-With ditolak; origin asing ditolak', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  let r = await handle(req('/api/spike/exchange', { method: 'POST', body: { code: 'x' }, headers: { origin: ORIGIN } }), env, { fetch: g.fetch });
  assert.equal(r.status, 400);
  r = await handle(req('/api/spike/exchange', { method: 'POST', body: { code: 'x' }, headers: { ...XHR, origin: 'https://jahat.example' } }), env, { fetch: g.fetch });
  assert.equal(r.status, 403);
});

test('emel bukan ujian ditolak dan akses ditarik balik', async () => {
  const g = fakeGoogle({ email: 'orang.lain@gmail.com' });
  const env = makeEnv(g);
  const { status, j } = await login(env, g);
  assert.equal(status, 403);
  assert.equal(j.kod, 'bukan-emel-ujian');
  assert.ok(g.state.revoked.includes('at-kod'));
});

test('kotak Drive tidak ditanda -> tiada-skop-drive', async () => {
  const g = fakeGoogle({ scope: 'openid https://www.googleapis.com/auth/userinfo.email' });
  const env = makeEnv(g);
  const { j } = await login(env, g);
  assert.equal(j.kod, 'tiada-skop-drive');
  assert.equal(g.state.sheets.size, 0);
});

test('tiada refresh token pada login pertama -> tarik balik dan minta cuba lagi', async () => {
  const g = fakeGoogle({ refreshToken: null });
  const env = makeEnv(g);
  const { j } = await login(env, g);
  assert.equal(j.kod, 'tiada-refresh-token');
  assert.ok(g.state.revoked.includes('at-kod'));
  assert.equal(await env.REGISTRY.get('spike:ujian@gmail.com'), null);
});

test('(c) Worker tulis guna refresh token, bukan token dari pelayar', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { j: s } = await login(env, g);
  g.state.accessUsed.length = 0;
  const { status, j } = await post(env, g, '/api/spike/write', s.sesi);
  assert.equal(status, 200, JSON.stringify(j));
  assert.equal(g.state.refreshCount, 1);
  assert.deepEqual(g.state.accessUsed, ['at-refresh-1']);
  const rows = g.state.sheets.get('sheet-1').tabs.Ujian;
  assert.equal(rows[rows.length - 1][1], 'worker-refresh-token');
});

test('(c) tanpa sesi atau sesi palsu -> 401', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  assert.equal((await post(env, g, '/api/spike/write', undefined)).status, 401);
  assert.equal((await post(env, g, '/api/spike/write', 'abc.def')).status, 401);
});

test('akses ditarik balik di Google -> google-putus (401)', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { j: s } = await login(env, g);
  g.state.revoked.push('rt-rahsia-123');
  const { status, j } = await post(env, g, '/api/spike/write', s.sesi);
  assert.equal(status, 401);
  assert.equal(j.kod, 'google-putus');
});

test('(d) simulasi: 20 serentak dengan kunci -> tepat 1; tanpa kunci -> lebih dari 1', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { j: s } = await login(env, g);
  const run = (runId, kunci) =>
    Promise.all(Array.from({ length: 20 }, (_, i) => post(env, g, '/api/spike/race-one', s.sesi, { runId, mode: 'sim', kunci, idx: i })));
  const dengan = await run('kunci001', true);
  assert.equal(dengan.filter((r) => r.j.ok).length, 1);
  assert.equal(dengan.filter((r) => r.j.sebab === 'slot-penuh').length, 19);
  const tanpa = await run('tanpa001', false);
  assert.ok(tanpa.filter((r) => r.j.ok).length > 1);
});

test('(d) Sheet: 5 serentak -> tepat 1 baris dalam Sheet, token disegar sekali sahaja', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { j: s } = await login(env, g);
  const res = await Promise.all(
    Array.from({ length: 5 }, (_, i) => post(env, g, '/api/spike/race-one', s.sesi, { runId: 'sheet001', mode: 'sheet', idx: i }))
  );
  assert.equal(res.filter((r) => r.j.ok).length, 1, JSON.stringify(res.map((r) => r.j)));
  assert.equal(g.state.refreshCount, 1, 'DO cache access token, tidak segar semula setiap permintaan');
  const { j } = await post(env, g, '/api/spike/race-kira', s.sesi, { runId: 'sheet001' });
  assert.equal(j.baris, 1);
  // mod sheet tidak boleh dijalankan tanpa kunci
  const r2 = await Promise.all(
    Array.from({ length: 5 }, (_, i) => post(env, g, '/api/spike/race-one', s.sesi, { runId: 'sheet002', mode: 'sheet', kunci: false, idx: i }))
  );
  assert.equal(r2.filter((r) => r.j.ok).length, 1);
});

test('padam: rekod KV dibuang dan refresh token ditarik balik', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { j: s } = await login(env, g);
  const { j } = await post(env, g, '/api/spike/padam', s.sesi);
  assert.equal(j.ok, true);
  assert.equal(j.ditarik, true);
  assert.ok(g.state.revoked.includes('rt-rahsia-123'));
  assert.equal(await env.REGISTRY.get('spike:ujian@gmail.com'), null);
});

test('login kali kedua tanpa refresh token guna rekod sedia ada, Sheet tidak dicipta semula', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  await login(env, g);
  const g2 = fakeGoogle({ refreshToken: null });
  g2.state.sheets = g.state.sheets;
  const { j } = await login(env, g2);
  assert.equal(j.ok, true);
  assert.equal(j.refreshTokenBaru, false);
  assert.equal(j.sheetBaru, false);
  assert.equal(g.state.sheets.size, 1);
});
