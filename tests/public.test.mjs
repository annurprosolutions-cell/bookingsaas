// Fasa 3: halaman awam /<slug>, /config, /slots, /book, /status (F-04 hingga F-07, IPD 3.1 hingga 3.7)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupStudio, call, NOW, turnstileToken } from './helpers.mjs';
import { HEADERS } from '../js/core/sheet-schema.js';
import { clearPublicCache } from '../worker/public.js';

const T = HEADERS.Tempahan;
const col = (name) => T.indexOf(name);
const MIN = 60 * 1000;
const baik = { nama: 'Aisyah', telefon: '012-345 6789', emel: '', tarikh: '2026-12-05', slot_ids: ['S01'], addon_ids: [], dewasa: 2, kanak: 1, catatan: '', pdpa: true };

const book = (s, patch = {}, { ip = '1.1.1.1', now = NOW, token } = {}) =>
  call(s.env, s.g, '/api/public/wakanda/book', {
    method: 'POST',
    body: { ...baik, turnstile: token === undefined ? turnstileToken() : token, ...patch },
    headers: { 'cf-connecting-ip': ip },
    now
  });
const status = (s, body, { ip = '2.2.2.2', now = NOW } = {}) =>
  call(s.env, s.g, '/api/public/wakanda/status', { method: 'POST', body, headers: { 'cf-connecting-ip': ip }, now });
const config = (s, now = NOW) => call(s.env, s.g, '/api/public/wakanda/config', { now });
const slots = (s, date, now = NOW) => call(s.env, s.g, '/api/public/wakanda/slots?date=' + date, { now });
const page = (s, path, now = NOW) => call(s.env, s.g, path, { now });

function setTetapan(s, key, value) {
  const row = s.sheet('Tetapan').find((r) => r[0] === key);
  row[1] = value;
}
const bookingRows = (s) => s.sheet('Tempahan').slice(1);
const count = (s, needle) => s.g.state.calls.filter((c) => c.includes(needle)).length;

