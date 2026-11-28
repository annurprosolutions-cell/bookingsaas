// Annur Booking - Cloudflare Worker (API + static assets)
// Fungsi handle(request, env, deps) boleh diuji dalam Node dengan KV palsu dan fetch palsu.

import { json, error, bearer, sameOrigin, HttpError, SECURITY_HEADERS } from './lib/http.js';
import { safeEqual } from './lib/crypto.js';
import { GoogleError } from './lib/google.js';
import { setupCheck } from './setup-check.js';
import { authGoogle, authLogout, me, reconnect, deleteAccount } from './auth.js';
import { slugCheck, tenantSetup } from './tenant.js';
import { SetupError } from './sheet-setup.js';
import { publicApi, studioPage, studioManifest } from './public.js';
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

// [kaedah, laluan, pengendali, tulis?]  Permintaan tulis mesti dari origin sendiri.
const ROUTES = [
  ['POST', '/api/auth/google', authGoogle, true],
  ['POST', '/api/auth/logout', authLogout, true],
  ['GET', '/api/me', me, false],
  ['GET', '/api/slug/check', slugCheck, false],
  ['POST', '/api/tenant/setup', tenantSetup, true],
  ['POST', '/api/admin/reconnect', reconnect, true],
  ['DELETE', '/api/admin/account', deleteAccount, true]
];

function routeError(e) {
  if (e instanceof HttpError) return error(e.status, e.kod, e.message);
  if (e instanceof SetupError) return error(e.status, e.kod, e.message);
  if (e instanceof GoogleError) {
    if (e.status === 401 && (e.reason === 'id_token' || e.reason === 'email_unverified')) {
      return error(401, 'login-tidak-sah', e.reason === 'email_unverified' ? 'Emel Google ini belum disahkan oleh Google.' : 'Log masuk Google tidak sah. Cuba lagi.');
    }
    if (e.revoked) {
      return error(401, 'google-putus', 'Sambungan Google terputus. Tekan "Sambung semula" dan log masuk dengan akaun yang sama.');
    }
    if (e.status === 429) return error(503, 'google-sibuk', 'Google sedang sibuk. Cuba lagi dalam seminit.');
    return error(502, 'google', 'Google tidak dapat memproses permintaan sekarang. Cuba lagi.');
  }
  return error(500, 'ralat', 'Ralat dalaman');
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

    const pub = /^\/api\/public\/([^/]{1,40})\/(config|slots|book|status)$/.exec(path);
    if (pub) {
      if (request.method === 'POST' && !sameOrigin(request, env)) return error(403, 'origin', 'Origin tidak dibenarkan');
      try {
        return await publicApi(request, env, d, pub[1], pub[2]);
      } catch (e) {
        return routeError(e);
      }
    }

    if (path.startsWith('/api/') || path === '/api') {
      const route = ROUTES.find(([, p]) => p === path);
      if (!route) return error(404, 'tiada', 'Tidak dijumpai');
      const [method, , fn, tulis] = route;
      if (request.method !== method) return error(405, 'kaedah', 'Kaedah tidak dibenarkan');
      if (tulis && !sameOrigin(request, env)) return error(403, 'origin', 'Origin tidak dibenarkan');
      try {
        return await fn(request, env, d);
      } catch (e) {
        return routeError(e);
      }
    }

    // /bcl/<KEY> dibina dalam Fasa 5.
    if (path.startsWith('/bcl/')) return error(404, 'tiada', 'Tidak dijumpai');

    // Halaman awam studio /<slug> (fail statik sedia ada sudah dihidang oleh lapisan assets sebelum sampai ke sini)
    if (request.method === 'GET' || request.method === 'HEAD') {
      const man = /^\/([a-z0-9-]{3,30})\/manifest\.webmanifest$/.exec(path);
      if (man) return await studioManifest(request, env, d, man[1]);
      const m = /^\/([A-Za-z0-9-]{3,30})\/?$/.exec(path);
      if (m) {
        const lower = m[1].toLowerCase();
        if (lower !== m[1]) return Response.redirect(url.origin + '/' + lower + url.search, 301);
        if (env.ASSETS) {
          // Fail/folder statik dengan nama yang sama (cth /daftar) diutamakan
          const asset = await env.ASSETS.fetch(request);
          if (asset.status !== 404) return withSecurityHeaders(asset);
        }
        return await studioPage(request, env, d, lower);
      }
    }

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
