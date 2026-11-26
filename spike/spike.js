// Prototaip Fasa 0 (IPD 0.9). Dibuang selepas lulus.
(function () {
  const CFG = window.ANNUR_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const KEY = 'annur_spike_v1';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch { return {}; }
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* mod peribadi */ }
  }
  let st = load();
  st.laporan = st.laporan || {};

  function show(id, text) {
    const el = $(id);
    el.hidden = false;
    el.textContent = text;
  }
  function busy(btn, on, label) {
    btn.disabled = on;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Sedang berjalan...'; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
  function rid() {
    const a = new Uint8Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => (b % 36).toString(36)).join('');
  }
  function catat(k, v) {
    st.laporan[k] = v;
    save(st);
    renderLaporan();
  }
  function renderLaporan() {
    const L = st.laporan;
    const baris = ['Laporan prototaip Fasa 0 - Annur Booking', 'Versi: ' + (CFG.version || '?'), 'Pelayar: ' + navigator.userAgent.split(') ')[0] + ')'];
    for (const k of ['A', 'B', 'C', 'C2', 'D1', 'D2']) if (L[k]) baris.push(k + ': ' + L[k]);
    $('laporan').textContent = baris.length > 3 ? baris.join('\n') : 'Belum ada keputusan.';
  }
  function enable() {
    const ada = !!st.sesi;
    for (const id of ['btnWrite', 'btnSim', 'btnSheet', 'btnPadam']) $(id).disabled = !ada;
  }

  async function api(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest',
        ...(st.sesi ? { authorization: 'Bearer ' + st.sesi } : {})
      },
      body: JSON.stringify(body || {})
    });
    const j = await res.json().catch(() => ({ ok: false, mesej: 'Respons tidak sah' }));
    j._status = res.status;
    return j;
  }

  async function semakStatus() {
    const amaran = [];
    if (!CFG.googleClientId) amaran.push('googleClientId dalam config.js masih kosong. Hantar Client ID kepada Claude dahulu.');
    try {
      const r = await fetch('/api/spike/status', { cache: 'no-store' });
      if (r.status === 404) amaran.push('Prototaip belum aktif: var SPIKE_EMAILS belum dipasang di Cloudflare.');
    } catch {
      amaran.push('Gagal hubungi server.');
    }
    if (amaran.length) { $('amaran').hidden = false; $('amaran').textContent = amaran.join(' '); }
  }

  // Ujian A + B
  $('btnLogin').addEventListener('click', () => {
    if (!window.google || !google.accounts || !google.accounts.oauth2) {
      show('outLogin', 'Skrip Google belum siap dimuat. Tunggu 2 saat dan tekan lagi.');
      return;
    }
    if (!CFG.googleClientId) { show('outLogin', 'Client ID belum diisi.'); return; }
    const state = rid();
    const btn = $('btnLogin');
    // Popup mesti dibuka terus dari klik ini.
    const client = google.accounts.oauth2.initCodeClient({
      client_id: CFG.googleClientId,
      scope: CFG.scopes,
      ux_mode: 'popup',
      select_account: true,
      state,
      callback: async (resp) => {
        if (resp.error) { show('outLogin', 'Google: ' + resp.error); busy(btn, false); return; }
        if (resp.state !== state) { show('outLogin', 'State tidak sepadan, cuba lagi.'); busy(btn, false); return; }
        show('outLogin', 'Kod diterima. Worker sedang tukar kod dan cipta Sheet...');
        try {
          const j = await api('/api/spike/exchange', { code: resp.code });
          if (!j.ok) {
            show('outLogin', 'Belum berjaya: ' + (j.mesej || j.kod || j._status));
            catat('A', 'BELUM (' + (j.kod || j._status) + ')');
            return;
          }
          st.sesi = j.sesi; st.email = j.email; st.sheetUrl = j.sheetUrl; save(st);
          show('outLogin',
            'Emel: ' + j.email +
            '\nRefresh token: ' + (j.refreshTokenBaru ? 'DITERIMA (baru)' : 'guna yang sudah disimpan') +
            '\nSheet: ' + (j.sheetBaru ? 'DICIPTA' : 'sudah wujud') + '\n' + j.sheetUrl +
            '\nDrive API nampak fail: ' + (j.driveOk ? 'YA' : 'TIDAK'));
          catat('A', 'LULUS (kod OAuth -> refresh token ' + (j.refreshTokenBaru ? 'baru' : 'sedia ada') + ')');
          catat('B', (j.driveOk ? 'LULUS' : 'SEPARA') + ' (Sheet ' + (j.sheetBaru ? 'dicipta' : 'sedia ada') + ', Drive nampak fail: ' + (j.driveOk ? 'ya' : 'tidak') + ')');
          enable();
        } catch {
          show('outLogin', 'Gagal sambung ke server.');
        } finally {
          busy(btn, false);
        }
      },
      error_callback: (err) => {
        show('outLogin', 'Popup ditutup atau disekat (' + (err && err.type) + ').');
        busy(btn, false);
      }
    });
    busy(btn, true, 'Menunggu Google...');
    client.requestCode();
  });

  // Ujian C
  $('btnWrite').addEventListener('click', async () => {
    const btn = $('btnWrite');
    busy(btn, true);
    try {
      const j = await api('/api/spike/write');
      if (!j.ok) { show('outWrite', 'Gagal: ' + (j.mesej || j.kod)); catat(st.laporan.C ? 'C2' : 'C', 'GAGAL (' + (j.kod || j._status) + ')'); return; }
      show('outWrite', 'Berjaya ditulis pada ' + j.masa + '\nJulat: ' + j.julat + '\nMinit sejak login: ' + j.minitSejakLogin + '\nBuka Sheet untuk lihat baris baharu.');
      const k = st.laporan.C && j.minitSejakLogin >= 60 ? 'C2' : 'C';
      catat(k, 'LULUS (Worker tulis guna refresh token, ' + j.minitSejakLogin + ' minit selepas login)');
    } catch {
      show('outWrite', 'Gagal sambung ke server.');
    } finally {
      busy(btn, false);
    }
  });

  async function serentak(n, body) {
    const t0 = performance.now();
    const res = await Promise.all(
      Array.from({ length: n }, (_, i) => api('/api/spike/race-one', { ...body, idx: i + 1 }).catch(() => ({ ok: false, sebab: 'rangkaian' })))
    );
    const ms = Math.round(performance.now() - t0);
    const ok = res.filter((r) => r.ok).length;
    const penuh = res.filter((r) => r.sebab === 'slot-penuh').length;
    const ralat = n - ok - penuh;
    return { ok, penuh, ralat, ms, contohRalat: (res.find((r) => !r.ok && r.sebab !== 'slot-penuh') || {}) };
  }

  // Ujian D1
  $('btnSim').addEventListener('click', async () => {
    const btn = $('btnSim');
    busy(btn, true);
    try {
      const tanpa = await serentak(20, { runId: 'x' + rid(), mode: 'sim', kunci: false });
      const dengan = await serentak(20, { runId: 'k' + rid(), mode: 'sim', kunci: true });
      const lulus = dengan.ok === 1 && dengan.ralat === 0;
      show('outRace',
        'TANPA kunci: ' + tanpa.ok + '/20 berjaya (lebih dari 1 = bukti masalah double booking wujud)' +
        '\nDENGAN kunci: ' + dengan.ok + '/20 berjaya, ' + dengan.penuh + ' ditolak "slot penuh", ralat ' + dengan.ralat +
        '\nKeputusan: ' + (lulus ? 'LULUS' : 'GAGAL'));
      catat('D1', (lulus ? 'LULUS' : 'GAGAL') + ' (DO SQLite; tanpa kunci ' + tanpa.ok + '/20, dengan kunci ' + dengan.ok + '/20, ralat ' + dengan.ralat + ')');
    } finally {
      busy(btn, false);
    }
  });

  // Ujian D2
  $('btnSheet').addEventListener('click', async () => {
    const btn = $('btnSheet');
    busy(btn, true);
    try {
      const runId = 's' + rid();
      const r = await serentak(5, { runId, mode: 'sheet', kunci: true });
      const k = await api('/api/spike/race-kira', { runId });
      const lulus = r.ok === 1 && k.ok && k.baris === 1;
      show('outRace',
        '5 serentak ke Sheet: ' + r.ok + ' berjaya, ' + r.penuh + ' ditolak, ralat ' + r.ralat +
        (r.ralat ? ' (' + (r.contohRalat.reason || r.contohRalat.sebab || '') + ')' : '') +
        '\nBaris dalam Sheet untuk ujian ini: ' + (k.ok ? k.baris : '?') + ' (mesti 1)' +
        '\nMasa: ' + r.ms + ' ms' +
        '\nKeputusan: ' + (lulus ? 'LULUS' : 'GAGAL'));
      catat('D2', (lulus ? 'LULUS' : 'GAGAL') + ' (5 serentak, ' + r.ok + ' berjaya, baris Sheet ' + (k.ok ? k.baris : '?') + ', ' + r.ms + ' ms)');
    } finally {
      busy(btn, false);
    }
  });

  $('btnSalin').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('laporan').textContent);
      $('btnSalin').textContent = 'Disalin';
      setTimeout(() => { $('btnSalin').textContent = 'Salin laporan'; }, 2000);
    } catch {
      $('btnSalin').textContent = 'Gagal salin, pilih teks secara manual';
    }
  });

  $('btnPadam').addEventListener('click', async () => {
    if (!confirm('Padam rekod prototaip dan tarik balik akses Google? Sheet ujian dalam Drive tidak dipadam, anda boleh padam sendiri.')) return;
    const j = await api('/api/spike/padam');
    show('outWrite', j.ok ? 'Rekod dipadam. Akses Google ditarik balik: ' + (j.ditarik ? 'ya' : 'tidak pasti') + '.\nSheet ujian: ' + (j.sheetUrl || '-') : 'Gagal: ' + (j.mesej || j.kod));
    if (j.ok) { st = { laporan: st.laporan }; save(st); enable(); }
  });

  renderLaporan();
  enable();
  semakStatus();
})();
