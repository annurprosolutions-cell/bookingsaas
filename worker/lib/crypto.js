// Kripto asas: base64url, AES-256-GCM (refresh token), HMAC-SHA256 (sesi), ID rawak.
// Guna Web Crypto sahaja, jadi boleh jalan dalam Cloudflare Worker dan Node 20+.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64urlEncode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  if (typeof str !== 'string' || !/^[A-Za-z0-9\-_+/]*={0,2}$/.test(str)) throw new Error('base64 tidak sah');
  const norm = str.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  const bin = atob(norm + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  const u8 = new Uint8Array(n);
  crypto.getRandomValues(u8);
  return u8;
}

// ID rawak tanpa bias (rejection sampling). Lalai: base32 huruf kecil untuk tid.
export function randomId(len = 12, alphabet = 'abcdefghijklmnopqrstuvwxyz234567') {
  const n = alphabet.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < len) {
    const buf = randomBytes(len * 2);
    for (let i = 0; i < buf.length && out.length < len; i++) {
      if (buf[i] < limit) out += alphabet[buf[i] % n];
    }
  }
  return out;
}

// TOKEN_ENC_KEY: 32 bait, dikodkan base64 atau base64url.
export function decodeEncKey(secret) {
  if (!secret || typeof secret !== 'string') return null;
  try {
    const raw = b64urlDecode(secret.trim());
    return raw.length === 32 ? raw : null;
  } catch {
    return null;
  }
}

async function importAesKey(secret) {
  const raw = decodeEncKey(secret);
  if (!raw) throw new Error('TOKEN_ENC_KEY mesti 32 bait (base64url)');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// Hasil: "<iv>.<ciphertext>" kedua-duanya base64url (BSD seksyen 3, medan rt).
export async function encryptText(plain, secret) {
  const key = await importAesKey(secret);
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return b64urlEncode(iv) + '.' + b64urlEncode(new Uint8Array(ct));
}

export async function decryptText(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('format enkripsi tidak sah');
  const key = await importAesKey(secret);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64urlDecode(parts[0]) },
    key,
    b64urlDecode(parts[1])
  );
  return dec.decode(pt);
}

async function importHmacKey(secret, usages) {
  if (!secret || String(secret).length < 32) throw new Error('SESSION_SECRET terlalu pendek');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

// Token sesi: base64url(JSON payload) + "." + base64url(HMAC). Payload mesti ada exp (saat epoch).
export async function signSession(payload, secret) {
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const key = await importHmacKey(secret, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return body + '.' + b64urlEncode(new Uint8Array(sig));
}

// Pulangkan payload jika sah dan belum tamat, jika tidak null. Perbandingan tandatangan masa-tetap (subtle.verify).
export async function verifySession(token, secret, nowMs = Date.now()) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const key = await importHmacKey(secret, ['verify']);
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(parts[1]), enc.encode(parts[0]));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(b64urlDecode(parts[0])));
    if (!payload || typeof payload.exp !== 'number' || payload.exp * 1000 <= nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

// Banding dua rentetan tanpa bocor masa (untuk ADMIN_TOKEN).
export async function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function sha256Hex(text) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}
