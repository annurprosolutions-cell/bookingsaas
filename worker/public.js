// API awam dan halaman studio /<slug> (F-04 hingga F-07, TRD 4, IPD 3.1 hingga 3.6).
// Pelanggan awam tidak login. Setiap endpoint hanya ikut slug, medan terhad, Turnstile untuk tulis, dan had kadar.

import { json, readJson, HttpError, SECURITY_HEADERS } from './lib/http.js';
import { sha256Hex } from './lib/crypto.js';
import { verifyTurnstile } from './lib/turnstile.js';
import { todayMY, isoMY } from './lib/time.js';
import { getTenant, getLicence } from './registry.js';
import { licenceStatus, DEFAULT_GRACE_DAYS } from '../js/core/licence.js';
import { validateSlug, validateStatusQuery } from '../js/core/validate.js';
import { isValidDate } from '../js/core/dates.js';

// CSP sama dengan _headers (diuji dalam tests/repo.test.mjs)
export const CSP =
  "default-src 'self'; script-src 'self' https://accounts.google.com/gsi/client https://challenges.cloudflare.com; " +
  "style-src 'self' https://accounts.google.com/gsi/style; frame-src https://accounts.google.com https://challenges.cloudflare.com; " +
  "connect-src 'self' https://accounts.google.com/gsi/; img-src 'self' https: data:; font-src 'self'; object-src 'none'; " +
  "base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

// ---- cari studio dari slug (cache isolate 30 saat: jimat bacaan KV pada waktu puncak) ----
const cache = new Map();
const TTL = 30 * 1000;

export function clearPublicCache() {
  cache.clear();
}

export async function loadPublicTenant(env, slug, now) {
  const c = cache.get(slug);
  if (c && c.exp > now) return c.v;
  let v = null;
  const tid = await env.REGISTRY.get('slug:' + slug);
  if (tid) {
    const tenant = await getTenant(env, tid);
    if (tenant && tenant.slug === slug) v = { tenant, licence: await getLicence(env, tenant.ownerEmail) };
  }
  cache.set(slug, { v, exp: now + TTL });
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  return v;
}

// Sebab studio tidak menerima tempahan. Kepada pelanggan, sebab licence/sambungan TIDAK disebut (AFD A6).
function gate(env, pt, now) {
  const t = pt.tenant;
  if (t.status !== 'aktif') return 'tidak-tersedia';
  if (t.conn !== 'ok' || !t.sheetId) return 'tidak-tersedia';
  const graceDays = Number.isInteger(Number(env.GRACE_DAYS)) && env.GRACE_DAYS !== '' ? Number(env.GRACE_DAYS) : DEFAULT_GRACE_DAYS;
  if (!licenceStatus(pt.licence, todayMY(now), { graceDays }).allowed) return 'tidak-tersedia';
  return null;
}

function stubFor(env, tid) {
  return env.TENANT_LOCK.get(env.TENANT_LOCK.idFromName('tenant:' + tid));
}

