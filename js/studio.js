// Halaman awam studio: S-11 Utama, S-12 Memo, S-13 Tarikh, S-14 Slot, S-15 Butiran, S-16 Berjaya,
// S-17 Semak status, S-21 Tertutup. AFD A3 "Pelanggan menempah", DBD bahagian B.
// Semua teks dari Sheet dimasukkan dengan textContent (XSS). Harga di sini hanyalah ANGGARAN; server mengira semula.
import { h, clear, icon, setBusy, toast, copyText, $ } from './lib/dom.js';
import * as store from './lib/store.js';
import { applyBrand } from './lib/theme.js';
import { formatRM, toSen } from './core/pricing.js';
import { normalizePhone, isValidPhone, isEmail, isValidRef } from './core/validate.js';
import { daysInMonth, formatDate, parseDate } from './core/dates.js';

const CFG = window.ANNUR_CONFIG || {};
const app = $('#app');
const nav = $('#nav');
const slug = (location.pathname.split('/')[1] || '').toLowerCase();
const KEY_PILIH = 'annur_pilih_' + slug;
const KEY_LOGO = 'annur_logo_' + slug;
const KEY_WA = 'annur_wa_pos';
const KEY_REF = 'annur_ref_' + slug;

let C = null;
let S = { tarikh: '', slotIds: [], addonIds: [], dewasa: 1, kanak: 0 };
const P = { nama: '', telefon: '', emel: '', catatan: '', pdpa: false }; // data peribadi: memori sahaja, tidak disimpan
let hasil = null;
let bulan = null;
const slotCache = new Map();
let tsToken = '';
let tsWidget = null;

const HARI = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'];
const HARI_PENDEK = ['Ahd', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'];
const BULAN = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
const STATUS_LABEL = { PENDING: 'Menunggu deposit', DEPOSIT: 'Deposit diterima', SELESAI: 'Selesai', CANCEL: 'Dibatalkan' };

const dow = (d) => {
  const p = parseDate(d);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
};
const fmtTarikh = (d) => (parseDate(d) ? `${HARI[dow(d)]}, ${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '-');
const rm = (n) => formatRM(n || 0);
const save = () => store.set(KEY_PILIH, S);
const go = (r) => {
  location.hash = '#/' + r;
};

function notice(level, text, ...extra) {
  const ic = level === 'ok' ? 'check-circle' : level === 'info' ? 'info' : 'warning-circle';
  return h('div', { class: 'notice ' + level, role: level === 'urgent' ? 'alert' : 'status' }, icon(ic), h('div', {}, h('p', {}, text), ...extra));
}

function backLink(to, label = 'Kembali') {
  return h('a', { class: 'back', href: '#/' + to }, icon('arrow-left'), label);
}

function waUrl(text) {
  const no = (C.studio && C.studio.whatsapp) || '';
  return no ? `https://wa.me/${no}?text=${encodeURIComponent(text)}` : '';
}

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------
async function boot() {
  const logo = store.get(KEY_LOGO, '');
  if (logo) $('.boot-ring').style.setProperty('background-image', `url(${JSON.stringify(logo)})`);
  const el = document.getElementById('annur-data');
  if (el) {
    try {
      C = JSON.parse(el.textContent);
    } catch {
      C = null;
    }
  }
  if (!C) {
    try {
      const r = await fetch(`/api/public/${encodeURIComponent(slug)}/config`, { cache: 'no-store' });
      if (r.ok) C = await r.json();
    } catch {
      /* rangkaian */
    }
  }
  if (!C || !C.ok) {
    clear(app, h('div', { class: 'page' }, notice('urgent', 'Halaman tidak dapat dimuatkan. Semak sambungan internet dan cuba lagi.'), h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, 'Cuba lagi')));
    hideBoot();
    return;
  }
  applyBrand(C.studio.warna_utama);
  if (C.studio.logo_url) store.set(KEY_LOGO, C.studio.logo_url);
  const lama = store.get(KEY_PILIH, null);
  if (lama && typeof lama === 'object') S = { ...S, ...lama, slotIds: Array.isArray(lama.slotIds) ? lama.slotIds : [], addonIds: Array.isArray(lama.addonIds) ? lama.addonIds : [] };
  if (S.tarikh && S.tarikh < C.hari_ini) S = { ...S, tarikh: '', slotIds: [] };
  window.addEventListener('hashchange', route);
  route();
  hideBoot();
}

function hideBoot() {
  const b = $('#boot');
  if (!b) return;
  b.classList.add('hilang');
  setTimeout(() => b.remove(), 400);
}

