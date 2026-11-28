// Cloudflare Turnstile (anti-spam) untuk /book dan review. TRD 6.
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Pulangkan true jika token sah. Token hanya boleh digunakan sekali (Cloudflare).
export async function verifyTurnstile(fetchFn, secret, token, ip) {
  if (!secret || typeof token !== 'string' || !token || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetchFn(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
    });
    if (!res.ok) return false;
    const j = await res.json();
    return j && j.success === true;
  } catch {
    return false;
  }
}
