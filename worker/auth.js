// Login Google dan akaun studio (F-02, F-14). TRD 5.

import { json, readJson, HttpError } from './lib/http.js';
import { encryptText, decryptText, randomId } from './lib/crypto.js';
import { exchangeCode, revokeToken, readIdToken, hasScope, DRIVE_FILE_SCOPE, sheetUrl, driveGetFile, GoogleError } from './lib/google.js';
import { isoMY, todayMY } from './lib/time.js';
import { issueSession, requireTenant } from './lib/session.js';
import { getTenant, putTenant, getLicence, putLicence, registry, withGoogle, withLease, forgetToken } from './registry.js';
import { startTrial, licenceStatus, DEFAULT_TRIAL_DAYS, DEFAULT_GRACE_DAYS } from '../js/core/licence.js';
import { setupTenantSheet, SetupError } from './sheet-setup.js';

function requireXhr(request) {
  // Perlindungan CSRF untuk aliran kod popup GIS (disyorkan Google)
  if (request.headers.get('x-requested-with') !== 'XMLHttpRequest') throw new HttpError(400, 'csrf', 'Permintaan tidak sah');
}

function requireGoogleConfig(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENC_KEY || !env.SESSION_SECRET || !env.REGISTRY || !env.TENANT_LOCK) {
    throw new HttpError(503, 'belum-setup', 'Platform belum lengkap dipasang. Hubungi pemilik platform.');
  }
}

const intEnv = (v, d) => {
  const n = Number(v);
  return v === undefined || v === null || v === '' || !Number.isInteger(n) ? d : n;
};

async function readCode(request) {
  const b = await readJson(request, 4096);
  const code = typeof b.code === 'string' ? b.code : '';
  if (!code || code.length > 2048) throw new HttpError(400, 'tiada-kod', 'Kod Google tiada');
  return code;
}

// Tukar kod -> token dan semak skop. Pulangkan { tok, email } atau respons ralat siap.
async function exchangeAndCheck(env, deps, code) {
  let tok;
  try {
    tok = await exchangeCode(deps.fetch, env, code);
  } catch (e) {
    // Kod tamat/sudah digunakan (invalid_grant) ialah ralat login biasa, BUKAN sambungan studio terputus.
    if (e instanceof GoogleError && e.status >= 400 && e.status < 500) {
      if (e.reason === 'invalid_client' || e.reason === 'unauthorized_client') {
        throw new HttpError(503, 'belum-setup', 'Konfigurasi Google platform tidak sah. Hubungi pemilik platform.');
      }
      throw new HttpError(400, 'kod-tidak-sah', 'Log masuk Google tidak berjaya. Sila tekan sekali lagi.');
    }
    throw e;
  }
  const id = readIdToken(tok.id_token, env.GOOGLE_CLIENT_ID, deps.now());
  if (!hasScope(tok.scope, DRIVE_FILE_SCOPE)) {
    await revokeToken(deps.fetch, tok.access_token);
    return {
      res: json({
        ok: false,
        kod: 'tiada-skop-drive',
        mesej: 'Kebenaran Google Drive tidak ditanda. Tekan sekali lagi dan TANDA kotak Google Drive supaya sistem boleh mencipta Sheet anda.'
      })
    };
  }
  return { tok, email: id.email };
}

const TIADA_RT = {
  ok: false,
  kod: 'tiada-refresh-token',
  mesej: 'Google tidak memberi kebenaran penuh kali ini. Akses telah ditetapkan semula secara automatik. Sila tekan "Teruskan dengan Google" sekali lagi.'
};