function route() {
  const r = location.hash.replace(/^#\/?/, '');
  document.body.classList.remove('ada-actionbar');
  document.body.classList.toggle('tanpa-wa', r === 'berjaya');
  if (C.tertutup) {
    renderNav(null);
    return renderTertutup();
  }
  const views = { '': home, memo, tarikh: viewTarikh, slot: viewSlot, butiran: viewButiran, berjaya: viewBerjaya, status: viewStatus };
  const fn = views[r] || home;
  renderNav(r);
  fn();
  window.scrollTo(0, 0);
  const hd = $('h1, h2', app);
  if (hd) {
    hd.setAttribute('tabindex', '-1');
    hd.focus({ preventScroll: true });
  }
}

// ---------------------------------------------------------------------------------------------
// Navigasi bawah + WhatsApp terapung
// ---------------------------------------------------------------------------------------------
function renderNav(r) {
  if (r === null) {
    nav.hidden = true;
    return;
  }
  const item = (to, ic, label, aktif) => h('a', { href: '#/' + to, 'aria-current': aktif ? 'page' : null }, icon(ic), label);
  const tempah = ['memo', 'tarikh', 'slot', 'butiran', 'berjaya'].includes(r);
  clear(nav, item('', 'house', 'Utama', r === ''), item('memo', 'calendar-blank', 'Tempah', tempah), item('status', 'ticket', 'Status', r === 'status'));
  nav.hidden = false;
  renderWa();
}

let waEl = null;
function renderWa(text) {
  const url = waUrl(text || C.studio.mesej_wa || 'Salam');
  if (!url) return;
  if (!waEl) {
    waEl = h('a', { class: 'wa-float', href: url, target: '_blank', rel: 'noopener', 'aria-label': 'WhatsApp studio' }, icon('whatsapp-logo'));
    document.body.append(waEl);
    draggable(waEl);
  } else waEl.href = url;
}

// Butang boleh diseret (DBD B6). Kedudukan disimpan dalam pelayar sahaja.
function draggable(el) {
  const pos = store.get(KEY_WA, null);
  const place = (x, y) => {
    const maxX = window.innerWidth - el.offsetWidth - 8;
    const maxY = window.innerHeight - el.offsetHeight - 72;
    el.style.setProperty('left', Math.max(8, Math.min(maxX, x)) + 'px');
    el.style.setProperty('top', Math.max(8, Math.min(maxY, y)) + 'px');
    el.style.setProperty('right', 'auto');
    el.style.setProperty('bottom', 'auto');
  };
  if (pos && typeof pos.x === 'number') requestAnimationFrame(() => place(pos.x, pos.y));
  let start = null;
  let moved = false;
  el.addEventListener('pointerdown', (e) => {
    const r = el.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, ox: r.left, oy: r.top };
    moved = false;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true;
    place(start.ox + dx, start.oy + dy);
  });
  el.addEventListener('pointerup', () => {
    if (moved) {
      const r = el.getBoundingClientRect();
      store.set(KEY_WA, { x: r.left, y: r.top });
    }
    start = null;
  });
  el.addEventListener('click', (e) => {
    if (moved) {
      e.preventDefault();
      moved = false;
    }
  });
}

function actionbar(info, btn) {
  document.body.classList.add('ada-actionbar');
  return h('div', { class: 'actionbar' }, h('div', { class: 'info' }, info), btn);
}

// ---------------------------------------------------------------------------------------------
// S-11 Utama
// ---------------------------------------------------------------------------------------------
function heroLogo() {
  const s = C.studio;
  const ph = h('div', { class: 's-logo-ph', 'aria-hidden': 'true' }, (s.nama_studio || 'S').trim().charAt(0).toUpperCase());
  if (!s.logo_url) return ph;
  const img = h('img', { class: 's-logo', src: s.logo_url, alt: '', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(ph));
  return img;
}

function carousel(urls) {
  if (!urls || !urls.length) return null;
  const track = h('div', { class: 'track', tabindex: '0', 'aria-label': 'Gambar studio' });
  urls.forEach((u, i) => {
    const img = h('img', { src: u, alt: `Gambar ${i + 1}`, loading: i === 0 ? 'eager' : 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => img.remove());
    track.append(img);
  });
  if (urls.length === 1) return h('div', { class: 'carousel' }, track);
  const dots = h('div', { class: 'dots' }, urls.map((_, i) => h('button', { type: 'button', 'aria-label': `Gambar ${i + 1}`, onclick: () => goto(i) })));
  const goto = (i) => track.scrollTo({ left: i * track.clientWidth, behavior: 'smooth' });
  const now = () => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  const mark = () => [...dots.children].forEach((d, i) => d.setAttribute('aria-current', String(i === now())));
  track.addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true });
  requestAnimationFrame(mark);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let timer = null;
  const tick = () => {
    if (!document.body.contains(track)) return clearInterval(timer);
    goto((now() + 1) % urls.length);
  };
  if (!reduce) timer = setInterval(tick, 4000);
  ['pointerdown', 'focusin'].forEach((ev) => track.addEventListener(ev, () => clearInterval(timer), { once: true }));
  return h('div', { class: 'carousel' }, track, dots,
    h('button', { class: 'arrow kiri', type: 'button', 'aria-label': 'Sebelum', onclick: () => goto((now() - 1 + urls.length) % urls.length) }, icon('caret-left')),
    h('button', { class: 'arrow kanan', type: 'button', 'aria-label': 'Seterusnya', onclick: () => goto((now() + 1) % urls.length) }, icon('caret-right')));
}

function footer() {
  return h('p', { class: 'footer-studio' }, 'Dikuasakan oleh ', h('a', { href: '/' }, 'Annur Booking'), ' · ',
    h('a', { href: '/daftar/', 'aria-label': 'Log masuk pemilik studio' }, icon('lock')));
}

