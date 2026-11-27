import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, isValidPhone, isValidWhatsapp, isEmail, isHttpsUrl, validateSlug, suggestSlug, RESERVED_SLUGS,
  generateRef, isValidRef, REF_ALPHABET, validateBookingInput, validateStatusQuery, validateReviewInput,
  validateTetapan, contrastWithWhite, contrastOk, suggestAccessibleColour, cleanText
} from '../js/core/validate.js';

const ctx = { today: '2027-03-01', maksDewasa: 4, closed: { '2027-03-10': 'Cuti umum' } };
const baik = { nama: 'Aisyah', telefon: '012-345 6789', tarikh: '2027-03-05', slot_ids: ['S01'], dewasa: 2, kanak: 1, pdpa: true };

test('normalizePhone: 01x -> 601x, buang simbol dan +', () => {
  assert.equal(normalizePhone('012-345 6789'), '60123456789');
  assert.equal(normalizePhone('+60 12-345 6789'), '60123456789');
  assert.equal(normalizePhone('0123456789'), '60123456789');
  assert.equal(normalizePhone('60123456789'), '60123456789');
  assert.equal(normalizePhone('0060123456789'), '60123456789');
  assert.equal(normalizePhone(undefined), '');
});

test('isValidPhone: 9 hingga 13 digit sahaja', () => {
  assert.equal(isValidPhone('601234567'), true);
  assert.equal(isValidPhone('6012345678901'), true);
  assert.equal(isValidPhone('60123456'), false);
  assert.equal(isValidPhone('60123456789012'), false);
  assert.equal(isValidPhone('abc'), false);
  assert.equal(isValidPhone(''), false);
});

test('isValidWhatsapp: 60 + 8 hingga 11 digit', () => {
  assert.equal(isValidWhatsapp('60123456789'), true);
  assert.equal(isValidWhatsapp('0123456789'), false);
  assert.equal(isValidWhatsapp('6512345678'), false);
});

