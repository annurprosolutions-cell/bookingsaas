// Pengesahan input (TRD seksyen 6, BSD seksyen 4). Fungsi tulen, mesej ralat dalam Bahasa Malaysia.
// Server MESTI menjalankan semua semakan ini; semakan di klien hanyalah kemudahan.

import { isValidDate } from './dates.js';
import { TETAPAN_SPEC, TETAPAN_KEYS, STATUS_TEMPAHAN } from './sheet-schema.js';

export const STATUSES = STATUS_TEMPAHAN;
export const isStatus = (s) => STATUS_TEMPAHAN.includes(s);

// ---- teks ----
// Buang aksara kawalan, ringkaskan ruang putih, potong hujung. Bukan rentetan -> ''.
export function cleanText(v, { multiline = false } = {}) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  let s = v.replace(multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, ' ');
  if (multiline) s = s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').trim();
  else s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// ---- telefon ----
// "012-345 6789" / "+6012 3456789" / "0123456789" -> "60123456789"
export function normalizePhone(v) {
  let d = String(v ?? '').replace(/[^0-9]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '60' + d.slice(1);
  return d;
}
export const isValidPhone = (d) => /^[0-9]{9,13}$/.test(d);

// Nombor WhatsApp studio: 60 + 8 hingga 11 digit
export const isValidWhatsapp = (d) => /^60[0-9]{8,11}$/.test(d);

export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(s);

export function isHttpsUrl(s) {
  if (typeof s !== 'string' || s.length > 2048) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' && !!u.hostname;
  } catch {
    return false;
  }
}

// ---- warna (DBD B3: kontras teks putih pada butang >= 4.5:1) ----
export const isHexColour = (s) => typeof s === 'string' && /^#[0-9A-Fa-f]{6}$/.test(s);

function luminance(hex) {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = ch.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastWithWhite(hex) {
  if (!isHexColour(hex)) return 0;
  return 1.05 / (luminance(hex) + 0.05);
}
export const contrastOk = (hex) => contrastWithWhite(hex) >= 4.5;

// Cadangan warna lebih gelap dengan kontras >= 4.5:1 (DBD B3). Warna yang sudah lulus dikembalikan seperti asal.
export function suggestAccessibleColour(hex) {
  if (!isHexColour(hex)) return null;
  let rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const toHex = (a) => '#' + a.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
  for (let i = 0; i < 60 && !contrastOk(toHex(rgb)); i++) rgb = rgb.map((c) => Math.floor(c * 0.95));
  return toHex(rgb);
}

// ---- slug (TRD seksyen 4) ----
export const RESERVED_SLUGS = [
  'admin', 'app', 'api', 'daftar', 'login', 'platform', 'privasi', 'terma', 'panduan', 'demo', 'salepage', 'static',
  'assets', 'bcl', 'sw', 'manifest', 'css', 'js', 'tools', 'docs',
  // laluan statik sebenar dalam repo ini
  'fonts', 'icons', 'robots', 'favicon'
];
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{1,28})[a-z0-9]$/;

export function validateSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    return { ok: false, kod: 'format', mesej: 'Guna 3 hingga 30 huruf kecil, nombor atau sengkang (-). Mesti bermula dan berakhir dengan huruf atau nombor.' };
  }
  if (RESERVED_SLUGS.includes(slug)) return { ok: false, kod: 'reserved', mesej: 'Nama ini dikhaskan oleh sistem. Pilih nama lain.' };
  return { ok: true };
}

// Cadangan slug dari nama studio (wizard langkah 1)
export function suggestSlug(name) {
  const s = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
  return s;
}

// ---- Ref ID tempahan (BSD 4: AB- + 6 aksara) ----
export const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const isValidRef = (s) => typeof s === 'string' && /^AB-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(s);

function defaultRng(n) {
  const u8 = new Uint8Array(n);
  crypto.getRandomValues(u8);
  return u8;
}

// `taken` = Set (atau objek dengan .has) bagi Ref sedia ada. Ulang sehingga tidak bertembung.
// `rng(n)` boleh disuntik untuk ujian; mesti memulangkan n bait.
export function generateRef(taken = new Set(), rng = defaultRng, maxTries = 50) {
  const n = REF_ALPHABET.length; // 32 -> 256 % 32 == 0, tiada bias
  for (let t = 0; t < maxTries; t++) {
    const b = rng(6);
    let ref = 'AB-';
    for (let i = 0; i < 6; i++) ref += REF_ALPHABET[b[i] % n];
    if (!taken.has(ref)) return ref;
  }
  throw new Error('Tidak dapat menjana Ref unik');
}

