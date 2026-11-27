// Aritmetik tarikh tulen (YYYY-MM-DD). Semua dalam UTC supaya tidak terkesan zon masa mesin.
// Tiada kebergantungan. Boleh dipakai oleh Node, Worker dan pelayar.

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function parseDate(s) {
  const m = RE.exec(String(s));
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

export function isValidDate(s) {
  return parseDate(s) !== null;
}

export function formatDate(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function toMs(s) {
  const p = parseDate(s);
  if (!p) throw new Error('Tarikh tidak sah: ' + s);
  return Date.UTC(p.y, p.m - 1, p.d);
}

export function addDays(s, n) {
  const dt = new Date(toMs(s) + n * 86400000);
  return formatDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

// a - b dalam bilangan hari penuh
export function diffDays(a, b) {
  return Math.round((toMs(a) - toMs(b)) / 86400000);
}

// Tambah bulan dengan "sauh" hari-dalam-bulan: 31 Jan + 1 bulan = 28/29 Feb, bulan seterusnya kembali 31.
export function addMonths(s, months, anchorDay) {
  const p = parseDate(s);
  if (!p) throw new Error('Tarikh tidak sah: ' + s);
  const day = Number.isInteger(anchorDay) && anchorDay >= 1 && anchorDay <= 31 ? anchorDay : p.d;
  const total = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (((total % 12) + 12) % 12) + 1;
  return formatDate(y, m, Math.min(day, daysInMonth(y, m)));
}

// Nombor siri Google Sheets (hari sejak 30/12/1899) -> YYYY-MM-DD. Studio mungkin menaip tarikh sendiri dalam Sheet.
export function serialToDate(n) {
  if (typeof n !== 'number' || !isFinite(n)) return '';
  const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return formatDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
