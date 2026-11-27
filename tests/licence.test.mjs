import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  trialExpiry, startTrial, validateLicence, extendLicence, planFromItems, licenceStatus
} from '../js/core/licence.js';

test('trial: hari ini + 13 hari (14 hari termasuk hari ini)', () => {
  assert.equal(trialExpiry('2026-12-01', 14), '2026-12-14');
  assert.equal(trialExpiry('2026-12-25', 14), '2027-01-07');
  assert.equal(trialExpiry('2026-12-01', 0), null);
  assert.equal(trialExpiry('2026-12-01', '0'), null);
});

test('startTrial: penanda trial menghalang trial berulang; TRIAL_DAYS=0 matikan trial', () => {
  const t = startTrial({ today: '2026-12-01', shop: 'Studio A', nowIso: 'x' });
  assert.equal(t.plan, 'percubaan');
  assert.equal(t.expires, '2026-12-14');
  assert.equal(t.day, 14);
  assert.equal(startTrial({ today: '2026-12-01', trialMarker: '2026-11-01' }), null);
  assert.equal(startTrial({ today: '2026-12-01', trialDays: 0 }), null);
});

test('validateLicence: tanpa tarikh luput ditolak', () => {
  assert.equal(validateLicence({ plan: 'bulanan' }).ok, false);
  assert.equal(validateLicence({ plan: 'bulanan', expires: '2027-02-30' }).ok, false);
  assert.equal(validateLicence({ plan: 'lain', expires: '2027-02-28' }).ok, false);
  assert.equal(validateLicence({ plan: 'bulanan', expires: '2027-02-28', day: 40 }).ok, false);
  assert.equal(validateLicence({ plan: 'tahunan', expires: '2027-02-28', day: 31 }).ok, true);
  assert.equal(validateLicence(null).ok, false);
});

test('lanjutan: 31 Jan + 1 bulan = 28/29 Feb, bulan seterusnya kembali 31', () => {
  const a = extendLicence(null, 1, '2027-01-31');
  assert.deepEqual(a, { expires: '2027-02-28', day: 31 });
  const b = extendLicence({ plan: 'bulanan', ...a }, 1, '2027-02-20');
  assert.deepEqual(b, { expires: '2027-03-31', day: 31 });
  const leap = extendLicence(null, 1, '2028-01-31');
  assert.equal(leap.expires, '2028-02-29');
  assert.equal(extendLicence({ plan: 'bulanan', ...leap }, 1, '2028-02-10').expires, '2028-03-31');
});

test('lanjutan: dari tarikh luput semasa jika masih aktif', () => {
  const r = extendLicence({ plan: 'bulanan', expires: '2027-03-10', day: 10 }, 1, '2027-03-01');
  assert.equal(r.expires, '2027-04-10');
});

test('lanjutan: hari terakhir sah masih dikira aktif', () => {
  const r = extendLicence({ plan: 'bulanan', expires: '2027-03-10', day: 10 }, 1, '2027-03-10');
  assert.equal(r.expires, '2027-04-10');
});

test('lanjutan: dari hari ini jika sudah luput, sauh baharu mengikut hari ini', () => {
  const r = extendLicence({ plan: 'bulanan', expires: '2027-01-10', day: 10 }, 1, '2027-03-05');
  assert.deepEqual(r, { expires: '2027-04-05', day: 5 });
});

test('lanjutan: tahunan dari 28 Feb sauh 31 -> 29 Feb tahun lompat', () => {
  const r = extendLicence({ plan: 'tahunan', expires: '2027-02-28', day: 31 }, 12, '2027-02-01');
  assert.equal(r.expires, '2028-02-29');
});

test('lanjutan: bulan mesti integer >= 1', () => {
  assert.throws(() => extendLicence(null, 0, '2027-01-01'));
  assert.throws(() => extendLicence(null, 1.5, '2027-01-01'));
});

test('plan dari item BCL: kuantiti didarab bulan', () => {
  assert.deepEqual(planFromItems([{ name: 'ANNUR BOOKING BULANAN', quantity: 3 }]), { plan: 'bulanan', months: 3 });
  assert.deepEqual(planFromItems([{ name: 'ANNUR BOOKING TAHUNAN', quantity: 2 }]), { plan: 'tahunan', months: 24 });
  assert.deepEqual(planFromItems([{ name: 'ANNUR BOOKING BULANAN', quantity: 1 }]), { plan: 'bulanan', months: 1 });
});

