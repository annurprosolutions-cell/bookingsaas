// Kekosongan slot (BSD 4 "Peraturan bisnes").
// - Slot dikira TERISI untuk semua status kecuali CANCEL.
// - Bilangan terisi satu slot pada satu tarikh tidak boleh melebihi kapasiti.
// - CANCEL hanya melepaskan slot; tarikh dan slot dalam rekod kekal.
// - CANCEL -> status lain hanya jika slot masih kosong.
//
// Indeks ini ialah struktur dalam memori yang dipegang Durable Object (Fasa 3). Ia tidak
// menyimpan nama/telefon/emel, hanya (tarikh, slot, bilangan).

export const isOccupying = (status) => status !== 'CANCEL';

// "S01, S02" atau ['S01','S02'] -> ['S01','S02']
export function slotIdList(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

export class AvailabilityIndex {
  constructor(bookings = []) {
    this.counts = new Map();
    for (const b of bookings) this.add(b);
  }

  static key(date, slotId) {
    return date + '|' + slotId;
  }

  count(date, slotId) {
    return this.counts.get(AvailabilityIndex.key(date, slotId)) || 0;
  }

  _bump(b, delta) {
    if (!b || !b.tarikh || !isOccupying(b.status)) return;
    for (const id of slotIdList(b.slot_ids)) {
      const k = AvailabilityIndex.key(b.tarikh, id);
      const n = (this.counts.get(k) || 0) + delta;
      if (n > 0) this.counts.set(k, n);
      else this.counts.delete(k);
    }
  }

  add(b) {
    this._bump(b, +1);
  }

  remove(b) {
    this._bump(b, -1);
  }

  // Tukar rekod lama kepada baharu (edit tarikh/slot/status) dalam satu langkah.
  replace(oldB, newB) {
    this.remove(oldB);
    this.add(newB);
  }
}

// Kapasiti sah = integer >= 1. Nilai rosak/hilang jatuh ke 1 (BSD: lalai 1), TIDAK PERNAH "tanpa had".
export function kapasitiSlot(slot) {
  return Number.isInteger(slot && slot.kapasiti) && slot.kapasiti >= 1 ? slot.kapasiti : 1;
}

// Tarikh: tidak lampau, bukan tarikh tutup. closed = Map atau objek { tarikh: sebab }.
export { checkBookingDate as checkDate } from './validate.js';

// Semak sama ada slot-slot itu boleh diambil pada tarikh itu.
// opts.exclude   : rekod tempahan sedia ada yang sedang diedit (kedudukannya tidak dikira sebagai terisi)
// opts.allowInactive : benarkan slot tidak aktif (untuk memulihkan tempahan lama dari CANCEL)
// Pulangkan { ok, conflicts: [{ slot_id, kod }] } dengan kod: tiada | tidak-aktif | penuh
export function checkCapacity(index, { tarikh, slotIds }, slots, opts = {}) {
  const bySlot = new Map(slots.map((s) => [s.slot_id, s]));
  const own = new Set(opts.exclude && opts.exclude.tarikh === tarikh && isOccupying(opts.exclude.status) ? slotIdList(opts.exclude.slot_ids) : []);
  const conflicts = [];
  for (const id of slotIdList(slotIds)) {
    const s = bySlot.get(id);
    if (!s) {
      conflicts.push({ slot_id: id, kod: 'tiada' });
      continue;
    }
    if (!s.aktif && !opts.allowInactive) {
      conflicts.push({ slot_id: id, kod: 'tidak-aktif' });
      continue;
    }
    const terisi = index.count(tarikh, id) - (own.has(id) ? 1 : 0);
    if (terisi >= kapasitiSlot(s)) conflicts.push({ slot_id: id, kod: 'penuh' });
  }
  return { ok: conflicts.length === 0, conflicts };
}

// Senarai slot aktif untuk satu tarikh, ikut susunan, dengan bilangan terisi (tiada PII).
export function slotAvailability(date, slots, index) {
  return slots
    .filter((s) => s.aktif)
    .slice()
    .sort((a, b) => a.susunan - b.susunan || String(a.slot_id).localeCompare(String(b.slot_id)))
    .map((s) => {
      const terisi = index.count(date, s.slot_id);
      const kapasiti = kapasitiSlot(s);
      return {
        slot_id: s.slot_id,
        label: s.label,
        kumpulan: s.kumpulan,
        kapasiti,
        terisi,
        tinggal: Math.max(0, kapasiti - terisi),
        penuh: terisi >= kapasiti
      };
    });
}

// Kumpulkan ikut sesi (Pagi/Petang/Malam) mengikut susunan kemunculan pertama.
export function groupByKumpulan(avail) {
  const order = [];
  const map = new Map();
  for (const a of avail) {
    if (!map.has(a.kumpulan)) {
      map.set(a.kumpulan, []);
      order.push(a.kumpulan);
    }
    map.get(a.kumpulan).push(a);
  }
  return order.map((k) => ({ kumpulan: k, slots: map.get(k) }));
}

// Tukar status satu tempahan. Pulangkan { ok:true } atau { ok:false, kod, conflicts }.
// Indeks TIDAK diubah di sini; pemanggil memanggil index.replace(lama, baru) selepas tulisan Sheet berjaya.
export function checkStatusChange(index, booking, newStatus, slots) {
  if (!['PENDING', 'DEPOSIT', 'SELESAI', 'CANCEL'].includes(newStatus)) return { ok: false, kod: 'status-tidak-sah' };
  if (newStatus === booking.status) return { ok: true };
  if (booking.status === 'CANCEL' && newStatus !== 'CANCEL') {
    const r = checkCapacity(index, { tarikh: booking.tarikh, slotIds: booking.slot_ids }, slots, { allowInactive: true });
    if (!r.ok) return { ok: false, kod: 'slot-sudah-diambil', conflicts: r.conflicts };
  }
  return { ok: true };
}
