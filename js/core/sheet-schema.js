// Kontrak Sheet studio (BSD seksyen 4 dan 6). Nama tab dan header ialah kontrak dengan kod: jangan ubah.
// Modul ini hanya data dan penukar baris <-> objek. Tiada pengesahan input (lihat validate.js).

import { serialToDate } from './dates.js';

export const SCHEMA_VERSION = 1;
export const LOG_MAX_ROWS = 5000;
export const PLATFORM_NAME = 'Annur Booking';

export const TABS = ['Info', 'Tetapan', 'Banner', 'Slot', 'Addon', 'HariSpecial', 'TarikhTutup', 'Tempahan', 'Review', 'Log'];

export const HEADERS = {
  Info: ['kunci', 'nilai'],
  Tetapan: ['kunci', 'nilai', 'dikemas_kini'],
  Banner: ['id', 'url', 'susunan', 'aktif'],
  Slot: ['slot_id', 'label', 'kumpulan', 'susunan', 'aktif', 'kapasiti'],
  Addon: ['addon_id', 'nama', 'harga', 'aktif', 'susunan'],
  HariSpecial: ['tarikh', 'label'],
  TarikhTutup: ['tarikh', 'sebab'],
  Tempahan: [
    'ref', 'dicipta_pada', 'nama', 'telefon', 'emel', 'tarikh', 'slot_ids', 'slot_label', 'bil_slot', 'dewasa',
    'kanak', 'addon', 'harga_slot', 'harga_addon', 'jumlah', 'status', 'catatan', 'persetujuan_pdpa',
    'dikemas_kini_pada', 'dikemas_kini_oleh'
  ],
  Review: ['id', 'dicipta_pada', 'tarikh', 'nama', 'bintang', 'komen', 'status'],
  Log: ['masa', 'pelaku', 'tindakan', 'sasaran', 'butiran']
};

// Jenis lajur selain teks. Lajur tidak disenaraikan = teks.
export const COLUMN_TYPES = {
  Banner: { susunan: 'int', aktif: 'bool' },
  Slot: { susunan: 'int', aktif: 'bool', kapasiti: 'int' },
  Addon: { harga: 'number', aktif: 'bool', susunan: 'int' },
  Tempahan: { bil_slot: 'int', dewasa: 'int', kanak: 'int', harga_slot: 'number', harga_addon: 'number', jumlah: 'number' },
  Review: { bintang: 'int' }
};

// Nilai lalai BSD bila lajur hilang dari Sheet atau selnya kosong (Slot: aktif TRUE, kapasiti 1).
// Penting: kapasiti hilang TIDAK boleh bermakna "tanpa had" (itu membenarkan double booking).
export const COLUMN_DEFAULTS = { Slot: { aktif: true, kapasiti: 1 } };

// Lajur tarikh (nombor siri dari suntingan manual dikembalikan kepada YYYY-MM-DD)
const DATE_COLUMNS = { HariSpecial: ['tarikh'], TarikhTutup: ['tarikh'], Tempahan: ['tarikh'], Review: ['tarikh'] };

export const STATUS_TEMPAHAN = ['PENDING', 'DEPOSIT', 'SELESAI', 'CANCEL'];
export const STATUS_REVIEW = ['MENUNGGU', 'LULUS', 'TOLAK'];

// ---------------------------------------------------------------------------------------------
// Tetapan (BSD 4: tab Tetapan). type: text | ml (berbilang baris) | url | hex | wa | number | int | bool
// ---------------------------------------------------------------------------------------------
export const TERMA_SEED = [
  '30 minit setiap sesi.',
  'Softcopy disediakan.',
  'Deposit akan dinyatakan oleh studio dan tidak dikembalikan.',
  'Pembatalan atau perubahan waktu perlu dimaklumkan 2 hari sebelum.'
].join('\n');

export const TETAPAN_SPEC = {
  nama_studio: { type: 'text', max: 60, required: true },
  tajuk_hero: { type: 'text', max: 80, defaultFrom: 'nama_studio' },
  subtajuk_hero: { type: 'text', max: 140, default: '' },
  logo_url: { type: 'url', default: '' },
  warna_utama: { type: 'hex', default: '#2563EB' },
  whatsapp: { type: 'wa', required: true },
  ticker: { type: 'text', max: 200, default: '' },
  alamat: { type: 'ml', max: 300, default: '' },
  maps_url: { type: 'url', default: '' },
  waktu_pagi: { type: 'text', max: 40, default: '09:00 - 12:00' },
  waktu_petang: { type: 'text', max: 40, default: '14:00 - 18:00' },
  waktu_malam: { type: 'text', max: 40, default: '21:00 - 23:00' },
  harga_normal: { type: 'number', min: 0, required: true },
  harga_special: { type: 'number', min: 0, defaultFrom: 'harga_normal' },
  deposit: { type: 'number', min: 0, default: 50 },
  arahan_deposit: { type: 'ml', max: 500, default: '' },
  link_bayaran: { type: 'url', default: '' },
  terma: { type: 'ml', max: 2000, default: TERMA_SEED },
  faedah: { type: 'ml', max: 2000, default: '' },
  maks_dewasa: { type: 'int', min: 1, max: 50, default: 10 },
  umur_kanak_percuma: { type: 'int', min: 0, default: 4 },
  tempahan_aktif: { type: 'bool', default: true },
  tempoh_sesi_minit: { type: 'int', min: 1, default: 30 },
  mesej_wa: { type: 'text', max: 300, default: 'Salam, saya nak sahkan tempahan Raya!' }
};
export const TETAPAN_KEYS = Object.keys(TETAPAN_SPEC);

