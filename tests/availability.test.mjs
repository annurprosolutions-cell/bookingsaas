import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kapasitiSlot, AvailabilityIndex, checkCapacity, slotAvailability, groupByKumpulan, checkStatusChange, slotIdList, checkDate
} from '../js/core/availability.js';
import { seedSlots } from '../js/core/sheet-schema.js';

const D = '2027-03-05';
const mk = (ref, slot, status = 'PENDING', tarikh = D) => ({ ref, tarikh, slot_ids: slot, status });

// Simulasi satu percubaan tempah di bawah kunci: semak -> tambah ke indeks jika lulus
function cuba(index, slots, booking) {
  const r = checkCapacity(index, { tarikh: booking.tarikh, slotIds: booking.slot_ids }, slots);
  if (r.ok) index.add(booking);
  return r;
}

test('kapasiti 1: tempahan kedua pada slot sama ditolak "penuh"', () => {
  const slots = seedSlots('raya');
  const idx = new AvailabilityIndex();
  assert.equal(cuba(idx, slots, mk('A', ['S01'])).ok, true);
  const r = cuba(idx, slots, mk('B', ['S01']));
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicts, [{ slot_id: 'S01', kod: 'penuh' }]);
});

test('kapasiti 2: dua tempahan diterima, yang ketiga ditolak', () => {
  const slots = seedSlots('raya').map((s) => (s.slot_id === 'S01' ? { ...s, kapasiti: 2 } : s));
  const idx = new AvailabilityIndex();
  assert.equal(cuba(idx, slots, mk('A', ['S01'])).ok, true);
  assert.equal(cuba(idx, slots, mk('B', ['S01'])).ok, true);
  assert.equal(cuba(idx, slots, mk('C', ['S01'])).ok, false);
  assert.equal(idx.count(D, 'S01'), 2);
});

test('tarikh berbeza tidak berebut slot yang sama', () => {
  const slots = seedSlots('raya');
  const idx = new AvailabilityIndex();
  assert.equal(cuba(idx, slots, mk('A', ['S01'], 'PENDING', '2027-03-05')).ok, true);
  assert.equal(cuba(idx, slots, mk('B', ['S01'], 'PENDING', '2027-03-06')).ok, true);
});

test('tempahan berbilang slot: satu slot penuh menolak keseluruhan', () => {
  const slots = seedSlots('raya');
  const idx = new AvailabilityIndex([mk('A', 'S02')]);
  const r = checkCapacity(idx, { tarikh: D, slotIds: ['S01', 'S02', 'S03'] }, slots);
  assert.equal(r.ok, false);
  assert.deepEqual(r.conflicts.map((c) => c.slot_id), ['S02']);
  assert.equal(new AvailabilityIndex([mk('X', 'S01, S02, S03')]).count(D, 'S03'), 1);
});

test('semua status kecuali CANCEL dikira terisi', () => {
  const idx = new AvailabilityIndex([mk('A', 'S01', 'PENDING'), mk('B', 'S02', 'DEPOSIT'), mk('C', 'S03', 'SELESAI'), mk('D', 'S04', 'CANCEL')]);
  assert.equal(idx.count(D, 'S01'), 1);
  assert.equal(idx.count(D, 'S02'), 1);
  assert.equal(idx.count(D, 'S03'), 1);
  assert.equal(idx.count(D, 'S04'), 0);
});

test('CANCEL melepaskan slot, rekod asal (tarikh/slot) kekal', () => {
  const slots = seedSlots('raya');
  const asal = mk('A', 'S01', 'PENDING');
  const idx = new AvailabilityIndex([asal]);
  assert.equal(checkCapacity(idx, { tarikh: D, slotIds: ['S01'] }, slots).ok, false);
  const batal = { ...asal, status: 'CANCEL' };
  idx.replace(asal, batal);
  assert.equal(batal.tarikh, D);
  assert.equal(batal.slot_ids, 'S01');
  assert.equal(checkCapacity(idx, { tarikh: D, slotIds: ['S01'] }, slots).ok, true);
  assert.equal(cuba(idx, slots, mk('B', ['S01'])).ok, true);
});

test('CANCEL -> status lain hanya jika slot masih kosong', () => {
  const slots = seedSlots('raya');
  const batal = mk('A', 'S01', 'CANCEL');
  const idx = new AvailabilityIndex([batal]);
  assert.equal(checkStatusChange(idx, batal, 'PENDING', slots).ok, true);
  idx.add(mk('B', 'S01')); // orang lain ambil slot itu
  const r = checkStatusChange(idx, batal, 'PENDING', slots);
  assert.equal(r.ok, false);
  assert.equal(r.kod, 'slot-sudah-diambil');
  assert.equal(checkStatusChange(idx, batal, 'CANCEL', slots).ok, true);
  assert.equal(checkStatusChange(idx, mk('B', 'S01'), 'DEPOSIT', slots).ok, true);
  assert.equal(checkStatusChange(idx, batal, 'LAIN', slots).kod, 'status-tidak-sah');
});

