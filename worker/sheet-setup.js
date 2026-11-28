// setupTenantSheet (BSD 6.1). Idempotent: selamat dijalankan berulang, TIDAK pernah memadam atau menimpa data.
//
// 1. Sheet sedia ada dan boleh dibuka -> terus ke semakan skema. Jika tidak (404), cipta Sheet baharu.
// 2. Cipta tab yang hilang, tulis header, bekukan baris 1, dropdown (status, aktif, kumpulan), format teks.
// 3. Tab sedia ada: hanya TAMBAH lajur yang hilang di hujung (migrasi skema).
// 4. Seed hanya tab yang kosong selain header.
// 5. Tulis Log (tanpa PII).
//
// Bilangan panggilan Sheets API untuk Sheet baharu: 4 (create, values:batchUpdate, batchUpdate, append Log).

import {
  TABS, HEADERS, SCHEMA_VERSION, missingHeaders, seedSlots, seedAddon, infoRows, sheetTitle, objectToRow,
  tetapanToRows, seedTetapan, STATUS_TEMPAHAN, STATUS_REVIEW
} from '../js/core/sheet-schema.js';
import {
  createSpreadsheet, spreadsheetGet, spreadsheetBatchUpdate, valuesBatchUpdate, valuesBatchGet, valuesAppend,
  driveGetFile, a1, colLetter, sheetUrl, GoogleError
} from './lib/google.js';

export class SetupError extends Error {
  constructor(status, kod, mesej) {
    super(mesej);
    this.status = status;
    this.kod = kod;
  }
}

// Lajur yang diformat sebagai TEKS (elak Sheets menukar tarikh/telefon/label masa bila studio menaip sendiri)
const TEXT_COLUMNS = {
  Tempahan: ['ref', 'telefon', 'tarikh', 'slot_ids'],
  HariSpecial: ['tarikh'],
  TarikhTutup: ['tarikh'],
  Review: ['tarikh'],
  Slot: ['slot_id', 'label']
};

const DROPDOWNS = {
  Tempahan: { status: { values: STATUS_TEMPAHAN, strict: true } },
  Review: { status: { values: STATUS_REVIEW, strict: true } },
  Slot: { aktif: { values: ['TRUE', 'FALSE'], strict: true }, kumpulan: { values: ['Pagi', 'Petang', 'Malam'], strict: false } },
  Addon: { aktif: { values: ['TRUE', 'FALSE'], strict: true } },
  Banner: { aktif: { values: ['TRUE', 'FALSE'], strict: true } }
};

const isBlankRow = (r) => !r || r.every((c) => c === '' || c === null || c === undefined);

function seedRowsFor(tab, seed, nowIso, headers) {
  const toRows = (objs) => objs.map((o) => objectToRow(tab, o, headers));
  // Info/Tetapan: baris kunci-nilai yang sudah ditukar (nombor kekal nombor), disusun ikut header sebenar
  const kv = (rows, names) => rows.map((r) => headers.map((h) => (names.indexOf(h) >= 0 ? r[names.indexOf(h)] : '')));
  switch (tab) {
    case 'Info':
      return kv(infoRows(nowIso), HEADERS.Info);
    case 'Tetapan':
      return kv(tetapanToRows(seedTetapan(seed.tetapan || {}), nowIso), HEADERS.Tetapan);
    case 'Slot':
      return toRows(seedSlots(seed.templat || 'raya'));
    case 'Addon': {
      const list = seed.addons && seed.addons.length
        ? seed.addons.map((a, i) => ({ addon_id: 'A' + String(i + 1).padStart(2, '0'), nama: a.nama, harga: a.harga, aktif: true, susunan: i + 1 }))
        : seedAddon();
      return toRows(list);
    }
    case 'Banner':
      return toRows((seed.banners || []).map((url, i) => ({ id: 'B' + String(i + 1).padStart(2, '0'), url, susunan: i + 1, aktif: true })));
    default:
      return [];
  }
}

function formatRequests(tab, sheetId, headers, { baru }) {
  const reqs = [];
  const n = headers.length;
  reqs.push({
    updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' }
  });
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: n },
      cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.918, green: 0.953, blue: 0.988 } } },
      fields: 'userEnteredFormat(textFormat,backgroundColor)'
    }
  });
  for (const col of TEXT_COLUMNS[tab] || []) {
    const i = headers.indexOf(col);
    if (i < 0) continue;
    reqs.push({
      repeatCell: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } },
        fields: 'userEnteredFormat.numberFormat'
      }
    });
  }
  for (const [col, dd] of Object.entries(DROPDOWNS[tab] || {})) {
    const i = headers.indexOf(col);
    if (i < 0) continue;
    reqs.push({
      setDataValidation: {
        range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
        rule: {
          condition: { type: 'ONE_OF_LIST', values: dd.values.map((v) => ({ userEnteredValue: v })) },
          strict: dd.strict,
          showCustomUi: true
        }
      }
    });
  }
  if (baru) {
    reqs.push({
      updateDimensionProperties: {
        range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: n },
        properties: { pixelSize: 150 },
        fields: 'pixelSize'
      }
    });
  }
  return reqs;
}

