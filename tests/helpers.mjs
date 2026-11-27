// Pembantu ujian Worker. Fixture asas ada dalam tests/fixtures/.
import { TenantLock } from '../worker/tenant-lock.js';
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
    idFromName: (n) => 'id:' + n,
    get(id) {
      if (!instances.has(id)) instances.set(id, new TenantLock(state, getEnv(), { fetch: fetchFn }));
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
    SPIKE_EMAILS: 'ujian@gmail.com',
    ALLOWED_ORIGINS: 'https://booking.annurpro.com',
    REGISTRY: fakeKv(),
    ASSETS: fakeAssets({
      '/config.js': "window.ANNUR_CONFIG = { googleClientId: '" + CLIENT_ID + "', turnstileSiteKey: '0x4AAAAAAAAAAA-site' };"
    }),
    ...extra
  };
  env.TENANT_LOCK = fakeDoNamespace(() => env, google ? google.fetch : fetch);
  return env;
}

export const ORIGIN = 'https://booking.annurpro.com';

export function req(path, { method = 'GET', body, token, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['content-type'] = 'application/json';
  if (token) h.authorization = 'Bearer ' + token;
  return new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
}
