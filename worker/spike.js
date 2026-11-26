// PROTOTAIP RISIKO (IPD 0.9). Akan DIBUANG selepas lulus (awal Fasa 1).
// Aktif hanya bila var SPIKE_EMAILS diisi, dan hanya untuk emel dalam senarai itu.
//
// Membuktikan:
//  (a) kod OAuth (GIS popup) boleh ditukar kepada refresh token di Worker
//  (b) Worker boleh cipta Google Sheet dengan skop drive.file, dan Drive API nampak fail itu
//  (c) Worker boleh tulis ke Sheet guna refresh token sahaja (tanpa token dari pelayar)
//  (d) Durable Object SQLite berjalan dan kunci menghalang tempahan berganda

import { json, error, readJson, bearer, sameOrigin, HttpError } from './lib/http.js';
import { encryptText, decryptText, signSession, verifySession } from './lib/crypto.js';
import {
  exchangeCode,
  refreshAccessToken,
  revokeToken,
  readIdToken,
  hasScope,
  DRIVE_FILE_SCOPE,
  createSpreadsheet,
  valuesUpdate,
  valuesAppend,
  valuesGet,
  driveGetFile,
  a1,
  GoogleError
} from './lib/google.js';
import { isoMY } from './lib/time.js';

const TTL_REKOD = 3 * 24 * 3600; // rekod spike dipadam sendiri oleh KV selepas 3 hari
const TAJUK_SHEET = 'Annur Booking - Prototaip (BOLEH PADAM)';

function spikeEmails(env) {
  return String(env.SPIKE_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function spikeEnabled(env) {
  return spikeEmails(env).length > 0;
}

async function auth(request, env, now) {
  const p = await verifySession(bearer(request), env.SESSION_SECRET, now);
  if (!p || !p.spike || !spikeEmails(env).includes(p.email)) throw new HttpError(401, 'sesi-tidak-sah', 'Sila login semula');
  return p.email;
}

async function loadRec(env, email) {
  const raw = await env.REGISTRY.get('spike:' + email);
  return raw ? JSON.parse(raw) : null;
}

async function accessFromRec(fetchFn, env, rec) {
  const rt = await decryptText(rec.rt, env.TOKEN_ENC_KEY);
  const t = await refreshAccessToken(fetchFn, env, rt);
  return t.access_token;
}

async function exchange(request, env, deps) {
  if (request.headers.get('x-requested-with') !== 'XMLHttpRequest') {
    throw new HttpError(400, 'csrf', 'Permintaan tidak sah');
  }
  const body = await readJson(request, 4096);
  const code = typeof body.code === 'string' ? body.code : '';
  if (!code || code.length > 2048) throw new HttpError(400, 'tiada-kod', 'Kod Google tiada');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(503, 'belum-setup', 'GOOGLE_CLIENT_ID atau GOOGLE_CLIENT_SECRET belum dipasang');
  }
  if (!env.REGISTRY) throw new HttpError(503, 'belum-setup', 'KV REGISTRY belum dipasang');

  const tok = await exchangeCode(deps.fetch, env, code);
  const id = readIdToken(tok.id_token, env.GOOGLE_CLIENT_ID, deps.now());

  if (!spikeEmails(env).includes(id.email)) {
    await revokeToken(deps.fetch, tok.access_token);
    throw new HttpError(403, 'bukan-emel-ujian', 'Emel ini tiada dalam SPIKE_EMAILS');
  }
  if (!hasScope(tok.scope, DRIVE_FILE_SCOPE)) {
    await revokeToken(deps.fetch, tok.access_token);
    return json({
      ok: false,
      kod: 'tiada-skop-drive',
      mesej: 'Kebenaran Google Drive tidak ditanda. Tekan Login semula dan TANDA kotak kebenaran Drive.'
    });
  }

  const lama = await loadRec(env, id.email);
  const rtBaru = typeof tok.refresh_token === 'string' && tok.refresh_token.length > 0;
  if (!rtBaru && !lama) {
    // Google hanya beri refresh token pada persetujuan pertama. Tarik balik supaya cubaan seterusnya
    // memaparkan skrin persetujuan penuh dan memberi refresh token.
    await revokeToken(deps.fetch, tok.access_token);
    return json({
      ok: false,
      kod: 'tiada-refresh-token',
      mesej: 'Google tidak beri refresh token kali ini. Akses ditarik balik secara automatik. Tekan Login sekali lagi.'
    });
  }

  let sheetId = lama && lama.sheetId;
  let sheetUrl = lama && lama.sheetUrl;
  let sheetBaru = false;
  if (!sheetId) {
    const ss = await createSpreadsheet(deps.fetch, tok.access_token, TAJUK_SHEET, ['Ujian']);
    sheetId = ss.spreadsheetId;
    sheetUrl = ss.spreadsheetUrl;
    sheetBaru = true;
    await valuesUpdate(deps.fetch, tok.access_token, sheetId, a1('Ujian', 'A1:D1'), [['masa', 'sumber', 'run', 'nota']]);
  }
  let driveOk = false;
  try {
    const f = await driveGetFile(deps.fetch, tok.access_token, sheetId);
    driveOk = f && f.id === sheetId && !f.trashed;
  } catch {
    driveOk = false;
  }

  const rt = rtBaru ? await encryptText(tok.refresh_token, env.TOKEN_ENC_KEY) : lama.rt;
  const rec = { rt, sheetId, sheetUrl, dicipta: (lama && lama.dicipta) || isoMY(deps.now()), loginMs: deps.now() };
  await env.REGISTRY.put('spike:' + id.email, JSON.stringify(rec), { expirationTtl: TTL_REKOD });

  const sesi = await signSession(
    { email: id.email, spike: true, exp: Math.floor(deps.now() / 1000) + 2 * 24 * 3600 },
    env.SESSION_SECRET
  );
  return json({ ok: true, email: id.email, refreshTokenBaru: rtBaru, sheetBaru, sheetUrl, driveOk, sesi });
}

async function write(request, env, deps) {
  const email = await auth(request, env, deps.now());
  const rec = await loadRec(env, email);
  if (!rec) throw new HttpError(404, 'tiada-rekod', 'Tiada rekod prototaip. Login semula.');
  const access = await accessFromRec(deps.fetch, env, rec);
  const masa = isoMY(deps.now());
  const r = await valuesAppend(deps.fetch, access, rec.sheetId, a1('Ujian', 'A:D'), [
    [masa, 'worker-refresh-token', '-', 'Ditulis oleh Worker guna refresh token, tanpa token dari pelayar']
  ]);
  const minit = Math.round((deps.now() - (rec.loginMs || deps.now())) / 60000);
  return json({ ok: true, masa, julat: (r.updates && r.updates.updatedRange) || '', minitSejakLogin: minit });
}

// Satu permintaan "tempahan" ujian. Pelayar menghantar N permintaan ini serentak.
async function raceOne(request, env, deps) {
  const email = await auth(request, env, deps.now());
  const b = await readJson(request, 1024);
  const runId = typeof b.runId === 'string' && /^[a-z0-9-]{6,20}$/.test(b.runId) ? b.runId : '';
  if (!runId) throw new HttpError(400, 'run-tidak-sah', 'runId tidak sah');
  const mode = b.mode === 'sheet' ? 'sheet' : 'sim';
  const idx = Number.isInteger(b.idx) ? b.idx : 0;
  const kunci = b.kunci !== false;
  if (!env.TENANT_LOCK) throw new HttpError(503, 'belum-setup', 'Durable Object TENANT_LOCK belum dipasang');
  const stub = env.TENANT_LOCK.get(env.TENANT_LOCK.idFromName('spike:' + email));
  const res = await stub.fetch('https://do.internal/spike/race', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, runId, mode, idx, kunci })
  });
  return json(await res.json());
}

