// Sesi pemilik studio (TRD 5): token HMAC { tid, email, exp } sah 14 hari, dihantar sebagai Authorization: Bearer.
// Semua semakan dibuat di server pada setiap permintaan.

import { signSession, verifySession } from './crypto.js';
import { bearer, HttpError } from './http.js';
import { getTenant } from '../registry.js';

export const SESSION_DAYS = 14;

export function issueSession(env, { tid, email }, nowMs = Date.now()) {
  return signSession({ tid, email, exp: Math.floor(nowMs / 1000) + SESSION_DAYS * 86400 }, env.SESSION_SECRET);
}

export async function readSession(request, env, nowMs = Date.now()) {
  if (!env.SESSION_SECRET) return null;
  const p = await verifySession(bearer(request), env.SESSION_SECRET, nowMs);
  if (!p || typeof p.tid !== 'string' || typeof p.email !== 'string') return null;
  return p;
}

// opts.allowDraft: benarkan tenant yang belum lengkap setup (tiada slug)
// opts.requireActive: tolak tenant yang digantung oleh pemilik platform
export async function requireTenant(request, env, deps, { allowDraft = false, requireActive = true } = {}) {
  const s = await readSession(request, env, deps.now());
  if (!s) throw new HttpError(401, 'sesi-tidak-sah', 'Sila log masuk semula.');
  const tenant = await getTenant(env, s.tid);
  if (!tenant || tenant.ownerEmail !== s.email) throw new HttpError(401, 'sesi-tidak-sah', 'Sila log masuk semula.');
  if (requireActive && tenant.status !== 'aktif') throw new HttpError(403, 'digantung', 'Akaun studio ini digantung. Hubungi sokongan.');
  if (!allowDraft && !tenant.slug) throw new HttpError(409, 'perlu-setup', 'Sila lengkapkan setup studio dahulu.');
  return { sesi: s, tenant };
}