test('plan dari item BCL: had 120 bulan setiap item', () => {
  assert.equal(planFromItems([{ name: 'TAHUNAN', quantity: 11 }]).months, 120);
  assert.equal(planFromItems([{ name: 'BULANAN', quantity: 500 }]).months, 120);
  assert.equal(planFromItems([{ name: 'TAHUNAN', quantity: 11 }, { name: 'BULANAN', quantity: 2 }]).months, 122);
});

test('plan dari item BCL: campuran, kuantiti tak sah, dan nama tidak dikenali (fallback jumlah)', () => {
  assert.deepEqual(planFromItems([{ name: 'BULANAN', quantity: 2 }, { name: 'TAHUNAN', quantity: 1 }]), { plan: 'tahunan', months: 14 });
  assert.equal(planFromItems([{ name: 'BULANAN', quantity: 0 }]).months, 1);
  assert.equal(planFromItems([{ name: 'BULANAN', quantity: 'abc' }]).months, 1);
  assert.deepEqual(planFromItems([{ name: 'Item pelik' }], 1000), { plan: 'tahunan', months: 12 });
  assert.deepEqual(planFromItems([], 150), { plan: 'tahunan', months: 12 });
  assert.deepEqual(planFromItems([], 149.99), { plan: 'bulanan', months: 1 });
  assert.deepEqual(planFromItems([{ name: 'Item pelik' }], 100), { plan: 'bulanan', months: 1 });
});

test('status: tiada licence atau tanpa tarikh luput', () => {
  for (const rec of [null, undefined, {}, { plan: 'bulanan' }]) {
    const s = licenceStatus(rec, '2027-01-01');
    assert.equal(s.state, 'tiada');
    assert.equal(s.allowed, false);
    assert.equal(s.reason, 'tiada');
  }
});

test('status trial: info > 7 hari, amaran <= 7, mendesak <= 3', () => {
  const rec = { plan: 'percubaan', expires: '2027-01-14' };
  assert.equal(licenceStatus(rec, '2027-01-01').notice.level, 'info');
  assert.equal(licenceStatus(rec, '2027-01-06').notice.level, 'info'); // 8 hari lagi
  assert.equal(licenceStatus(rec, '2027-01-07').notice.level, 'warning'); // 7 hari lagi
  assert.equal(licenceStatus(rec, '2027-01-11').notice.level, 'urgent'); // 3 hari lagi
  const last = licenceStatus(rec, '2027-01-14');
  assert.equal(last.state, 'aktif');
  assert.equal(last.daysLeft, 0);
  assert.equal(last.allowed, true);
});

test('status trial: tamat terus tanpa grace', () => {
  const s = licenceStatus({ plan: 'percubaan', expires: '2027-01-14' }, '2027-01-15');
  assert.equal(s.state, 'tamat');
  assert.equal(s.allowed, false);
  assert.equal(s.reason, 'percubaan-tamat');
  assert.equal(s.notice.level, 'critical');
});

test('status berbayar: tiada notis > 7 hari, amaran <= 7, mendesak <= 3', () => {
  const rec = { plan: 'bulanan', expires: '2027-02-28' };
  assert.equal(licenceStatus(rec, '2027-02-10').notice, null);
  assert.equal(licenceStatus(rec, '2027-02-21').notice.level, 'warning');
  assert.equal(licenceStatus(rec, '2027-02-25').notice.level, 'urgent');
});

test('status berbayar: grace 7 hari selepas luput, hari ke-8 tamat', () => {
  const rec = { plan: 'bulanan', expires: '2027-02-28' };
  const g1 = licenceStatus(rec, '2027-03-01');
  assert.equal(g1.state, 'grace');
  assert.equal(g1.allowed, true);
  assert.equal(licenceStatus(rec, '2027-03-07').state, 'grace');
  const t = licenceStatus(rec, '2027-03-08');
  assert.equal(t.state, 'tamat');
  assert.equal(t.allowed, false);
  assert.equal(t.reason, 'tamat');
  assert.equal(licenceStatus({ plan: 'pilot', expires: '2027-02-28' }, '2027-03-05').state, 'grace');
  assert.equal(licenceStatus(rec, '2027-03-03', { graceDays: 2 }).state, 'tamat');
});