async function raceKira(request, env, deps) {
  const email = await auth(request, env, deps.now());
  const b = await readJson(request, 1024);
  const runId = typeof b.runId === 'string' && /^[a-z0-9-]{6,20}$/.test(b.runId) ? b.runId : '';
  if (!runId) throw new HttpError(400, 'run-tidak-sah', 'runId tidak sah');
  const rec = await loadRec(env, email);
  if (!rec) throw new HttpError(404, 'tiada-rekod', 'Tiada rekod prototaip');
  const access = await accessFromRec(deps.fetch, env, rec);
  const r = await valuesGet(deps.fetch, access, rec.sheetId, a1('Ujian', 'A:D'));
  const baris = (r.values || []).filter((row) => row[2] === runId).length;
  return json({ ok: true, baris });
}

async function padam(request, env, deps) {
  const email = await auth(request, env, deps.now());
  const rec = await loadRec(env, email);
  let ditarik = false;
  if (rec) {
    try {
      ditarik = await revokeToken(deps.fetch, await decryptText(rec.rt, env.TOKEN_ENC_KEY));
    } catch {
      ditarik = false;
    }
    await env.REGISTRY.delete('spike:' + email);
  }
  return json({ ok: true, ditarik, sheetUrl: rec ? rec.sheetUrl : '' });
}

export async function handleSpike(request, env, deps, path) {
  if (!spikeEnabled(env)) return error(404, 'tiada', 'Tidak dijumpai');
  if (path === '/api/spike/status' && request.method === 'GET') {
    return json({ ok: true, aktif: true, clientId: !!env.GOOGLE_CLIENT_ID });
  }
  if (request.method !== 'POST') return error(405, 'kaedah', 'Kaedah tidak dibenarkan');
  if (!sameOrigin(request, env)) return error(403, 'origin', 'Origin tidak dibenarkan');
  try {
    if (path === '/api/spike/exchange') return await exchange(request, env, deps);
    if (path === '/api/spike/write') return await write(request, env, deps);
    if (path === '/api/spike/race-one') return await raceOne(request, env, deps);
    if (path === '/api/spike/race-kira') return await raceKira(request, env, deps);
    if (path === '/api/spike/padam') return await padam(request, env, deps);
    return error(404, 'tiada', 'Tidak dijumpai');
  } catch (e) {
    if (e instanceof HttpError) return error(e.status, e.kod, e.message);
    if (e instanceof GoogleError) {
      return error(e.revoked ? 401 : 502, e.revoked ? 'google-putus' : 'google', 'Google: ' + (e.reason || e.status), {
        googleStatus: e.status
      });
    }
    return error(500, 'ralat', 'Ralat dalaman');
  }
}

