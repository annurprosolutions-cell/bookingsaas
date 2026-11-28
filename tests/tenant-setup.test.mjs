// F-03 / F-14: wizard -> cipta Sheet (BSD 6.1), semak slug, rollback, idempotent, migrasi, sambung semula, padam akaun
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, fakeGoogle, call, login, WIZARD } from './helpers.mjs';
import { TABS, HEADERS } from '../js/core/sheet-schema.js';

const kvJson = (env, k) => JSON.parse(env.REGISTRY._map.get(k));
const tidOf = (env, email = 'ujian@gmail.com') => env.REGISTRY._map.get('owner:' + email);
const tenantOf = (env, email) => kvJson(env, 'tenant:' + tidOf(env, email));
const setup = (env, g, sesi, body = WIZARD) => call(env, g, '/api/tenant/setup', { method: 'POST', body, token: sesi });
const sheetCalls = (g) => g.state.calls.filter((c) => c.includes('sheets.googleapis.com'));
const tab = (g, id, name) => g.state.sheets.get(id).tabs[name];

async function studioSiap(opts = {}) {
  const g = fakeGoogle(opts.google);
  const env = makeEnv(g);
  const { j } = await login(env, g);
  const r = await setup(env, g, j.sesi, opts.body || WIZARD);
  return { g, env, sesi: j.sesi, r };
}

test('setup penuh: Sheet dengan 10 tab dan header tepat, seed, registry dikemas kini', async () => {
  const { g, env, r } = await studioSiap();
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.slug, 'wakanda');
  assert.equal(r.j.url, 'https://booking.annurpro.com/wakanda');
  assert.equal(r.j.sheetBaru, true);
  assert.ok(r.j.warnings.warna_utama, 'oren Wakanda diberi amaran kontras, bukan ditolak');

  const t = tenantOf(env);
  assert.deepEqual([t.slug, t.shopName, t.conn], ['wakanda', 'Wakanda Studio', 'ok']);
  assert.equal(env.REGISTRY._map.get('slug:wakanda'), t.tid);
  assert.equal(r.j.sheetUrl, `https://docs.google.com/spreadsheets/d/${t.sheetId}/edit`);
  assert.equal(kvJson(env, 'email:ujian@gmail.com').shop, 'Wakanda Studio');

  const sh = g.state.sheets.get(t.sheetId);
  assert.equal(sh.title, 'Annur Booking - Wakanda Studio (JANGAN PADAM)');
  assert.deepEqual(Object.keys(sh.tabs), TABS);
  for (const name of TABS) assert.deepEqual(sh.tabs[name].rows[0], HEADERS[name], name);

  assert.equal(tab(g, t.sheetId, 'Slot').rows.length, 27, 'header + 26 slot Raya');
  const tet = Object.fromEntries(tab(g, t.sheetId, 'Tetapan').rows.slice(1).map((r) => [r[0], r[1]]));
  assert.equal(tet.nama_studio, 'Wakanda Studio');
  assert.equal(tet.whatsapp, '60123456789');
  assert.equal(tet.harga_normal, 80);
  assert.equal(tet.harga_special, '', 'kosong supaya terus ikut harga_normal');
  assert.equal(tet.tajuk_hero, '');
  assert.equal(tet.warna_utama, '#F97316');
  assert.equal(tet.logo_url, 'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOpQr&sz=w1600');
  assert.equal(tet.alamat, 'Lot 1, Jalan Raya\nKuala Lumpur');
  assert.equal(tet.tempahan_aktif, 'TRUE');
  assert.equal(tet.deposit, 50);
  assert.deepEqual(tab(g, t.sheetId, 'Addon').rows.slice(1), [['A01', 'Frame', 30, 'TRUE', 1]]);
  assert.deepEqual(tab(g, t.sheetId, 'Banner').rows.slice(1), [['B01', 'https://i.postimg.cc/abc/banner.jpg', 1, 'TRUE']]);
  assert.deepEqual(tab(g, t.sheetId, 'Info').rows[1], ['skema', '1']);
  assert.equal(tab(g, t.sheetId, 'Tempahan').rows.length, 1, 'hanya header');
  const log = tab(g, t.sheetId, 'Log').rows;
  assert.deepEqual(log[1].slice(1), ['sistem', 'setup', 'sheet', 'skema=1']);

  const reqs = sh.requests;
  const dv = reqs.filter((x) => x.setDataValidation).map((x) => x.setDataValidation.rule.condition.values.map((v) => v.userEnteredValue).join('/'));
  assert.ok(dv.includes('PENDING/DEPOSIT/SELESAI/CANCEL'));
  assert.ok(dv.includes('MENUNGGU/LULUS/TOLAK'));
  assert.ok(dv.includes('Pagi/Petang/Malam'));
  assert.ok(reqs.some((x) => x.updateSheetProperties && x.updateSheetProperties.properties.gridProperties.frozenRowCount === 1));
  assert.ok(reqs.some((x) => x.repeatCell && x.repeatCell.cell.userEnteredFormat.numberFormat && x.repeatCell.cell.userEnteredFormat.numberFormat.type === 'TEXT'));

  // Kecekapan kuota: create + values:batchUpdate + batchUpdate + append Log
  assert.equal(sheetCalls(g).length, 4, sheetCalls(g).join('\n'));
});

