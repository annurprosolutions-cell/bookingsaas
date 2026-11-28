// Config AWAM untuk pelayar. Jangan letak apa-apa rahsia di sini.
// Nilai GOOGLE_CLIENT_ID dan TURNSTILE_SITE_KEY mesti sama dengan "vars" dalam wrangler.jsonc.
window.ANNUR_CONFIG = Object.freeze({
  version: '0.2.0',
  googleClientId: '166391390903-21ubr3c3oclihgl7inpu4t2vg2en7lhe.apps.googleusercontent.com',
  turnstileSiteKey: '0x4AAAAAAGT5W0cOHVd9nvKA',
  scopes: 'openid email https://www.googleapis.com/auth/drive.file'
});
