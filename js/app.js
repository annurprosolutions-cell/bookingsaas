// Dashboard studio (Fasa 2: S-10 Akaun dan sambungan Google sahaja).
// Shell penuh S-04 (Tempahan, Review, Tetapan, Akaun dengan bar bawah) dibina dalam Fasa 4.
import { h, clear, icon, setBusy, toast, copyText, waShareUrl, openModal, $ } from './lib/dom.js';
import { api } from './lib/api.js';
import * as store from './lib/store.js';
import { requestCode } from './lib/google-login.js';
import { applyBrand } from './lib/theme.js';

const CFG = window.ANNUR_CONFIG || {};
const root = $('#app');
let me = null;

const PLAN_LABEL = { percubaan: 'Percubaan percuma', bulanan: 'Bulanan', tahunan: 'Tahunan', pilot: 'Pilot' };
const fmtDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '-');

function notice(level, text, ...extra) {
  const ic = level === 'ok' ? 'check-circle' : level === 'info' ? 'info' : 'warning-circle';
  return h('div', { class: 'notice ' + level, role: level === 'urgent' || level === 'critical' ? 'alert' : 'status' }, icon(ic), h('div', {}, h('p', {}, text), ...extra));
}

function goLogin() {
  store.clearSession();
  location.replace('/daftar/');
}

async function boot() {
  if (!store.getSession()) return goLogin();
  const r = await api('/api/me');
  if (r.status === 401) return goLogin();
  if (!r.ok) {
    clear(root, notice('urgent', r.data.mesej || 'Gagal memuatkan. Cuba lagi.'), h('button', { class: 'btn', type: 'button', onclick: boot }, 'Cuba lagi'));
    return;
  }
  me = r.data;
  if (me.studio.perluSetup) {
    location.replace('/daftar/');
    return;
  }
  render();
  semakLatar();
}

// Semakan sambungan Google sebenar di latar (F-14): kesan akses ditarik balik atau Sheet dipadam.
let disemak = false;
async function semakLatar() {
  if (disemak) return;
  disemak = true;
  const r = await api('/api/me?semak=1');
  if (!r.ok) return;
  const s = r.data.studio;
  if (s.conn !== me.studio.conn || (s.sheet !== 'ok' && s.sheet !== 'tidak-diketahui')) {
    me = r.data;
    render();
  }
}

function langganBtn(label = 'Langgan sekarang') {
  if (!me.buyUrl) return null;
  return h('a', { class: 'btn small', href: me.buyUrl, target: '_blank', rel: 'noopener' }, label);
}

// Notis licence (AFD A6/A7): trial, hampir luput, grace, tamat. Teks ikut `notice.kod` dari server.
function licenceNotice() {
  const l = me.licence;
  if (!l.notice) return null;
  // daysLeft 0 = hari terakhir sah. Baki dikira termasuk hari ini (hari pertama trial = 14 hari).
  const baki = l.daysLeft === null ? 0 : l.daysLeft + 1;
  const hari = baki === 1 ? 'hari ini hari terakhir' : `baki ${baki} hari`;
  const t = fmtDate(l.expires);
  const msg = {
    percubaan: `Percubaan percuma: ${hari} (sah hingga ${t}).`,
    'percubaan-hampir-luput': `Percubaan percuma: ${hari} (sah hingga ${t}). Langgan untuk terus menerima tempahan.`,
    'hampir-luput': `Langganan: ${hari} (sah hingga ${t}). Perbaharui supaya halaman tempahan tidak ditutup.`,
    grace: `Langganan tamat pada ${t}. Anda dalam tempoh tangguh 7 hari. Perbaharui sekarang supaya halaman tempahan tidak ditutup.`,
    tamat: `Langganan tamat pada ${t}. Halaman tempahan awam ditutup. Data anda dalam Google Sheet kekal selamat.`,
    'percubaan-tamat': `Percubaan percuma tamat pada ${t}. Halaman tempahan awam ditutup. Data anda dalam Google Sheet kekal selamat.`,
    tiada: 'Tiada langganan aktif. Halaman tempahan awam ditutup. Data anda dalam Google Sheet kekal selamat.'
  }[l.notice.kod];
  if (!msg) return null;
  return notice(l.notice.level, msg, l.notice.kod === 'percubaan' ? null : langganBtn(l.plan === 'percubaan' || !l.plan ? 'Langgan sekarang' : 'Perbaharui'));
}