function home() {
  const s = C.studio;
  const waktu = [['Pagi', s.waktu_pagi], ['Petang', s.waktu_petang], ['Malam', s.waktu_malam]].filter(([, v]) => v);
  clear(app,
    h('header', { class: 's-hero' }, heroLogo(), h('h1', {}, s.tajuk_hero || s.nama_studio), s.subtajuk_hero ? h('p', {}, s.subtajuk_hero) : null),
    h('div', { class: 's-cards' },
      h('a', { class: 'primary', href: '#/memo' }, icon('calendar-blank'), 'Tempah Sekarang', h('small', {}, 'Pilih tarikh dan slot')),
      h('a', { href: '#/status' }, icon('ticket'), 'Semak Status', h('small', {}, 'Guna Ref ID'))),
    s.ticker ? h('div', { class: 'ticker', role: 'marquee' }, h('span', {}, s.ticker)) : null,
    carousel(C.banners),
    h('div', { class: 'page' },
      C.ada_slot ? null : notice('info', 'Studio belum membuka slot tempahan. Sila hubungi studio melalui WhatsApp.'),
      waktu.length ? h('div', { class: 'card' }, h('h2', {}, 'Waktu operasi'), h('dl', { class: 'waktu' }, waktu.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))) : null,
      s.alamat || s.maps_url ? h('div', { class: 'card stack' },
        h('h2', {}, 'Lokasi'),
        s.alamat ? h('div', { class: 'info-row' }, icon('map-pin'), h('div', { class: 'pre' }, s.alamat)) : null,
        s.maps_url ? h('a', { class: 'btn secondary', href: s.maps_url, target: '_blank', rel: 'noopener' }, icon('map-pin'), 'Buka Google Maps') : null) : null,
      footer()));
}

// ---------------------------------------------------------------------------------------------
// S-12 Memo "Baca dahulu"
// ---------------------------------------------------------------------------------------------
function memo() {
  const s = C.studio;
  const lain = s.harga_special !== undefined && s.harga_special !== null && Number(s.harga_special) !== Number(s.harga_normal);
  const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const terma = lines(s.terma);
  const faedah = lines(s.faedah);
  clear(app, h('div', { class: 'page' },
    backLink(''),
    h('h1', {}, 'Baca dahulu sebelum tempah'),
    h('div', { class: 'card stack' },
      h('h2', {}, 'Harga'),
      h('div', { class: 'harga-box' },
        h('div', {}, h('span', { class: 'small muted' }, 'Satu slot, hari biasa'), h('span', { class: 'num' }, rm(s.harga_normal))),
        lain ? h('div', { class: 'special' }, h('span', { class: 'small' }, 'Satu slot, hari special'), h('span', { class: 'num' }, rm(s.harga_special))) : null),
      s.tempoh_sesi_minit ? h('p', { class: 'small muted mb0' }, `Setiap sesi ${s.tempoh_sesi_minit} minit. Maksimum ${s.maks_dewasa} dewasa setiap tempahan.`) : null,
      Number(s.deposit) > 0 ? h('p', { class: 'small mb0' }, h('b', {}, `Deposit ${rm(s.deposit)}`), ' diperlukan untuk mengesahkan tempahan. Cara bayaran dipaparkan selepas tempahan dibuat.') : null),
    faedah.length ? h('div', { class: 'card' }, h('h2', {}, 'Apa anda dapat'), h('ul', { class: 'terma' }, faedah.map((t) => h('li', {}, t)))) : null,
    terma.length ? h('div', { class: 'card' }, h('h2', {}, 'Terma'), h('ul', { class: 'terma' }, terma.map((t) => h('li', {}, t)))) : null,
    C.ada_slot ? null : notice('info', 'Studio belum membuka slot tempahan.'),
    h('a', { class: 'btn', href: C.ada_slot ? '#/tarikh' : '#/', 'aria-disabled': C.ada_slot ? null : 'true' }, 'Saya Faham dan Teruskan', icon('arrow-right'))));
}

