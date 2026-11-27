// Logik licence (BSD seksyen 3, `email:<email>`). Fungsi tulen: semua menerima `today` (YYYY-MM-DD, zon Asia/Kuala_Lumpur)
// supaya ujian tidak bergantung pada jam sebenar.
//
// Peraturan:
// - Trial = hari ini + 13 hari (14 hari termasuk hari ini). TRIAL_DAYS=0 bermakna tiada trial.
// - Grace 7 hari selepas luput untuk plan berbayar sahaja. Trial tamat terus.
// - Lanjutan bermula dari tarikh luput semasa jika masih aktif, jika tidak dari hari ini.
// - Bulan ditambah dengan "sauh" hari-dalam-bulan (31 Jan + 1 bulan = 28/29 Feb, seterusnya kembali 31).
// - Kuantiti item BCL didarab bulan, hadkan 120 bulan setiap item.
// - Licence tanpa tarikh luput ditolak.

import { addDays, addMonths, diffDays, isValidDate, parseDate } from './dates.js';

export const PLANS = ['percubaan', 'bulanan', 'tahunan', 'pilot'];
export const PAID_PLANS = ['bulanan', 'tahunan', 'pilot'];
export const DEFAULT_TRIAL_DAYS = 14;
export const DEFAULT_GRACE_DAYS = 7;
export const MAX_MONTHS_PER_ITEM = 120;
export const YEARLY_MIN_AMOUNT = 150;

export const isPaidPlan = (plan) => PAID_PLANS.includes(plan);

// ---- trial ----
// Tarikh terakhir sah bagi trial yang bermula hari ini. trialDays <= 0 -> null (tiada trial).
export function trialExpiry(today, trialDays = DEFAULT_TRIAL_DAYS) {
  const n = Number(trialDays);
  if (!Number.isInteger(n) || n <= 0) return null;
  return addDays(today, n - 1);
}

// Cipta rekod trial, atau null jika tidak layak (penanda trial wujud atau trial dimatikan).
export function startTrial({ today, trialMarker, trialDays = DEFAULT_TRIAL_DAYS, shop = '', nowIso = '' }) {
  if (trialMarker) return null;
  const expires = trialExpiry(today, trialDays);
  if (!expires) return null;
  return { shop, plan: 'percubaan', expires, day: parseDate(expires).d, updatedAt: nowIso };
}

// ---- pengesahan rekod ----
export function validateLicence(rec) {
  const errors = [];
  if (!rec || typeof rec !== 'object') return { ok: false, errors: ['rekod kosong'] };
  if (!PLANS.includes(rec.plan)) errors.push('plan tidak sah');
  if (!rec.expires) errors.push('tarikh luput wajib (licence tanpa tarikh luput ditolak)');
  else if (!isValidDate(rec.expires)) errors.push('tarikh luput tidak sah');
  if (rec.day !== undefined && !(Number.isInteger(rec.day) && rec.day >= 1 && rec.day <= 31)) errors.push('day mesti 1..31');
  return { ok: errors.length === 0, errors };
}

// ---- lanjutan ----
// Pulangkan { expires, day }. `rec` boleh null (belum ada licence).
export function extendLicence(rec, months, today) {
  if (!Number.isInteger(months) || months < 1) throw new Error('months mesti integer >= 1');
  const active = !!(rec && rec.expires && isValidDate(rec.expires) && rec.expires >= today);
  const base = active ? rec.expires : today;
  const day = active && Number.isInteger(rec.day) ? rec.day : parseDate(base).d;
  return { expires: addMonths(base, months, day), day };
}

// ---- plan dari item BCL ----
// items: [{ name, quantity }]. amount: jumlah transaksi (RM) untuk fallback bila nama item tidak dikenali.
export function planFromItems(items, amount, yearlyMinAmount = YEARLY_MIN_AMOUNT) {
  let months = 0;
  let yearly = false;
  let recognised = false;
  for (const it of items || []) {
    const name = String((it && it.name) || '');
    const qty = Math.max(1, Math.trunc(Number(it && it.quantity)) || 1);
    let per = 0;
    if (/tahunan|yearly|setahun/i.test(name)) per = 12;
    else if (/bulanan|monthly|sebulan/i.test(name)) per = 1;
    if (!per) continue;
    recognised = true;
    if (per === 12) yearly = true;
    months += Math.min(per * qty, MAX_MONTHS_PER_ITEM);
  }
  if (recognised) return { plan: yearly ? 'tahunan' : 'bulanan', months };
  const a = Number(amount);
  if (isFinite(a) && a >= yearlyMinAmount) return { plan: 'tahunan', months: 12 };
  return { plan: 'bulanan', months: 1 };
}

// ---- status semasa ----
// Pulangkan:
// { state: 'aktif'|'grace'|'tamat'|'tiada', allowed, daysLeft, reason, notice }
// allowed = boleh tulis (aktif atau grace). Baca dan export sentiasa dibenarkan oleh pemanggil.
// reason (bila !allowed): 'tiada' | 'tamat' | 'percubaan-tamat'
// notice: { level: 'info'|'warning'|'urgent'|'critical', kod } atau null
export function licenceStatus(rec, today, { graceDays = DEFAULT_GRACE_DAYS } = {}) {
  if (!rec || !rec.expires || !isValidDate(rec.expires)) {
    return { state: 'tiada', allowed: false, daysLeft: null, reason: 'tiada', notice: { level: 'critical', kod: 'tiada' } };
  }
  const daysLeft = diffDays(rec.expires, today); // 0 = hari terakhir sah
  const trial = rec.plan === 'percubaan';

  if (daysLeft >= 0) {
    let notice = null;
    if (daysLeft <= 3) notice = { level: 'urgent', kod: trial ? 'percubaan-hampir-luput' : 'hampir-luput' };
    else if (daysLeft <= 7) notice = { level: 'warning', kod: trial ? 'percubaan-hampir-luput' : 'hampir-luput' };
    else if (trial) notice = { level: 'info', kod: 'percubaan' };
    return { state: 'aktif', allowed: true, daysLeft, reason: null, notice };
  }

  if (isPaidPlan(rec.plan) && -daysLeft <= graceDays) {
    return { state: 'grace', allowed: true, daysLeft, reason: null, notice: { level: 'urgent', kod: 'grace' } };
  }

  const reason = trial ? 'percubaan-tamat' : 'tamat';
  return { state: 'tamat', allowed: false, daysLeft, reason, notice: { level: 'critical', kod: reason } };
}