// ---- integer dari input JSON (nombor atau rentetan digit) ----
function toInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  if (typeof v === 'string' && /^-?[0-9]{1,6}$/.test(v.trim())) return parseInt(v, 10);
  return null;
}

// ---- tarikh tempahan ----
// closed = Map atau objek { 'YYYY-MM-DD': sebab }. Pulangkan { ok } atau { ok:false, kod, sebab? }
export function checkBookingDate(date, today, closed = {}) {
  if (!isValidDate(date)) return { ok: false, kod: 'tidak-sah' };
  if (date < today) return { ok: false, kod: 'lampau' };
  const sebab = closed instanceof Map ? closed.get(date) : closed[date];
  if (sebab !== undefined) return { ok: false, kod: 'tutup', sebab: sebab || '' };
  return { ok: true };
}

// ---- input tempahan awam ----
// raw: badan JSON dari klien. ctx: { today, maksDewasa, tempahanAktif }
// Padanan slot/add-on dengan Sheet dan kapasiti dibuat dalam pricing.js dan availability.js.
// Medan seperti jumlah/harga/status/ref dari klien DIABAIKAN (tidak disalin ke value).
export function validateBookingInput(raw, ctx) {
  const errors = {};
  const r = raw && typeof raw === 'object' ? raw : {};
  const maksDewasa = ctx.maksDewasa ?? 10;

  const nama = cleanText(r.nama);
  if (!nama) errors.nama = 'Sila isi nama.';
  else if (nama.length > 80) errors.nama = 'Nama terlalu panjang (maksimum 80 aksara).';

  const telefon = normalizePhone(r.telefon);
  if (!isValidPhone(telefon)) errors.telefon = 'Nombor telefon tidak sah (9 hingga 13 digit).';

  let emel = '';
  if (r.emel !== undefined && r.emel !== null && String(r.emel).trim() !== '') {
    emel = typeof r.emel === 'string' ? r.emel.trim() : '';
    if (!isEmail(emel)) errors.emel = 'Format emel tidak sah.';
  }

  const tarikh = typeof r.tarikh === 'string' ? r.tarikh : '';
  const dt = checkBookingDate(tarikh, ctx.today, ctx.closed || {});
  if (!dt.ok) {
    errors.tarikh =
      dt.kod === 'lampau' ? 'Tarikh sudah lepas.' : dt.kod === 'tutup' ? dt.sebab || 'Tarikh ini ditutup.' : 'Tarikh tidak sah.';
  }

  let slotIds = [];
  if (!Array.isArray(r.slot_ids) || r.slot_ids.length === 0) errors.slot_ids = 'Sila pilih sekurang-kurangnya satu slot.';
  else if (r.slot_ids.length > 50 || !r.slot_ids.every((s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(s))) {
    errors.slot_ids = 'Pilihan slot tidak sah.';
  } else if (new Set(r.slot_ids).size !== r.slot_ids.length) errors.slot_ids = 'Slot yang sama dipilih lebih dari sekali.';
  else slotIds = r.slot_ids.slice();

  let addonIds = [];
  if (r.addon_ids !== undefined && r.addon_ids !== null) {
    if (!Array.isArray(r.addon_ids) || r.addon_ids.length > 50 || !r.addon_ids.every((s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(s))) {
      errors.addon_ids = 'Pilihan add-on tidak sah.';
    } else if (new Set(r.addon_ids).size !== r.addon_ids.length) errors.addon_ids = 'Add-on yang sama dipilih lebih dari sekali.';
    else addonIds = r.addon_ids.slice();
  }

  const dewasa = toInt(r.dewasa ?? 1);
  if (dewasa === null || dewasa < 1 || dewasa > maksDewasa) errors.dewasa = `Bilangan dewasa mesti 1 hingga ${maksDewasa}.`;
  const kanak = toInt(r.kanak ?? 0);
  if (kanak === null || kanak < 0 || kanak > 20) errors.kanak = 'Bilangan kanak-kanak mesti 0 hingga 20.';

  const catatan = r.catatan === undefined || r.catatan === null ? '' : cleanText(r.catatan);
  if (catatan.length > 200) errors.catatan = 'Catatan terlalu panjang (maksimum 200 aksara).';

  if (r.pdpa !== true) errors.pdpa = 'Sila setuju dengan notis privasi untuk meneruskan.';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { nama, telefon, emel, tarikh, slot_ids: slotIds, addon_ids: addonIds, dewasa, kanak, catatan } };
}

// ---- semak status (Ref + telefon) ----
export function validateStatusQuery(raw) {
  const ref = typeof raw?.ref === 'string' ? raw.ref.trim().toUpperCase() : '';
  const telefon = normalizePhone(raw?.telefon);
  if (!isValidRef(ref) || !isValidPhone(telefon)) return { ok: false };
  return { ok: true, ref, telefon };
}

// ---- review awam ----
export function validateReviewInput(raw) {
  const errors = {};
  const r = raw && typeof raw === 'object' ? raw : {};
  const nama = cleanText(r.nama);
  if (!nama) errors.nama = 'Sila isi nama.';
  else if (nama.length > 40) errors.nama = 'Nama terlalu panjang (maksimum 40 aksara).';
  const bintang = toInt(r.bintang);
  if (bintang === null || bintang < 1 || bintang > 5) errors.bintang = 'Sila pilih 1 hingga 5 bintang.';
  const komen = cleanText(r.komen, { multiline: true });
  if (!komen) errors.komen = 'Sila isi komen.';
  else if (komen.length > 500) errors.komen = 'Komen terlalu panjang (maksimum 500 aksara).';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { nama, bintang, komen } };
}