test('KV tidak mengandungi data Sheet studio (alamat, WhatsApp, harga)', async () => {
  const { env } = await studioSiap();
  const semua = [...env.REGISTRY._map.values()].join('\n');
  for (const x of ['60123456789', 'Jalan Raya', 'postimg', '"harga']) assert.ok(!semua.includes(x), x);
});

test('/api/me selepas setup: pautan awam dan Buka Sheet saya', async () => {
  const { g, env, sesi } = await studioSiap();
  const me = await call(env, g, '/api/me', { token: sesi });
  assert.equal(me.j.studio.perluSetup, false);
  assert.equal(me.j.studio.url, 'https://booking.annurpro.com/wakanda');
  assert.match(me.j.studio.sheetUrl, /^https:\/\/docs\.google\.com\/spreadsheets\/d\/sheet-\d+\/edit$/);
  assert.equal(me.j.studio.nama, 'Wakanda Studio');
});

test('templat kosong dan tiada add-on: Slot kosong, add-on contoh Frame tidak aktif', async () => {
  const { g, env, r } = await studioSiap({ body: { ...WIZARD, templat: 'kosong', addons: [] } });
  assert.equal(r.status, 200);
  const id = tenantOf(env).sheetId;
  assert.equal(tab(g, id, 'Slot').rows.length, 1);
  assert.deepEqual(tab(g, id, 'Addon').rows.slice(1), [['A01', 'Frame', 30, 'FALSE', 1]]);
});

test('pengesahan wizard: medan wajib, slug reserved, WhatsApp, URL http', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { j } = await login(env, g);
  const bad = await setup(env, g, j.sesi, { ...WIZARD, slug: 'admin', whatsapp: '123', harga_normal: '', logo_url: 'http://x.com/a.png', banners: ['ftp://x'] });
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.j.errors).sort(), ['banners', 'harga_normal', 'logo_url', 'slug', 'whatsapp']);
  assert.equal(g.state.createCount, 0, 'tiada Sheet dicipta bila input tidak sah');
  const bad2 = await setup(env, g, j.sesi, { ...WIZARD, addons: [{ nama: 'A, B', harga: 5 }, { nama: 'X', harga: -1 }] });
  assert.ok(bad2.j.errors.addons);
});

test('semak slug: format, reserved, diambil studio lain, slug sendiri, perlu sesi', async () => {
  const { g, env } = await studioSiap();
  const g2 = fakeGoogle({ email: 'lain@gmail.com', refreshToken: 'rt-lain' });
  const { j } = await login(env, g2);
  const chk = async (s) => (await call(env, g2, '/api/slug/check?slug=' + encodeURIComponent(s), { token: j.sesi })).j;
  assert.equal((await chk('ab')).kod, 'format');
  assert.equal((await chk('Studio')).kod, 'format');
  assert.equal((await chk('platform')).kod, 'reserved');
  assert.equal((await chk('wakanda')).kod, 'diambil');
  assert.equal((await chk('studio-lain')).tersedia, true);
  assert.equal((await call(env, g, '/api/slug/check?slug=x')).status, 401);
});