// ---------------------------------------------------------------------------------------------
// S-13 Pilih tarikh
// ---------------------------------------------------------------------------------------------
function viewTarikh() {
  const today = C.hari_ini;
  const tp = parseDate(today);
  if (!bulan) {
    const sp = parseDate(S.tarikh || today);
    bulan = { y: sp.y, m: sp.m };
  }
  const special = new Map((C.hari_special || []).map((x) => [x.tarikh, x.label]));
  const tutup = new Map((C.tarikh_tutup || []).map((x) => [x.tarikh, x.sebab]));
  const maxIdx = tp.y * 12 + tp.m + 12;
  const idx = bulan.y * 12 + bulan.m;

  const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': 'Kalendar' }, HARI_PENDEK.map((d) => h('div', { class: 'dow', 'aria-hidden': 'true' }, d)));
  const first = dow(formatDate(bulan.y, bulan.m, 1));
  for (let i = 0; i < first; i++) grid.append(h('div', {}));
  for (let d = 1; d <= daysInMonth(bulan.y, bulan.m); d++) {
    const t = formatDate(bulan.y, bulan.m, d);
    const lampau = t < today;
    const isTutup = tutup.has(t);
    const isSp = special.has(t);
    const cls = [t === today ? 'today' : '', isSp ? 'special' : '', isTutup ? 'closed' : ''].join(' ').trim();
    const label = `${fmtTarikh(t)}${isSp ? ', hari special' : ''}${isTutup ? ', ditutup' : ''}`;
    const b = h('button', { type: 'button', class: cls, disabled: lampau, 'aria-pressed': String(S.tarikh === t), 'aria-label': label }, String(d));
    b.addEventListener('click', () => {
      if (isTutup) {
        toast(tutup.get(t) ? `Ditutup: ${tutup.get(t)}` : 'Tarikh ini ditutup.');
        return;
      }
      if (S.tarikh !== t) S = { ...S, tarikh: t, slotIds: [] };
      save();
      viewTarikh();
    });
    grid.append(b);
  }
  const pilihan = S.tarikh
    ? h('div', {}, h('b', {}, fmtTarikh(S.tarikh)), special.has(S.tarikh) ? h('span', {}, ` · ${special.get(S.tarikh) || 'Hari special'}`) : null)
    : h('div', {}, 'Belum pilih tarikh');
  const next = h('a', { class: 'btn', href: S.tarikh ? '#/slot' : '#/tarikh', 'aria-disabled': S.tarikh ? null : 'true' }, 'Seterusnya');
  if (!S.tarikh) next.addEventListener('click', (e) => e.preventDefault());

  clear(app, h('div', { class: 'page' },
    backLink('memo'),
    h('h1', {}, 'Pilih tarikh'),
    h('div', { class: 'card' },
      h('div', { class: 'cal-head' },
        h('button', { type: 'button', 'aria-label': 'Bulan sebelum', disabled: idx <= tp.y * 12 + tp.m, onclick: () => { bulan = bulan.m === 1 ? { y: bulan.y - 1, m: 12 } : { y: bulan.y, m: bulan.m - 1 }; viewTarikh(); } }, icon('caret-left')),
        h('h2', { class: 'mb0', 'aria-live': 'polite' }, `${BULAN[bulan.m - 1]} ${bulan.y}`),
        h('button', { type: 'button', 'aria-label': 'Bulan seterusnya', disabled: idx >= maxIdx, onclick: () => { bulan = bulan.m === 12 ? { y: bulan.y + 1, m: 1 } : { y: bulan.y, m: bulan.m + 1 }; viewTarikh(); } }, icon('caret-right'))),
      grid,
      h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'l-pl' }), 'Dipilih'), h('span', {}, h('i', { class: 'l-sp' }), 'Hari special'), h('span', {}, h('i', { class: 'l-tt' }), 'Ditutup'))),
    actionbar(pilihan, next)));
}

// ---------------------------------------------------------------------------------------------
// S-14 Pilih slot
// ---------------------------------------------------------------------------------------------
async function fetchSlots(date, force) {
  const c = slotCache.get(date);
  if (!force && c && Date.now() - c.at < 15000) return c.data;
  const r = await fetch(`/api/public/${encodeURIComponent(slug)}/slots?date=${date}`, { cache: 'no-store' }).catch(() => null);
  const j = r ? await r.json().catch(() => null) : null;
  if (!r || !j) return { ok: false, mesej: navigator.onLine === false ? 'Perlukan sambungan internet.' : 'Gagal, cuba lagi.' };
  if (r.ok) slotCache.set(date, { data: j, at: Date.now() });
  return j;
}

function anggaran(data) {
  const per = data ? data.harga_seslot : 0;
  const addon = (C.addons || []).filter((a) => S.addonIds.includes(a.addon_id)).reduce((t, a) => t + toSen(a.harga), 0);
  return (toSen(per) * S.slotIds.length + addon) / 100;
}

