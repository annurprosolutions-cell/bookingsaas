// Google Identity Services, model kod (TRD 5). Popup mesti dibuka TERUS dari klik pengguna,
// jadi requestCode() mesti dipanggil secara serentak (sync) dalam pengendali klik.

export function gisReady() {
  return !!(window.google && google.accounts && google.accounts.oauth2 && google.accounts.oauth2.initCodeClient);
}

function randomState() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Pulangkan Promise<code>. Ralat: { kod, mesej }
export function requestCode({ clientId, scope, loginHint }) {
  return new Promise((resolve, reject) => {
    if (!gisReady()) {
      reject({ kod: 'belum-siap', mesej: 'Skrip Google belum siap dimuat. Tunggu sebentar dan tekan sekali lagi.' });
      return;
    }
    if (!clientId) {
      reject({ kod: 'tiada-client', mesej: 'Konfigurasi Google belum lengkap.' });
      return;
    }
    const state = randomState();
    const cfg = {
      client_id: clientId,
      scope,
      ux_mode: 'popup',
      select_account: true,
      state,
      callback: (resp) => {
        if (resp.error) return reject({ kod: resp.error, mesej: 'Google: ' + resp.error });
        if (resp.state !== state) return reject({ kod: 'state', mesej: 'Permintaan tidak sepadan. Cuba lagi.' });
        resolve(resp.code);
      },
      error_callback: (err) => {
        const t = err && err.type;
        reject({
          kod: t || 'ditutup',
          mesej: t === 'popup_failed_to_open' ? 'Popup disekat oleh pelayar. Benarkan popup untuk laman ini dan cuba lagi.' : 'Tetingkap Google ditutup sebelum selesai.'
        });
      }
    };
    if (loginHint) cfg.login_hint = loginHint;
    google.accounts.oauth2.initCodeClient(cfg).requestCode();
  });
}