test('slug sudah diambil studio lain: 409 dan TIADA Sheet dicipta', async () => {
  const { env } = await studioSiap();
  const g2 = fakeGoogle({ email: 'lain@gmail.com', refreshToken: 'rt-lain' });
  const { j } = await login(env, g2);
  const r = await setup(env, g2, j.sesi);
  assert.equal(r.status, 409);
  assert.equal(r.j.kod, 'slug-diambil');
  assert.equal(g2.state.createCount, 0);
});

test('cipta Sheet gagal: ralat, slug TIDAK dikunci, boleh cuba lagi', async () => {
  let gagal = true;
  const g = fakeGoogle({ failOn: (m, p) => (gagal && m === 'POST' && p === 'https://sheets.googleapis.com/v4/spreadsheets' ? 500 : 0) });
  const env = makeEnv(g);
  const { j } = await login(env, g);
  const r1 = await setup(env, g, j.sesi);
  assert.equal(r1.status, 502);
  assert.equal(env.REGISTRY._map.get('slug:wakanda'), undefined);
  assert.equal(tenantOf(env).slug, '');
  assert.equal(tenantOf(env).sheetId, '');
  gagal = false;
  const r2 = await setup(env, g, j.sesi);
  assert.equal(r2.status, 200, JSON.stringify(r2.j));
  assert.equal(g.state.createCount, 1);
});

test('gagal SELEPAS Sheet dicipta: sheetId disimpan, slug tidak dikunci, cubaan semula guna Sheet yang sama', async () => {
  let gagal = true;
  const g = fakeGoogle({ failOn: (m, p) => (gagal && /values:batchUpdate$/.test(p) ? 500 : 0) });
  const env = makeEnv(g);
  const { j } = await login(env, g);
  const r1 = await setup(env, g, j.sesi);
  assert.equal(r1.status, 502);
  const id = tenantOf(env).sheetId;
  assert.match(id, /^sheet-/);
  assert.equal(tenantOf(env).slug, '');
  assert.equal(env.REGISTRY._map.get('slug:wakanda'), undefined);
  gagal = false;
  const r2 = await setup(env, g, j.sesi);
  assert.equal(r2.status, 200, JSON.stringify(r2.j));
  assert.equal(g.state.createCount, 1, 'tiada Sheet kedua');
  assert.equal(tenantOf(env).sheetId, id);
  assert.equal(tab(g, id, 'Slot').rows.length, 27);
});

test('slug dirampas orang lain semasa Sheet dicipta: 409, Sheet disimpan, guna slug lain tanpa Sheet kedua', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const orig = g.fetch;
  g.fetch = async (u, init) => {
    if (u === 'https://sheets.googleapis.com/v4/spreadsheets') await env.REGISTRY.put('slug:wakanda', 'tidlainxxxxx');
    return orig(u, init);
  };
  const { j } = await login(env, g);
  const r1 = await setup(env, g, j.sesi);
  assert.equal(r1.status, 409);
  assert.equal(env.REGISTRY._map.get('slug:wakanda'), 'tidlainxxxxx', 'slug orang lain tidak ditimpa');
  assert.match(tenantOf(env).sheetId, /^sheet-/);
  const r2 = await setup(env, g, j.sesi, { ...WIZARD, slug: 'wakanda-studio' });
  assert.equal(r2.status, 200, JSON.stringify(r2.j));
  assert.equal(g.state.createCount, 1);
  assert.equal(tenantOf(env).slug, 'wakanda-studio');
});

