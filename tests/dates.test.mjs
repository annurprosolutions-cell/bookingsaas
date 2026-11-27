import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, addMonths, diffDays, isValidDate, parseDate, daysInMonth, serialToDate } from '../js/core/dates.js';

test('isValidDate: kalendar sebenar', () => {
  assert.equal(isValidDate('2027-03-09'), true);
  assert.equal(isValidDate('2028-02-29'), true);
  assert.equal(isValidDate('2027-02-29'), false);
  assert.equal(isValidDate('2027-02-30'), false);
  assert.equal(isValidDate('2027-13-01'), false);
  assert.equal(isValidDate('2027-3-9'), false);
  assert.equal(isValidDate('09/03/2027'), false);
  assert.equal(isValidDate(''), false);
  assert.equal(isValidDate(undefined), false);
});

test('daysInMonth dan tahun lompat', () => {
  assert.equal(daysInMonth(2027, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
});

test('addDays dan diffDays merentas bulan/tahun', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(diffDays('2027-03-09', '2027-03-01'), 8);
  assert.equal(diffDays('2027-03-01', '2027-03-09'), -8);
  assert.equal(diffDays('2027-01-01', '2026-01-01'), 365);
});

test('addMonths: 31 Jan + 1 bulan = 28 Feb (biasa) dan 29 Feb (lompat)', () => {
  assert.equal(addMonths('2027-01-31', 1, 31), '2027-02-28');
  assert.equal(addMonths('2028-01-31', 1, 31), '2028-02-29');
});

test('addMonths: sauh kembali ke 31 bulan seterusnya', () => {
  assert.equal(addMonths('2027-02-28', 1, 31), '2027-03-31');
  assert.equal(addMonths('2027-03-31', 1, 31), '2027-04-30');
  assert.equal(addMonths('2027-04-30', 1, 31), '2027-05-31');
});

test('addMonths: merentas tahun dan 12 bulan', () => {
  assert.equal(addMonths('2026-11-15', 3, 15), '2027-02-15');
  assert.equal(addMonths('2027-02-28', 12, 31), '2028-02-29');
  assert.equal(addMonths('2026-12-10', 1), '2027-01-10');
  assert.equal(addMonths('2027-05-10', 120, 10), '2037-05-10');
});

test('serialToDate: nombor siri Sheets', () => {
  assert.equal(serialToDate(diffDays('2027-03-09', '1899-12-30')), '2027-03-09');
  assert.equal(serialToDate(1), '1899-12-31');
  assert.equal(serialToDate('x'), '');
  assert.deepEqual(parseDate('2027-03-09'), { y: 2027, m: 3, d: 9 });
});
