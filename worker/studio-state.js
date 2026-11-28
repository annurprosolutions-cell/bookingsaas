// Keadaan satu studio dalam Durable Object (TRD 4 dan 7, IPD 3.3).
//
// - Config (Tetapan, Banner, Slot, Addon, HariSpecial, TarikhTutup) dibaca dari Sheet, segar 60 saat.
// - Indeks kekosongan dibina dari tab Tempahan, segar 5 minit, dan dikemas kini serta-merta selepas setiap tempahan.
// - Semua tempahan dijalankan dalam MUTEX: semak kapasiti -> tulis Sheet -> kemas kini indeks, satu demi satu.
//   (DO sahaja tidak cukup: permintaan lain boleh menyelit masuk semasa menunggu Sheets API. Dibuktikan Fasa 0.)
// - Had kadar disimpan sebagai pembilang berhash dalam memori.
//
// Tiada data dalam storan kekal DO. Untuk semakan status (Ref + telefon) tanpa membaca Sheet setiap kali, memori
// memegang HMAC telefon (bukan nombor mentah) bersama medan terhad (tarikh, slot, status, jumlah).

import { createMutex } from './lib/mutex.js';
import { valuesBatchGet, valuesAppend, a1, GoogleError } from './lib/google.js';
import { withGoogle } from './registry.js';
import { parseTable, tetapanFromRows, objectToRow, publicTetapan, HEADERS } from '../js/core/sheet-schema.js';
import { AvailabilityIndex, checkCapacity, slotAvailability, groupByKumpulan } from '../js/core/availability.js';
import { computeBooking, pricePerSlot, isSpecialDate } from '../js/core/pricing.js';
import { validateBookingInput, generateRef, isHttpsUrl, normalizePhone, isHexColour } from '../js/core/validate.js';
import { isValidDate } from '../js/core/dates.js';

export const CONFIG_TTL_MS = 60 * 1000;
export const INDEX_TTL_MS = 5 * 60 * 1000;
const CONFIG_TABS = ['Tetapan', 'Banner', 'Slot', 'Addon', 'HariSpecial', 'TarikhTutup'];
const WAJIB_TEMPAHAN = ['ref', 'tarikh', 'slot_ids', 'status', 'telefon'];

// Had kadar (per hash IP harian, per studio)
export const LIMITS = {
  book: { max: 10, ms: 10 * 60 * 1000 },
  status: { max: 10, ms: 60 * 1000 },
  statusRef: { max: 6, ms: 10 * 60 * 1000 }
};

const enc = new TextEncoder();

function byOrder(a, b) {
  return (a.susunan ?? 0) - (b.susunan ?? 0);
}

// Studio boleh menyunting Sheet terus, jadi nilai TIDAK dipercayai walaupun wizard sudah mengesahkannya.
// Pautan bukan https (cth "javascript:") dibuang sebelum sampai ke pelayar pelanggan.
export function sanitizeStudio(s) {
  const out = { ...s };
  for (const k of ['logo_url', 'maps_url', 'link_bayaran']) out[k] = isHttpsUrl(out[k]) ? out[k] : '';
  const wa = normalizePhone(out.whatsapp);
  out.whatsapp = /^[0-9]{9,15}$/.test(wa) ? wa : '';
  out.warna_utama = isHexColour(out.warna_utama) ? out.warna_utama.toUpperCase() : '#2563EB';
  return out;
}

export class StudioState {
  constructor({ env, fetch, now }) {
    this.env = env;
    this.fetch = fetch;
    this.now = now;
    this.lock = createMutex();
    this.cfg = null;
    this.cfgAt = 0;
    this.idx = null;
    this.idxAt = 0;
    this.idxStale = false;
    this.headers = null;
    this.refs = new Set();
    this.byRef = new Map();
    this.limits = new Map();
    this.hmacKey = null;
  }

  deps() {
    return { fetch: this.fetch, now: this.now };
  }

  invalidate({ config = true, index = true } = {}) {
    if (config) this.cfg = null;
    if (index) this.idxStale = true;
  }