// ---------------------------------------------------------------------------------------------
test('halaman /<slug>: tajuk, meta OG, warna tema, manifest, CSP dan config disuntik', async () => {
  const s = await setupStudio();
  setTetapan(s, 'arahan_deposit', 'DuitNow 0123 RAHSIA-DEPOSIT');
  const r = await page(s, '/wakanda');
  assert.equal(r.status, 200);
  const html = r.j._text;
  assert.match(html, /<title>Wakanda Studio \| Tempahan<\/title>/);
  assert.ok(!/<base /.test(html), 'tiada <base>: ia merosakkan pautan hash');
  assert.ok(!/(href|src)="(?!\/|https:|#)/.test(html), 'semua aset dalam templat guna laluan mutlak');
  assert.match(html, /<meta name="theme-color" content="#F97316">/);
  assert.match(html, /<meta property="og:title" content="Wakanda Studio">/);
  assert.match(html, /<link rel="manifest" href="\/wakanda\/manifest.webmanifest">/);
  const data = JSON.parse(/<script type="application\/json" id="annur-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(data.studio.nama_studio, 'Wakanda Studio');
  assert.equal(data.tertutup, null);
  assert.ok(!html.includes('RAHSIA-DEPOSIT'), 'arahan_deposit tidak didedahkan sebelum tempahan');
  assert.ok(!html.includes('ANNUR_HEAD') && !html.includes('ANNUR_DATA'));
});

test('halaman: slug tiada / reserved -> 404 mesra; huruf besar -> 301; manifest dinamik', async () => {
  const s = await setupStudio();
  const a = await page(s, '/tiada-studio');
  assert.equal(a.status, 404);
  assert.match(a.j._text, /Halaman tidak dijumpai/);
  assert.equal((await page(s, '/admin')).status, 404);
  const r = await page(s, '/Wakanda');
  assert.equal(r.status, 301);
  const m = await page(s, '/wakanda/manifest.webmanifest');
  assert.equal(m.j.name, 'Wakanda Studio');
  assert.equal(m.j.start_url, '/wakanda');
  assert.equal(m.j.theme_color, '#F97316');
});

test('XSS: nama studio berisi HTML dipaparkan sebagai teks dalam HTML dan JSON', async () => {
  const s = await setupStudio();
  setTetapan(s, 'nama_studio', '</script><script>alert(1)</script><img src=x onerror=alert(2)>');
  const html = (await page(s, '/wakanda')).j._text;
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;\/script&gt;&lt;script&gt;alert\(1\)/);
  assert.match(html, /\\u003c\/script\\u003e/);
});

test('/config: tanpa arahan_deposit; add-on aktif sahaja; tarikh special/tutup akan datang sahaja', async () => {
  const s = await setupStudio();
  setTetapan(s, 'arahan_deposit', 'Akaun 123');
  s.sheet('Addon').push(['A02', 'Lama', 5, 'FALSE', 2]);
  s.sheet('HariSpecial').push(['2026-11-01', 'Lepas'], ['2026-12-07', 'Raya']);
  s.sheet('TarikhTutup').push(['2026-12-08', 'Cuti umum']);
  const { status: st, j } = await config(s);
  assert.equal(st, 200);
  assert.ok(!('arahan_deposit' in j.studio));
  assert.ok(!JSON.stringify(j).includes('Akaun 123'));
  assert.deepEqual(j.addons, [{ addon_id: 'A01', nama: 'Frame', harga: 30 }]);
  assert.deepEqual(j.banners, ['https://i.postimg.cc/abc/banner.jpg']);
  assert.deepEqual(j.hari_special, [{ tarikh: '2026-12-07', label: 'Raya' }]);
  assert.deepEqual(j.tarikh_tutup, [{ tarikh: '2026-12-08', sebab: 'Cuti umum' }]);
  assert.equal(j.hari_ini, '2026-12-01');
  assert.equal(j.studio.whatsapp, '60123456789');
});

test('/config dicache 60 saat (kuota Sheets): dua panggilan = satu bacaan Sheet; selepas 61 saat dibaca semula', async () => {
  const s = await setupStudio();
  const sebelum = count(s, 'values:batchGet');
  await config(s);
  await config(s, NOW + 30 * 1000);
  await page(s, '/wakanda', NOW + 40 * 1000);
  assert.equal(count(s, 'values:batchGet') - sebelum, 1);
  setTetapan(s, 'ticker', 'Promosi baharu');
  clearPublicCache();
  const r = await config(s, NOW + 61 * 1000);
  assert.equal(count(s, 'values:batchGet') - sebelum, 2);
  assert.equal(r.j.studio.ticker, 'Promosi baharu', 'perubahan tetapan muncul dalam 60 saat (F-10)');
});

test('halaman tertutup (S-21): tempahan_aktif FALSE -> "ditutup"; licence tamat atau Google putus -> "tidak-tersedia"', async () => {
  const s = await setupStudio();
  setTetapan(s, 'tempahan_aktif', 'FALSE');
  const a = await config(s);
  assert.equal(a.j.tertutup, 'ditutup');
  assert.equal(a.j.studio.whatsapp, '60123456789', 'butang WhatsApp masih ada');
  assert.ok(!('harga_normal' in a.j.studio));
  assert.equal((await book(s)).status, 403);

  const s2 = await setupStudio();
  await s2.env.REGISTRY.put('email:ujian@gmail.com', JSON.stringify({ plan: 'percubaan', expires: '2026-11-30' }));
  clearPublicCache();
  const b = await config(s2);
  assert.equal(b.j.tertutup, 'tidak-tersedia');
  assert.ok(!JSON.stringify(b.j).match(/langgan|bayar|licence|percubaan/i), 'pelanggan tidak diberitahu tentang bayaran');
  const bk = await book(s2);
  assert.equal(bk.status, 403);
  assert.equal(bk.j.tertutup, 'tidak-tersedia');
  assert.equal((await slots(s2, '2026-12-05')).status, 403);

  const s3 = await setupStudio();
  const t = JSON.parse(s3.env.REGISTRY._map.get('tenant:' + s3.tid));
  await s3.env.REGISTRY.put('tenant:' + s3.tid, JSON.stringify({ ...t, conn: 'putus' }));
  clearPublicCache();
  const c = await config(s3);
  assert.equal(c.j.tertutup, 'tidak-tersedia');
  assert.deepEqual(Object.keys(c.j.studio), ['nama_studio']);
  assert.equal(bookingRows(s3).length, 0);
});

test('/slots: kekosongan ikut sesi, hari special, tarikh tutup, tarikh lampau, slot tidak aktif disorok', async () => {
  const s = await setupStudio();
  setTetapan(s, 'harga_special', 120);
  s.sheet('HariSpecial').push(['2026-12-07', 'Raya']);
  s.sheet('TarikhTutup').push(['2026-12-08', 'Cuti umum']);
  s.sheet('Slot')[2][4] = 'FALSE'; // S02 tidak aktif
  const r = await slots(s, '2026-12-05');
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.sesi.map((x) => [x.kumpulan, x.slots.length]), [['Pagi', 8], ['Petang', 11], ['Malam', 6]]);
  assert.equal(r.j.jenis_hari, 'normal');
  assert.equal(r.j.harga_seslot, 80);
  assert.ok(r.j.sesi[0].slots.every((x) => !x.penuh && x.tinggal === 1));
  const sp = await slots(s, '2026-12-07');
  assert.deepEqual([sp.j.jenis_hari, sp.j.harga_seslot], ['special', 120]);
  assert.deepEqual((await slots(s, '2026-12-08')).j.tutup, { sebab: 'Cuti umum' });
  assert.equal((await slots(s, '2026-11-30')).j.lampau, true);
  assert.equal((await slots(s, '2026-02-30')).status, 400);
  assert.ok(!JSON.stringify(r.j).match(/nama|telefon|emel/));
});