test('butang ditekan dua kali serentak: hanya satu Sheet dicipta', async () => {
  const g = fakeGoogle();
  const env = makeEnv(g);
  const { j } = await login(env, g);
  const rs = await Promise.all([setup(env, g, j.sesi), setup(env, g, j.sesi)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(g.state.createCount, 1);
});

test('idempotent: setup dijalankan semula tidak mencipta atau menggandakan apa-apa', async () => {
  const { g, env, sesi } = await studioSiap();
  const id = tenantOf(env).sheetId;
  const r = await setup(env, g, sesi, { slug: 'nama-lain' });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.slug, 'wakanda', 'slug tidak berubah selepas setup');
  assert.equal(g.state.createCount, 1);
  assert.equal(tab(g, id, 'Slot').rows.length, 27);
  assert.equal(tab(g, id, 'Tetapan').rows.length, 25);
  assert.equal(tab(g, id, 'Log').rows.length, 2, 'tiada log baharu bila tiada perubahan');
});

test('migrasi skema: lajur dan tab yang hilang ditambah, data sedia ada TIDAK disentuh', async () => {
  const { g, env, sesi } = await studioSiap();
  const id = tenantOf(env).sheetId;
  const sh = g.state.sheets.get(id);
  // Simulasi Sheet versi lama: Slot tanpa lajur kapasiti, tab Review tiada, studio tambah lajur sendiri
  sh.tabs.Slot.rows = sh.tabs.Slot.rows.map((r, i) => (i === 0 ? ['slot_id', 'label', 'kumpulan', 'susunan', 'aktif', 'nota saya'] : [...r.slice(0, 5), 'catatan studio']));
  delete sh.tabs.Review;
  sh.tabs.Tempahan.rows.push(['AB-ABC234', 'x', 'Pelanggan Lama']);
  const sebelum = JSON.stringify(sh.tabs.Slot.rows.slice(1));

  const r = await setup(env, g, sesi, {});
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(sh.tabs.Slot.rows[0], ['slot_id', 'label', 'kumpulan', 'susunan', 'aktif', 'nota saya', 'kapasiti']);
  assert.equal(JSON.stringify(sh.tabs.Slot.rows.slice(1)), sebelum, 'baris data Slot tidak berubah');
  assert.deepEqual(sh.tabs.Review.rows, [HEADERS.Review]);
  assert.equal(sh.tabs.Tempahan.rows[1][2], 'Pelanggan Lama');
  const log = sh.tabs.Log.rows[sh.tabs.Log.rows.length - 1];
  assert.equal(log[2], 'migrasi');
  assert.match(log[4], /Slot: tambah kapasiti/);
  assert.match(log[4], /tab baharu: Review/);
  assert.ok(!log.join(' ').includes('Pelanggan Lama'), 'log tanpa PII');
});

test('sambungan Google ditarik balik: conn "putus", halaman pemilik diminta sambung semula', async () => {
  const { g, env, sesi } = await studioSiap();
  g.state.revoked.push('rt-rahsia-123');
  const r = await setup(env, g, sesi, {});
  assert.equal(r.status, 401);
  assert.equal(r.j.kod, 'google-putus');
  assert.equal(tenantOf(env).conn, 'putus');
  const me = await call(env, g, '/api/me', { token: sesi });
  assert.equal(me.j.studio.conn, 'putus');
});

test('sambung semula: emel sama -> conn ok; emel lain ditolak', async () => {
  const { g, env, sesi } = await studioSiap();
  g.state.revoked.push('rt-rahsia-123');
  await setup(env, g, sesi, {});
  assert.equal(tenantOf(env).conn, 'putus');

  const salah = fakeGoogle({ email: 'orang.lain@gmail.com', refreshToken: 'rt-x' });
  salah.state.sheets = g.state.sheets;
  const r0 = await call(env, salah, '/api/admin/reconnect', { method: 'POST', body: { code: 'k' }, token: sesi });
  assert.equal(r0.status, 403);
  assert.equal(r0.j.kod, 'emel-lain');
  assert.ok(salah.state.revoked.includes('at-kod'));

  const g2 = fakeGoogle({ refreshToken: 'rt-baru-456' });
  g2.state.sheets = g.state.sheets;
  const r = await call(env, g2, '/api/admin/reconnect', { method: 'POST', body: { code: 'k' }, token: sesi });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.sheetBaru, false);
  assert.equal(tenantOf(env).conn, 'ok');
});

test('sambung semula bila Sheet dipadam kekal: Sheet baharu dicipta dan dilaporkan', async () => {
  const { g, env, sesi } = await studioSiap();
  const lama = tenantOf(env).sheetId;
  g.state.sheets.delete(lama);
  const r = await call(env, g, '/api/admin/reconnect', { method: 'POST', body: { code: 'k' }, token: sesi });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.sheetBaru, true);
  assert.notEqual(tenantOf(env).sheetId, lama);
  assert.equal(tenantOf(env).slug, 'wakanda');
});