async function doCall(env, tid, op, body) {
  const res = await stubFor(env, tid).fetch('https://do.internal/public/' + op, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return res.json();
}

function respond(r) {
  const { status = 200, ...rest } = r;
  return json(rest, status);
}

async function ipKey(request, now) {
  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-real-ip') || 'tiada-ip';
  // Hash harian: IP mentah tidak pernah disimpan (TRD 6)
  return (await sha256Hex(ip + '|' + todayMY(now))).slice(0, 24);
}

// Config penuh untuk halaman (dikongsi oleh /config dan suntikan HTML)
export async function publicConfig(env, d, slug) {
  const now = d.now();
  const pt = await loadPublicTenant(env, slug, now);
  if (!pt) return null;
  const t = pt.tenant;
  const sebab = gate(env, pt, now);
  const base = { ok: true, slug, hari_ini: todayMY(now), tertutup: sebab, studio: { nama_studio: t.shopName } };
  // Licence tamat tetapi sambungan masih baik: baca config supaya S-21 boleh tunjuk butang WhatsApp studio.
  const bolehBaca = t.status === 'aktif' && t.conn === 'ok' && t.sheetId;
  if (!bolehBaca) return base;
  const r = await doCall(env, t.tid, 'config', { tenant: t, today: todayMY(now) });
  if (!r.ok) return { ...base, tertutup: r.tertutup || 'tidak-tersedia' };
  const cfg = r.config;
  let tertutup = sebab;
  if (!tertutup && !cfg.studio.tempahan_aktif) tertutup = 'ditutup';
  if (tertutup) {
    // Halaman tertutup hanya perlu identiti studio dan cara menghubungi
    const s = cfg.studio;
    return { ...base, tertutup, studio: { nama_studio: s.nama_studio, logo_url: s.logo_url, warna_utama: s.warna_utama, whatsapp: s.whatsapp, alamat: s.alamat, maps_url: s.maps_url } };
  }
  return { ...base, tertutup: null, ...cfg };
}

// /api/public/<slug>/<op>
export async function publicApi(request, env, d, slug, op) {
  const now = d.now();
  if (!validateSlug(slug).ok) return json({ ok: false, kod: 'tiada', mesej: 'Studio tidak dijumpai.' }, 404);

  if (op === 'config') {
    if (request.method !== 'GET') throw new HttpError(405, 'kaedah', 'Kaedah tidak dibenarkan');
    const c = await publicConfig(env, d, slug);
    if (!c) return json({ ok: false, kod: 'tiada', mesej: 'Studio tidak dijumpai.' }, 404);
    return json(c);
  }

  const pt = await loadPublicTenant(env, slug, now);
  if (!pt) return json({ ok: false, kod: 'tiada', mesej: 'Studio tidak dijumpai.' }, 404);
  const t = pt.tenant;
  const sebab = gate(env, pt, now);

  if (op === 'slots') {
    if (request.method !== 'GET') throw new HttpError(405, 'kaedah', 'Kaedah tidak dibenarkan');
    if (sebab) return json({ ok: false, kod: 'tertutup', tertutup: sebab, mesej: 'Tempahan tidak tersedia buat masa ini.' }, 403);
    const tarikh = new URL(request.url).searchParams.get('date') || '';
    if (!isValidDate(tarikh)) throw new HttpError(400, 'tarikh', 'Tarikh tidak sah.');
    return respond(await doCall(env, t.tid, 'slots', { tenant: t, tarikh, today: todayMY(now) }));
  }

  if (op === 'book') {
    if (request.method !== 'POST') throw new HttpError(405, 'kaedah', 'Kaedah tidak dibenarkan');
    if (sebab) return json({ ok: false, kod: 'tertutup', tertutup: sebab, mesej: 'Tempahan tidak tersedia buat masa ini.' }, 403);
    const body = await readJson(request, 8 * 1024);
    if (!env.TURNSTILE_SECRET) throw new HttpError(503, 'belum-setup', 'Tempahan tidak tersedia buat masa ini.');
    const ip = request.headers.get('cf-connecting-ip') || '';
    if (!(await verifyTurnstile(d.fetch, env.TURNSTILE_SECRET, body.turnstile, ip))) {
      throw new HttpError(400, 'turnstile', 'Pengesahan anti-spam gagal atau tamat. Sila cuba lagi.');
    }
    const { turnstile, ...input } = body; // eslint-disable-line no-unused-vars
    return respond(await doCall(env, t.tid, 'book', { tenant: t, input, ipKey: await ipKey(request, now), today: todayMY(now), nowIso: isoMY(now) }));
  }

  if (op === 'status') {
    if (request.method !== 'POST') throw new HttpError(405, 'kaedah', 'Kaedah tidak dibenarkan');
    const body = await readJson(request, 1024);
    const q = validateStatusQuery(body);
    if (!q.ok) return json({ ok: false, kod: 'tiada', mesej: 'Tiada tempahan sepadan. Semak Ref ID dan nombor telefon.' }, 404);
    if (t.status !== 'aktif' || t.conn !== 'ok' || !t.sheetId) {
      return json({ ok: false, kod: 'tertutup', tertutup: 'tidak-tersedia', mesej: 'Semakan tidak tersedia buat masa ini. Sila hubungi studio.' }, 403);
    }
    return respond(await doCall(env, t.tid, 'status', { tenant: t, ref: q.ref, telefon: q.telefon, ipKey: await ipKey(request, now) }));
  }

  return json({ ok: false, kod: 'tiada', mesej: 'Tidak dijumpai' }, 404);
}

// ---------------------------------------------------------------------------------------------
// Halaman /<slug> (IPD 3.1): templat statik + suntikan tajuk, meta OG, warna tema, manifest dan config.
// ---------------------------------------------------------------------------------------------
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// JSON selamat dalam <script type="application/json">
export function safeJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function htmlHeaders(extra = {}) {
  return { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'content-security-policy': CSP, ...SECURITY_HEADERS, ...extra };
}

export function notFoundPage() {
  const html = `<!doctype html><html lang="ms"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tidak dijumpai | Annur Booking</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/css/app.css"></head>
<body><main><header class="brandbar"><div class="mark" aria-hidden="true">A</div><b>Annur Booking</b></header>
<h1>Halaman tidak dijumpai</h1><p class="muted">Pautan studio ini tidak wujud atau sudah ditukar. Semak semula pautan yang diberikan oleh studio.</p>
<div class="card stack"><a class="btn" href="/">Ke laman utama Annur Booking</a></div></main></body></html>`;
  return new Response(html, { status: 404, headers: htmlHeaders() });
}

export async function studioPage(request, env, d, slug) {
  if (!validateSlug(slug).ok) return notFoundPage();
  const cfg = await publicConfig(env, d, slug);
  if (!cfg) return notFoundPage();
  const origin = new URL(request.url).origin;
  const tpl = await env.ASSETS.fetch(new Request(origin + '/studio/'));
  if (!tpl.ok) return new Response('Templat tidak dijumpai', { status: 500 });
  let html = await tpl.text();

  const s = cfg.studio || {};
  const nama = s.nama_studio || 'Studio';
  const desc = s.subtajuk_hero || `Tempah sesi fotografi di ${nama}.`;
  const warna = /^#[0-9A-Fa-f]{6}$/.test(s.warna_utama || '') ? s.warna_utama : '#2563EB';
  const img = (cfg.banners && cfg.banners[0]) || s.logo_url || '';
  // Tiada <base href>: ia merosakkan pautan hash (#/memo jadi /#/memo). Semua aset guna laluan mutlak (/css, /js).
  const head = [
    `<title>${escapeHtml(nama)} | Tempahan</title>`,
    `<meta name="description" content="${escapeHtml(desc)}">`,
    `<meta name="theme-color" content="${warna}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${escapeHtml(nama)}">`,
    `<meta property="og:description" content="${escapeHtml(desc)}">`,
    `<meta property="og:url" content="${escapeHtml(origin + '/' + slug)}">`,
    img ? `<meta property="og:image" content="${escapeHtml(img)}">` : '',
    `<link rel="manifest" href="/${slug}/manifest.webmanifest">`
  ].filter(Boolean).join('\n  ');
  html = html.replace('<!--ANNUR_HEAD-->', head).replace('<!--ANNUR_DATA-->', `<script type="application/json" id="annur-data">${safeJson(cfg)}</script>`);
  return new Response(html, { status: 200, headers: htmlHeaders() });
}

// Manifest PWA dinamik (F-13). Ikon lengkap dalam Fasa 6.
export async function studioManifest(request, env, d, slug) {
  if (!validateSlug(slug).ok) return json({ ok: false }, 404);
  const pt = await loadPublicTenant(env, slug, d.now());
  if (!pt) return json({ ok: false }, 404);
  const cfg = await publicConfig(env, d, slug);
  const s = (cfg && cfg.studio) || {};
  const warna = /^#[0-9A-Fa-f]{6}$/.test(s.warna_utama || '') ? s.warna_utama : '#2563EB';
  const nama = s.nama_studio || pt.tenant.shopName || 'Studio';
  const m = {
    name: nama,
    short_name: nama.slice(0, 12),
    start_url: '/' + slug,
    scope: '/' + slug,
    display: 'standalone',
    background_color: '#F6FAFE',
    theme_color: warna,
    lang: 'ms'
  };
  return new Response(JSON.stringify(m), { headers: { 'content-type': 'application/manifest+json', 'cache-control': 'public, max-age=300', ...SECURITY_HEADERS } });
}