function reconnectFlow(btn, out) {
  const p = requestCode({ clientId: CFG.googleClientId, scope: CFG.scopes, loginHint: me.email });
  setBusy(btn, true, 'Menunggu Google...');
  p.then(async (code) => {
    setBusy(btn, true, 'Menyambung semula...');
    const r = await api('/api/admin/reconnect', { method: 'POST', body: { code } });
    setBusy(btn, false);
    if (!r.ok) {
      clear(out, notice('urgent', r.data.mesej || 'Gagal. Cuba lagi.'));
      return;
    }
    toast('Sambungan Google dipulihkan');
    disemak = false;
    await boot();
    if (r.data.sheetBaru) {
      $('main').prepend(notice('warning', 'Sheet lama tidak dijumpai dalam Drive anda, jadi Sheet baharu telah dicipta. Sila semak semula tetapan studio anda.'));
    }
  }).catch((e) => {
    setBusy(btn, false);
    clear(out, notice('urgent', (e && e.mesej) || 'Gagal. Cuba lagi.'));
  });
}

function deleteFlow() {
  const slug = me.studio.slug;
  const input = h('input', { type: 'text', id: 'sahkan', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'sahkan-hint' });
  const out = h('div', {});
  const btn = h('button', { class: 'btn danger', type: 'button', disabled: true }, icon('trash'), 'Padam akaun');
  input.addEventListener('input', () => {
    btn.disabled = input.value.trim().toLowerCase() !== slug.toLowerCase();
  });
  const close = openModal('Padam akaun studio?',
    h('ul', { class: 'small' },
      h('li', {}, `Pautan ${location.host}/${slug} akan berhenti berfungsi dan nama itu boleh diambil oleh orang lain.`),
      h('li', {}, 'Annur Booking akan berhenti mengakses Google Drive anda.'),
      h('li', {}, 'Google Sheet anda TIDAK dipadam. Semua data tempahan kekal milik anda dalam Drive.'),
      h('li', {}, 'Jika anda daftar semula kelak dengan emel yang sama, baki langganan anda masih sah.')),
    h('div', { class: 'field' }, h('label', { for: 'sahkan' }, 'Taip ', h('b', {}, slug), ' untuk mengesahkan'), input, h('div', { class: 'hint', id: 'sahkan-hint' }, 'Tindakan ini tidak boleh dibatalkan.')),
    out,
    btn);
  btn.addEventListener('click', async () => {
    setBusy(btn, true, 'Memadam...');
    const r = await api('/api/admin/account', { method: 'DELETE', body: { sahkan: input.value.trim() } });
    if (!r.ok) {
      setBusy(btn, false);
      clear(out, notice('urgent', r.data.mesej || 'Gagal. Cuba lagi.'));
      return;
    }
    close();
    store.clearSession();
    clear(root,
      h('div', { class: 'success-mark' }, icon('check', 'ic ic-xl')),
      h('h1', { class: 'center' }, 'Akaun dipadam'),
      h('p', { class: 'center muted' }, 'Google Sheet anda masih ada dalam Google Drive dan kekal milik anda.'),
      r.data.sheetUrl ? h('a', { class: 'btn secondary', href: r.data.sheetUrl, target: '_blank', rel: 'noopener' }, icon('table'), 'Buka Google Sheet') : null,
      h('div', { class: 'mt' }, h('a', { class: 'btn', href: '/' }, 'Ke laman utama')));
  });
}

