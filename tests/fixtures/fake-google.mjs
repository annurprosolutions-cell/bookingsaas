// Google palsu (OAuth + Sheets API v4 + Drive API v3) dalam memori. `fetch` palsu ini disuntik ke Worker
// melalui deps.fetch. Tiada rangkaian sebenar disentuh.
//
// Model Sheet: state.sheets.get(id) = { title, trashed, tabs: { [title]: { sheetId, rows: [[...]] } }, requests: [] }
// Pilihan:
//   email, refreshToken (null = tiada), scope
//   failOn(method, pathname) -> status HTTP (0 = tiada kegagalan) untuk menguji rollback
import { b64urlEncode } from '../../worker/lib/crypto.js';

export const CLIENT_ID = '123-abc.apps.googleusercontent.com';

const enc = (o) => b64urlEncode(new TextEncoder().encode(JSON.stringify(o)));

export function fakeIdToken({ email = 'ujian@gmail.com', aud = CLIENT_ID, verified = true, nowMs = Date.now() } = {}) {
  return [
    enc({ alg: 'RS256' }),
    enc({ iss: 'https://accounts.google.com', aud, email, email_verified: verified, sub: '42', exp: Math.floor(nowMs / 1000) + 60 * 86400 }), // panjang: ujian guna jam tetap
    'sig'
  ].join('.');
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// "'Tab'!A1", "'Tab'!A:Z", "'Tab'!1:2", "'Tab'!A1:D1", "'Tab'!E1"
export function parseRange(range) {
  const m = /^'((?:[^']|'')*)'!(.*)$/.exec(range);
  if (!m) throw new Error('julat tidak dikenali: ' + range);
  const tab = m[1].replace(/''/g, "'");
  const [a, b] = m[2].split(':');
  const part = (s) => {
    const x = /^([A-Z]*)(\d*)$/.exec(s || '');
    return { c: x && x[1] ? colIndex(x[1]) : null, r: x && x[2] ? Number(x[2]) - 1 : null };
  };
  const p = part(a);
  const q = b === undefined ? null : part(b);
  return {
    tab,
    r0: p.r ?? 0,
    c0: p.c ?? 0,
    r1: q ? (q.r !== null ? q.r + 1 : Infinity) : p.r !== null ? Infinity : Infinity,
    c1: q ? (q.c !== null ? q.c + 1 : Infinity) : Infinity
  };
}

const blank = (r) => !r || r.every((c) => c === '' || c === null || c === undefined);

