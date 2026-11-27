import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABS, HEADERS, seedSlots, seedAddon, infoRows, sheetTitle, sanitizeCell, unsanitizeCell, objectToRow, rowToObject,
  parseTable, missingHeaders, tetapanFromRows, tetapanToRows, resolveTetapan, publicTetapan, toCsv, csvCell, CSV_BOM,
  TERMA_SEED, parseBool, TETAPAN_KEYS
} from '../js/core/sheet-schema.js';
import { diffDays } from '../js/core/dates.js';

test('tab dan header mengikut BSD seksyen 4 (kontrak dengan kod)', () => {
  assert.deepEqual(TABS, ['Info', 'Tetapan', 'Banner', 'Slot', 'Addon', 'HariSpecial', 'TarikhTutup', 'Tempahan', 'Review', 'Log']);
  assert.deepEqual(HEADERS.Slot, ['slot_id', 'label', 'kumpulan', 'susunan', 'aktif', 'kapasiti']);
  assert.deepEqual(HEADERS.Addon, ['addon_id', 'nama', 'harga', 'aktif', 'susunan']);
  assert.deepEqual(HEADERS.Banner, ['id', 'url', 'susunan', 'aktif']);
  assert.deepEqual(HEADERS.Tetapan, ['kunci', 'nilai', 'dikemas_kini']);
  assert.deepEqual(HEADERS.HariSpecial, ['tarikh', 'label']);
  assert.deepEqual(HEADERS.TarikhTutup, ['tarikh', 'sebab']);
  assert.deepEqual(HEADERS.Review, ['id', 'dicipta_pada', 'tarikh', 'nama', 'bintang', 'komen', 'status']);
  assert.deepEqual(HEADERS.Log, ['masa', 'pelaku', 'tindakan', 'sasaran', 'butiran']);
  assert.equal(HEADERS.Tempahan.length, 20);
  assert.equal(HEADERS.Tempahan[0], 'ref');
  assert.equal(HEADERS.Tempahan[19], 'dikemas_kini_oleh');
  assert.equal(HEADERS.Tempahan.join(','), 'ref,dicipta_pada,nama,telefon,emel,tarikh,slot_ids,slot_label,bil_slot,dewasa,kanak,addon,harga_slot,harga_addon,jumlah,status,catatan,persetujuan_pdpa,dikemas_kini_pada,dikemas_kini_oleh');
  for (const t of TABS) assert.ok(HEADERS[t], t);
});

test('templat Raya: 26 slot ikut Wakanda (BSD 6.3)', () => {
  const s = seedSlots('raya');
  assert.equal(s.length, 26);
  assert.deepEqual(s.map((x) => x.susunan), Array.from({ length: 26 }, (_, i) => i + 1));
  assert.deepEqual([s[0].slot_id, s[0].label, s[0].kumpulan], ['S01', '09:00 AM', 'Pagi']);
  assert.deepEqual([s[8].slot_id, s[8].label, s[8].kumpulan], ['S09', '11:40 AM', 'Pagi']);
  assert.deepEqual([s[9].slot_id, s[9].label, s[9].kumpulan], ['S10', '02:20 PM', 'Petang']);
  assert.deepEqual([s[19].slot_id, s[19].label, s[19].kumpulan], ['S20', '05:40 PM', 'Petang']);
  assert.deepEqual([s[20].slot_id, s[20].label, s[20].kumpulan], ['S21', '09:00 PM', 'Malam']);
  assert.deepEqual([s[25].slot_id, s[25].label, s[25].kumpulan], ['S26', '10:40 PM', 'Malam']);
  assert.ok(s.every((x) => x.kapasiti === 1 && x.aktif === true));
  assert.equal(new Set(s.map((x) => x.slot_id)).size, 26);
  assert.deepEqual(['Pagi', 'Petang', 'Malam'].map((k) => s.filter((x) => x.kumpulan === k).length), [9, 11, 6]);
  assert.deepEqual(seedSlots('kosong'), []);
});

test('seed add-on contoh: Frame RM30 tidak aktif; Info ada skema=1', () => {
  assert.deepEqual(seedAddon(), [{ addon_id: 'A01', nama: 'Frame', harga: 30, aktif: false, susunan: 1 }]);
  const info = infoRows('2027-01-01T00:00:00+08:00');
  assert.deepEqual(info[0], ['skema', '1']);
  assert.equal(info.find((r) => r[0] === 'platform')[1], 'Annur Booking');
  assert.equal(sheetTitle('Wakanda Studio'), 'Annur Booking - Wakanda Studio (JANGAN PADAM)');
});