test('/book berjaya: satu baris RAW, harga dikira server, PENDING, Ref unik; arahan deposit selepas tempahan', async () => {
  const s = await setupStudio();
  setTetapan(s, 'arahan_deposit', 'DuitNow 0123456789');
  const r = await book(s, { addon_ids: ['A01'], jumlah: 1, harga_slot: 1, status: 'SELESAI', ref: 'AB-AAAAAA', dikemas_kini_oleh: 'admin' });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.match(r.j.ref, /^AB-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.notEqual(r.j.ref, 'AB-AAAAAA');
  assert.equal(r.j.tempahan.jumlah, 110);
  assert.equal(r.j.bayaran.arahan_deposit, 'DuitNow 0123456789');
  const rows = bookingRows(s);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row[col('ref')], r.j.ref);
  assert.equal(row[col('nama')], 'Aisyah');
  assert.equal(row[col('telefon')], '60123456789');
  assert.equal(row[col('tarikh')], '2026-12-05');
  assert.equal(row[col('slot_ids')], 'S01');
  assert.equal(row[col('slot_label')], '09:00 AM');
  assert.equal(row[col('addon')], 'Frame (+RM30)');
  assert.deepEqual([row[col('harga_slot')], row[col('harga_addon')], row[col('jumlah')]], [80, 30, 110]);
  assert.equal(row[col('status')], 'PENDING');
  assert.equal(row[col('dikemas_kini_oleh')], 'pelanggan');
  assert.match(row[col('persetujuan_pdpa')], /^TRUE 2026-12-01T10:00:00\+08:00$/);
  assert.equal(row[col('dicipta_pada')], '2026-12-01T10:00:00+08:00');
  assert.equal(count(s, ':append') >= 1, true);
});

test('/book: formula dalam nama ditulis sebagai teks (awalan \')', async () => {
  const s = await setupStudio();
  await book(s, { nama: '=HYPERLINK("http://jahat","klik")' });
  assert.equal(bookingRows(s)[0][col('nama')], '\'=HYPERLINK("http://jahat","klik")');
});