test('Sheet dalam Tong Sampah: diminta pulihkan, tiada Sheet baharu', async () => {
  const { g, env, sesi } = await studioSiap();
  g.state.sheets.get(tenantOf(env).sheetId).trashed = true;
  const r = await call(env, g, '/api/admin/reconnect', { method: 'POST', body: { code: 'k' }, token: sesi });
  assert.equal(r.status, 409);
  assert.equal(r.j.kod, 'sheet-dibuang');
  assert.equal(g.state.createCount, 1);
});

test('padam akaun: pengesahan wajib; registry dipadam; Sheet, licence dan penanda trial kekal', async () => {
  const { g, env, sesi } = await studioSiap();
  const t = tenantOf(env);
  const salah = await call(env, g, '/api/admin/account', { method: 'DELETE', body: { sahkan: 'salah' }, token: sesi });
  assert.equal(salah.status, 400);
  assert.ok(env.REGISTRY._map.has('tenant:' + t.tid));

  const r = await call(env, g, '/api/admin/account', { method: 'DELETE', body: { sahkan: 'WAKANDA' }, token: sesi });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.ditarik, true);
  assert.ok(g.state.revoked.includes('rt-rahsia-123'));
  for (const k of ['tenant:' + t.tid, 'slug:wakanda', 'owner:ujian@gmail.com']) assert.ok(!env.REGISTRY._map.has(k), k);
  assert.ok(env.REGISTRY._map.has('email:ujian@gmail.com'), 'licence (rekod billing) kekal');
  assert.ok(env.REGISTRY._map.has('trial:ujian@gmail.com'), 'penanda trial kekal: tiada trial berulang');
  assert.ok(g.state.sheets.has(t.sheetId), 'Sheet kekal milik studio');
  assert.ok(!g.state.calls.some((c) => c.startsWith('DELETE')), 'tiada fail dipadam di Google');
  assert.equal((await call(env, g, '/api/me', { token: sesi })).status, 401, 'sesi lama tidak lagi sah');

  // slug kini bebas untuk studio lain
  const g2 = fakeGoogle({ email: 'baru@gmail.com', refreshToken: 'rt-b' });
  const { j } = await login(env, g2);
  assert.equal((await setup(env, g2, j.sesi)).status, 200);
});

test('studio digantung: setup ditolak 403, /api/me masih boleh dibaca', async () => {
  const { g, env, sesi } = await studioSiap();
  const t = tenantOf(env);
  await env.REGISTRY.put('tenant:' + t.tid, JSON.stringify({ ...t, status: 'digantung' }));
  assert.equal((await setup(env, g, sesi, {})).status, 403);
  const me = await call(env, g, '/api/me', { token: sesi });
  assert.equal(me.status, 200);
  assert.equal(me.j.studio.status, 'digantung');
});

test('/api/me?semak=1: kesan akses ditarik balik dari akaun Google (conn putus)', async () => {
  const { g, env, sesi } = await studioSiap();
  const ok = await call(env, g, '/api/me?semak=1', { token: sesi });
  assert.equal(ok.j.studio.sheet, 'ok');
  assert.equal(ok.j.studio.conn, 'ok');
  g.state.revoked.push('rt-rahsia-123'); // pengguna buang akses di myaccount.google.com
  const biasa = await call(env, g, '/api/me', { token: sesi });
  assert.equal(biasa.j.studio.conn, 'ok', '/api/me biasa tidak menghubungi Google');
  const r = await call(env, g, '/api/me?semak=1', { token: sesi });
  assert.equal(r.j.studio.conn, 'putus');
  assert.equal(tenantOf(env).conn, 'putus');
});

test('/api/me?semak=1: Sheet dalam Tong Sampah atau dipadam kekal dilaporkan', async () => {
  const { g, env, sesi } = await studioSiap();
  const id = tenantOf(env).sheetId;
  g.state.sheets.get(id).trashed = true;
  assert.equal((await call(env, g, '/api/me?semak=1', { token: sesi })).j.studio.sheet, 'dibuang');
  g.state.sheets.delete(id);
  assert.equal((await call(env, g, '/api/me?semak=1', { token: sesi })).j.studio.sheet, 'hilang');
  assert.equal(tenantOf(env).conn, 'ok', 'Sheet hilang bukan bermakna sambungan terputus');
});