test('formula injection: awalan \' pada teks yang bermula = + - @', () => {
  assert.equal(sanitizeCell('=HYPERLINK("http://x","klik")'), "'=HYPERLINK(\"http://x\",\"klik\")");
  assert.equal(sanitizeCell('+60123'), "'+60123");
  assert.equal(sanitizeCell('-1+1'), "'-1+1");
  assert.equal(sanitizeCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(sanitizeCell('\t=1'), "'\t=1");
  assert.equal(sanitizeCell('Biasa = ok'), 'Biasa = ok');
  assert.equal(sanitizeCell('Ali'), 'Ali');
  assert.equal(sanitizeCell(''), '');
  assert.equal(sanitizeCell(42), 42);
  assert.equal(sanitizeCell(-5), -5, 'nombor tidak disentuh');
});

test('unsanitizeCell: hanya buang awalan yang kita tambah', () => {
  assert.equal(unsanitizeCell("'=1+1"), '=1+1');
  assert.equal(unsanitizeCell("'@x"), '@x');
  assert.equal(unsanitizeCell("'biasa"), "'biasa");
  assert.equal(unsanitizeCell("'"), "'");
  for (const v of ['=1', '+1', '-1', '@a', 'Ali']) assert.equal(unsanitizeCell(sanitizeCell(v)), v);
});

const tempahan = {
  ref: 'AB-ABC234', dicipta_pada: '2027-03-01T10:00:00+08:00', nama: '=cmd|calc', telefon: '60123456789', emel: '',
  tarikh: '2027-03-05', slot_ids: 'S01, S02', slot_label: '09:00 AM, 09:20 AM', bil_slot: 2, dewasa: 2, kanak: 1,
  addon: 'Frame (+RM30)', harga_slot: 160, harga_addon: 30, jumlah: 190, status: 'PENDING', catatan: '@catat',
  persetujuan_pdpa: 'TRUE 2027-03-01T10:00:00+08:00', dikemas_kini_pada: '2027-03-01T10:00:00+08:00', dikemas_kini_oleh: 'pelanggan'
};

test('baris Tempahan: dalam susunan header, formula diescape, nombor kekal nombor', () => {
  const row = objectToRow('Tempahan', tempahan);
  assert.equal(row.length, 20);
  assert.equal(row[0], 'AB-ABC234');
  assert.equal(row[2], "'=cmd|calc");
  assert.equal(row[8], 2);
  assert.equal(row[14], 190);
  assert.equal(row[16], "'@catat");
  assert.equal(row[3], '60123456789');
});

test('baris Tempahan pergi-balik: objek asal pulih sepenuhnya', () => {
  assert.deepEqual(rowToObject('Tempahan', objectToRow('Tempahan', tempahan)), tempahan);
});

test('boolean: TRUE/FALSE ditulis, true/"TRUE"/"true" dibaca', () => {
  assert.deepEqual(objectToRow('Slot', { slot_id: 'S01', label: '09:00 AM', kumpulan: 'Pagi', susunan: 1, aktif: true, kapasiti: 1 }), ['S01', '09:00 AM', 'Pagi', 1, 'TRUE', 1]);
  assert.equal(objectToRow('Slot', { aktif: false })[4], 'FALSE');
  for (const v of [true, 'TRUE', 'true', ' True ', 1]) assert.equal(parseBool(v), true, String(v));
  for (const v of [false, 'FALSE', 'false', 0]) assert.equal(parseBool(v, true), false, String(v));
  assert.equal(parseBool('', true), true);
  assert.equal(parseBool(undefined), false);
});

test('parseTable: lajur dipetakan ikut NAMA header (susunan diubah studio), lajur tambahan dan baris kosong dilangkau', () => {
  const values = [
    ['kapasiti', 'slot_id', 'nota studio', 'label', 'kumpulan', 'susunan', 'aktif'],
    [2, 'S01', 'abaikan', '09:00 AM', 'Pagi', '1', true],
    ['', '', '', '', '', '', ''],
    ['1', 'S02', '', '09:20 AM', 'Pagi', 2, 'FALSE']
  ];
  const { headers, rows } = parseTable('Slot', values);
  assert.equal(headers.length, 7);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].slot_id, rows[0].kapasiti, rows[0].susunan, rows[0].aktif, rows[0]._baris], ['S01', 2, 1, true, 2]);
  assert.deepEqual([rows[1].slot_id, rows[1].kapasiti, rows[1].aktif, rows[1]._baris], ['S02', 1, false, 4]);
});