  // ---- had kadar ----
  rate(action, key, limit = LIMITS[action]) {
    const now = this.now();
    if (this.limits.size > 5000) {
      for (const [k, v] of this.limits) if (v.reset <= now) this.limits.delete(k);
    }
    const k = action + '|' + key;
    const e = this.limits.get(k);
    if (!e || e.reset <= now) {
      this.limits.set(k, { n: 1, reset: now + limit.ms });
      return true;
    }
    e.n++;
    return e.n <= limit.max;
  }

  async phoneHash(telefon) {
    if (!this.hmacKey) {
      this.hmacKey = await crypto.subtle.importKey('raw', enc.encode('telefon|' + (this.env.SESSION_SECRET || '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    }
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', this.hmacKey, enc.encode(String(telefon || ''))));
    let s = '';
    for (let i = 0; i < 16; i++) s += sig[i].toString(16).padStart(2, '0');
    return s;
  }

  async entry(r) {
    return {
      h: await this.phoneHash(r.telefon),
      tarikh: r.tarikh,
      slot_label: r.slot_label,
      bil_slot: r.bil_slot,
      dewasa: r.dewasa,
      kanak: r.kanak,
      jumlah: r.jumlah,
      status: r.status
    };
  }

  // ---- muat dari Sheet (satu panggilan batchGet untuk apa sahaja yang basi) ----
  async ensure(tenant, { config = true, index = false } = {}) {
    const now = this.now();
    const needCfg = config && (!this.cfg || now - this.cfgAt > CONFIG_TTL_MS);
    const needIdx = index && (!this.idx || this.idxStale || now - this.idxAt > INDEX_TTL_MS);
    if (!needCfg && !needIdx) return;
    const tabs = [...(needCfg ? CONFIG_TABS : []), ...(needIdx ? ['Tempahan'] : [])];
    const r = await withGoogle(this.env, this.deps(), tenant, (access) =>
      valuesBatchGet(this.fetch, access, tenant.sheetId, tabs.map((t) => a1(t, 'A:AZ')))
    );
    const vals = {};
    (r.valueRanges || []).forEach((vr, i) => (vals[tabs[i]] = vr.values || []));

    if (needCfg) {
      const t = (name) => parseTable(name, vals[name]).rows;
      this.cfg = {
        settings: sanitizeStudio(tetapanFromRows((vals.Tetapan || []).slice(1))),
        banners: t('Banner').filter((b) => b.aktif && isHttpsUrl(b.url)).sort(byOrder).slice(0, 8),
        slots: t('Slot').filter((s) => s.slot_id),
        addons: t('Addon').filter((a) => a.addon_id && a.nama),
        hariSpecial: t('HariSpecial').filter((h) => isValidDate(h.tarikh)),
        tarikhTutup: t('TarikhTutup').filter((h) => isValidDate(h.tarikh))
      };
      this.cfgAt = now;
    }
    if (needIdx) {
      const { headers, rows } = parseTable('Tempahan', vals.Tempahan);
      this.headers = headers.length ? headers : HEADERS.Tempahan;
      const idx = new AvailabilityIndex();
      const refs = new Set();
      const byRef = new Map();
      for (const row of rows) {
        if (!row.ref) continue;
        refs.add(row.ref);
        if (isValidDate(row.tarikh)) idx.add(row);
        byRef.set(row.ref, await this.entry(row));
      }
      this.idx = idx;
      this.refs = refs;
      this.byRef = byRef;
      this.idxAt = now;
      this.idxStale = false;
    }
  }

  closedMap() {
    return Object.fromEntries(this.cfg.tarikhTutup.map((t) => [t.tarikh, t.sebab || '']));
  }

  // ---- config awam (tanpa arahan_deposit, tanpa data peribadi) ----
  async config(tenant, today) {
    return this.lock(async () => {
      await this.ensure(tenant, { config: true });
      const c = this.cfg;
      return {
        studio: publicTetapan(c.settings),
        banners: c.banners.map((b) => b.url),
        addons: c.addons.filter((a) => a.aktif).sort(byOrder).map((a) => ({ addon_id: a.addon_id, nama: a.nama, harga: a.harga ?? 0 })),
        hari_special: c.hariSpecial.filter((h) => h.tarikh >= today).map((h) => ({ tarikh: h.tarikh, label: h.label || '' })),
        tarikh_tutup: c.tarikhTutup.filter((h) => h.tarikh >= today).map((h) => ({ tarikh: h.tarikh, sebab: h.sebab || '' })),
        ada_slot: c.slots.some((s) => s.aktif)
      };
    });
  }

  // ---- kekosongan satu tarikh (tiada PII) ----
  async slots(tenant, date, today) {
    return this.lock(async () => {
      await this.ensure(tenant, { config: true, index: true });
      const c = this.cfg;
      const tutup = c.tarikhTutup.find((t) => t.tarikh === date);
      const harga = pricePerSlot(date, c.settings, c.hariSpecial);
      const avail = slotAvailability(date, c.slots, this.idx);
      return {
        tarikh: date,
        lampau: date < today,
        tutup: tutup ? { sebab: tutup.sebab || '' } : null,
        jenis_hari: isSpecialDate(date, c.hariSpecial) ? 'special' : 'normal',
        harga_seslot: harga,
        sesi: groupByKumpulan(avail).map((g) => ({
          kumpulan: g.kumpulan,
          slots: g.slots.map((s) => ({ slot_id: s.slot_id, label: s.label, tinggal: s.tinggal, penuh: s.penuh }))
        }))
      };
    });
  }

  // ---- tempah (IPD 3.5) ----
  async book(tenant, { input, ipKey, today, nowIso }) {
    return this.lock(async () => {
      if (!this.rate('book', ipKey)) {
        return { status: 429, ok: false, kod: 'had-kadar', mesej: 'Terlalu banyak cubaan. Sila cuba lagi dalam beberapa minit.' };
      }
      await this.ensure(tenant, { config: true, index: true });
      const c = this.cfg;
      const s = c.settings;
      if (!s.tempahan_aktif) return { status: 403, ok: false, kod: 'tertutup', tertutup: 'ditutup', mesej: 'Tempahan ditutup buat masa ini.' };
      if (!WAJIB_TEMPAHAN.every((h) => this.headers.includes(h))) {
        return { status: 503, ok: false, kod: 'sheet-rosak', mesej: 'Tempahan tidak dapat diterima buat masa ini. Sila hubungi studio.' };
      }

      const v = validateBookingInput(input, { today, maksDewasa: s.maks_dewasa, closed: this.closedMap() });
      if (!v.ok) return { status: 400, ok: false, kod: 'tidak-sah', mesej: 'Sila semak maklumat yang ditanda.', errors: v.errors };
      const val = v.value;

      const harga = computeBooking({ tarikh: val.tarikh, slotIds: val.slot_ids, addonIds: val.addon_ids, settings: s, slots: c.slots, addons: c.addons, hariSpecial: c.hariSpecial });
      if (!harga.ok) {
        const label = (id) => (c.slots.find((x) => x.slot_id === id) || {}).label || id;
        if (harga.kod === 'slot-tidak-sah' || harga.kod === 'slot-tidak-aktif') {
          return { status: 409, ok: false, kod: 'slot-diambil', slot_ids: [harga.slot_id], mesej: `Slot ${label(harga.slot_id)} tidak lagi tersedia. Sila pilih slot lain.` };
        }
        if (harga.kod === 'addon-tidak-sah' || harga.kod === 'addon-tidak-aktif') {
          return { status: 409, ok: false, kod: 'addon-tiada', mesej: 'Satu add-on yang dipilih tidak lagi tersedia. Sila semak semula.' };
        }
        return { status: 503, ok: false, kod: harga.kod, mesej: 'Tempahan tidak dapat diterima buat masa ini. Sila hubungi studio.' };
      }

      const cap = checkCapacity(this.idx, { tarikh: val.tarikh, slotIds: harga.slot_ids }, c.slots);
      if (!cap.ok) {
        const ids = cap.conflicts.map((x) => x.slot_id);
        const labels = ids.map((id) => (c.slots.find((x) => x.slot_id === id) || {}).label || id);
        return { status: 409, ok: false, kod: 'slot-diambil', slot_ids: ids, mesej: `Slot ${labels.join(', ')} baru diambil orang lain. Sila pilih slot lain.` };
      }

      const rec = {
        ref: generateRef(this.refs),
        dicipta_pada: nowIso,
        nama: val.nama,
        telefon: val.telefon,
        emel: val.emel,
        tarikh: val.tarikh,
        slot_ids: harga.slot_ids.join(', '),
        slot_label: harga.slot_label,
        bil_slot: harga.bil_slot,
        dewasa: val.dewasa,
        kanak: val.kanak,
        addon: harga.addon,
        harga_slot: harga.harga_slot,
        harga_addon: harga.harga_addon,
        jumlah: harga.jumlah,
        status: 'PENDING',
        catatan: val.catatan,
        persetujuan_pdpa: 'TRUE ' + nowIso,
        dikemas_kini_pada: nowIso,
        dikemas_kini_oleh: 'pelanggan'
      };
      const row = objectToRow('Tempahan', rec, this.headers);
      try {
        await withGoogle(this.env, this.deps(), tenant, (access) => valuesAppend(this.fetch, access, tenant.sheetId, a1('Tempahan', 'A1'), [row]));
      } catch (e) {
        // Tulisan mungkin separuh berjaya (cth tamat masa): paksa indeks dibina semula sebelum tempahan seterusnya.
        this.idxStale = true;
        throw e;
      }
      this.idx.add(rec);
      this.refs.add(rec.ref);
      this.byRef.set(rec.ref, await this.entry(rec));

      return {
        status: 200,
        ok: true,
        ref: rec.ref,
        tempahan: {
          tarikh: rec.tarikh, slot_label: rec.slot_label, bil_slot: rec.bil_slot, dewasa: rec.dewasa, kanak: rec.kanak,
          addon: rec.addon, harga_slot: rec.harga_slot, harga_addon: rec.harga_addon, jumlah: rec.jumlah,
          jenis_hari: harga.jenis_hari, status: rec.status
        },
        // arahan_deposit hanya didedahkan SELEPAS tempahan dibuat (BSD 5)
        bayaran: { deposit: s.deposit ?? 0, arahan_deposit: s.arahan_deposit || '', link_bayaran: s.link_bayaran || '' }
      };
    });
  }

  // ---- semak status (IPD 3.6): Ref DAN telefon mesti sepadan, medan terhad ----
  async status(tenant, { ref, telefon, ipKey }) {
    return this.lock(async () => {
      if (!this.rate('status', ipKey) || !this.rate('statusRef', ref)) {
        return { status: 429, ok: false, kod: 'had-kadar', mesej: 'Terlalu banyak cubaan. Sila cuba lagi sebentar.' };
      }
      await this.ensure(tenant, { config: false, index: true });
      const e = this.byRef.get(ref);
      const h = await this.phoneHash(telefon);
      if (!e || e.h !== h) return { status: 404, ok: false, kod: 'tiada', mesej: 'Tiada tempahan sepadan. Semak Ref ID dan nombor telefon.' };
      return {
        status: 200,
        ok: true,
        tempahan: { ref, tarikh: e.tarikh, slot_label: e.slot_label, bil_slot: e.bil_slot, dewasa: e.dewasa, kanak: e.kanak, jumlah: e.jumlah, status: e.status }
      };
    });
  }
}

// Ralat Google -> respons mesra (dipanggil oleh DO)
export function googleFailure(e) {
  if (e instanceof GoogleError) {
    if (e.revoked) return { status: 503, ok: false, kod: 'tertutup', tertutup: 'tidak-tersedia', mesej: 'Tempahan tidak tersedia buat masa ini.' };
    if (e.status === 429) return { status: 503, ok: false, kod: 'sibuk', mesej: 'Sistem sibuk. Sila cuba lagi dalam seminit.' };
    if (e.status === 404 || e.status === 403) return { status: 503, ok: false, kod: 'tertutup', tertutup: 'tidak-tersedia', mesej: 'Tempahan tidak tersedia buat masa ini.' };
    return { status: 502, ok: false, kod: 'google', mesej: 'Gagal, cuba lagi.' };
  }
  return { status: 500, ok: false, kod: 'ralat', mesej: 'Gagal, cuba lagi.' };
}