test('/book: Turnstile wajib, token tidak boleh diguna semula', async () => {
  const s = await setupStudio();
  assert.equal((await book(s, {}, { token: '' })).j.kod, 'turnstile');
  assert.equal((await book(s, {}, { token: 'gagal' })).status, 400);
  assert.equal((await book(s, {}, { token: 'sekali' })).status, 200);
  const r = await book(s, { slot_ids: ['S02'] }, { token: 'sekali' });
  assert.equal(r.j.kod, 'turnstile');
  assert.equal(bookingRows(s).length, 1);
});

test('/book: input tidak sah ditolak tanpa baris (tarikh lampau/tutup, pax, PDPA, slot tiada)', async () => {
  const s = await setupStudio();
  s.sheet('TarikhTutup').push(['2026-12-08', 'Cuti umum']);
  const e = async (patch) => (await book(s, patch)).j;
  assert.ok((await e({ tarikh: '2026-11-30' })).errors.tarikh);
  assert.equal((await e({ tarikh: '2026-12-08' })).errors.tarikh, 'Cuti umum');
  assert.ok((await e({ dewasa: 11 })).errors.dewasa, 'maks_dewasa lalai 10');
  assert.ok((await e({ pdpa: false })).errors.pdpa);
  assert.ok((await e({ telefon: '123' })).errors.telefon);
  assert.equal((await e({ slot_ids: ['S99'] })).kod, 'slot-diambil');
  assert.equal((await e({ addon_ids: ['A99'] })).kod, 'addon-tiada');
  assert.equal(bookingRows(s).length, 0);
});

test('kapasiti 2: dua tempahan diterima, yang ketiga ditolak', async () => {
  const s = await setupStudio();
  s.sheet('Slot')[1][5] = 2; // S01 kapasiti 2
  assert.equal((await book(s, {}, { ip: 'a' })).status, 200);
  assert.equal((await book(s, {}, { ip: 'b' })).status, 200);
  const r3 = await book(s, {}, { ip: 'c' });
  assert.equal(r3.status, 409);
  assert.equal(r3.j.kod, 'slot-diambil');
  assert.match(r3.j.mesej, /09:00 AM baru diambil orang lain/);
  assert.equal(bookingRows(s).length, 2);
});

test('IPD 3.7: 20 tempahan SERENTAK untuk slot kapasiti 1 -> tepat 1 baris, 19 "slot diambil"', async () => {
  const s = await setupStudio();
  const sebelum = { get: count(s, 'values:batchGet'), app: count(s, ':append') };
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => book(s, { nama: 'Pelanggan ' + i }, { ip: '10.0.0.' + i })));
  assert.equal(rs.filter((r) => r.status === 200).length, 1);
  const ditolak = rs.filter((r) => r.status === 409);
  assert.equal(ditolak.length, 19);
  assert.ok(ditolak.every((r) => r.j.kod === 'slot-diambil'));
  assert.equal(bookingRows(s).length, 1);
  // Kuota: satu bacaan (config + indeks) dan satu tulisan sahaja
  assert.equal(count(s, 'values:batchGet') - sebelum.get, 1);
  assert.equal(count(s, ':append') - sebelum.app, 1);
});

test('20 tempahan serentak untuk 20 slot BERBEZA: semua berjaya, tiada pertembungan', async () => {
  const s = await setupStudio();
  const ids = Array.from({ length: 20 }, (_, i) => 'S' + String(i + 1).padStart(2, '0'));
  const rs = await Promise.all(ids.map((id, i) => book(s, { slot_ids: [id] }, { ip: '10.1.0.' + i })));
  assert.equal(rs.filter((r) => r.status === 200).length, 20);
  assert.equal(new Set(rs.map((r) => r.j.ref)).size, 20, 'Ref unik');
  assert.equal(bookingRows(s).length, 20);
});

