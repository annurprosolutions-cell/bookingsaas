// Durable Object TenantLock: satu instance per studio.
// Fasa 0: hanya /ping (semak SQLite) dan /spike/race (ujian kunci serentak).
// Fasa 3 akan menambah indeks kekosongan slot dan laluan tempahan sebenar.

import { createMutex } from './lib/mutex.js';
import { decryptText } from './lib/crypto.js';
import { refreshAccessToken, valuesAppend, a1 } from './lib/google.js';
import { isoMY } from './lib/time.js';

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TenantLock {
  constructor(state, env, deps = {}) {
    this.state = state;
    this.env = env;
    this.fetchFn = deps.fetch || ((...a) => fetch(...a));
    this.lock = createMutex();
    // Indeks dalam memori sahaja: kunci "runId|slot" -> bilangan terisi. Tiada PII.
    this.terisi = new Map();
    // Cache access token Google dalam memori (tidak pernah disimpan ke storan).
    this.token = null;
  }

  sqliteOk() {
    try {
      const sql = this.state && this.state.storage && this.state.storage.sql;
      if (!sql) return false;
      const row = sql.exec('SELECT 1 AS x').one();
      return !!row && row.x === 1;
    } catch {
      return false;
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ping') return jsonRes({ ok: true, sqlite: this.sqliteOk() });
    if (url.pathname === '/spike/race' && request.method === 'POST') {
      const body = await request.json();
      return jsonRes(await this.spikeRace(body));
    }
    return jsonRes({ ok: false, kod: 'tiada-laluan' }, 404);
  }

  // Access token untuk Sheet prototaip, dibaca dari KV dan diperbaharui guna refresh token.
  async accessTokenSpike(email) {
    const now = Date.now();
    if (this.token && this.token.email === email && this.token.exp - 60000 > now) return this.token;
    const raw = await this.env.REGISTRY.get('spike:' + email);
    if (!raw) throw Object.assign(new Error('tiada rekod'), { status: 404, reason: 'tiada-rekod' });
    const rec = JSON.parse(raw);
    const rt = await decryptText(rec.rt, this.env.TOKEN_ENC_KEY);
    const t = await refreshAccessToken(this.fetchFn, this.env, rt);
    this.token = { email, access: t.access_token, exp: now + (t.expires_in || 3600) * 1000, sheetId: rec.sheetId };
    return this.token;
  }

  // Satu "tempahan" ujian untuk slot berkapasiti 1.
  // kunci=true  : semak + tulis + kemas kini indeks dalam mutex (reka bentuk sebenar)
  // kunci=false : tanpa mutex (mod simulasi sahaja), untuk membuktikan perlumbaan memang berlaku
  async spikeRace(b) {
    const key = `${b.runId}|S01`;
    const kapasiti = 1;
    const kerja = async () => {
      const ada = this.terisi.get(key) || 0;
      if (ada >= kapasiti) return { ok: false, sebab: 'slot-penuh' };
      if (b.mode === 'sheet') {
        const tok = await this.accessTokenSpike(b.email);
        // Await ke Sheets API ini membuka peluang permintaan lain menyelit masuk jika tiada mutex.
        await valuesAppend(this.fetchFn, tok.access, tok.sheetId, a1('Ujian', 'A:D'), [
          [isoMY(), 'ujian-kunci', b.runId, 'peminta-' + b.idx]
        ]);
      } else {
        await sleep(40); // simulasi masa panggilan Sheets API
      }
      this.terisi.set(key, (this.terisi.get(key) || 0) + 1);
      return { ok: true };
    };
    try {
      return b.kunci === false && b.mode !== 'sheet' ? await kerja() : await this.lock(kerja);
    } catch (e) {
      return { ok: false, sebab: 'ralat', status: e.status || 0, reason: e.reason || '' };
    }
  }
}