// ---------------------------------------------------------------------------------------------
// Penukar nilai sel
// ---------------------------------------------------------------------------------------------
export function parseBool(v, dflt = false) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'ya') return true;
  if (s === 'false' || s === '0' || s === 'tidak') return false;
  return dflt;
}

function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = String(v ?? '').trim().replace(/^RM/i, '').replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

function parseInteger(v) {
  const n = parseNum(v);
  return n === null ? null : Math.trunc(n);
}

// Formula injection (BSD 4 dan TRD 6): sel teks yang bermula = + - @ (juga tab/CR) diberi awalan '.
const FORMULA_START = /^[=+\-@\t\r]/;

export function sanitizeCell(v) {
  if (typeof v !== 'string') return v;
  return FORMULA_START.test(v) ? "'" + v : v;
}

// Kembalikan teks yang kita awalan sendiri. Hanya awalan ' yang diikuti aksara berbahaya dibuang.
export function unsanitizeCell(v) {
  if (typeof v !== 'string') return v;
  return v.length > 1 && v[0] === "'" && FORMULA_START.test(v.slice(1)) ? v.slice(1) : v;
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  return unsanitizeCell(String(v));
}

function toCell(type, v) {
  if (v === null || v === undefined) return '';
  if (type === 'bool') return parseBool(v) ? 'TRUE' : 'FALSE';
  if (type === 'int' || type === 'number') {
    const n = parseNum(v);
    return n === null ? '' : n;
  }
  return sanitizeCell(String(v));
}

// ---------------------------------------------------------------------------------------------
// Jadual <-> objek. Lajur dipetakan mengikut NAMA header sebenar dalam Sheet (studio mungkin
// menyusun semula lajur atau menambah lajur sendiri), bukan kedudukan.
// ---------------------------------------------------------------------------------------------
export function rowToObject(tab, row, headers = HEADERS[tab]) {
  const types = COLUMN_TYPES[tab] || {};
  const dates = DATE_COLUMNS[tab] || [];
  const defaults = COLUMN_DEFAULTS[tab] || {};
  const blank = (v) => v === undefined || v === null || v === '';
  const obj = {};
  headers.forEach((h, i) => {
    const raw = row[i];
    const t = types[h];
    if (blank(raw) && h in defaults) obj[h] = defaults[h];
    else if (t === 'bool') obj[h] = parseBool(raw);
    else if (t === 'int') obj[h] = parseInteger(raw);
    else if (t === 'number') obj[h] = parseNum(raw);
    else if (dates.includes(h) && typeof raw === 'number') obj[h] = serialToDate(raw);
    else obj[h] = cellText(raw);
  });
  // Lajur yang hilang terus dari Sheet: beri nilai lalai (atau kosong bertaip) supaya kod tidak menerima undefined.
  for (const h of HEADERS[tab] || []) {
    if (h in obj) continue;
    const t = types[h];
    obj[h] = h in defaults ? defaults[h] : t === 'bool' ? false : t === 'int' || t === 'number' ? null : '';
  }
  return obj;
}

export function objectToRow(tab, obj, headers = HEADERS[tab]) {
  const types = COLUMN_TYPES[tab] || {};
  return headers.map((h) => toCell(types[h], obj[h]));
}

// values = hasil values.get (baris 1 ialah header). Baris kosong sepenuhnya dilangkau.
export function parseTable(tab, values) {
  if (!Array.isArray(values) || values.length === 0) return { headers: [], rows: [] };
  const headers = values[0].map((h) => String(h ?? '').trim());
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i] || [];
    if (r.every((c) => c === '' || c === null || c === undefined)) continue;
    rows.push({ ...rowToObject(tab, r, headers), _baris: i + 1 });
  }
  return { headers, rows };
}

// Migrasi skema (BSD 6.1 langkah 3): hanya TAMBAH lajur yang hilang di hujung. Tidak pernah padam atau timpa.
export function missingHeaders(tab, existingHeaderRow) {
  const have = new Set((existingHeaderRow || []).map((h) => String(h ?? '').trim()));
  return HEADERS[tab].filter((h) => !have.has(h));
}

// ---------------------------------------------------------------------------------------------
// Tetapan: baris <-> objek bertaip, dengan nilai lalai
// ---------------------------------------------------------------------------------------------
function coerceTetapan(spec, raw) {
  switch (spec.type) {
    case 'bool':
      return parseBool(raw, spec.default ?? false);
    case 'int': {
      const n = parseInteger(raw);
      return n === null ? undefined : n;
    }
    case 'number': {
      const n = parseNum(raw);
      return n === null ? undefined : n;
    }
    default:
      return cellText(raw);
  }
}

