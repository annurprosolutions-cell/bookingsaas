// Pembantu HTTP untuk Worker: respons JSON, header keselamatan, baca body dengan had saiz.

export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
      ...extra
    }
  });
}

export function error(status, kod, mesej, extra = {}) {
  return json({ ok: false, kod, mesej, ...extra }, status);
}

export async function readJson(request, maxBytes = 16 * 1024) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'terlalu-besar', 'Data terlalu besar');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'terlalu-besar', 'Data terlalu besar');
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('bukan objek');
    return v;
  } catch {
    throw new HttpError(400, 'json-tidak-sah', 'Format data tidak sah');
  }
}

export class HttpError extends Error {
  constructor(status, kod, mesej) {
    super(mesej);
    this.status = status;
    this.kod = kod;
  }
}

export function bearer(request) {
  const h = request.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : '';
}

// Permintaan tulis dari pelayar mesti datang dari origin sendiri.
export function sameOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return true; // bukan pelayar (curl, ujian) - auth lain tetap disemak
  const self = new URL(request.url).origin;
  if (origin === self) return true;
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}