// ---- tetapan studio (BSD 4: tab Tetapan) ----
// partial=true untuk PUT sebahagian. Kunci tidak dikenali ditolak. Kembalikan nilai bertaip yang bersih.
export function validateTetapan(input, { partial = false } = {}) {
  const errors = {};
  const warnings = {};
  const value = {};
  const src = input && typeof input === 'object' ? input : {};

  for (const k of Object.keys(src)) if (!TETAPAN_KEYS.includes(k)) errors[k] = 'Tetapan tidak dikenali.';

  for (const key of TETAPAN_KEYS) {
    const spec = TETAPAN_SPEC[key];
    const has = src[key] !== undefined && src[key] !== null && !(typeof src[key] === 'string' && src[key].trim() === '' && spec.required);
    if (!has) {
      if (spec.required && !partial) errors[key] = 'Wajib diisi.';
      else if (spec.required && partial && key in src) errors[key] = 'Wajib diisi.';
      continue;
    }
    const v = src[key];
    switch (spec.type) {
      case 'text':
      case 'ml': {
        const s = cleanText(typeof v === 'string' ? v : String(v), { multiline: spec.type === 'ml' });
        if (spec.max && s.length > spec.max) errors[key] = `Maksimum ${spec.max} aksara.`;
        else value[key] = s;
        break;
      }
      case 'url': {
        const s = typeof v === 'string' ? v.trim() : '';
        if (s === '') value[key] = '';
        else if (!isHttpsUrl(s)) errors[key] = 'Mesti pautan https:// yang sah.';
        else value[key] = s;
        break;
      }
      case 'hex': {
        const s = typeof v === 'string' ? v.trim().toUpperCase() : '';
        if (!isHexColour(s)) errors[key] = 'Format warna mesti #RRGGBB.';
        else {
          value[key] = s;
          // DBD B3: kontras rendah ialah AMARAN + cadangan, bukan penolakan (preset "Oren Studio" #F97316 pun < 4.5:1).
          if (!contrastOk(s)) {
            warnings[key] = {
              mesej: 'Teks putih pada warna ini sukar dibaca. Cuba warna yang lebih gelap.',
              kontras: Math.round(contrastWithWhite(s) * 100) / 100,
              cadangan: suggestAccessibleColour(s)
            };
          }
        }
        break;
      }
      case 'wa': {
        const d = normalizePhone(v);
        if (!isValidWhatsapp(d)) errors[key] = 'Nombor WhatsApp tidak sah. Contoh: 0123456789.';
        else value[key] = d;
        break;
      }
      case 'number': {
        if (typeof v === 'string' && v.trim() === '') {
          // Dikosongkan: guna nilai lalai (cth harga_special ikut harga_normal)
          value[key] = '';
          break;
        }
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim().replace(/^RM/i, '').replace(/,/g, '')) : NaN;
        if (!isFinite(n) || n < (spec.min ?? 0) || n > 1000000) errors[key] = 'Mesti nombor 0 atau lebih.';
        else value[key] = Math.round((n + Number.EPSILON) * 100) / 100;
        break;
      }
      case 'int': {
        if (typeof v === 'string' && v.trim() === '') {
          value[key] = '';
          break;
        }
        const n = toInt(v);
        if (n === null || n < (spec.min ?? 0) || (spec.max !== undefined && n > spec.max)) {
          errors[key] = spec.max !== undefined ? `Mesti nombor bulat ${spec.min} hingga ${spec.max}.` : `Mesti nombor bulat ${spec.min ?? 0} atau lebih.`;
        } else value[key] = n;
        break;
      }
      case 'bool': {
        if (typeof v === 'boolean') value[key] = v;
        else if (v === 'TRUE' || v === 'FALSE') value[key] = v === 'TRUE';
        else errors[key] = 'Mesti ya atau tidak.';
        break;
      }
      default:
        break;
    }
  }

  if (Object.keys(errors).length) return { ok: false, errors, warnings };
  return { ok: true, value, warnings };
}