// rows = baris data Tetapan (tanpa header): [kunci, nilai, dikemas_kini]
export function tetapanFromRows(rows) {
  const raw = new Map();
  for (const r of rows || []) {
    const k = String(r[0] ?? '').trim();
    if (k) raw.set(k, r[1]);
  }
  const out = {};
  for (const key of TETAPAN_KEYS) {
    // Kunci tiada dalam Sheet -> undefined -> nilai lalai. Teks yang sengaja dikosongkan kekal kosong.
    out[key] = raw.has(key) ? coerceTetapan(TETAPAN_SPEC[key], raw.get(key)) : undefined;
  }
  return resolveTetapan(out);
}

// Isi nilai lalai. tajuk_hero = nama_studio, harga_special = harga_normal bila kosong.
export function resolveTetapan(partial) {
  const out = { ...partial };
  for (const key of TETAPAN_KEYS) {
    const spec = TETAPAN_SPEC[key];
    if (out[key] === undefined || out[key] === null || (out[key] === '' && spec.defaultFrom)) {
      if (spec.defaultFrom) out[key] = out[spec.defaultFrom];
      else if ('default' in spec) out[key] = spec.default;
    }
  }
  return out;
}

export function tetapanToRows(obj, nowIso) {
  return TETAPAN_KEYS.filter((k) => obj[k] !== undefined && obj[k] !== null).map((k) => {
    const spec = TETAPAN_SPEC[k];
    const t = spec.type === 'bool' ? 'bool' : spec.type === 'int' ? 'int' : spec.type === 'number' ? 'number' : 'text';
    return [k, toCell(t, obj[k]), nowIso || ''];
  });
}

// Nilai Tetapan untuk seed Sheet baharu: input wizard + nilai lalai. Kunci "defaultFrom" (tajuk_hero,
// harga_special) dibiarkan KOSONG supaya ia terus mengikut nama_studio/harga_normal bila itu diubah kelak.
export function seedTetapan(values = {}) {
  const out = {};
  for (const key of TETAPAN_KEYS) {
    const spec = TETAPAN_SPEC[key];
    if (values[key] !== undefined && values[key] !== null) out[key] = values[key];
    else if (spec.defaultFrom) out[key] = '';
    else if ('default' in spec) out[key] = spec.default;
  }
  return out;
}

// Config awam (BSD 5: tanpa arahan_deposit sebelum tempahan dibuat).
export function publicTetapan(tetapan) {
  const { arahan_deposit, ...rest } = tetapan; // eslint-disable-line no-unused-vars
  return rest;
}

// ---------------------------------------------------------------------------------------------
// Seed (BSD 6.1 langkah 4 dan 6.3)
// ---------------------------------------------------------------------------------------------
const RAYA_PAGI = ['09:00', '09:20', '09:40', '10:00', '10:20', '10:40', '11:00', '11:20', '11:40'].map((t) => t + ' AM');
const RAYA_PETANG = ['02:20', '02:40', '03:00', '03:20', '03:40', '04:00', '04:20', '04:40', '05:00', '05:20', '05:40'].map(
  (t) => t + ' PM'
);
const RAYA_MALAM = ['09:00', '09:20', '09:40', '10:00', '10:20', '10:40'].map((t) => t + ' PM');

// 26 slot: S01..S09 Pagi, S10..S20 Petang, S21..S26 Malam. Kapasiti 1.
export function seedSlots(template = 'raya') {
  if (template !== 'raya') return [];
  const groups = [
    ['Pagi', RAYA_PAGI],
    ['Petang', RAYA_PETANG],
    ['Malam', RAYA_MALAM]
  ];
  const out = [];
  for (const [kumpulan, labels] of groups) {
    for (const label of labels) {
      const n = out.length + 1;
      out.push({ slot_id: 'S' + String(n).padStart(2, '0'), label, kumpulan, susunan: n, aktif: true, kapasiti: 1 });
    }
  }
  return out;
}

// Satu contoh add-on, TIDAK aktif supaya tidak dipaparkan kepada pelanggan.
export function seedAddon() {
  return [{ addon_id: 'A01', nama: 'Frame', harga: 30, aktif: false, susunan: 1 }];
}

export function infoRows(nowIso) {
  return [
    ['skema', String(SCHEMA_VERSION)],
    ['dicipta_pada', nowIso],
    ['platform', PLATFORM_NAME],
    ['nota', 'Jangan ubah nama tab atau header. Anda boleh ubah isi data.']
  ];
}

export function sheetTitle(namaStudio) {
  return `Annur Booking - ${namaStudio} (JANGAN PADAM)`;
}

// ---------------------------------------------------------------------------------------------
// Export CSV (BSD F-09): UTF-8 dengan BOM (Excel), CRLF, escape formula sama seperti penulisan Sheet.
// ---------------------------------------------------------------------------------------------
export const CSV_BOM = '﻿';

export function csvCell(v) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'string' ? sanitizeCell(v) : String(v);
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(headers.map((h) => csvCell(r[h])).join(','));
  return CSV_BOM + lines.join('\r\n') + '\r\n';
}