export function fakeGoogle(opts = {}) {
  const o = {
    email: 'ujian@gmail.com',
    refreshToken: 'rt-rahsia-123',
    scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/drive.file',
    failOn: () => 0,
    ...opts
  };
  const state = { calls: [], revoked: [], sheets: new Map(), refreshCount: 0, accessUsed: [], createCount: 0, tokenOwner: new Map() };
  let nextSheet = 1;
  let nextTabId = 100;

  const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const gerr = (status, s) => res({ error: { code: status, status: s || 'ERROR', message: 'palsu' } }, status);

  function writeAt(sh, range, values) {
    const { tab, r0, c0 } = parseRange(range);
    const t = sh.tabs[tab];
    if (!t) throw Object.assign(new Error('tab'), { status: 400 });
    values.forEach((row, i) => {
      const target = (t.rows[r0 + i] = t.rows[r0 + i] || []);
      row.forEach((v, j) => {
        while (target.length < c0 + j) target.push('');
        target[c0 + j] = v;
      });
    });
    return { updatedRange: range, updatedRows: values.length };
  }

  function readRange(sh, range) {
    const { tab, r0, r1, c0, c1 } = parseRange(range);
    const t = sh.tabs[tab];
    if (!t) return null;
    const out = [];
    for (let r = r0; r < Math.min(r1, t.rows.length); r++) {
      const row = (t.rows[r] || []).slice(c0, c1 === Infinity ? undefined : c1);
      while (row.length && (row[row.length - 1] === '' || row[row.length - 1] === undefined)) row.pop();
      out.push(row);
    }
    while (out.length && out[out.length - 1].length === 0) out.pop();
    return out.length ? { range, values: out } : { range };
  }

  async function fetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init.method || 'GET').toUpperCase();
    const pathname = url.split('?')[0];
    state.calls.push(method + ' ' + pathname);
    const fail = o.failOn(method, pathname);
    if (fail) return gerr(fail, 'INTERNAL');

    if (url === 'https://oauth2.googleapis.com/token') {
      const p = new URLSearchParams(init.body);
      if (p.get('grant_type') === 'authorization_code') {
        if (p.get('redirect_uri') !== 'postmessage') return res({ error: 'redirect_uri_mismatch' }, 400);
        const body = { access_token: 'at-kod', expires_in: 3599, scope: o.scope, token_type: 'Bearer', id_token: fakeIdToken({ email: o.email }) };
        if (o.refreshToken) body.refresh_token = o.refreshToken;
        state.tokenOwner.set('at-kod', o.refreshToken);
        return res(body);
      }
      if (p.get('grant_type') === 'refresh_token') {
        if (p.get('refresh_token') !== o.refreshToken || state.revoked.includes(o.refreshToken)) {
          return res({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
        }
        state.refreshCount++;
        const at = 'at-refresh-' + state.refreshCount;
        state.tokenOwner.set(at, o.refreshToken);
        return res({ access_token: at, expires_in: 3599 });
      }
      return res({ error: 'unsupported_grant_type' }, 400);
    }
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      // Turnstile palsu: token "gagal" atau token yang sudah digunakan ditolak (token sebenar sekali guna)
      const p = new URLSearchParams(init.body);
      const t = p.get('response');
      state.turnstile = state.turnstile || new Set();
      const ok = !!t && t !== 'gagal' && !state.turnstile.has(t) && !!p.get('secret');
      if (t) state.turnstile.add(t);
      return res({ success: ok, 'error-codes': ok ? [] : ['invalid-input-response'] });
    }
    if (url === 'https://oauth2.googleapis.com/revoke') {
      state.revoked.push(new URLSearchParams(init.body).get('token'));
      return res({});
    }

    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || '';
    const access = auth.replace(/^Bearer /, '');
    if (!access) return gerr(401, 'UNAUTHENTICATED');
    // Menarik balik kebenaran juga membatalkan access token yang sudah dikeluarkan
    if (state.revoked.includes(access) || (state.tokenOwner.has(access) && state.revoked.includes(state.tokenOwner.get(access)))) {
      return gerr(401, 'UNAUTHENTICATED');
    }
    state.accessUsed.push(access);

    const SS = 'https://sheets.googleapis.com/v4/spreadsheets';
    if (pathname === SS && method === 'POST') {
      const b = JSON.parse(init.body);
      const id = 'sheet-' + nextSheet++;
      state.createCount++;
      const tabs = {};
      const sheets = b.sheets.map((s) => {
        const sheetId = nextTabId++;
        tabs[s.properties.title] = { sheetId, rows: [] };
        return { properties: { sheetId, title: s.properties.title, index: s.properties.index } };
      });
      state.sheets.set(id, { title: b.properties.title, trashed: false, tabs, requests: [] });
      return res({ spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, properties: b.properties, sheets });
    }

    let m = /^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(pathname);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const rest = m[2];
      const sh = state.sheets.get(id);
      if (!sh) return gerr(404, 'NOT_FOUND');

      if (rest === '' && method === 'GET') {
        return res({
          spreadsheetId: id,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
          properties: { title: sh.title },
          sheets: Object.entries(sh.tabs).map(([title, t], index) => ({ properties: { sheetId: t.sheetId, title, index } }))
        });
      }
      if (rest === ':batchUpdate' && method === 'POST') {
        const { requests } = JSON.parse(init.body);
        const replies = requests.map((r) => {
          sh.requests.push(r);
          if (r.addSheet) {
            const title = r.addSheet.properties.title;
            if (sh.tabs[title]) throw new Error('tab sudah wujud: ' + title);
            const sheetId = nextTabId++;
            sh.tabs[title] = { sheetId, rows: [] };
            return { addSheet: { properties: { sheetId, title } } };
          }
          return {};
        });
        return res({ spreadsheetId: id, replies });
      }
      if (rest === '/values:batchUpdate' && method === 'POST') {
        const b = JSON.parse(init.body);
        if (b.valueInputOption !== 'RAW') return gerr(400, 'INVALID_ARGUMENT');
        for (const d of b.data) writeAt(sh, d.range, d.values);
        return res({ spreadsheetId: id, totalUpdatedRows: b.data.reduce((t, d) => t + d.values.length, 0) });
      }
      if (rest === '/values:batchGet' && method === 'GET') {
        const ranges = new URL(url).searchParams.getAll('ranges');
        return res({ spreadsheetId: id, valueRanges: ranges.map((r) => readRange(sh, r) || { range: r }) });
      }
      const vm = /^\/values\/([^:]+)(:append)?$/.exec(rest);
      if (vm) {
        const range = decodeURIComponent(vm[1]);
        const { tab } = parseRange(range);
        const t = sh.tabs[tab];
        if (!t) return gerr(400, 'INVALID_ARGUMENT');
        if (vm[2] && method === 'POST') {
          if (!/valueInputOption=RAW/.test(url)) return gerr(400, 'INVALID_ARGUMENT');
          await delay(5); // panggilan sebenar mengambil masa; beri peluang perlumbaan
          const vals = JSON.parse(init.body).values;
          let last = t.rows.length;
          while (last > 0 && blank(t.rows[last - 1])) last--;
          vals.forEach((v, i) => (t.rows[last + i] = v.slice()));
          const n = last + vals.length;
          return res({ updates: { updatedRange: `'${tab}'!A${last + 1}:A${n}`, updatedRows: vals.length } });
        }
        if (method === 'PUT') {
          if (!/valueInputOption=RAW/.test(url)) return gerr(400, 'INVALID_ARGUMENT');
          return res(writeAt(sh, range, JSON.parse(init.body).values));
        }
        return res(readRange(sh, range));
      }
    }

    const d = /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)/.exec(url);
    if (d) {
      const id = decodeURIComponent(d[1]);
      const sh = state.sheets.get(id);
      if (!sh) return gerr(404, 'NOT_FOUND');
      return res({ id, name: sh.title, trashed: !!sh.trashed, mimeType: 'application/vnd.google-apps.spreadsheet' });
    }
    return res({ error: 'tiada dalam fake' }, 404);
  }
  return { fetch, state };
}
