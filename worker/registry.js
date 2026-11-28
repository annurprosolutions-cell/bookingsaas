// Registry platform dalam KV (BSD 3). Tiada data pelanggan studio di sini.
// tenant:<tid>  slug:<slug> -> tid  owner:<email> -> tid  email:<email> (licence)  trial:<email>

import { decryptText } from './lib/crypto.js';
import { refreshAccessToken, GoogleError } from './lib/google.js';

export async function getJson(env, key) {
  const raw = await env.REGISTRY.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const getTenant = (env, tid) => getJson(env, 'tenant:' + tid);
export const putTenant = (env, t) => env.REGISTRY.put('tenant:' + t.tid, JSON.stringify(t));
export const getLicence = (env, email) => getJson(env, 'email:' + email);
export const putLicence = (env, email, rec) => env.REGISTRY.put('email:' + email, JSON.stringify(rec));

// Operasi unik melalui Durable Object "registry" (lihat tenant-lock.js)
export async function registry(env, body) {
  const stub = env.TENANT_LOCK.get(env.TENANT_LOCK.idFromName('registry'));
  const res = await stub.fetch('https://do.internal/registry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

// Pajakan ringkas per tenant (elak setup berganda bila butang ditekan dua kali)
export async function withLease(env, tid, name, ms, fn) {
  const stub = env.TENANT_LOCK.get(env.TENANT_LOCK.idFromName('tenant:' + tid));
  const call = (op) =>
    stub
      .fetch('https://do.internal/lease', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ op, name, ms })
      })
      .then((r) => r.json());
  const got = await call('ambil');
  if (!got.ok) return { busy: true };
  try {
    return { busy: false, value: await fn() };
  } finally {
    await call('lepas').catch(() => {});
  }
}

// ---- access token Google bagi pihak studio ----
// Cache dalam memori isolate sahaja (tidak pernah disimpan). Kunci = rt berenkripsi, jadi rt baharu = cache baharu.
const tokenCache = new Map();

export function clearTokenCache() {
  tokenCache.clear();
}

export async function accessTokenFor(env, deps, tenant) {
  const now = deps.now();
  const c = tokenCache.get(tenant.rt);
  if (c && c.exp - 60000 > now) return c.access;
  let rt;
  try {
    rt = await decryptText(tenant.rt, env.TOKEN_ENC_KEY);
  } catch {
    throw new GoogleError(401, 'invalid_grant', 'Token tidak boleh dibuka');
  }
  try {
    const t = await refreshAccessToken(deps.fetch, env, rt);
    tokenCache.set(tenant.rt, { access: t.access_token, exp: now + (t.expires_in || 3600) * 1000 });
    if (tokenCache.size > 500) tokenCache.delete(tokenCache.keys().next().value);
    return t.access_token;
  } catch (e) {
    if (e instanceof GoogleError && e.revoked && tenant.conn !== 'putus') {
      // TRD 5: invalid_grant -> tanda conn:"putus". Halaman awam tutup, pemilik nampak "Sambung semula".
      const semasa = (await getTenant(env, tenant.tid)) || tenant; // baca semula: elak menimpa medan yang baru dikemas kini
      await putTenant(env, { ...semasa, conn: 'putus' });
    }
    throw e;
  }
}

export function forgetToken(tenant) {
  tokenCache.delete(tenant.rt);
}

// Jalankan fn(access). Jika Google menolak access token dari cache (401: akses ditarik balik atau tamat),
// buang cache dan cuba sekali lagi dengan token baharu. Jika refresh token sendiri sudah ditarik balik,
// accessTokenFor menanda tenant conn:"putus" dan membuang GoogleError invalid_grant.
export async function withGoogle(env, deps, tenant, fn) {
  const access = await accessTokenFor(env, deps, tenant);
  try {
    return await fn(access);
  } catch (e) {
    if (!(e instanceof GoogleError) || e.status !== 401 || e.revoked) throw e;
    forgetToken(tenant);
    const baru = await accessTokenFor(env, deps, tenant);
    return fn(baru);
  }
}