// POST /api/auth/google
export async function authGoogle(request, env, deps) {
  requireXhr(request);
  requireGoogleConfig(env);
  const code = await readCode(request);
  const x = await exchangeAndCheck(env, deps, code);
  if (x.res) return x.res;
  const { tok, email } = x;
  const now = deps.now();

  const tidAda = await env.REGISTRY.get('owner:' + email);
  let tenant = tidAda ? await getTenant(env, tidAda) : null;
  const rtBaru = typeof tok.refresh_token === 'string' && tok.refresh_token.length > 0;

  // Google hanya memberi refresh token pada persetujuan pertama. Tanpanya (dan tiada yang sah disimpan),
  // tarik balik supaya cubaan seterusnya memaparkan persetujuan penuh.
  if (!rtBaru && (!tenant || !tenant.rt || tenant.conn === 'putus')) {
    await revokeToken(deps.fetch, tok.access_token);
    return json(TIADA_RT);
  }
  const rt = rtBaru ? await encryptText(tok.refresh_token, env.TOKEN_ENC_KEY) : tenant.rt;

  if (!tenant) {
    const draf = {
      tid: randomId(12),
      slug: '',
      ownerEmail: email,
      shopName: '',
      sheetId: '',
      rt,
      conn: 'ok',
      status: 'aktif',
      schema: 1,
      createdAt: isoMY(now)
    };
    const r = await registry(env, { op: 'owner', email, tenant: draf });
    if (!r.ok) throw new HttpError(500, 'ralat', 'Gagal mencipta akaun. Cuba lagi.');
    tenant = r.baru ? draf : await getTenant(env, r.tid);
    if (!tenant) throw new HttpError(503, 'cuba-lagi', 'Sila cuba sebentar lagi.');
    if (!r.baru && rtBaru) {
      tenant = { ...tenant, rt, conn: 'ok' };
      await putTenant(env, tenant);
    }
  } else if (rtBaru || tenant.conn !== 'ok') {
    tenant = { ...tenant, rt, conn: 'ok' };
    await putTenant(env, tenant);
  }

  // Trial automatik 14 hari (sekali sahaja setiap emel)
  if (!(await getLicence(env, email))) {
    const marker = await env.REGISTRY.get('trial:' + email);
    const trial = startTrial({
      today: todayMY(now),
      trialMarker: marker,
      trialDays: intEnv(env.TRIAL_DAYS, DEFAULT_TRIAL_DAYS),
      shop: tenant.shopName || '',
      nowIso: isoMY(now)
    });
    if (trial) {
      await putLicence(env, email, trial);
      await env.REGISTRY.put('trial:' + email, todayMY(now));
    }
  }

  const sesi = await issueSession(env, { tid: tenant.tid, email }, now);
  return json({ ok: true, sesi, email, perluSetup: !tenant.slug });
}

// POST /api/auth/logout (sesi tanpa keadaan: klien buang token)
export function authLogout() {
  return json({ ok: true });
}

export function licenceView(env, rec, now) {
  const st = licenceStatus(rec, todayMY(now), { graceDays: intEnv(env.GRACE_DAYS, DEFAULT_GRACE_DAYS) });
  return {
    plan: rec ? rec.plan : null,
    expires: rec ? rec.expires : null,
    state: st.state,
    allowed: st.allowed,
    daysLeft: st.daysLeft,
    reason: st.reason,
    notice: st.notice
  };
}

// Semakan sambungan sebenar (F-14): segar token (tanpa cache) dan buka metadata Sheet melalui Drive API.
// Tiada kuota Sheets digunakan. Pulangkan status Sheet: ok | dibuang (Tong Sampah) | hilang | tidak-diketahui
async function semakSambungan(env, deps, tenant) {
  if (!tenant.rt || tenant.conn === 'putus' || !tenant.sheetId) return 'tidak-diketahui';
  forgetToken(tenant);
  try {
    const f = await withGoogle(env, deps, tenant, (access) => driveGetFile(deps.fetch, access, tenant.sheetId));
    return f && f.trashed ? 'dibuang' : 'ok';
  } catch (e) {
    if (e instanceof GoogleError && e.status === 404) return 'hilang';
    if (e instanceof GoogleError && e.revoked) return 'tidak-diketahui'; // tenant kini ditanda conn:"putus"
    return 'tidak-diketahui';
  }
}