function render() {
  applyBrand('#2563EB');
  const s = me.studio;
  const l = me.licence;
  const putus = s.conn === 'putus';
  const connOut = h('div', {});
  const reBtn = h('button', { class: 'btn ' + (putus ? '' : 'secondary'), type: 'button' }, icon('arrows-clockwise'), 'Sambung semula Google');
  reBtn.addEventListener('click', () => reconnectFlow(reBtn, connOut));

  const stateBadge = {
    aktif: l.plan === 'percubaan' ? ['Percubaan', 'b-info'] : ['Aktif', 'b-ok'],
    grace: ['Tempoh tangguh', 'b-warn'],
    tamat: ['Tamat', 'b-bad'],
    tiada: ['Tiada', 'b-bad']
  }[l.state] || ['-', 'b-info'];

  const refreshBtn = h('button', { class: 'btn ghost small', type: 'button' }, icon('arrows-clockwise'), 'Muat semula status');
  refreshBtn.addEventListener('click', async () => {
    setBusy(refreshBtn, true);
    await boot();
    toast('Status dikemas kini');
  });

  clear(root,
    h('header', { class: 'brandbar' },
      h('div', { class: 'mark', 'aria-hidden': 'true' }, 'A'),
      h('div', {}, h('b', {}, s.nama || 'Studio'), h('div', { class: 'caption' }, me.email)),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn ghost small', type: 'button', onclick: goLogin }, icon('sign-out'), 'Log keluar')),

    s.status === 'digantung' ? notice('critical', 'Akaun studio ini digantung. Hubungi sokongan Annur Booking.') : null,
    putus ? notice('urgent', 'Sambungan Google terputus. Halaman tempahan awam ditutup sementara sehingga anda sambung semula.', h('div', { class: 'mt' }, reBtn)) : null,
    !putus && s.sheet === 'dibuang' ? notice('urgent', 'Google Sheet anda berada dalam Tong Sampah Google Drive. Pulihkan fail itu dari Tong Sampah supaya tempahan boleh diterima.') : null,
    !putus && s.sheet === 'hilang' ? notice('urgent', 'Google Sheet anda tidak dijumpai. Tekan "Sambung semula Google" untuk mencipta Sheet baharu.') : null,
    licenceNotice(),

    h('div', { class: 'card stack' },
      h('h2', {}, 'Halaman tempahan anda'),
      h('div', { class: 'linkbox' }, icon('link'), s.url),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn secondary', type: 'button', onclick: () => copyText(s.url) }, icon('copy'), 'Salin'),
        h('a', { class: 'btn wa', href: waShareUrl(`Tempah sesi fotografi di ${s.nama}: ${s.url}`), target: '_blank', rel: 'noopener' }, icon('whatsapp-logo'), 'Kongsi'))),

    h('div', { class: 'card stack' },
      h('h2', {}, 'Google Sheet anda'),
      h('p', { class: 'muted small mb0' }, 'Semua tempahan, tetapan dan review disimpan dalam Sheet ini dalam Google Drive anda. Jangan padam fail ini atau tukar nama tab.'),
      h('a', { class: 'btn secondary', href: s.sheetUrl, target: '_blank', rel: 'noopener' }, icon('table'), 'Buka Sheet saya')),

    h('div', { class: 'card stack' },
      h('div', { class: 'head-row' }, h('h2', {}, 'Langganan'), h('span', { class: 'badge ' + stateBadge[1] }, stateBadge[0])),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Plan'), h('dd', {}, PLAN_LABEL[l.plan] || '-'),
        h('dt', {}, 'Sah hingga'), h('dd', {}, fmtDate(l.expires))),
      me.buyUrl ? h('a', { class: 'btn', href: me.buyUrl, target: '_blank', rel: 'noopener' }, icon('ticket'), l.plan && l.plan !== 'percubaan' ? 'Perbaharui langganan' : 'Langgan') : null,
      h('p', { class: 'caption mb0' }, `RM${me.harga.bulan} sebulan atau RM${me.harga.tahun.toLocaleString('en-MY')} setahun. Dalam borang bayaran, isi emel Google yang sama: `, h('b', {}, me.email), '.'),
      refreshBtn),

    h('div', { class: 'card stack' },
      h('div', { class: 'head-row' }, h('h2', {}, 'Sambungan Google'), h('span', { class: 'badge ' + (putus ? 'b-bad' : 'b-ok') }, putus ? 'Terputus' : 'Bersambung')),
      h('p', { class: 'muted small mb0' }, 'Annur Booking hanya boleh membuka fail yang ia cipta sendiri dalam Drive anda.'),
      putus ? null : reBtn,
      connOut),

    h('div', { class: 'card flat' },
      h('h2', {}, 'Tempahan, review dan tetapan'),
      h('p', { class: 'muted small mb0' }, 'Pengurusan tempahan, review dan tetapan studio akan tersedia di sini tidak lama lagi. Buat masa ini anda boleh melihat data terus dalam Google Sheet.')),

    h('div', { class: 'card flat' },
      h('h2', {}, 'Zon bahaya'),
      h('p', { class: 'muted small' }, 'Putuskan sambungan dan padam akaun Annur Booking. Google Sheet anda tidak dipadam.'),
      h('button', { class: 'btn secondary', type: 'button', onclick: deleteFlow }, icon('trash'), 'Padam akaun')),

    h('p', { class: 'footer' }, h('a', { href: '/privasi' }, 'Privasi'), ' · ', h('a', { href: '/terma' }, 'Terma'), ' · Dikuasakan oleh Annur Booking'));
}

boot();