test('isEmail dan isHttpsUrl', () => {
  assert.equal(isEmail('a@b.com'), true);
  assert.equal(isEmail('a@b'), false);
  assert.equal(isEmail('a b@c.com'), false);
  assert.equal(isEmail('a@b.com,c@d.com'), false);
  assert.equal(isHttpsUrl('https://example.com/a.png'), true);
  assert.equal(isHttpsUrl('http://example.com'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
  assert.equal(isHttpsUrl('//example.com'), false);
  assert.equal(isHttpsUrl(''), false);
});

test('slug: format TRD (3 hingga 30 aksara)', () => {
  assert.equal(validateSlug('wakanda').ok, true, 'wakanda dibenarkan untuk studio pertama');
  assert.equal(validateSlug('studio-raya-2027').ok, true);
  assert.equal(validateSlug('a'.repeat(30)).ok, true);
  assert.equal(validateSlug('a'.repeat(31)).kod, 'format');
  assert.equal(validateSlug('ab').kod, 'format');
  assert.equal(validateSlug('abc').ok, true);
  assert.equal(validateSlug('Studio').kod, 'format');
  assert.equal(validateSlug('-studio').kod, 'format');
  assert.equal(validateSlug('studio-').kod, 'format');
  assert.equal(validateSlug('stu dio').kod, 'format');
  assert.equal(validateSlug('stu_dio').kod, 'format');
  assert.equal(validateSlug('../etc').kod, 'format');
  assert.equal(validateSlug(undefined).kod, 'format');
});

test('slug: senarai reserved ditolak', () => {
  for (const r of ['admin', 'app', 'api', 'daftar', 'login', 'platform', 'privasi', 'terma', 'panduan', 'demo', 'salepage', 'static', 'assets', 'bcl', 'sw', 'manifest', 'css', 'js', 'tools', 'docs', 'spike']) {
    assert.ok(RESERVED_SLUGS.includes(r), r);
    const v = validateSlug(r);
    // "sw" dan "js" terlalu pendek (format), selebihnya reserved
    assert.equal(v.ok, false, r);
    assert.ok(['reserved', 'format'].includes(v.kod), r);
  }
  assert.equal(validateSlug('admin').kod, 'reserved');
  assert.equal(validateSlug('platform').kod, 'reserved');
});

test('suggestSlug dari nama studio', () => {
  assert.equal(suggestSlug('Wakanda Studio Raya'), 'wakanda-studio-raya');
  assert.equal(suggestSlug('  Éclat Foto!! '), 'eclat-foto');
  assert.equal(suggestSlug('A'.repeat(50)).length, 30);
  assert.equal(suggestSlug('???'), '');
});

test('Ref: format AB- + 6 aksara daripada abjad yang ditetapkan', () => {
  const r = generateRef();
  assert.match(r, /^AB-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  assert.equal(isValidRef(r), true);
  for (const bad of ['AB-ABCDE0', 'AB-ABCDEI', 'ab-abcdef', 'AB-ABCDE', 'XX-ABCDEF', 'AB-ABCDEFG']) assert.equal(isValidRef(bad), false, bad);
  assert.ok(!REF_ALPHABET.includes('0') && !REF_ALPHABET.includes('O') && !REF_ALPHABET.includes('I') && !REF_ALPHABET.includes('1'));
});

test('Ref: 2000 Ref berturutan semuanya unik', () => {
  const taken = new Set();
  for (let i = 0; i < 2000; i++) {
    const r = generateRef(taken);
    assert.ok(!taken.has(r));
    taken.add(r);
  }
  assert.equal(taken.size, 2000);
});

test('Ref: bertembung dengan yang sedia ada -> dijana semula', () => {
  let call = 0;
  const rng = () => (++call === 1 ? new Uint8Array([0, 0, 0, 0, 0, 0]) : new Uint8Array([1, 1, 1, 1, 1, 1]));
  const r = generateRef(new Set(['AB-AAAAAA']), rng);
  assert.equal(r, 'AB-BBBBBB');
  assert.equal(call, 2);
  assert.throws(() => generateRef(new Set(['AB-AAAAAA']), () => new Uint8Array(6), 5), /unik/);
});

test('tempahan: input sah dinormalisasi', () => {
  const r = validateBookingInput({ ...baik, emel: ' a@b.com ', catatan: '  nak   frame ' }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.telefon, '60123456789');
  assert.equal(r.value.emel, 'a@b.com');
  assert.equal(r.value.catatan, 'nak frame');
  assert.deepEqual(r.value.addon_ids, []);
});

test('tempahan: medan harga/status/ref dari klien tidak disalin', () => {
  const r = validateBookingInput({ ...baik, jumlah: 1, harga_slot: 1, status: 'SELESAI', ref: 'AB-AAAAAA', dikemas_kini_oleh: 'admin' }, ctx);
  assert.equal(r.ok, true);
  for (const k of ['jumlah', 'harga_slot', 'status', 'ref', 'dikemas_kini_oleh']) assert.ok(!(k in r.value), k);
});

test('tempahan: nama HTML dikekalkan sebagai teks (dipaparkan guna textContent)', () => {
  const r = validateBookingInput({ ...baik, nama: '<img src=x onerror=alert(1)>' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.value.nama, '<img src=x onerror=alert(1)>');
  const f = validateBookingInput({ ...baik, nama: '=HYPERLINK("http://jahat")' }, ctx);
  assert.equal(f.value.nama, '=HYPERLINK("http://jahat")', 'awalan formula ditambah semasa menulis Sheet, bukan di sini');
});

test('tempahan: semua pengesahan wajib', () => {
  const e = (patch) => validateBookingInput({ ...baik, ...patch }, ctx).errors || {};
  assert.ok(e({ nama: '' }).nama);
  assert.ok(e({ nama: 'x'.repeat(81) }).nama);
  assert.ok(e({ nama: 123 }).nama);
  assert.ok(e({ telefon: '123' }).telefon);
  assert.ok(e({ emel: 'bukan-emel' }).emel);
  assert.ok(e({ tarikh: '2027-02-28' }).tarikh, 'lampau');
  assert.ok(e({ tarikh: '2027-02-30' }).tarikh, 'tidak wujud');
  assert.equal(e({ tarikh: '2027-03-10' }).tarikh, 'Cuti umum', 'sebab tarikh tutup dipaparkan');
  assert.ok(e({ slot_ids: [] }).slot_ids);
  assert.ok(e({ slot_ids: 'S01' }).slot_ids);
  assert.ok(e({ slot_ids: ['S01', 'S01'] }).slot_ids);
  assert.ok(e({ slot_ids: ['S01; DROP'] }).slot_ids);
  assert.ok(e({ dewasa: 0 }).dewasa);
  assert.ok(e({ dewasa: 5 }).dewasa, 'maks_dewasa=4');
  assert.ok(e({ dewasa: 1.5 }).dewasa);
  assert.ok(e({ kanak: -1 }).kanak);
  assert.ok(e({ kanak: 21 }).kanak);
  assert.ok(e({ catatan: 'x'.repeat(201) }).catatan);
  assert.ok(e({ pdpa: false }).pdpa);
  assert.ok(e({ pdpa: 'true' }).pdpa, 'mesti boolean true');
  assert.ok(e({ addon_ids: 'A01' }).addon_ids);
  assert.ok(e({ addon_ids: ['A01', 'A01'] }).addon_ids);
  assert.equal(validateBookingInput(null, ctx).ok, false);
});

test('tempahan: had sempadan diterima, hari ini dibenarkan, dewasa/kanak boleh rentetan digit', () => {
  const r = validateBookingInput({ ...baik, tarikh: '2027-03-01', dewasa: '4', kanak: '20', nama: 'x'.repeat(80) }, ctx);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.dewasa, 4);
  assert.equal(r.value.kanak, 20);
});

test('semak status: perlu Ref sah DAN telefon sah', () => {
  assert.deepEqual(validateStatusQuery({ ref: ' ab-abc234 ', telefon: '0123456789' }), { ok: true, ref: 'AB-ABC234', telefon: '60123456789' });
  assert.equal(validateStatusQuery({ telefon: '0123456789' }).ok, false, 'telefon sahaja tidak cukup');
  assert.equal(validateStatusQuery({ ref: 'AB-ABC234' }).ok, false);
  assert.equal(validateStatusQuery({ ref: 'salah', telefon: '0123456789' }).ok, false);
  assert.equal(validateStatusQuery(null).ok, false);
});

test('review: bintang 1..5, nama <=40, komen <=500', () => {
  assert.equal(validateReviewInput({ nama: 'A', bintang: 5, komen: 'Bagus' }).ok, true);
  assert.ok(validateReviewInput({ nama: 'A', bintang: 6, komen: 'x' }).errors.bintang);
  assert.ok(validateReviewInput({ nama: 'A', bintang: 0, komen: 'x' }).errors.bintang);
  assert.ok(validateReviewInput({ nama: 'x'.repeat(41), bintang: 3, komen: 'x' }).errors.nama);
  assert.ok(validateReviewInput({ nama: 'A', bintang: 3, komen: 'x'.repeat(501) }).errors.komen);
  assert.ok(validateReviewInput({ nama: 'A', bintang: 3, komen: '' }).errors.komen);
  assert.equal(validateReviewInput({ nama: 'A', bintang: 3, komen: '<b>x</b>' }).value.komen, '<b>x</b>');
});

test('cleanText: buang aksara kawalan', () => {
  assert.equal(cleanText('a\u0000b\tc\nd'), 'a b c d');
  assert.equal(cleanText('a\n\n  b', { multiline: true }), 'a\n\nb');
  assert.equal(cleanText(5), '');
});

test('kontras warna: biru Annur lulus, oren Wakanda gagal tetapi diberi cadangan', () => {
  assert.ok(contrastWithWhite('#2563EB') > 5);
  assert.equal(contrastOk('#2563EB'), true);
  assert.equal(contrastOk('#F97316'), false);
  assert.equal(contrastOk('#FACC15'), false);
  const c = suggestAccessibleColour('#F97316');
  assert.ok(contrastOk(c), c);
  assert.equal(suggestAccessibleColour('#2563EB'), '#2563EB');
  assert.equal(suggestAccessibleColour('merah'), null);
});

const tetapanBaik = { nama_studio: 'Wakanda Studio', whatsapp: '0123456789', harga_normal: 80 };

test('tetapan: ringkas sah, WhatsApp dinormalisasi', () => {
  const r = validateTetapan(tetapanBaik);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.whatsapp, '60123456789');
  assert.equal(r.value.harga_normal, 80);
});

test('tetapan: medan wajib dan jenis', () => {
  assert.deepEqual(Object.keys(validateTetapan({}).errors).sort(), ['harga_normal', 'nama_studio', 'whatsapp']);
  assert.ok(validateTetapan({ ...tetapanBaik, nama_studio: 'x'.repeat(61) }).errors.nama_studio);
  assert.ok(validateTetapan({ ...tetapanBaik, harga_normal: -1 }).errors.harga_normal);
  assert.ok(validateTetapan({ ...tetapanBaik, harga_normal: 'abc' }).errors.harga_normal);
  assert.ok(validateTetapan({ ...tetapanBaik, whatsapp: '123' }).errors.whatsapp);
  assert.ok(validateTetapan({ ...tetapanBaik, logo_url: 'http://x.com/a.png' }).errors.logo_url);
  assert.equal(validateTetapan({ ...tetapanBaik, logo_url: '' }).ok, true);
  assert.ok(validateTetapan({ ...tetapanBaik, maks_dewasa: 51 }).errors.maks_dewasa);
  assert.ok(validateTetapan({ ...tetapanBaik, maks_dewasa: 0 }).errors.maks_dewasa);
  assert.ok(validateTetapan({ ...tetapanBaik, alamat: 'x'.repeat(301) }).errors.alamat);
  assert.ok(validateTetapan({ ...tetapanBaik, arahan_deposit: 'x'.repeat(501) }).errors.arahan_deposit);
  assert.ok(validateTetapan({ ...tetapanBaik, tempahan_aktif: 'mungkin' }).errors.tempahan_aktif);
  assert.ok(validateTetapan({ ...tetapanBaik, warna_utama: 'biru' }).errors.warna_utama);
  assert.ok(validateTetapan({ ...tetapanBaik, tak_wujud: 1 }).errors.tak_wujud, 'kunci tidak dikenali ditolak');
});

test('tetapan: harga "RM1,200.50" diterima dan dibundar 2 titik perpuluhan', () => {
  assert.equal(validateTetapan({ ...tetapanBaik, harga_normal: 'RM1,200.50' }).value.harga_normal, 1200.5);
  assert.equal(validateTetapan({ ...tetapanBaik, harga_normal: 1.005 }).value.harga_normal, 1.01);
});

test('tetapan: warna kontras rendah = AMARAN dengan cadangan, bukan penolakan (preset Oren Studio)', () => {
  const r = validateTetapan({ ...tetapanBaik, warna_utama: '#f97316' });
  assert.equal(r.ok, true);
  assert.equal(r.value.warna_utama, '#F97316');
  assert.ok(r.warnings.warna_utama.kontras < 4.5);
  assert.ok(contrastOk(r.warnings.warna_utama.cadangan));
  assert.deepEqual(validateTetapan({ ...tetapanBaik, warna_utama: '#2563EB' }).warnings, {});
});

test('tetapan: kemas kini separa (partial) tidak menuntut medan wajib lain', () => {
  assert.equal(validateTetapan({ ticker: 'Promo Raya' }, { partial: true }).ok, true);
  assert.ok(validateTetapan({ nama_studio: '' }, { partial: true }).errors.nama_studio, 'tetapi tidak boleh dikosongkan');
});
