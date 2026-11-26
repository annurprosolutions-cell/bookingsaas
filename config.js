// Config AWAM untuk pelayar. Jangan letak apa-apa rahsia di sini.
// Nilai GOOGLE_CLIENT_ID dan TURNSTILE_SITE_KEY mesti sama dengan "vars" dalam wrangler.jsonc.
window.ANNUR_CONFIG = Object.freeze({
  version: '0.0.1',
  googleClientId: '',
  turnstileSiteKey: '',
  scopes: 'openid email https://www.googleapis.com/auth/drive.file'
});
