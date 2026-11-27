// Fixture KV/Google palsu berfungsi, dan modul js/core boleh bersambung dengannya hujung ke hujung
// (cipta Sheet -> seed -> tulis tempahan -> baca semula -> indeks -> kapasiti). Semuanya dalam memori.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeKv } from './fixtures/fake-kv.mjs';
import { fakeGoogle } from './fixtures/fake-google.mjs';
import { createSpreadsheet, valuesUpdate, valuesAppend, valuesGet, a1 } from '../worker/lib/google.js';
import {
  TABS, HEADERS, seedSlots, tetapanToRows, resolveTetapan, tetapanFromRows, objectToRow, parseTable
} from '../js/core/sheet-schema.js';
import { AvailabilityIndex, checkCapacity } from '../js/core/availability.js';
import { computeBooking } from '../js/core/pricing.js';
import { validateBookingInput, generateRef } from '../js/core/validate.js';

test('KV palsu: get/put/delete/list dan rekod TTL', async () => {
  const kv = fakeKv();
  await kv.put('tenant:a1', JSON.stringify({ slug: 'wakanda' }));
  await kv.put('tenant:b2', '{}');
  await kv.put('weblog:1', '{}', { expirationTtl: 7776000 });
  assert.deepEqual(await kv.get('tenant:a1', 'json'), { slug: 'wakanda' });
  assert.equal(await kv.get('tiada'), null);
  assert.deepEqual((await kv.list({ prefix: 'tenant:' })).keys.map((k) => k.name), ['tenant:a1', 'tenant:b2']);
  assert.equal(kv._ttl.get('weblog:1'), 7776000);
  await kv.delete('tenant:b2');
  assert.equal(await kv.get('tenant:b2'), null);
});

test('hujung ke hujung: Sheet palsu + teras = tiada double booking walaupun Sheet dibaca semula', async () => {
  const g = fakeGoogle();
  const f = g.fetch;
  const AT = 'at-ujian';
  const ss = await createSpreadsheet(f, AT, 'Annur Booking - Ujian (JANGAN PADAM)', TABS);
  const id = ss.spreadsheetId;

  // seed header, slot, tetapan (hanya jika tab kosong, seperti setupTenantSheet nanti)
  for (const t of TABS) await valuesUpdate(f, AT, id, a1(t, 'A1'), [HEADERS[t]]);
  await valuesAppend(f, AT, id, a1('Slot', 'A:F'), seedSlots('raya').map((s) => objectToRow('Slot', s)));
  const tet = resolveTetapan({ nama_studio: 'Wakanda', whatsapp: '60123456789', harga_normal: 80, harga_special: 120 });
  await valuesAppend(f, AT, id, a1('Tetapan', 'A:C'), tetapanToRows(tet, '2027-03-01T10:00:00+08:00'));

  const baca = async (tab) => parseTable(tab, (await valuesGet(f, AT, id, a1(tab, 'A:Z'))).values);
  const slots = (await baca('Slot')).rows;
  assert.equal(slots.length, 26);
  const settings = tetapanFromRows((await valuesGet(f, AT, id, a1('Tetapan', 'A:C'))).values.slice(1));
  assert.equal(settings.harga_special, 120);

  // satu tempahan penuh: validasi -> harga server -> kapasiti -> tulis RAW
  const ctx = { today: '2027-03-01', maksDewasa: settings.maks_dewasa, closed: {} };
  const v = validateBookingInput({ nama: '=cmd|calc', telefon: '012-345 6789', tarikh: '2027-03-05', slot_ids: ['S02', 'S01'], dewasa: 2, pdpa: true, jumlah: 1 }, ctx);
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  const harga = computeBooking({ tarikh: v.value.tarikh, slotIds: v.value.slot_ids, settings, slots });
  assert.equal(harga.jumlah, 160);

  let index = new AvailabilityIndex((await baca('Tempahan')).rows);
  assert.equal(checkCapacity(index, { tarikh: v.value.tarikh, slotIds: harga.slot_ids }, slots).ok, true);
  const rekod = {
    ref: generateRef(), dicipta_pada: '2027-03-01T10:00:00+08:00', ...v.value, slot_ids: harga.slot_ids.join(', '),
    slot_label: harga.slot_label, bil_slot: harga.bil_slot, kanak: 0, addon: harga.addon, harga_slot: harga.harga_slot,
    harga_addon: harga.harga_addon, jumlah: harga.jumlah, status: 'PENDING', persetujuan_pdpa: 'TRUE 2027-03-01T10:00:00+08:00',
    dikemas_kini_pada: '2027-03-01T10:00:00+08:00', dikemas_kini_oleh: 'pelanggan'
  };
  await valuesAppend(f, AT, id, a1('Tempahan', 'A:T'), [objectToRow('Tempahan', rekod)]);

  // sel dalam Sheet sudah diescape; bila dibaca semula ia pulih sebagai teks asal
  const mentah = g.state.sheets.get(id).tabs.Tempahan[1];
  assert.equal(mentah[2], "'=cmd|calc");
  const semula = (await baca('Tempahan')).rows;
  assert.equal(semula.length, 1);
  assert.equal(semula[0].nama, '=cmd|calc');
  assert.equal(semula[0].jumlah, 160);

  // indeks dibina semula dari Sheet (DO dingin): slot itu kini penuh, slot lain kosong
  index = new AvailabilityIndex(semula);
  const lagi = checkCapacity(index, { tarikh: '2027-03-05', slotIds: ['S01'] }, slots);
  assert.deepEqual(lagi.conflicts, [{ slot_id: 'S01', kod: 'penuh' }]);
  assert.equal(checkCapacity(index, { tarikh: '2027-03-05', slotIds: ['S03'] }, slots).ok, true);
  assert.equal(checkCapacity(index, { tarikh: '2027-03-06', slotIds: ['S01'] }, slots).ok, true);
});
