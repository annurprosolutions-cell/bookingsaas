// Tema studio (DBD B3): --brand dari tetapan, --brand-dark (gelap 35%), --brand-soft (8% brand + putih).
const isHex = (s) => /^#[0-9A-Fa-f]{6}$/.test(s || '');
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (a) => '#' + a.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('').toUpperCase();

export const darken = (hex, p) => toHex(rgb(hex).map((c) => c * (1 - p)));
export const mixWhite = (hex, p) => toHex(rgb(hex).map((c) => c * p + 255 * (1 - p)));

export function applyBrand(hex, el = document.documentElement) {
  const b = isHex(hex) ? hex.toUpperCase() : '#2563EB';
  el.style.setProperty('--brand', b);
  el.style.setProperty('--brand-dark', darken(b, 0.35));
  el.style.setProperty('--brand-soft', mixWhite(b, 0.08));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && el === document.documentElement) meta.setAttribute('content', b);
  return b;
}

// Preset tema. "Oren Studio" ialah warna Wakanda (kontras < 4.5:1, sistem beri amaran + cadangan).
export const PRESETS = [
  { nama: 'Biru Annur', hex: '#2563EB' },
  { nama: 'Oren Studio', hex: '#F97316' },
  { nama: 'Hijau Teal', hex: '#0F766E' },
  { nama: 'Ungu', hex: '#7C3AED' },
  { nama: 'Merah Jambu', hex: '#DB2777' },
  { nama: 'Hitam', hex: '#111827' }
];