test('CANCEL melepaskan slot (selepas indeks disegar dari Sheet), tarikh/slot asal kekal dalam rekod', async () => {
  const s = await setupStudio();
  await book(s, { slot_ids: ['S02'] });
  assert.equal((await book(s, { slot_ids: ['S02'] }, { ip: 'x' })).status, 409);
  bookingRows(s)[0][col('status')] = 'CANCEL'; // pemilik tukar status (Fasa 4 akan mengemas kini indeks serta-merta)
  const r = await book(s, { slot_ids: ['S02'] }, { ip: 'y', now: NOW + 6 * MIN });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const rows = bookingRows(s);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0][col('tarikh')], rows[0][col('slot_ids')], rows[0][col('status')]], ['2026-12-05', 'S02', 'CANCEL']);
});

test('baris yang studio tambah sendiri dalam Sheet dikira selepas indeks disegar (5 minit)', async () => {
  const s = await setupStudio();
  await slots(s, '2026-12-05'); // muat indeks
  const manual = T.map((h) => ({ ref: 'AB-MANUAL', tarikh: '2026-12-05', slot_ids: 'S03', status: 'DEPOSIT', telefon: '60111111111' })[h] ?? '');
  s.sheet('Tempahan').push(manual);
  const awal = await slots(s, '2026-12-05', NOW + 1 * MIN);
  assert.equal(awal.j.sesi[0].slots[2].penuh, false, 'masih dari cache');
  const lepas = await slots(s, '2026-12-05', NOW + 6 * MIN);
  assert.equal(lepas.j.sesi[0].slots[2].penuh, true);
  assert.equal((await book(s, { slot_ids: ['S03'] }, { now: NOW + 6 * MIN })).status, 409);
});

test('had kadar /book: 10 cubaan setiap 10 minit bagi satu IP', async () => {
  const s = await setupStudio();
  const ids = Array.from({ length: 11 }, (_, i) => 'S' + String(i + 1).padStart(2, '0'));
  const rs = [];
  for (const id of ids) rs.push(await book(s, { slot_ids: [id] }, { ip: '9.9.9.9' }));
  assert.equal(rs.filter((r) => r.status === 200).length, 10);
  assert.equal(rs[10].status, 429);
  assert.equal((await book(s, { slot_ids: ['S12'] }, { ip: '9.9.9.9', now: NOW + 11 * MIN })).status, 200);
});

test('tulisan Sheet gagal: tempahan tidak dianggap berjaya, indeks dibina semula untuk permintaan seterusnya', async () => {
  let gagal = true;
  const s = await setupStudio({ google: { failOn: (m, p) => (gagal && m === 'POST' && p.endsWith(':append') && p.includes('Tempahan') ? 500 : 0) } });
  const r = await book(s);
  assert.equal(r.status, 502);
  assert.equal(r.j.ok, false);
  gagal = false;
  const sebelum = count(s, 'values:batchGet');
  const r2 = await book(s);
  assert.equal(r2.status, 200);
  assert.equal(count(s, 'values:batchGet') - sebelum, 1, 'indeks dibaca semula selepas kegagalan');
});

test('/status: Ref + telefon sepadan -> medan terhad sahaja', async () => {
  const s = await setupStudio();
  const b = await book(s, { emel: 'a@b.com' });
  const r = await status(s, { ref: b.j.ref.toLowerCase(), telefon: '0123456789' });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(Object.keys(r.j.tempahan).sort(), ['bil_slot', 'dewasa', 'jumlah', 'kanak', 'ref', 'slot_label', 'status', 'tarikh']);
  assert.equal(r.j.tempahan.status, 'PENDING');
  const txt = JSON.stringify(r.j);
  for (const x of ['Aisyah', '60123456789', 'a@b.com']) assert.ok(!txt.includes(x), x);
});

test('/status: telefon salah, Ref salah, telefon sahaja -> tiada rekod (tiada enumerasi)', async () => {
  const s = await setupStudio();
  const b = await book(s);
  assert.equal((await status(s, { ref: b.j.ref, telefon: '0199999999' })).status, 404);
  assert.equal((await status(s, { ref: 'AB-ZZZZZZ', telefon: '0123456789' })).status, 404);
  assert.equal((await status(s, { telefon: '0123456789' })).status, 404);
  assert.equal((await status(s, { ref: b.j.ref })).status, 404);
});