async function viewSlot(force) {
  if (!S.tarikh) return go('tarikh');
  const body = h('div', {}, h('div', { class: 'slot-grid' }, Array.from({ length: 9 }, () => h('div', { class: 'skeleton' }))));
  const info = h('div', {});
  const next = h('a', { class: 'btn', href: '#/butiran' }, 'Seterusnya');
  clear(app, h('div', { class: 'page' }, backLink('tarikh'), h('h1', {}, 'Pilih slot'), h('p', { class: 'muted' }, fmtTarikh(S.tarikh)), body, actionbar(info, next)));

  const data = await fetchSlots(S.tarikh, force === true);
  if (location.hash !== '#/slot') return;
  if (data.tertutup) {
    C.tertutup = data.tertutup;
    return route();
  }
  if (!data.sesi) {
    clear(body, notice('urgent', data.mesej || 'Gagal, cuba lagi.'), h('button', { class: 'btn secondary', type: 'button', onclick: () => viewSlot(true) }, 'Cuba lagi'));
    return;
  }
  if (data.tutup || data.lampau) {
    clear(body, notice('warning', data.tutup ? `Tarikh ini ditutup${data.tutup.sebab ? ': ' + data.tutup.sebab : '.'}` : 'Tarikh ini sudah lepas.'), backLink('tarikh', 'Pilih tarikh lain'));
    return;
  }
  // Slot yang dipilih tetapi kini penuh dibuang dari pilihan
  const penuh = new Set(data.sesi.flatMap((g) => g.slots.filter((x) => x.penuh).map((x) => x.slot_id)));
  const ada = new Set(data.sesi.flatMap((g) => g.slots.map((x) => x.slot_id)));
  const sebelum = S.slotIds.length;
  S.slotIds = S.slotIds.filter((id) => ada.has(id) && !penuh.has(id));
  if (S.slotIds.length < sebelum) toast('Sebahagian slot pilihan anda sudah diambil.');
  save();

  const upd = () => {
    clear(info, S.slotIds.length ? h('div', {}, `${S.slotIds.length} slot dipilih`, h('b', {}, rm(anggaran(data)))) : h('div', {}, 'Pilih satu atau lebih slot'));
    next.setAttribute('aria-disabled', S.slotIds.length ? 'false' : 'true');
  };
  next.addEventListener('click', (e) => {
    if (!S.slotIds.length) e.preventDefault();
  });
  if (!data.sesi.length) {
    clear(body, notice('info', 'Tiada slot dibuka. Sila hubungi studio.'));
    return;
  }
  clear(body,
    data.jenis_hari === 'special' ? notice('warning', `Hari special: ${rm(data.harga_seslot)} setiap slot.`) : null,
    data.sesi.map((g) => h('div', { class: 'slot-group' },
      h('h3', {}, g.kumpulan),
      h('div', { class: 'slot-grid' }, g.slots.map((x) => {
        const b = h('button', { type: 'button', disabled: x.penuh, 'aria-pressed': String(S.slotIds.includes(x.slot_id)), 'aria-label': x.label + (x.penuh ? ', penuh' : '') }, x.label, x.penuh ? h('small', {}, 'Penuh') : null);
        b.addEventListener('click', () => {
          S.slotIds = S.slotIds.includes(x.slot_id) ? S.slotIds.filter((i) => i !== x.slot_id) : [...S.slotIds, x.slot_id];
          b.setAttribute('aria-pressed', String(S.slotIds.includes(x.slot_id)));
          save();
          upd();
        });
        return b;
      })))));
  upd();
}

// ---------------------------------------------------------------------------------------------
// S-15 Butiran dan sahkan
// ---------------------------------------------------------------------------------------------
function loadTurnstile(box) {
  const render = () => {
    if (!window.turnstile || !box.isConnected) return;
    tsToken = '';
    tsWidget = window.turnstile.render(box, {
      sitekey: CFG.turnstileSiteKey,
      theme: 'light',
      size: 'flexible',
      callback: (t) => { tsToken = t; },
      'expired-callback': () => { tsToken = ''; },
      'error-callback': () => { tsToken = ''; }
    });
  };
  if (window.turnstile) return render();
  if (!document.getElementById('ts-script')) {
    const sc = document.createElement('script');
    sc.id = 'ts-script';
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    sc.async = true;
    sc.addEventListener('load', render);
    document.head.append(sc);
  } else document.getElementById('ts-script').addEventListener('load', render);
}

function resetTurnstile() {
  tsToken = '';
  try {
    if (window.turnstile && tsWidget !== null) window.turnstile.reset(tsWidget);
  } catch {
    /* abaikan */
  }
}

