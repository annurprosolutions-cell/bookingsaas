// Semak slug dan setup studio (F-03). AFD A3 langkah 4 hingga 9.

import { json, readJson, HttpError } from './lib/http.js';
import { sheetUrl } from './lib/google.js';
import { isoMY } from './lib/time.js';
import { requireTenant } from './lib/session.js';
import { putTenant, getLicence, putLicence, registry, withGoogle, withLease } from './registry.js';
import { validateSlug, validateWizard } from '../js/core/validate.js';
import { setupTenantSheet } from './sheet-setup.js';

// GET /api/slug/check?slug=
export async function slugCheck(request, env, deps) {
  const { tenant } = await requireTenant(request, env, deps, { allowDraft: true });
  const slug = (new URL(request.url).searchParams.get('slug') || '').trim();
  const v = validateSlug(slug);
  if (!v.ok) return json({ ok: true, tersedia: false, kod: v.kod, mesej: v.mesej });
  const ada = await env.REGISTRY.get('slug:' + slug);
  if (ada && ada !== tenant.tid) return json({ ok: true, tersedia: false, kod: 'diambil', mesej: 'Nama ini sudah digunakan studio lain.' });
  return json({ ok: true, tersedia: true });
}

// POST /api/tenant/setup  (body = jawapan wizard)
export async function tenantSetup(request, env, deps) {
  const { sesi, tenant } = await requireTenant(request, env, deps, { allowDraft: true });
  const body = await readJson(request, 32 * 1024);
  const origin = new URL(request.url).origin;

  // Sudah siap setup: jalankan semakan/pembaikan sahaja (idempotent), slug tidak berubah.
  const sudahSiap = !!tenant.slug;
  let w = null;
  if (!sudahSiap) {
    w = validateWizard(body);
    if (!w.ok) return json({ ok: false, kod: 'tidak-sah', mesej: 'Sila semak maklumat yang ditanda.', errors: w.errors }, 400);
    // Semakan awal (tanpa kunci). Tuntutan sebenar dibuat SELEPAS Sheet berjaya dicipta.
    const ada = await env.REGISTRY.get('slug:' + w.value.slug);
    if (ada && ada !== tenant.tid) {
      return json({ ok: false, kod: 'slug-diambil', mesej: 'Nama pautan ini baru sahaja diambil. Pilih nama lain.', errors: { slug: 'Sudah digunakan.' } }, 409);
    }
  }

  let t = tenant;
  const r = await withLease(env, tenant.tid, 'setup', 90000, async () => {
    const seed = w ? { tetapan: w.value.tetapan, templat: w.value.templat, addons: w.value.addons, banners: w.value.banners } : { tetapan: { nama_studio: t.shopName }, templat: 'kosong' };
    return withGoogle(env, deps, t, (access) => setupTenantSheet({
      fetch: deps.fetch,
      access,
      sheetId: t.sheetId,
      seed,
      nowIso: isoMY(deps.now()),
      // Simpan sheetId sebaik Sheet dicipta supaya cubaan semula tidak mencipta Sheet kedua
      onCreated: async (id) => {
        t = { ...t, sheetId: id };
        await putTenant(env, t);
      }
    }));
  });
  if (r.busy) throw new HttpError(409, 'sedang-berjalan', 'Setup sedang berjalan. Tunggu sebentar.');
  const sheet = r.value;

  if (!sudahSiap) {
    // Tuntut slug secara atomik. Jika gagal, Sheet kekal (sheetId sudah disimpan) dan pengguna pilih nama lain.
    const c = await registry(env, { op: 'slug', slug: w.value.slug, tid: t.tid });
    if (!c.ok) {
      return json({ ok: false, kod: 'slug-diambil', mesej: 'Nama pautan ini baru sahaja diambil. Pilih nama lain.', errors: { slug: 'Sudah digunakan.' } }, 409);
    }
    t = { ...t, slug: w.value.slug, shopName: w.value.tetapan.nama_studio, sheetId: sheet.sheetId, conn: 'ok', schema: 1 };
    await putTenant(env, t);
    const lic = await getLicence(env, sesi.email);
    if (lic && !lic.shop) await putLicence(env, sesi.email, { ...lic, shop: t.shopName });
  }

  return json({
    ok: true,
    slug: t.slug,
    url: origin + '/' + t.slug,
    sheetUrl: sheetUrl(t.sheetId),
    sheetBaru: sheet.dicipta,
    warnings: w ? w.warnings : {}
  });
}