test('parseTable: lajur hilang tidak memecahkan bacaan; tulis ikut header sebenar', () => {
  const { rows, headers } = parseTable('Slot', [['slot_id', 'label'], ['S01', '09:00 AM']]);
  assert.equal(rows[0].slot_id, 'S01');
  assert.equal(rows[0].kapasiti, 1, 'kapasiti hilang -> lalai 1, bukan tanpa had');
  assert.equal(rows[0].aktif, true, 'aktif hilang -> lalai TRUE (BSD)');
  assert.equal(parseTable('Addon', [['addon_id'], ['A01']]).rows[0].harga, null);
  assert.deepEqual(objectToRow('Slot', { slot_id: 'S01', label: 'X', kapasiti: 3 }, ['kapasiti', 'slot_id']), [3, 'S01']);
  assert.deepEqual(headers, ['slot_id', 'label']);
  assert.deepEqual(parseTable('Slot', []), { headers: [], rows: [] });
});

test('parseTable: sel kapasiti kosong atau rosak -> 1', () => {
  const { rows } = parseTable('Slot', [HEADERS.Slot, ['S01', 'A', 'Pagi', 1, true, ''], ['S02', 'B', 'Pagi', 2, true, 'abc']]);
  assert.equal(rows[0].kapasiti, 1);
  assert.equal(rows[1].kapasiti, null, 'nilai rosak jadi null; availability.js menganggapnya 1');
});

test('parseTable: tarikh yang ditaip manual (nombor siri) dipulihkan ke YYYY-MM-DD', () => {
  const serial = diffDays('2027-03-09', '1899-12-30');
  const { rows } = parseTable('HariSpecial', [['tarikh', 'label'], [serial, 'Raya'], ['2027-03-10', '']]);
  assert.equal(rows[0].tarikh, '2027-03-09');
  assert.equal(rows[1].tarikh, '2027-03-10');
});

test('parseTable: awalan \' pada sel dibuang bila dibaca semula', () => {
  const { rows } = parseTable('Tempahan', [HEADERS.Tempahan, objectToRow('Tempahan', tempahan)]);
  assert.equal(rows[0].nama, '=cmd|calc');
});

test('migrasi skema: hanya tambah lajur yang hilang, tidak pernah padam', () => {
  assert.deepEqual(missingHeaders('Slot', ['slot_id', 'label', 'kumpulan', 'susunan', 'aktif']), ['kapasiti']);
  assert.deepEqual(missingHeaders('Slot', HEADERS.Slot), []);
  assert.deepEqual(missingHeaders('Slot', ['slot_id', 'nota studio', 'label', 'kumpulan', 'susunan', 'aktif', 'kapasiti']), []);
  assert.deepEqual(missingHeaders('HariSpecial', []), ['tarikh', 'label']);
  assert.deepEqual(missingHeaders('Slot', undefined), HEADERS.Slot);
});

test('tetapan: nilai lalai (BSD 4)', () => {
  const t = resolveTetapan({ nama_studio: 'Wakanda', harga_normal: 80, whatsapp: '60123456789' });
  assert.equal(t.tajuk_hero, 'Wakanda');
  assert.equal(t.harga_special, 80);
  assert.equal(t.deposit, 50);
  assert.equal(t.warna_utama, '#2563EB');
  assert.equal(t.maks_dewasa, 10);
  assert.equal(t.umur_kanak_percuma, 4);
  assert.equal(t.tempahan_aktif, true);
  assert.equal(t.tempoh_sesi_minit, 30);
  assert.equal(t.waktu_pagi, '09:00 - 12:00');
  assert.equal(t.waktu_petang, '14:00 - 18:00');
  assert.equal(t.waktu_malam, '21:00 - 23:00');
  assert.equal(t.mesej_wa, 'Salam, saya nak sahkan tempahan Raya!');
  assert.equal(t.terma, TERMA_SEED);
  assert.equal(t.terma.split('\n').length, 4);
  assert.equal(t.faedah, '');
  assert.equal(t.logo_url, '');
});

