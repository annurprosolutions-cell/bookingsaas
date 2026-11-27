import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBooking, pricePerSlot, formatRM, toSen, isSpecialDate, addonLabel } from '../js/core/pricing.js';
import { seedSlots } from '../js/core/sheet-schema.js';

const slots = seedSlots('raya');
const settings = { harga_normal: 80, harga_special: 120 };
const special = ['2027-03-09'];
const addons = [
  { addon_id: 'A01', nama: 'Frame', harga: 30, aktif: true, susunan: 1 },
  { addon_id: 'A02', nama: 'Cetakan', harga: 10.5, aktif: true, susunan: 2 },
  { addon_id: 'A03', nama: 'Lama', harga: 5, aktif: false, susunan: 3 }
];
const base = { tarikh: '2027-03-05', slotIds: ['S01', 'S02', 'S03'], settings, slots, addons, hariSpecial: special };

test('harga hari biasa: bil_slot x harga_normal', () => {
  const r = computeBooking(base);
  assert.equal(r.ok, true);
  assert.equal(r.jenis_hari, 'normal');
  assert.equal(r.bil_slot, 3);
  assert.equal(r.harga_slot, 240);
  assert.equal(r.harga_addon, 0);
  assert.equal(r.jumlah, 240);
  assert.equal(r.slot_label, '09:00 AM, 09:20 AM, 09:40 AM');
  assert.equal(r.addon, '');
});

test('harga hari special: guna harga_special', () => {
  const r = computeBooking({ ...base, tarikh: '2027-03-09' });
  assert.equal(r.jenis_hari, 'special');
  assert.equal(r.harga_slot, 360);
  assert.equal(r.jumlah, 360);
});

test('harga_special kosong = harga_normal', () => {
  assert.equal(pricePerSlot('2027-03-09', { harga_normal: 80 }, special), 80);
  assert.equal(pricePerSlot('2027-03-09', { harga_normal: 80, harga_special: '' }, special), 80);
  assert.equal(pricePerSlot('2027-03-09', { harga_normal: 80, harga_special: null }, special), 80);
  assert.equal(pricePerSlot('2027-03-09', { harga_normal: 80, harga_special: 0 }, special), 0);
});

test('hariSpecial boleh array rentetan atau objek { tarikh }', () => {
  assert.equal(isSpecialDate('2027-03-09', ['2027-03-09']), true);
  assert.equal(isSpecialDate('2027-03-09', [{ tarikh: '2027-03-09', label: 'Raya' }]), true);
  assert.equal(isSpecialDate('2027-03-10', [{ tarikh: '2027-03-09' }]), false);
});

test('add-on: dijumlah, label dengan harga, ikut susunan', () => {
  const r = computeBooking({ ...base, addonIds: ['A02', 'A01'] });
  assert.equal(r.harga_addon, 40.5);
  assert.equal(r.jumlah, 280.5);
  assert.equal(r.addon, 'Frame (+RM30), Cetakan (+RM10.50)');
});

test('wang dikira dalam sen: tiada ralat titik terapung', () => {
  const r = computeBooking({ ...base, settings: { harga_normal: 0.1 }, addonIds: [] });
  assert.equal(r.harga_slot, 0.3); // 0.1 * 3 secara naif = 0.30000000000000004
  const r2 = computeBooking({ ...base, settings: { harga_normal: 19.99 }, slotIds: ['S01', 'S02', 'S03'] });
  assert.equal(r2.harga_slot, 59.97);
  assert.equal(toSen(1.005), 101);
});

test('harga ditetapkan server: input jumlah/harga dari klien tiada kesan', () => {
  const r = computeBooking({ ...base, jumlah: 1, harga_slot: 1, harga_normal: 1, status: 'SELESAI' });
  assert.equal(r.jumlah, 240);
});

test('susunan slot mengikut Sheet walaupun klien hantar terbalik', () => {
  const r = computeBooking({ ...base, slotIds: ['S03', 'S01', 'S02'] });
  assert.deepEqual(r.slot_ids, ['S01', 'S02', 'S03']);
});

test('ralat: slot tak wujud, tidak aktif, berganda, kosong', () => {
  assert.equal(computeBooking({ ...base, slotIds: ['S99'] }).kod, 'slot-tidak-sah');
  const off = slots.map((s) => (s.slot_id === 'S02' ? { ...s, aktif: false } : s));
  assert.equal(computeBooking({ ...base, slots: off }).kod, 'slot-tidak-aktif');
  assert.equal(computeBooking({ ...base, slotIds: ['S01', 'S01'] }).kod, 'slot-berganda');
  assert.equal(computeBooking({ ...base, slotIds: [] }).kod, 'tiada-slot');
  assert.equal(computeBooking({ ...base, slotIds: 'S01' }).kod, 'tiada-slot');
});

test('ralat: add-on tak wujud, tidak aktif, berganda', () => {
  assert.equal(computeBooking({ ...base, addonIds: ['A99'] }).kod, 'addon-tidak-sah');
  assert.equal(computeBooking({ ...base, addonIds: ['A03'] }).kod, 'addon-tidak-aktif');
  assert.equal(computeBooking({ ...base, addonIds: ['A01', 'A01'] }).kod, 'addon-berganda');
});

test('ralat: harga_normal belum ditetapkan', () => {
  assert.equal(computeBooking({ ...base, settings: {} }).kod, 'harga-belum-ditetapkan');
  assert.equal(computeBooking({ ...base, settings: { harga_normal: -5 } }).kod, 'harga-belum-ditetapkan');
});

test('formatRM dan addonLabel', () => {
  assert.equal(formatRM(30), 'RM30');
  assert.equal(formatRM(30.5), 'RM30.50');
  assert.equal(formatRM(0), 'RM0');
  assert.equal(addonLabel({ nama: 'Frame', harga: 30 }), 'Frame (+RM30)');
});
