// Pembantu ujian Worker. Fixture asas ada dalam tests/fixtures/.
import { TenantLock } from '../worker/tenant-lock.js';
import { clearTokenCache } from '../worker/registry.js';
import { clearPublicCache } from '../worker/public.js';
import { readFileSync } from 'node:fs';
import { handle } from '../worker/index.mjs';
import { b64urlEncode } from '../worker/lib/crypto.js';
import { fakeKv } from './fixtures/fake-kv.mjs';
import { fakeGoogle, fakeIdToken, CLIENT_ID } from './fixtures/fake-google.mjs';

export { fakeKv, fakeGoogle, fakeIdToken, CLIENT_ID };

export const ENC_KEY = b64urlEncode(new Uint8Array(32).fill(7));
export const SESSION_SECRET = 's'.repeat(48);
export const ADMIN_TOKEN = 'a'.repeat(43);

export function fakeDoNamespace(getEnv, fetchFn) {
  const instances = new Map();
  const state = { storage: { sql: { exec: () => ({ one: () => ({ x: 1 }) }) } } };
  return {
    _instances: instances,
    idFromName: (n) => 'id:' + n,
    get(id) {
      if (!instances.has(id)) {
        instances.set(id, new TenantLock(state, getEnv(), { fetch: fetchFn, now: () => getEnv().__now ?? Date.now() }));
      }
      const inst = instances.get(id);
      return {
        fetch: (input, init) => inst.fetch(input instanceof Request ? input : new Request(input, init))
      };
    }
  };
}

export function fakeAssets(files = {}) {
  return {
    async fetch(req) {
      const p = new URL(req.url).pathname;
      if (p in files) return new Response(files[p], { status: 200 });
      return new Response('Not found', { status: 404 });
    }
  };
}

// env lengkap untuk ujian
export function makeEnv(google, extra = {}) {
  const env = {
    GOOGLE_CLIENT_ID: CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'GOCSPX-palsu-untuk-ujian',
    SESSION_SECRET,
    TOKEN_ENC_KEY: ENC_KEY,
    ADMIN_TOKEN,
    BCL_WEBHOOK_KEY: 'b'.repeat(48),
    TURNSTILE_SECRET: '0x4AAAAAAAAAAA-palsu',
    TURNSTILE_SITE_KEY: '0x4AAAAAAAAAAA-site',
    BCL_FORM_ID: '123',
    OWNER_EMAILS: 'pemilik@gmail.com',
    TRIAL_DAYS: '14',
    GRACE_DAYS: '7',
    BUY_URL: 'https://annurprosolutions1.bcl.my/form/annur-booking',
    ALLOWED_ORIGINS: 'https://booking.annurpro.com',
    REGISTRY: fakeKv(),
    ASSETS: fakeAssets({
      '/config.js': "window.ANNUR_CONFIG = { googleClientId: '" + CLIENT_ID + "', turnstileSiteKey: '0x4AAAAAAAAAAA-site' };",
      '/studio/': readFileSync(new URL('../studio/index.html', import.meta.url), 'utf8')
    }),
    ...extra
  };
  env.TENANT_LOCK = fakeDoNamespace(() => env, google ? google.fetch : fetch);
  clearTokenCache();
  clearPublicCache();
  return env;
}

export const ORIGIN = 'https://booking.annurpro.com';

export function req(path, { method = 'GET', body, token, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = 'Bearer ' + token;
  return new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}

// Jam tetap: 01/12/2026 10:00 waktu Malaysia
export const NOW = Date.parse('2026-12-01T02:00:00Z');
export const XHR = { 'x-requested-with': 'XMLHttpRequest', origin: ORIGIN };

// Panggil Worker dan pulangkan { status, j }
export async function call(env, g, path, { method = 'GET', body, token, headers = {}, now = NOW } = {}) {
  env.__now = now;
  const r = await handle(req(path, { method, body, token, headers: { ...(method !== 'GET' ? XHR : {}), ...headers } }), env, {
    fetch: g.fetch,
    now: () => now
  });
  const text = await r.text();
  let j = null;
  try {
    j = JSON.parse(text);
  } catch {
    j = { _text: text };
  }
  return { status: r.status, j };
}

export const login = (env, g, opts = {}) => call(env, g, '/api/auth/google', { method: 'POST', body: { code: '4/kod' }, ...opts });

export const WIZARD = {
  nama_studio: 'Wakanda Studio',
  slug: 'wakanda',
  whatsapp: '012-345 6789',
  alamat: 'Lot 1, Jalan Raya\nKuala Lumpur',
  maps_url: 'https://maps.app.goo.gl/abc123',
  waktu_pagi: '09:00 - 12:00',
  waktu_petang: '14:00 - 18:00',
  waktu_malam: '21:00 - 23:00',
  warna_utama: '#F97316',
  logo_url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view?usp=sharing',
  banners: ['https://i.postimg.cc/abc/banner.jpg', ''],
  harga_normal: 80,
  harga_special: '',
  deposit: 50,
  addons: [{ nama: 'Frame', harga: 30 }, { nama: '', harga: '' }],
  templat: 'raya'
};

// Studio siap (login + wizard). Pulangkan { g, env, sesi, tid, sheetId, sheet(tab) }
export async function setupStudio({ google, body = WIZARD, extra } = {}) {
  const g = fakeGoogle(google);
  const env = makeEnv(g, extra);
  const { j } = await login(env, g);
  const r = await call(env, g, '/api/tenant/setup', { method: 'POST', body, token: j.sesi });
  if (r.status !== 200) throw new Error('setup gagal: ' + JSON.stringify(r.j));
  const tid = env.REGISTRY._map.get('owner:ujian@gmail.com');
  const sheetId = JSON.parse(env.REGISTRY._map.get('tenant:' + tid)).sheetId;
  const sheet = (tab) => g.state.sheets.get(sheetId).tabs[tab].rows;
  return { g, env, sesi: j.sesi, tid, sheetId, sheet };
}

let tokN = 0;
export const turnstileToken = () => 'tok-' + ++tokN;
