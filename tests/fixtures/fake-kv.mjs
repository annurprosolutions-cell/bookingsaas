// KV palsu (Map dalam memori) untuk ujian Worker. Meniru sebahagian API Cloudflare KV yang kita guna.
export function fakeKv() {
  const m = new Map();
  const ttl = new Map();
  return {
    _map: m,
    _ttl: ttl,
    async get(k, opts) {
      if (!m.has(k)) return null;
      const v = m.get(k);
      return opts === 'json' || (opts && opts.type === 'json') ? JSON.parse(v) : v;
    },
    async put(k, v, opts = {}) {
      m.set(k, String(v));
      if (opts.expirationTtl) ttl.set(k, opts.expirationTtl);
      else ttl.delete(k);
    },
    async delete(k) {
      m.delete(k);
      ttl.delete(k);
    },
    // { prefix, limit } -> { keys: [{ name }], list_complete }
    async list({ prefix = '', limit = 1000 } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit).map((name) => ({ name }));
      return { keys, list_complete: true };
    }
  };
}