// ---- pautan imej (TRD 8) ----
// Pautan kongsi Google Drive sering disekat bila dipaparkan terus; tukar kepada format thumbnail.
export function normalizeImageUrl(url) {
  const u = typeof url === 'string' ? url.trim() : '';
  if (!u) return '';
  const m =
    /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})/.exec(u) ||
    /^https:\/\/drive\.google\.com\/(?:open|uc|thumbnail)\?(?:.*&)?id=([A-Za-z0-9_-]{10,})/.exec(u);
  return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w1600` : u;
}

// ---- wizard setup (S-03, AFD A3) ----
export const WIZARD_TETAPAN_KEYS = [
  'nama_studio', 'whatsapp', 'alamat', 'maps_url', 'waktu_pagi', 'waktu_petang', 'waktu_malam',
  'warna_utama', 'logo_url', 'harga_normal', 'harga_special', 'deposit'
];
export const MAX_BANNERS = 8;
export const MAX_ADDONS = 20;

export function validateAddons(list) {
  const errors = [];
  const value = [];
  if (list === undefined || list === null) return { ok: true, value, errors };
  if (!Array.isArray(list) || list.length > MAX_ADDONS) return { ok: false, value, errors: [`Maksimum ${MAX_ADDONS} add-on.`] };
  list.forEach((a, i) => {
    const nama = cleanText(a && a.nama);
    const raw = a && a.harga;
    const harga = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim().replace(/^RM/i, '')) : NaN;
    if (!nama && (raw === '' || raw === undefined || raw === null)) return; // baris kosong diabaikan
    if (!nama || nama.length > 60) errors.push(`Add-on ${i + 1}: nama wajib (maksimum 60 aksara).`);
    else if (/,/.test(nama)) errors.push(`Add-on ${i + 1}: nama tidak boleh mengandungi koma.`);
    else if (!isFinite(harga) || harga < 0 || harga > 100000) errors.push(`Add-on ${i + 1}: harga mesti nombor 0 atau lebih.`);
    else value.push({ nama, harga: Math.round((harga + Number.EPSILON) * 100) / 100 });
  });
  return { ok: errors.length === 0, value, errors };
}

export function validateBanners(list) {
  if (list === undefined || list === null) return { ok: true, value: [] };
  if (!Array.isArray(list)) return { ok: false, mesej: 'Senarai banner tidak sah.' };
  const urls = list.map(normalizeImageUrl).filter(Boolean);
  if (urls.length > MAX_BANNERS) return { ok: false, mesej: `Maksimum ${MAX_BANNERS} banner.` };
  if (!urls.every(isHttpsUrl)) return { ok: false, mesej: 'Setiap banner mesti pautan https:// yang sah.' };
  return { ok: true, value: urls };
}

// Pulangkan { ok, errors, warnings, value: { slug, tetapan, templat, addons, banners } }
export function validateWizard(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const errors = {};
  const sv = validateSlug(r.slug);
  if (!sv.ok) errors.slug = sv.mesej;

  const tetIn = {};
  for (const k of WIZARD_TETAPAN_KEYS) if (r[k] !== undefined) tetIn[k] = r[k];
  if (typeof tetIn.logo_url === 'string') tetIn.logo_url = normalizeImageUrl(tetIn.logo_url);
  const tv = validateTetapan(tetIn);
  Object.assign(errors, tv.errors || {});

  const templat = r.templat === 'kosong' ? 'kosong' : r.templat === 'raya' || r.templat === undefined ? 'raya' : null;
  if (!templat) errors.templat = 'Pilih templat slot.';

  const av = validateAddons(r.addons);
  if (!av.ok) errors.addons = av.errors.join(' ');
  const bv = validateBanners(r.banners);
  if (!bv.ok) errors.banners = bv.mesej;

  if (Object.keys(errors).length) return { ok: false, errors, warnings: tv.warnings || {} };
  return {
    ok: true,
    errors: {},
    warnings: tv.warnings || {},
    value: { slug: r.slug, tetapan: tv.value, templat, addons: av.value, banners: bv.value }
  };
}