test('memulihkan tempahan lama pada slot yang kini tidak aktif dibenarkan jika kapasiti ada', () => {
  const slots = seedSlots('raya').map((s) => (s.slot_id === 'S01' ? { ...s, aktif: false } : s));
  const batal = mk('A', 'S01', 'CANCEL');
  const idx = new AvailabilityIndex([batal]);
  assert.equal(checkStatusChange(idx, batal, 'PENDING', slots).ok, true);
  assert.equal(checkCapacity(idx, { tarikh: D, slotIds: ['S01'] }, slots).conflicts[0].kod, 'tidak-aktif');
});

test('edit tempahan: slot sendiri tidak dikira bertembung dengan dirinya', () => {
  const slots = seedSlots('raya');
  const a = mk('A', 'S01, S02');
  const idx = new AvailabilityIndex([a]);
  assert.equal(checkCapacity(idx, { tarikh: D, slotIds: ['S02', 'S03'] }, slots).ok, false);
  assert.equal(checkCapacity(idx, { tarikh: D, slotIds: ['S02', 'S03'] }, slots, { exclude: a }).ok, true);
  // tarikh lain: pengecualian tidak terpakai
  const idx2 = new AvailabilityIndex([a, mk('B', 'S05', 'PENDING', '2027-03-06')]);
  assert.equal(checkCapacity(idx2, { tarikh: '2027-03-06', slotIds: ['S05'] }, slots, { exclude: a }).ok, false);
});

test('slot tidak wujud atau tidak aktif ditolak', () => {
  const slots = seedSlots('raya').map((s) => (s.slot_id === 'S02' ? { ...s, aktif: false } : s));
  const idx = new AvailabilityIndex();
  const r = checkCapacity(idx, { tarikh: D, slotIds: ['S02', 'S99'] }, slots);
  assert.deepEqual(r.conflicts, [{ slot_id: 'S02', kod: 'tidak-aktif' }, { slot_id: 'S99', kod: 'tiada' }]);
});

test('slotAvailability: hanya slot aktif, ikut susunan, penanda penuh, tiada PII', () => {
  const slots = seedSlots('raya').map((s) => (s.slot_id === 'S02' ? { ...s, aktif: false } : s.slot_id === 'S03' ? { ...s, kapasiti: 2 } : s));
  const idx = new AvailabilityIndex([mk('A', 'S01'), mk('B', 'S03'), { ...mk('C', 'S04'), nama: 'Rahsia' }]);
  const av = slotAvailability(D, slots, idx);
  assert.equal(av.length, 25);
  assert.ok(!av.find((a) => a.slot_id === 'S02'));
  assert.equal(av[0].slot_id, 'S01');
  assert.equal(av[0].penuh, true);
  const s3 = av.find((a) => a.slot_id === 'S03');
  assert.deepEqual([s3.terisi, s3.tinggal, s3.penuh], [1, 1, false]);
  assert.ok(!JSON.stringify(av).includes('Rahsia'));
});

test('groupByKumpulan: Pagi, Petang, Malam mengikut susunan', () => {
  const g = groupByKumpulan(slotAvailability(D, seedSlots('raya'), new AvailabilityIndex()));
  assert.deepEqual(g.map((x) => [x.kumpulan, x.slots.length]), [['Pagi', 9], ['Petang', 11], ['Malam', 6]]);
});

test('slotIdList: rentetan koma atau array', () => {
  assert.deepEqual(slotIdList('S01, S02,S03 ,'), ['S01', 'S02', 'S03']);
  assert.deepEqual(slotIdList([' S01 ', 'S02']), ['S01', 'S02']);
  assert.deepEqual(slotIdList(null), []);
});

test('checkDate: lampau, tutup dengan sebab, tidak sah, hari ini dibenarkan', () => {
  const closed = { '2027-03-10': 'Cuti umum' };
  assert.equal(checkDate('2027-03-04', '2027-03-05', closed).kod, 'lampau');
  assert.equal(checkDate('2027-03-05', '2027-03-05', closed).ok, true);
  const t = checkDate('2027-03-10', '2027-03-05', closed);
  assert.deepEqual([t.kod, t.sebab], ['tutup', 'Cuti umum']);
  assert.equal(checkDate('2027-03-10', '2027-03-05', new Map([['2027-03-10', 'x']])).kod, 'tutup');
  assert.equal(checkDate('2027-02-30', '2027-03-05').kod, 'tidak-sah');
});

test('indeks: remove tidak menjadikan kiraan negatif', () => {
  const idx = new AvailabilityIndex();
  idx.remove(mk('A', 'S01'));
  assert.equal(idx.count(D, 'S01'), 0);
  assert.equal(idx.counts.size, 0);
});

test('kapasiti hilang/rosak dianggap 1, tidak pernah tanpa had (elak double booking senyap)', () => {
  for (const kap of [undefined, null, 0, -2, 1.5, 'abc', NaN]) {
    assert.equal(kapasitiSlot({ kapasiti: kap }), 1, String(kap));
    const slots = [{ slot_id: 'S01', label: 'x', kumpulan: 'Pagi', susunan: 1, aktif: true, kapasiti: kap }];
    const idx = new AvailabilityIndex();
    assert.equal(cuba(idx, slots, mk('A', ['S01'])).ok, true);
    assert.equal(cuba(idx, slots, mk('B', ['S01'])).ok, false, 'kapasiti=' + String(kap));
    assert.equal(slotAvailability(D, slots, idx)[0].penuh, true);
  }
  assert.equal(kapasitiSlot({ kapasiti: 3 }), 3);
});
