// Panggilan Google OAuth, Sheets API v4 dan Drive API v3 dari Worker.
// Token tidak pernah dimasukkan ke dalam mesej ralat atau log.

import { b64urlDecode } from './crypto.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE = 'https://www.googleapis.com/drive/v3/files';
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export class GoogleError extends Error {
  constructor(status, reason, message) {
    super(message || reason || 'Ralat Google');
    this.status = status;
    this.reason = reason || '';
  }
  // Refresh token ditarik balik / tamat -> tenant ditanda conn:"putus".
  get revoked() {
    return this.reason === 'invalid_grant';
  }
}

function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}

async function readGoogleError(res) {
  let reason = '';
  let message = '';
  try {
    const j = await res.json();
    if (typeof j.error === 'string') {
      reason = j.error;
      message = j.error_description || j.error;
    } else if (j.error) {
      reason = j.error.status || String(j.error.code || '');
      message = j.error.message || '';
    }
  } catch {
    /* abaikan */
  }
  return new GoogleError(res.status, reason, message || `HTTP ${res.status}`);
}

async function postForm(fetchFn, url, params) {
  const res = await fetchFn(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: timeoutSignal(10000)
  });
  if (!res.ok) throw await readGoogleError(res);
  return res.json();
}

// Kod dari GIS initCodeClient (mod popup) -> redirect_uri mesti "postmessage".
export function exchangeCode(fetchFn, env, code) {
  return postForm(fetchFn, TOKEN_URL, {
    code,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: 'postmessage',
    grant_type: 'authorization_code'
  });
}

export function refreshAccessToken(fetchFn, env, refreshToken) {
  return postForm(fetchFn, TOKEN_URL, {
    refresh_token: refreshToken,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    grant_type: 'refresh_token'
  });
}

// Tarik balik keseluruhan kebenaran (access atau refresh token). Ralat diabaikan.
export async function revokeToken(fetchFn, token) {
  try {
    await fetchFn(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: timeoutSignal(8000)
    });
    return true;
  } catch {
    return false;
  }
}

// id_token diterima terus dari endpoint token Google melalui TLS, jadi semakan tuntutan mencukupi
// (OpenID Connect Core 3.1.3.7). Pulangkan { email, sub } atau buang ralat.
export function readIdToken(idToken, clientId, nowMs = Date.now()) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new GoogleError(401, 'id_token', 'id_token tidak sah');
  let p;
  try {
    p = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  } catch {
    throw new GoogleError(401, 'id_token', 'id_token tidak boleh dibaca');
  }
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!clientId || !aud.includes(clientId)) throw new GoogleError(401, 'id_token', 'audience tidak sepadan');
  if (p.iss !== 'https://accounts.google.com' && p.iss !== 'accounts.google.com') {
    throw new GoogleError(401, 'id_token', 'issuer tidak sah');
  }
  if (typeof p.exp !== 'number' || p.exp * 1000 < nowMs - 60000) throw new GoogleError(401, 'id_token', 'id_token tamat');
  if (!(p.email_verified === true || p.email_verified === 'true')) {
    throw new GoogleError(401, 'email_unverified', 'Emel Google belum disahkan');
  }
  if (!p.email) throw new GoogleError(401, 'id_token', 'tiada emel');
  return { email: String(p.email).toLowerCase(), sub: String(p.sub || '') };
}

export function hasScope(scopeString, scope) {
  return String(scopeString || '').split(/\s+/).includes(scope);
}

async function gapi(fetchFn, accessToken, url, init = {}) {
  const res = await fetchFn(url, {
    ...init,
    headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json', ...(init.headers || {}) },
    signal: timeoutSignal(12000)
  });
  if (!res.ok) throw await readGoogleError(res);
  return res.status === 204 ? {} : res.json();
}

export function a1(tab, range) {
  return `'${String(tab).replace(/'/g, "''")}'!${range}`;
}

export function createSpreadsheet(fetchFn, accessToken, title, tabs) {
  return gapi(fetchFn, accessToken, SHEETS, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title, locale: 'en_GB', timeZone: 'Asia/Kuala_Lumpur' },
      sheets: tabs.map((t, i) => ({ properties: { title: t, index: i, gridProperties: { frozenRowCount: 1 } } }))
    })
  });
}

export function valuesUpdate(fetchFn, accessToken, id, range, values) {
  const u = `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  return gapi(fetchFn, accessToken, u, { method: 'PUT', body: JSON.stringify({ range, values }) });
}

export function valuesAppend(fetchFn, accessToken, id, range, values) {
  const u =
    `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append` +
    '?valueInputOption=RAW&insertDataOption=INSERT_ROWS&includeValuesInResponse=false';
  return gapi(fetchFn, accessToken, u, { method: 'POST', body: JSON.stringify({ values }) });
}

export function valuesGet(fetchFn, accessToken, id, range) {
  const u = `${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`;
  return gapi(fetchFn, accessToken, u, { method: 'GET' });
}

export function driveGetFile(fetchFn, accessToken, id) {
  const u = `${DRIVE}/${encodeURIComponent(id)}?fields=id,name,trashed,mimeType`;
  return gapi(fetchFn, accessToken, u, { method: 'GET' });
}
