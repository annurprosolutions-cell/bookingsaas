// Google palsu (OAuth + Sheets API v4 + Drive API v3) dalam memori. `fetch` palsu ini disuntik ke Worker
// melalui deps.fetch. Tiada rangkaian sebenar disentuh.
import { b64urlEncode } from '../../worker/lib/crypto.js';

export const CLIENT_ID = '123-abc.apps.googleusercontent.com';

const enc = (o) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));

export function fakeIdToken({ email = 'ujian@gmail.com', aud = CLIENT_ID, verified = true, nowMs = Date.now() } = {}) {
  return [
    enc({ alg: 'RS256' }),
    enc({ iss: 'https://accounts.google.com', aud, email, email_verified: verified, sub: '42', exp: Math.floor(nowMs / 1000) + 3600 }),
    'sig'
  ].join('.');
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Google palsu. opts.refreshToken = null untuk mensimulasikan tiada refresh token.
export function fakeGoogle(opts = {}) {
  const o = {
    email: 'ujian@gmail.com',
    refreshToken: 'rt-rahsia-123',
    scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file',
    ...opts
  };
  const state = { calls: [], revoked: [], sheets: new Map(), refreshCount: 0, accessUsed: [] };
  let nextSheet = 1;

  async function fetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    state.calls.push(method + ' ' + url.split('?')[0]);
    const res = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(init.body);
      if (p.get('grant_type') === 'authorization_code') {
        if (p.get('redirect_uri') !== 'postmessage') return res({ error: 'redirect_uri_mismatch' }, 400);
        const body = { access_token: 'at-kod', expires_in: 3599, scope: o.scope, token_type: 'Bearer', id_token: fakeIdToken({ email: o.email }) };
        if (o.refreshToken) body.refresh_token = o.refreshToken;
        return res(body);
      }
      if (p.get('grant_type') === 'refresh_token') {
        if (p.get('refresh_token') !== o.refreshToken || state.revoked.includes(o.refreshToken)) {
          return res({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
        }
        state.refreshCount++;
        return res({ access_token: 'at-refresh-' + state.refreshCount, expires_in: 3599 });
      }
      return res({ error: 'unsupported_grant_type' }, 400);
    }
    if (url === 'https://oauth2.googleapis.com/revoke') {
      state.revoked.push(new URLSearchParams(init.body).get('token'));
      return res({});
    }

    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || '';
    const access = auth.replace(/^Bearer /, '');
    if (!access) return res({ error: { code: 401, status: 'UNAUTHENTICATED' } }, 401);
    state.accessUsed.push(access);

    if (url === 'https://sheets.googleapis.com/v4/spreadsheets' && method === 'POST') {
      const b = JSON.parse(init.body);
      const id = 'sheet-' + nextSheet++;
      const tabs = {};
      for (const s of b.sheets) tabs[s.properties.title] = [];
      state.sheets.set(id, { title: b.properties.title, tabs });
      return res({ spreadsheetId: id, spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/' + id + '/edit' });
    }
    const m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/]+)\/values\/([^?:]+)(:append)?/.exec(url);
    if (m) {
      const sh = state.sheets.get(decodeURIComponent(m[1]));
      if (!sh) return res({ error: { code: 404, status: 'NOT_FOUND' } }, 404);
      const range = decodeURIComponent(m[2]);
      const tab = /^'(.*)'!/.exec(range)[1].replace(/''/g, "'");
      const rows = sh.tabs[tab];
      if (m[3] && method === 'POST') {
        await delay(5); // panggilan sebenar mengambil masa; beri peluang perlumbaan
        const vals = JSON.parse(init.body).values;
        rows.push(...vals);
        return res({ updates: { updatedRange: `'${tab}'!A${rows.length}:D${rows.length}`, updatedRows: vals.length } });
      }
      if (method === 'PUT') {
        const vals = JSON.parse(init.body).values;
        vals.forEach((v, i) => (rows[i] = v));
        return res({ updatedRows: vals.length });
      }
      return res({ range, values: rows.slice() });
    }
    const d = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)/.exec(url);
    if (d) {
      const id = decodeURIComponent(d[1]);
      const sh = state.sheets.get(id);
      if (!sh) return res({ error: { code: 404 } }, 404);
      return res({ id, name: sh.title, trashed: false, mimeType: 'application/vnd.google-apps.spreadsheet' });
    }
    return res({ error: 'tiada dalam fake' }, 404);
  }
  return { fetch, state };
}

