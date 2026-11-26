// Annur Booking - Cloudflare Worker (API + static assets)
// Fungsi handle(request, env, deps) boleh diuji dalam Node dengan KV palsu dan fetch palsu.

import { json, error, bearer, SECURITY_HEADERS } from './lib/http.js';
import { safeEqual } from './lib/crypto.js';
import { setupCheck } from './setup-check.js';
import { handleSpike } from './spike.js';
import { TenantLock } from './tenant-lock.js';
import { VERSION } from './version.js';

// Nota: modul utama Worker hanya boleh mengeksport handler/kelas (fungsi), bukan nilai biasa.
export { TenantLock };

// R-03: Fasa 0 hanya ADMIN_TOKEN. Login Google untuk emel OWNER_EMAILS ditambah dalam Fasa 5.
async function isPlatformAdmin(request, env) {
  const t = bearer(request);
  if (!t || !env.ADMIN_TOKEN) return false;
  return safeEqual(t, String(env.ADMIN_TOKEN));
}

function withSecurityHeaders(res) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!r.headers.has(k)) r.headers.set(k, v);
  }
  return r;
}

export async function handle(request, env, deps = {}) {
  const d = {
    fetch: deps.fetch || ((...a) => fetch(...a)),
    now: deps.now || (() => Date.now()),
    waitUntil: deps.waitUntil || (() => {})
  };
  const url = new URL(request.url);
  const path = url.pathname;

  try {
    if (path === '/api/health') {
      return json({ ok: true, versi: VERSION });
    }

    if (path === '/api/platform/setup-check') {
      if (request.method !== 'GET') return error(405, 'kaedah', 'Kaedah tidak dibenarkan');
      if (!env.ADMIN_TOKEN) {
        return error(503, 'tiada-admin-token', 'ADMIN_TOKEN belum dipasang di Cloudflare. Pasang dahulu, kemudian semak semula.');
      }
      if (!(await isPlatformAdmin(request, env))) return error(401, 'tidak-dibenarkan', 'Token tidak sah');
      return json({ ok: true, versi: VERSION, ...(await setupCheck(env, url.origin)) });
    }

    if (path.startsWith('/api/spike/')) {
      return await handleSpike(request, env, d, path);
    }

    if (path.startsWith('/api/') || path === '/api') {
      return error(404, 'tiada', 'Tidak dijumpai');
    }

    // /bcl/<KEY> dibina dalam Fasa 5.
    if (path.startsWith('/bcl/')) return error(404, 'tiada', 'Tidak dijumpai');

    // Selain itu: static assets. (Halaman /<slug> dibina dalam Fasa 3.)
    if (env.ASSETS) return withSecurityHeaders(await env.ASSETS.fetch(request));
    return error(404, 'tiada', 'Tidak dijumpai');
  } catch {
    // Jangan log butiran (elak PII/token dalam log).
    return error(500, 'ralat', 'Ralat dalaman');
  }
}

export default {
  fetch(request, env, ctx) {
    return handle(request, env, {
      waitUntil: (p) => ctx.waitUntil(p)
    });
  }
};
