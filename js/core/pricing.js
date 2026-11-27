// Pengiraan harga (BSD 4: harga dikira di server daripada tetapan Sheet; klien tidak pernah dipercayai).
// Semua wang dikira dalam sen (integer) untuk mengelak ralat titik terapung, kemudian dipulangkan dalam RM.

// EPSILON: 1.005 * 100 = 100.49999... dalam titik terapung; tanpa pembetulan ia dibundar ke bawah.
export const toSen = (n) => Math.round((Number(n) + Number.EPSILON) * 100);
export const fromSen = (s) => s / 100;

// 30 -> "RM30", 30.5 -> "RM30.50"
export function formatRM(n) {
  const v = toSen(n) / 100;
  return 'RM' + (Number.isInteger(v) ? String(v) : v.toFixed(2));
}

// hariSpecial: array tarikh (rentetan) atau array objek { tarikh }
export function isSpecialDate(date, hariSpecial = []) {
  return hariSpecial.some((h) => (typeof h === 'string' ? h : h && h.tarikh) === date);
}

// Harga satu slot pada tarikh itu. harga_special kosong = harga_normal.
export function pricePerSlot(date, settings, hariSpecial = []) {
  const normal = Number(settings.harga_normal);
  if (!isFinite(normal) || normal < 0) return null;
  if (!isSpecialDate(date, hariSpecial)) return normal;
  const sp = settings.harga_special;
  return sp === undefined || sp === null || sp === '' || !isFinite(Number(sp)) ? normal : Number(sp);
}

export function addonLabel(addon) {
  return `${addon.nama} (+${formatRM(addon.harga)})`;
}

// Kira tempahan penuh. Input klien hanya slotIds dan addonIds (id); jumlah/harga dari klien tiada laluan masuk.
// slots/addons: baris Sheet bertaip (aktif ialah boolean). Pulangkan { ok:true, ... } atau { ok:false, kod, ... }.
export function computeBooking({ tarikh, slotIds, addonIds = [], settings, slots, addons = [], hariSpecial = [] }) {
  const perSlot = pricePerSlot(tarikh, settings, hariSpecial);
  if (perSlot === null) return { ok: false, kod: 'harga-belum-ditetapkan' };

  const ids = Array.isArray(slotIds) ? slotIds : [];
  if (ids.length === 0) return { ok: false, kod: 'tiada-slot' };
  if (new Set(ids).size !== ids.length) return { ok: false, kod: 'slot-berganda' };

  const bySlot = new Map(slots.map((s) => [s.slot_id, s]));
  const chosen = [];
  for (const id of ids) {
    const s = bySlot.get(id);
    if (!s) return { ok: false, kod: 'slot-tidak-sah', slot_id: id };
    if (!s.aktif) return { ok: false, kod: 'slot-tidak-aktif', slot_id: id };
    chosen.push(s);
  }
  chosen.sort((a, b) => a.susunan - b.susunan || String(a.slot_id).localeCompare(String(b.slot_id)));

  const aIds = Array.isArray(addonIds) ? addonIds : [];
  if (new Set(aIds).size !== aIds.length) return { ok: false, kod: 'addon-berganda' };
  const byAddon = new Map(addons.map((a) => [a.addon_id, a]));
  const pickedAddons = [];
  for (const id of aIds) {
    const a = byAddon.get(id);
    if (!a) return { ok: false, kod: 'addon-tidak-sah', addon_id: id };
    if (!a.aktif) return { ok: false, kod: 'addon-tidak-aktif', addon_id: id };
    pickedAddons.push(a);
  }
  pickedAddons.sort((a, b) => a.susunan - b.susunan || String(a.addon_id).localeCompare(String(b.addon_id)));

  const hargaSlotSen = toSen(perSlot) * chosen.length;
  const hargaAddonSen = pickedAddons.reduce((t, a) => t + toSen(a.harga), 0);

  return {
    ok: true,
    jenis_hari: isSpecialDate(tarikh, hariSpecial) ? 'special' : 'normal',
    harga_seslot: perSlot,
    slot_ids: chosen.map((s) => s.slot_id),
    slot_label: chosen.map((s) => s.label).join(', '),
    bil_slot: chosen.length,
    addon: pickedAddons.map(addonLabel).join(', '),
    harga_slot: fromSen(hargaSlotSen),
    harga_addon: fromSen(hargaAddonSen),
    jumlah: fromSen(hargaSlotSen + hargaAddonSen)
  };
}