test('tetapan: baris Sheet -> objek bertaip, kunci hilang guna lalai, nilai sendiri menang', () => {
  const t = tetapanFromRows([
    ['nama_studio', 'Wakanda Studio', ''],
    ['whatsapp', '60123456789', ''],
    ['harga_normal', 80, ''],
    ['harga_special', '120', ''],
    ['maks_dewasa', '6', ''],
    ['tempahan_aktif', 'FALSE', ''],
    ['deposit', '', ''],
    ['arahan_deposit', 'DuitNow 0123456789\nBank X', '']
  ]);
  assert.equal(t.nama_studio, 'Wakanda Studio');
  assert.equal(t.harga_normal, 80);
  assert.equal(t.harga_special, 120);
  assert.equal(t.maks_dewasa, 6);
  assert.equal(t.tempahan_aktif, false);
  assert.equal(t.deposit, 50, 'sel kosong -> lalai');
  assert.equal(t.tajuk_hero, 'Wakanda Studio');
  assert.equal(t.arahan_deposit, 'DuitNow 0123456789\nBank X');
});

test('tetapan: terma yang sengaja dikosongkan kekal kosong; harga_special kosong ikut harga_normal', () => {
  const t = tetapanFromRows([['nama_studio', 'A', ''], ['harga_normal', 70, ''], ['harga_special', '', ''], ['terma', '', '']]);
  assert.equal(t.terma, '');
  assert.equal(t.harga_special, 70);
});

test('tetapan pergi-balik melalui baris Sheet', () => {
  const asal = resolveTetapan({ nama_studio: '=Studio', harga_normal: 80.5, whatsapp: '60123456789', tempahan_aktif: false, alamat: 'Jalan 1\nKL' });
  const rows = tetapanToRows(asal, '2027-03-01T10:00:00+08:00');
  assert.ok(rows.every((r) => r.length === 3 && r[2] === '2027-03-01T10:00:00+08:00'));
  assert.equal(rows.find((r) => r[0] === 'nama_studio')[1], "'=Studio");
  assert.equal(rows.find((r) => r[0] === 'tempahan_aktif')[1], 'FALSE');
  assert.deepEqual(tetapanFromRows(rows), asal);
  assert.equal(TETAPAN_KEYS.length, 24);
});

test('config awam: arahan_deposit tidak terdedah sebelum tempahan dibuat', () => {
  const t = resolveTetapan({ nama_studio: 'A', harga_normal: 80, whatsapp: '60123456789', arahan_deposit: 'Akaun 123' });
  const p = publicTetapan(t);
  assert.ok(!('arahan_deposit' in p));
  assert.ok(!JSON.stringify(p).includes('Akaun 123'));
  assert.equal(p.nama_studio, 'A');
});

test('CSV: BOM, CRLF, petik, koma, baris baru, formula diescape', () => {
  const csv = toCsv(['ref', 'nama', 'catatan'], [
    { ref: 'AB-AAAAAA', nama: 'Ali, Abu', catatan: 'dia kata "ok"\nbaris dua' },
    { ref: 'AB-BBBBBB', nama: '=HYPERLINK("x")', catatan: '+60123' },
    { ref: 'AB-CCCCCC', nama: '@cmd', catatan: undefined }
  ]);
  assert.ok(csv.startsWith(CSV_BOM));
  const lines = csv.slice(1).split('\r\n');
  assert.equal(lines[0], 'ref,nama,catatan');
  assert.equal(lines[1], 'AB-AAAAAA,"Ali, Abu","dia kata ""ok""\nbaris dua"');
  assert.equal(lines[2], `AB-BBBBBB,"'=HYPERLINK(""x"")",'+60123`);
  assert.equal(lines[3], "AB-CCCCCC,'@cmd,");
  assert.equal(lines[4], '');
  assert.equal(csvCell(190), '190');
  assert.equal(csvCell(null), '');
  for (const l of lines.slice(1, 4)) assert.ok(!/(^|,)[=+\-@]/.test(l.replace(/"[^"]*"/g, '"X"')), 'tiada sel bermula aksara formula: ' + l);
});