// opts: { fetch, access, sheetId, seed: { tetapan, templat, addons, banners }, nowIso, allowCreate, onCreated(id) }
export async function setupTenantSheet(opts) {
  const { fetch, access, seed = {}, nowIso } = opts;
  let meta = null;
  let dicipta = false;

  // 1. Buka Sheet sedia ada
  if (opts.sheetId) {
    try {
      meta = await spreadsheetGet(fetch, access, opts.sheetId);
    } catch (e) {
      if (!(e instanceof GoogleError)) throw e;
      if (e.status === 404) meta = null;
      else if (e.status === 403) throw new SetupError(403, 'sheet-tiada-akses', 'Annur Booking tidak lagi boleh membuka Sheet anda. Tekan "Sambung semula".');
      else throw e;
    }
    if (meta) {
      const f = await driveGetFile(fetch, access, opts.sheetId).catch(() => null);
      if (f && f.trashed) {
        throw new SetupError(409, 'sheet-dibuang', 'Sheet anda berada dalam Tong Sampah Google Drive. Pulihkan dahulu, kemudian cuba lagi.');
      }
    }
  }
  if (!meta) {
    if (opts.allowCreate === false) throw new SetupError(404, 'sheet-hilang', 'Sheet studio tidak dijumpai.');
    const nama = (seed.tetapan && seed.tetapan.nama_studio) || 'Studio';
    meta = await createSpreadsheet(fetch, access, sheetTitle(nama), TABS);
    dicipta = true;
    if (opts.onCreated) await opts.onCreated(meta.spreadsheetId);
  }
  const id = meta.spreadsheetId;
  const ids = new Map((meta.sheets || []).map((s) => [s.properties.title, s.properties.sheetId]));

  // 2. Tab yang hilang
  const tabBaru = TABS.filter((t) => !ids.has(t));
  if (tabBaru.length) {
    const r = await spreadsheetBatchUpdate(
      fetch,
      access,
      id,
      tabBaru.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }))
    );
    (r.replies || []).forEach((rep, i) => {
      const p = rep && rep.addSheet && rep.addSheet.properties;
      if (p) ids.set(tabBaru[i], p.sheetId);
    });
  }

  // 3. Baca header + baris pertama tab sedia ada (satu panggilan)
  const state = new Map(); // tab -> { header: [], hasData }
  const lama = TABS.filter((t) => !dicipta && !tabBaru.includes(t));
  if (lama.length) {
    const r = await valuesBatchGet(fetch, access, id, lama.map((t) => a1(t, '1:2')));
    (r.valueRanges || []).forEach((vr, i) => {
      const v = vr.values || [];
      state.set(lama[i], { header: (v[0] || []).map((h) => String(h ?? '').trim()), hasData: !isBlankRow(v[1]) });
    });
  }

  const data = [];
  const lajurDitambah = {};
  const diseed = [];
  const finalHeaders = new Map();
  for (const tab of TABS) {
    const st = state.get(tab) || { header: [], hasData: false };
    let headers;
    if (st.header.length === 0 || isBlankRow(st.header)) {
      headers = HEADERS[tab].slice();
      data.push({ range: a1(tab, 'A1'), values: [headers] });
    } else {
      const hilang = missingHeaders(tab, st.header);
      headers = st.header.concat(hilang);
      if (hilang.length) {
        data.push({ range: a1(tab, colLetter(st.header.length) + '1'), values: [hilang] });
        lajurDitambah[tab] = hilang;
      }
    }
    finalHeaders.set(tab, headers);
    if (!st.hasData) {
      const rows = seedRowsFor(tab, seed, nowIso, headers);
      if (rows.length) {
        data.push({ range: a1(tab, 'A2'), values: rows });
        diseed.push(tab);
      }
    }
  }
  if (data.length) await valuesBatchUpdate(fetch, access, id, data);

  // 4. Format, beku, dropdown (idempotent, ikut kedudukan header sebenar)
  const reqs = [];
  for (const tab of TABS) {
    const sid = ids.get(tab);
    if (sid === undefined) continue;
    reqs.push(...formatRequests(tab, sid, finalHeaders.get(tab), { baru: dicipta || tabBaru.includes(tab) }));
  }
  if (reqs.length) await spreadsheetBatchUpdate(fetch, access, id, reqs);

  // 5. Log (tiada PII)
  const berubah = dicipta || tabBaru.length || Object.keys(lajurDitambah).length;
  if (berubah) {
    const butiran = dicipta
      ? `skema=${SCHEMA_VERSION}`
      : [
          `skema=${SCHEMA_VERSION}`,
          tabBaru.length ? 'tab baharu: ' + tabBaru.join(' ') : '',
          ...Object.entries(lajurDitambah).map(([t, c]) => `${t}: tambah ${c.join(' ')}`)
        ].filter(Boolean).join('; ');
    await valuesAppend(fetch, access, id, a1('Log', 'A:E'), [[nowIso, 'sistem', dicipta ? 'setup' : 'migrasi', 'sheet', butiran]]);
  }

  return { sheetId: id, sheetUrl: sheetUrl(id), dicipta, tabBaru, lajurDitambah, diseed };
}
