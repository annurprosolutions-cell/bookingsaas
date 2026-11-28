// Pelayan dev tempatan: fail statik (dengan header dari _headers) + API Worker sebenar yang disambung
// kepada Google, KV dan Durable Object PALSU (tests/fixtures). Tiada akaun sebenar disentuh.
// Guna: node tools/dev-server.mjs [port]   kemudian buka http://127.0.0.1:8788/daftar/
// Login Google perlu dimock dalam pelayar (lihat ujian e2e); pelayan ini menerima sebarang kod.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from '../worker/index.mjs';
import { makeEnv, fakeGoogle } from '../tests/helpers.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] || 8788);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8'
};

const ignore = (await readFile(join(ROOT, '.assetsignore'), 'utf8')).split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
const isIgnored = (p) => ignore.some((i) => p === '/' + i.replace(/\/$/, '') || p.startsWith('/' + i.replace(/\/?$/, '/')));
const headersFile = await readFile(join(ROOT, '_headers'), 'utf8');
const STATIC_HEADERS = Object.fromEntries(
  headersFile.split('\n').filter((l) => /^\s+\S+:/.test(l)).map((l) => {
    const i = l.indexOf(':');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);

const g = fakeGoogle({ email: process.env.DEV_EMAIL || 'ujian@gmail.com' });
const env = makeEnv(g, { ALLOWED_ORIGINS: ORIGIN });
env.ASSETS = { fetch: async (req) => staticResponse(new URL(req.url).pathname) };

async function staticResponse(pathname) {
  let p = decodeURIComponent(pathname);
  if (p.includes('\0')) return new Response('Not found', { status: 404 });
  const slash = p.endsWith('/');
  p = normalize(p);
  if (slash && !p.endsWith('/')) p += '/';
  if (isIgnored(p)) return new Response('Not found', { status: 404 });
  let file = join(ROOT, p);
  if (!file.startsWith(ROOT)) return new Response('Not found', { status: 404 });
  try {
    const st = await stat(file);
    if (st.isDirectory()) {
      if (!p.endsWith('/')) return new Response(null, { status: 307, headers: { location: p + '/' } });
      file = join(file, 'index.html');
    }
    const body = await readFile(file);
    return new Response(body, { status: 200, headers: { 'content-type': TYPES[extname(file)] || 'application/octet-stream', ...STATIC_HEADERS } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const url = ORIGIN + req.url;
    const path = new URL(url).pathname;
    let out;
    if (path === '/__dev/sheets') {
      // Pemeriksaan dev sahaja: kandungan Sheet palsu
      out = Response.json(Object.fromEntries([...g.state.sheets].map(([id, s]) => [id, { title: s.title, tabs: Object.fromEntries(Object.entries(s.tabs).map(([t, v]) => [t, v.rows])) }])));
    } else if (path.startsWith('/api/') || path.startsWith('/bcl/')) {
      const r = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      out = await handle(r, env, { fetch: g.fetch });
    } else {
      // Seperti Cloudflare: fail statik dahulu; jika tiada, permintaan diteruskan ke Worker (cth /<slug>)
      out = await staticResponse(path);
      if (out.status === 404) out = await handle(new Request(url, { method: req.method, headers: req.headers }), env, { fetch: g.fetch });
    }
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
  })
  .listen(PORT, '127.0.0.1', () => console.log(`Pelayan dev: ${ORIGIN}/daftar/  (Google/KV palsu)`));
