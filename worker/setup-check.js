// GET /api/platform/setup-check (BSD 6.2)
// Laporkan sama ada binding, secret dan vars wujud. TIDAK pernah memulangkan nilai.

import { decodeEncKey } from './lib/crypto.js';

const URL_SAFE = /^[A-Za-z0-9_-]+$/;
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

// Setiap semakan: [nama, jenis, wajibSekarang, fungsi(nilai) -> null jika ok, atau mesej masalah]
const STATIC_CHECKS = [
  ['GOOGLE_CLIENT_SECRET', 'secret', true, (v) => (v.length >= 10 ? null : 'Nampak terlalu pendek')],
  ['SESSION_SECRET', 'secret', true, (v) => (v.length >= 32 ? null : 'Mesti sekurang-kurangnya 32 aksara. Jana semula dengan jana-rahsia.html')],
  ['TOKEN_ENC_KEY', 'secret', true, (v) => (decodeEncKey(v) ? null : 'Mesti tepat 32 bait (base64url). Jana semula dengan jana-rahsia.html')],
  ['ADMIN_TOKEN', 'secret', true, (v) => (v.length >= 32 ? null : 'Mesti sekurang-kurangnya 32 aksara')],
  [
    'BCL_WEBHOOK_KEY',
    'secret',
    true,
    (v) => (v.length >= 32 && URL_SAFE.test(v) ? null : 'Mesti 32+ aksara, huruf/nombor/-/_ sahaja')
  ],
  ['BCL_API_TOKEN', 'secret', false, (v) => (v.length >= 10 ? null : 'Nampak terlalu pendek')],
  ['TURNSTILE_SECRET', 'secret', true, (v) => (v.length >= 10 ? null : 'Nampak terlalu pendek')],
  [
    'GOOGLE_CLIENT_ID',
    'var',
    true,
    (v) => (/\.apps\.googleusercontent\.com$/.test(v) ? null : 'Format Client ID tidak dikenali')
  ],
  ['TURNSTILE_SITE_KEY', 'var', true, (v) => (v.length >= 10 ? null : 'Nampak terlalu pendek')],
  ['BCL_FORM_ID', 'var', true, (v) => (v.length >= 1 ? null : 'Kosong')],
  [
    'OWNER_EMAILS',
    'var',
    true,
    (v) => {
      const list = v.split(',').map((s) => s.trim()).filter(Boolean);
      if (!list.length) return 'Kosong';
      return list.every((e) => EMAIL.test(e)) ? null : 'Ada emel yang formatnya salah (pisahkan dengan koma)';
    }
  ]
];

const NOTA_KEMUDIAN = {
  BCL_API_TOKEN: 'Diperlukan dalam Fasa 5 (webhook BCL)'
};

async function checkKv(env) {
  if (!env.REGISTRY || typeof env.REGISTRY.get !== 'function') return { status: 'tiada', nota: 'Binding KV REGISTRY belum dipasang' };
  try {
    await env.REGISTRY.get('setup-check:ping');
    return { status: 'ok', nota: 'Boleh dibaca' };
  } catch {
    return { status: 'salah', nota: 'Binding wujud tetapi gagal dibaca' };
  }
}

async function checkDo(env) {
  if (!env.TENANT_LOCK || typeof env.TENANT_LOCK.idFromName !== 'function') {
    return { status: 'tiada', nota: 'Binding Durable Object TENANT_LOCK belum dipasang' };
  }
  try {
    const stub = env.TENANT_LOCK.get(env.TENANT_LOCK.idFromName('setup-check'));
    const res = await stub.fetch('https://do.internal/ping');
    const j = await res.json();
    if (j && j.ok && j.sqlite) return { status: 'ok', nota: 'Berjalan (SQLite)' };
    return { status: 'salah', nota: 'Berjalan tetapi storan SQLite tidak dikesan' };
  } catch {
    return { status: 'salah', nota: 'Binding wujud tetapi gagal dipanggil' };
  }
}

// config.js (awam) mesti sepadan dengan vars Worker, kalau tidak login/Turnstile gagal secara senyap.
async function checkConfigJs(env, origin) {
  if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') return { status: 'salah', nota: 'Static assets tidak tersedia' };
  try {
    const res = await env.ASSETS.fetch(new Request(origin + '/config.js'));
    if (!res.ok) return { status: 'salah', nota: 'config.js tidak dijumpai' };
    const text = await res.text();
    const cid = (/googleClientId:\s*'([^']*)'/.exec(text) || [])[1] || '';
    const site = (/turnstileSiteKey:\s*'([^']*)'/.exec(text) || [])[1] || '';
    const masalah = [];
    if (!cid || cid !== str(env.GOOGLE_CLIENT_ID)) masalah.push('googleClientId');
    if (!site || site !== str(env.TURNSTILE_SITE_KEY)) masalah.push('turnstileSiteKey');
    if (masalah.length) return { status: 'salah', nota: 'Tidak sepadan dengan vars Worker: ' + masalah.join(', ') };
    return { status: 'ok', nota: 'Sepadan dengan vars Worker' };
  } catch {
    return { status: 'salah', nota: 'Gagal dibaca' };
  }
}

export async function setupCheck(env, origin) {
  const items = [];
  const kv = await checkKv(env);
  items.push({ nama: 'REGISTRY', jenis: 'binding KV', wajib: true, ...kv });
  const dob = await checkDo(env);
  items.push({ nama: 'TENANT_LOCK', jenis: 'binding Durable Object', wajib: true, ...dob });

  for (const [nama, jenis, wajib, fn] of STATIC_CHECKS) {
    const v = str(env[nama]);
    let status;
    let nota;
    if (!v) {
      status = wajib ? 'tiada' : 'kemudian';
      nota = wajib ? 'Belum dipasang' : NOTA_KEMUDIAN[nama] || 'Belum diperlukan';
    } else {
      const masalah = fn(v);
      status = masalah ? 'salah' : 'ok';
      nota = masalah || 'Ada';
    }
    items.push({ nama, jenis, wajib, status, nota });
  }

  const cfg = await checkConfigJs(env, origin);
  items.push({ nama: 'config.js', jenis: 'fail awam', wajib: true, ...cfg });

  const gagal = items.filter((i) => i.wajib && i.status !== 'ok').map((i) => i.nama);
  return { ok: gagal.length === 0, gagal, items };
}
