// Durable Object TenantLock (SQLite-backed, tanpa data kekal).
//
// Dua kegunaan:
// 1. Instance bernama "registry" (satu sahaja): serialisasi operasi registry yang mesti unik
//    - cipta tenant untuk satu emel (satu emel = satu studio, klik berganda tidak cipta dua)
//    - tuntut slug (dua studio tidak boleh dapat slug yang sama walaupun serentak)
// 2. Satu instance per studio (Fasa 3): indeks kekosongan slot dan laluan tempahan.
//
// KV tidak ada operasi atomik "semak dan tulis", jadi semua semakan+tulisan unik dibuat di sini dalam mutex.
// `recent` menutup jurang konsistensi KV (sehingga ~60 saat) untuk tulisan yang baru dibuat.

import { createMutex } from './lib/mutex.js';
import { StudioState, googleFailure } from './studio-state.js';

const RECENT_MS = 120000;

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

export class TenantLock {
  constructor(state, env, deps = {}) {
    this.state = state;
    this.env = env;
    this.now = deps.now || (() => Date.now());
    this.fetchFn = deps.fetch || ((...a) => fetch(...a));
    this.studio = null;
    this.lock = createMutex();
    this.recent = new Map(); // kunci KV -> { v, t }
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
    if (url.pathname === '/lease' && request.method === 'POST') {
      const b = await request.json();
      return jsonRes(this.leaseOp(b));
    }
    if (url.pathname.startsWith('/public/') && request.method === 'POST') {
      const b = await request.json();
      return jsonRes(await this.publicOp(url.pathname.slice(8), b));
    }
    if (url.pathname === '/invalidate' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (this.studio) this.studio.invalidate(b);
      return jsonRes({ ok: true });
    }
    if (url.pathname === '/registry' && request.method === 'POST') {
      const body = await request.json();
      try {
        return jsonRes(await this.lock(() => this.registryOp(body)));
      } catch {
        return jsonRes({ ok: false, kod: 'ralat' }, 500);
      }
    }
    return jsonRes({ ok: false, kod: 'tiada-laluan' }, 404);
  }

  // ---- halaman awam studio (instance "tenant:<tid>") ----
  async publicOp(op, b) {
    if (!this.studio) this.studio = new StudioState({ env: this.env, fetch: this.fetchFn, now: this.now });
    const st = this.studio;
    try {
      if (op === 'config') return { status: 200, ok: true, config: await st.config(b.tenant, b.today) };
      if (op === 'slots') return { status: 200, ok: true, ...(await st.slots(b.tenant, b.tarikh, b.today)) };
      if (op === 'book') return await st.book(b.tenant, b);
      if (op === 'status') return await st.status(b.tenant, b);
      return { status: 404, ok: false, kod: 'tiada' };
    } catch (e) {
      return googleFailure(e);
    }
  }

  // ---- pajakan dalam memori: satu operasi panjang (cth setup Sheet) pada satu masa per tenant ----
  leaseOp(b) {
    this.leases = this.leases || new Map();
    const now = this.now();
    const held = this.leases.get(b.name);
    if (b.op === 'ambil') {
      if (held && held > now) return { ok: false };
      this.leases.set(b.name, now + Math.min(Number(b.ms) || 60000, 120000));
      return { ok: true };
    }
    if (b.op === 'lepas') {
      this.leases.delete(b.name);
      return { ok: true };
    }
    return { ok: false };
  }

  // ---- registry: baca/tulis KV dengan memori jangka pendek ----
  async kvGet(key) {
    const r = this.recent.get(key);
    if (r && this.now() - r.t < RECENT_MS) return r.v;
    return this.env.REGISTRY.get(key);
  }

  async kvPut(key, value) {
    await this.env.REGISTRY.put(key, value);
    this.recent.set(key, { v: value, t: this.now() });
  }

  async kvDelete(key) {
    await this.env.REGISTRY.delete(key);
    this.recent.set(key, { v: null, t: this.now() });
  }

  async registryOp(b) {
    if (b.op === 'owner') {
      // Cari atau cipta tenant untuk emel ini. Pulangkan tid sedia ada jika sudah ada.
      const key = 'owner:' + b.email;
      const ada = await this.kvGet(key);
      if (ada) return { ok: true, tid: ada, baru: false };
      await this.kvPut('tenant:' + b.tenant.tid, JSON.stringify(b.tenant));
      await this.kvPut(key, b.tenant.tid);
      return { ok: true, tid: b.tenant.tid, baru: true };
    }
    if (b.op === 'slug') {
      const key = 'slug:' + b.slug;
      const ada = await this.kvGet(key);
      if (ada && ada !== b.tid) return { ok: false, kod: 'slug-diambil' };
      if (!ada) await this.kvPut(key, b.tid);
      return { ok: true };
    }
    if (b.op === 'slug-check') {
      const ada = await this.kvGet('slug:' + b.slug);
      return { ok: true, tersedia: !ada || ada === b.tid };
    }
    if (b.op === 'release') {
      // Padam akaun: lepaskan slug dan emel, hanya jika masih milik tid ini.
      if (b.slug && (await this.kvGet('slug:' + b.slug)) === b.tid) await this.kvDelete('slug:' + b.slug);
      if (b.email && (await this.kvGet('owner:' + b.email)) === b.tid) await this.kvDelete('owner:' + b.email);
      await this.kvDelete('tenant:' + b.tid);
      return { ok: true };
    }
    return { ok: false, kod: 'op-tidak-dikenali' };
  }
}