async function viewButiran() {
  if (!S.tarikh) return go('tarikh');
  if (!S.slotIds.length) return go('slot');
  const s = C.studio;
  const data = await fetchSlots(S.tarikh);
  if (location.hash !== '#/butiran') return;
  const slotList = data && data.sesi ? data.sesi.flatMap((g) => g.slots).filter((x) => S.slotIds.includes(x.slot_id)) : [];
  if (!slotList.length) return go('slot');
  S.addonIds = S.addonIds.filter((id) => (C.addons || []).some((a) => a.addon_id === id));
  const errs = {};
  const jumlahEl = h('span', { class: 'jumlah' });
  const addonEl = h('div', {});
  const updJumlah = () => {
    jumlahEl.textContent = rm(anggaran(data));
    const pilih = (C.addons || []).filter((a) => S.addonIds.includes(a.addon_id));
    clear(addonEl, pilih.length ? h('div', { class: 'baris' }, h('span', {}, 'Add-on'), h('span', {}, pilih.map((a) => a.nama).join(', '))) : null);
  };

  const stepper = (key, label, min, max, hint) => {
    const out = h('output', { 'aria-live': 'polite' }, String(S[key]));
    const minus = h('button', { type: 'button', 'aria-label': 'Kurang ' + label }, icon('minus'));
    const plus = h('button', { type: 'button', 'aria-label': 'Tambah ' + label }, icon('plus'));
    const upd = () => {
      out.textContent = String(S[key]);
      minus.disabled = S[key] <= min;
      plus.disabled = S[key] >= max;
      save();
    };
    minus.addEventListener('click', () => { S[key] = Math.max(min, S[key] - 1); upd(); });
    plus.addEventListener('click', () => { S[key] = Math.min(max, S[key] + 1); upd(); });
    S[key] = Math.max(min, Math.min(max, Number(S[key]) || min));
    upd();
    return h('div', { class: 'stepper' }, h('div', {}, h('b', {}, label), hint ? h('div', { class: 'caption' }, hint) : null), h('div', { class: 'ctl' }, minus, out, plus));
  };

  const field = (key, label, attrs = {}, hint) => {
    const id = 'p-' + key;
    const input = attrs.multiline ? h('textarea', { id, maxlength: attrs.max, 'aria-describedby': id + '-err' }) : h('input', { id, type: attrs.type || 'text', inputmode: attrs.inputmode, autocomplete: attrs.autocomplete, maxlength: attrs.max, 'aria-describedby': id + '-err' });
    input.value = P[key];
    const err = h('div', { class: 'err', id: id + '-err', hidden: true });
    input.addEventListener('input', () => {
      P[key] = input.value;
      err.hidden = true;
      input.removeAttribute('aria-invalid');
    });
    errs[key] = (m) => {
      err.textContent = m;
      err.hidden = !m;
      if (m) input.setAttribute('aria-invalid', 'true');
    };
    return h('div', { class: 'field' }, h('label', { for: id }, label, attrs.optional ? h('span', { class: 'muted' }, ' (pilihan)') : null), input, hint ? h('div', { class: 'hint' }, hint) : null, err);
  };

  const pdpa = h('input', { type: 'checkbox', id: 'p-pdpa', checked: P.pdpa });
  const pdpaErr = h('div', { class: 'err', hidden: true });
  pdpa.addEventListener('change', () => {
    P.pdpa = pdpa.checked;
    pdpaErr.hidden = true;
  });
  errs.pdpa = (m) => {
    pdpaErr.textContent = m;
    pdpaErr.hidden = !m;
  };
  const tsBox = h('div', { class: 'ts-wrap' });
  const msg = h('div', {});
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Sahkan Tempahan');

  const form = h('form', { novalidate: true },
    h('div', { class: 'ringkas' },
      h('div', { class: 'baris' }, h('span', {}, 'Tarikh'), h('span', {}, fmtTarikh(S.tarikh))),
      h('div', { class: 'baris' }, h('span', {}, 'Slot'), h('span', {}, slotList.map((x) => x.label).join(', '))),
      h('div', { class: 'baris' }, h('span', {}, `${slotList.length} slot x ${rm(data.harga_seslot)}`), h('span', {}, rm(toSen(data.harga_seslot) * slotList.length / 100))),
      addonEl,
      h('hr', {}),
      h('div', { class: 'baris' }, h('span', {}, 'Anggaran jumlah'), jumlahEl)),
    (C.addons || []).length ? h('div', { class: 'card' }, h('h2', {}, 'Add-on'), (C.addons || []).map((a) => {
      const cb = h('input', { type: 'checkbox', checked: S.addonIds.includes(a.addon_id) });
      cb.addEventListener('change', () => {
        S.addonIds = cb.checked ? [...S.addonIds, a.addon_id] : S.addonIds.filter((i) => i !== a.addon_id);
        save();
        updJumlah();
      });
      return h('label', { class: 'addon' }, cb, h('b', {}, a.nama), h('span', { class: 'num' }, '+' + rm(a.harga)));
    })) : null,
    h('div', { class: 'card' }, h('h2', {}, 'Bilangan orang'),
      stepper('dewasa', 'Dewasa', 1, Number(s.maks_dewasa) || 10),
      stepper('kanak', 'Kanak-kanak', 0, 20, s.umur_kanak_percuma ? `Umur ${s.umur_kanak_percuma} tahun ke bawah percuma` : null)),
    h('div', { class: 'card' }, h('h2', {}, 'Maklumat anda'),
      field('nama', 'Nama', { max: 80, autocomplete: 'name' }),
      field('telefon', 'Nombor telefon', { type: 'tel', inputmode: 'tel', autocomplete: 'tel', max: 20 }, 'Diguna untuk semak status bersama Ref ID.'),
      field('emel', 'Emel', { type: 'email', inputmode: 'email', autocomplete: 'email', max: 254, optional: true }),
      field('catatan', 'Catatan', { multiline: true, max: 200, optional: true })),
    h('div', { class: 'card stack' },
      h('label', { class: 'check', for: 'p-pdpa' }, pdpa, h('span', {},
        `Saya bersetuju nama, telefon dan emel saya disimpan oleh ${s.nama_studio} untuk menguruskan tempahan ini. Untuk akses atau pembetulan data, hubungi ${s.nama_studio}. `,
        h('a', { href: '/privasi', target: '_blank', rel: 'noopener' }, 'Notis privasi'))),
      pdpaErr,
      tsBox),
    msg,
    btn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    Object.values(errs).forEach((f) => f(''));
    clear(msg);
    let ok = true;
    const nama = P.nama.trim();
    if (!nama) { errs.nama('Sila isi nama.'); ok = false; }
    if (!isValidPhone(normalizePhone(P.telefon))) { errs.telefon('Nombor telefon tidak sah. Contoh: 012-345 6789'); ok = false; }
    if (P.emel.trim() && !isEmail(P.emel.trim())) { errs.emel('Format emel tidak sah.'); ok = false; }
    if (!P.pdpa) { errs.pdpa('Sila tanda persetujuan untuk meneruskan.'); ok = false; }
    if (!ok) {
      const f = $('[aria-invalid="true"]', form) || pdpa;
      f.focus();
      return;
    }
    if (!tsToken) {
      clear(msg, notice('warning', 'Sila tunggu pengesahan anti-spam selesai, kemudian tekan sekali lagi.'));
      return;
    }
    setBusy(btn, true, 'Menghantar...');
    const body = {
      nama, telefon: P.telefon, emel: P.emel.trim(), catatan: P.catatan.trim(), tarikh: S.tarikh, slot_ids: S.slotIds,
      addon_ids: S.addonIds, dewasa: S.dewasa, kanak: S.kanak, pdpa: true, turnstile: tsToken
    };
    let r;
    let j;
    try {
      r = await fetch(`/api/public/${encodeURIComponent(slug)}/book`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      j = await r.json();
    } catch {
      setBusy(btn, false);
      resetTurnstile();
      clear(msg, notice('urgent', navigator.onLine === false ? 'Perlukan sambungan internet. Tempahan BELUM dibuat.' : 'Gagal menghantar. Tempahan BELUM dibuat. Cuba lagi.'));
      return;
    }
    if (r.ok && j.ok) {
      hasil = { ...j, nama, dewasa: S.dewasa, kanak: S.kanak };
      store.set(KEY_REF, j.ref);
      S = { tarikh: '', slotIds: [], addonIds: [], dewasa: 1, kanak: 0 };
      save();
      slotCache.clear();
      P.catatan = '';
      P.pdpa = false;
      go('berjaya');
      return;
    }
    setBusy(btn, false);
    resetTurnstile();
    if (j.kod === 'slot-diambil') {
      S.slotIds = S.slotIds.filter((id) => !(j.slot_ids || []).includes(id));
      save();
      slotCache.delete(S.tarikh);
      toast(j.mesej || 'Slot baru diambil orang lain.', 5000);
      go('slot');
      return;
    }
    if (j.kod === 'tertutup') {
      C.tertutup = j.tertutup || 'tidak-tersedia';
      route();
      return;
    }
    if (j.errors) {
      for (const [k, m] of Object.entries(j.errors)) {
        if (errs[k]) errs[k](m);
        else if (k === 'tarikh' || k === 'slot_ids') {
          toast(m, 5000);
          go(k === 'tarikh' ? 'tarikh' : 'slot');
          return;
        }
      }
    }
    clear(msg, notice('urgent', (j.mesej || 'Gagal, cuba lagi.') + ' Tempahan BELUM dibuat.'));
  });

  clear(app, h('div', { class: 'page' }, backLink('slot'), h('h1', {}, 'Butiran tempahan'), form));
  updJumlah();
  loadTurnstile(tsBox);
}