test('/status: had kadar 10/minit per IP dan 6 cubaan per Ref', async () => {
  const s = await setupStudio();
  const b = await book(s);
  const rs = [];
  for (let i = 0; i < 11; i++) rs.push(await status(s, { ref: 'AB-ZZZZZ' + (i % 2 ? 'Y' : 'Z'), telefon: '0123456789' }, { ip: '7.7.7.7' }));
  assert.equal(rs[10].status, 429);
  const perRef = [];
  for (let i = 0; i < 7; i++) perRef.push(await status(s, { ref: b.j.ref, telefon: '01999999' + String(10 + i) }, { ip: 'ip-' + i }));
  assert.equal(perRef[6].status, 429, 'meneka telefon untuk satu Ref disekat');
});

test('status tempahan yang ditukar dalam Sheet dikemas kini selepas indeks disegar', async () => {
  const s = await setupStudio();
  const b = await book(s);
  bookingRows(s)[0][col('status')] = 'DEPOSIT';
  const r = await status(s, { ref: b.j.ref, telefon: '0123456789' }, { now: NOW + 6 * MIN });
  assert.equal(r.j.tempahan.status, 'DEPOSIT');
});

test('PDPA: KV dan memori DO tiada nama/telefon/emel pelanggan mentah', async () => {
  const s = await setupStudio();
  await book(s, { nama: 'Siti Rahsia', telefon: '0177777777', emel: 'siti@rahsia.my' });
  const kv = [...s.env.REGISTRY._map.values()].join('\n');
  for (const x of ['Siti Rahsia', '60177777777', 'siti@rahsia.my']) assert.ok(!kv.includes(x), 'KV: ' + x);
  const inst = s.env.TENANT_LOCK._instances.get('id:tenant:' + s.tid);
  const mem = JSON.stringify([...inst.studio.byRef.values()]);
  for (const x of ['Siti Rahsia', '60177777777', '0177777777', 'siti@rahsia.my']) assert.ok(!mem.includes(x), 'DO: ' + x);
});

test('/book dari origin lain ditolak; kaedah salah 405', async () => {
  const s = await setupStudio();
  const r = await call(s.env, s.g, '/api/public/wakanda/book', { method: 'POST', body: { ...baik, turnstile: turnstileToken() }, headers: { origin: 'https://jahat.example' } });
  assert.equal(r.status, 403);
  assert.equal((await call(s.env, s.g, '/api/public/wakanda/book')).status, 405);
  assert.equal((await call(s.env, s.g, '/api/public/tiada-studio/config')).status, 404);
});

test('pautan berbahaya yang ditaip terus dalam Sheet dibuang (javascript:, http:)', async () => {
  const s = await setupStudio();
  setTetapan(s, 'maps_url', 'javascript:alert(document.cookie)');
  setTetapan(s, 'logo_url', 'http://tidak-selamat.example/logo.png');
  setTetapan(s, 'link_bayaran', 'data:text/html,<script>alert(1)</script>');
  setTetapan(s, 'whatsapp', '60123456789"><script>');
  setTetapan(s, 'warna_utama', 'red;background:url(x)');
  s.sheet('Banner').push(['B02', 'javascript:alert(1)', 2, 'TRUE']);
  const { j } = await config(s);
  assert.equal(j.studio.maps_url, '');
  assert.equal(j.studio.logo_url, '');
  assert.equal(j.studio.link_bayaran, '');
  assert.equal(j.studio.whatsapp, '60123456789');
  assert.equal(j.studio.warna_utama, '#2563EB');
  assert.deepEqual(j.banners, ['https://i.postimg.cc/abc/banner.jpg']);
  const html = (await page(s, '/wakanda', NOW + 61000)).j._text;
  assert.ok(!html.includes('javascript:'));
});