// GET /api/me   (?semak=1 untuk semakan sambungan Google sebenar)
export async function me(request, env, deps) {
  const auth = await requireTenant(request, env, deps, { allowDraft: true, requireActive: false });
  const { sesi } = auth;
  let tenant = auth.tenant;
  const origin = new URL(request.url).origin;
  let sheet = 'tidak-diketahui';
  if (new URL(request.url).searchParams.get('semak') === '1') {
    sheet = await semakSambungan(env, deps, tenant);
    tenant = (await getTenant(env, tenant.tid)) || tenant;
  }
  const lic = await getLicence(env, sesi.email);
  return json({
    ok: true,
    email: sesi.email,
    studio: {
      slug: tenant.slug,
      nama: tenant.shopName,
      url: tenant.slug ? origin + '/' + tenant.slug : '',
      sheetUrl: tenant.sheetId ? sheetUrl(tenant.sheetId) : '',
      conn: tenant.conn,
      sheet,
      status: tenant.status,
      perluSetup: !tenant.slug
    },
    licence: licenceView(env, lic, deps.now()),
    buyUrl: env.BUY_URL || '',
    harga: { bulan: Number(env.PRICE_MONTH || 100), tahun: Number(env.PRICE_YEAR || 1000) }
  });
}

// POST /api/admin/reconnect  (sesi + kod OAuth baharu)
export async function reconnect(request, env, deps) {
  requireXhr(request);
  requireGoogleConfig(env);
  const { tenant } = await requireTenant(request, env, deps, { allowDraft: true, requireActive: false });
  const code = await readCode(request);
  const x = await exchangeAndCheck(env, deps, code);
  if (x.res) return x.res;
  const { tok, email } = x;
  if (email !== tenant.ownerEmail) {
    await revokeToken(deps.fetch, tok.access_token);
    throw new HttpError(403, 'emel-lain', `Sila guna akaun Google yang sama (${tenant.ownerEmail}).`);
  }
  const rtBaru = typeof tok.refresh_token === 'string' && tok.refresh_token.length > 0;
  if (!rtBaru && (!tenant.rt || tenant.conn === 'putus')) {
    await revokeToken(deps.fetch, tok.access_token);
    return json(TIADA_RT);
  }
  let t = { ...tenant, rt: rtBaru ? await encryptText(tok.refresh_token, env.TOKEN_ENC_KEY) : tenant.rt, conn: 'ok' };
  await putTenant(env, t);

  // BSD 6.1: reconnect juga menyemak dan membaiki Sheet
  let sheet = null;
  if (t.slug) {
    const r = await withLease(env, t.tid, 'setup', 60000, async () => {
      return withGoogle(env, deps, t, (access) =>
        setupTenantSheet({
          fetch: deps.fetch,
          access,
          sheetId: t.sheetId,
          seed: { tetapan: { nama_studio: t.shopName }, templat: 'kosong' },
          nowIso: isoMY(deps.now()),
          onCreated: async (id) => {
            t = { ...t, sheetId: id };
            await putTenant(env, t);
          }
        })
      );
    });
    if (r.busy) throw new HttpError(409, 'sedang-berjalan', 'Proses lain sedang berjalan. Cuba lagi sebentar.');
    sheet = r.value;
  }
  return json({
    ok: true,
    sheetBaru: !!(sheet && sheet.dicipta),
    sheetUrl: t.sheetId ? sheetUrl(t.sheetId) : '',
    dibaiki: sheet ? { tabBaru: sheet.tabBaru, lajurDitambah: sheet.lajurDitambah } : null
  });
}

// DELETE /api/admin/account  { sahkan: <slug> }  (F-14)
// Padam registry studio (tenant, slug, owner). Sheet kekal milik studio dalam Drive mereka.
// Licence dan penanda trial DISIMPAN sebagai rekod billing dan untuk mengelak trial berulang.
export async function deleteAccount(request, env, deps) {
  const { tenant } = await requireTenant(request, env, deps, { allowDraft: true, requireActive: false });
  const b = await readJson(request, 1024);
  const perlu = tenant.slug || 'PADAM';
  if (typeof b.sahkan !== 'string' || b.sahkan.trim().toLowerCase() !== perlu.toLowerCase()) {
    throw new HttpError(400, 'sahkan', `Taip "${perlu}" untuk mengesahkan.`);
  }
  let ditarik = false;
  if (tenant.rt) {
    try {
      ditarik = await revokeToken(deps.fetch, await decryptText(tenant.rt, env.TOKEN_ENC_KEY));
    } catch {
      ditarik = false;
    }
  }
  await registry(env, { op: 'release', tid: tenant.tid, slug: tenant.slug, email: tenant.ownerEmail });
  return json({ ok: true, ditarik, sheetUrl: tenant.sheetId ? sheetUrl(tenant.sheetId) : '' });
}

export { SetupError };