// ---------------------------------------------------------------------------------------------
// S-16 Berjaya
// ---------------------------------------------------------------------------------------------
function viewBerjaya() {
  if (!hasil) return go('status');
  const t = hasil.tempahan;
  const b = hasil.bayaran || {};
  const pax = `${t.dewasa} dewasa${t.kanak ? `, ${t.kanak} kanak-kanak` : ''}`;
  const pesan = [
    C.studio.mesej_wa || 'Salam, saya nak sahkan tempahan.',
    `Ref: ${hasil.ref}`,
    `Nama: ${hasil.nama}`,
    `Tarikh: ${fmtTarikh(t.tarikh)}`,
    `Slot: ${t.slot_label}`,
    `Pax: ${pax}`,
    t.addon ? `Add-on: ${t.addon}` : '',
    `Jumlah: ${rm(t.jumlah)}`
  ].filter(Boolean).join('\n');
  const wa = waUrl(pesan);
  renderWa(pesan);
  clear(app, h('div', { class: 'page' },
    h('div', { class: 'success-mark' }, icon('check', 'ic ic-xl')),
    h('h1', { class: 'center' }, 'Tempahan diterima'),
    h('p', { class: 'center muted' }, 'Simpan Ref ID ini. Anda perlukannya untuk semak status.'),
    h('div', { class: 'ref-box' }, h('div', { class: 'caption' }, 'Ref ID'), h('div', { class: 'ref' }, hasil.ref),
      h('button', { class: 'btn ghost small', type: 'button', onclick: () => copyText(hasil.ref) }, icon('copy'), 'Salin')),
    wa ? h('div', { class: 'card stack' },
      h('h2', {}, 'Langkah seterusnya'),
      h('p', { class: 'mb0' }, 'Hantar maklumat tempahan kepada studio melalui WhatsApp untuk pengesahan.'),
      h('a', { class: 'btn wa', href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp-logo'), 'Hantar WhatsApp ke studio')) : null,
    h('div', { class: 'ringkas mt' },
      h('div', { class: 'baris' }, h('span', {}, 'Tarikh'), h('span', {}, fmtTarikh(t.tarikh))),
      h('div', { class: 'baris' }, h('span', {}, 'Slot'), h('span', {}, t.slot_label)),
      h('div', { class: 'baris' }, h('span', {}, 'Pax'), h('span', {}, pax)),
      t.addon ? h('div', { class: 'baris' }, h('span', {}, 'Add-on'), h('span', {}, t.addon)) : null,
      h('div', { class: 'baris' }, h('span', {}, 'Status'), h('span', {}, STATUS_LABEL[t.status] || t.status)),
      h('hr', {}),
      h('div', { class: 'baris' }, h('span', {}, 'Jumlah'), h('span', { class: 'jumlah' }, rm(t.jumlah)))),
    Number(b.deposit) > 0 || b.arahan_deposit || b.link_bayaran ? h('div', { class: 'card stack' },
      h('h2', {}, 'Bayaran deposit'),
      Number(b.deposit) > 0 ? h('p', { class: 'mb0' }, 'Deposit: ', h('b', { class: 'num' }, rm(b.deposit))) : null,
      b.arahan_deposit ? h('p', { class: 'pre mb0' }, b.arahan_deposit) : null,
      b.link_bayaran ? h('a', { class: 'btn secondary', href: b.link_bayaran, target: '_blank', rel: 'noopener' }, icon('money'), 'Bayar deposit') : null,
      h('p', { class: 'caption mb0' }, 'Tempahan disahkan oleh studio selepas deposit diterima.')) : null,
    h('a', { class: 'btn secondary mt', href: '#/status' }, 'Semak status tempahan'),
    footer()));
}

// ---------------------------------------------------------------------------------------------
// S-17 Semak status
// ---------------------------------------------------------------------------------------------
function viewStatus() {
  const refIn = h('input', { id: 'q-ref', type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'AB-XXXXXX', maxlength: 9 });
  refIn.value = store.get(KEY_REF, '') || '';
  const telIn = h('input', { id: 'q-tel', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '012-345 6789', maxlength: 20 });
  const out = h('div', { 'aria-live': 'polite' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'Semak');
  const form = h('form', { class: 'card stack', novalidate: true },
    h('div', { class: 'field' }, h('label', { for: 'q-ref' }, 'Ref ID'), refIn),
    h('div', { class: 'field mb0' }, h('label', { for: 'q-tel' }, 'Nombor telefon yang digunakan semasa tempah'), telIn),
    btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const ref = refIn.value.trim().toUpperCase();
    const telefon = telIn.value;
    if (!isValidRef(ref) || !isValidPhone(normalizePhone(telefon))) {
      clear(out, notice('warning', 'Masukkan Ref ID (contoh AB-K7M2QP) dan nombor telefon yang betul.'));
      return;
    }
    setBusy(btn, true, 'Menyemak...');
    let j = null;
    try {
      const r = await fetch(`/api/public/${encodeURIComponent(slug)}/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref, telefon }) });
      j = await r.json();
    } catch {
      j = { ok: false, mesej: 'Gagal, cuba lagi.' };
    }
    setBusy(btn, false);
    if (!j.ok) {
      clear(out, notice('warning', j.mesej || 'Tiada tempahan sepadan.'));
      return;
    }
    const t = j.tempahan;
    store.set(KEY_REF, t.ref);
    clear(out, h('div', { class: 'card stack' },
      h('div', { class: 'head-row' }, h('h2', {}, t.ref), h('span', { class: 'badge st-' + t.status }, STATUS_LABEL[t.status] || t.status)),
      h('dl', { class: 'kv' },
        h('dt', {}, 'Tarikh'), h('dd', {}, fmtTarikh(t.tarikh)),
        h('dt', {}, 'Slot'), h('dd', {}, t.slot_label),
        h('dt', {}, 'Pax'), h('dd', {}, `${t.dewasa} dewasa${t.kanak ? `, ${t.kanak} kanak-kanak` : ''}`),
        h('dt', {}, 'Jumlah'), h('dd', { class: 'num' }, rm(t.jumlah))),
      t.status === 'PENDING' ? h('p', { class: 'caption mb0' }, 'Tempahan akan disahkan oleh studio selepas deposit diterima.') : null));
  });
  clear(app, h('div', { class: 'page' }, h('h1', {}, 'Semak status tempahan'), form, out, footer()));
}

// ---------------------------------------------------------------------------------------------
// S-21 Tertutup
// ---------------------------------------------------------------------------------------------
function renderTertutup() {
  const s = C.studio || {};
  nav.hidden = true;
  const wa = waUrl('Salam, saya nak bertanya tentang tempahan.');
  clear(app,
    h('header', { class: 's-hero' }, heroLogo(), h('h1', {}, s.nama_studio || 'Studio')),
    h('div', { class: 'page' },
      h('div', { class: 'card stack' },
        h('h2', {}, C.tertutup === 'ditutup' ? 'Tempahan ditutup buat masa ini' : 'Tempahan tidak tersedia buat masa ini'),
        h('p', { class: 'muted mb0' }, 'Sila cuba lagi kemudian atau hubungi studio.'),
        wa ? h('a', { class: 'btn wa', href: wa, target: '_blank', rel: 'noopener' }, icon('whatsapp-logo'), 'WhatsApp studio') : null,
        s.maps_url ? h('a', { class: 'btn secondary', href: s.maps_url, target: '_blank', rel: 'noopener' }, icon('map-pin'), 'Lokasi studio') : null),
      footer()));
}

boot();
