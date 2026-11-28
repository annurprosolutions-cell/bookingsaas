// S-02 (Daftar / Login Google) dan S-03 (Wizard setup 5 langkah). AFD A3, DBD bahagian B.
import { h, clear, icon, setBusy, toast, copyText, waShareUrl, $ } from './lib/dom.js';
import { api } from './lib/api.js';
import * as store from './lib/store.js';
import { requestCode } from './lib/google-login.js';
import { applyBrand, PRESETS } from './lib/theme.js';
import {
  validateSlug, suggestSlug, normalizePhone, isHttpsUrl, normalizeImageUrl, contrastOk, contrastWithWhite,
  suggestAccessibleColour, validateTetapan, validateAddons, validateBanners, MAX_BANNERS, MAX_ADDONS
} from './core/validate.js';
import { formatRM } from './core/pricing.js';
import { sheetTitle } from './core/sheet-schema.js';

const CFG = window.ANNUR_CONFIG || {};
const root = $('#app');
const DRAF = 'annur_wizard_v1';
const DEFAULTS = {
  nama_studio: '', slug: '', slugManual: false, whatsapp: '', alamat: '', maps_url: '',
  waktu_pagi: '09:00 - 12:00', waktu_petang: '14:00 - 18:00', waktu_malam: '21:00 - 23:00',
  warna_utama: '#2563EB', logo_url: '', banners: [''], harga_normal: '', harga_special: '', deposit: '50',
  addons: [], templat: 'raya'
};
const STEPS = ['Nama dan pautan', 'WhatsApp dan lokasi', 'Warna dan gambar', 'Harga dan slot', 'Semak dan terbit'];
const FIELD_STEP = {
  nama_studio: 1, slug: 1, whatsapp: 2, alamat: 2, maps_url: 2, waktu_pagi: 2, waktu_petang: 2, waktu_malam: 2,
  warna_utama: 3, logo_url: 3, banners: 3, harga_normal: 4, harga_special: 4, deposit: 4, addons: 4, templat: 4
};

let data = { ...DEFAULTS, ...(store.get(DRAF, {}) || {}) };
if (!Array.isArray(data.banners) || !data.banners.length) data.banners = [''];
if (!Array.isArray(data.addons)) data.addons = [];
let step = 1;
let me = null;
let errors = {};
let slugState = { slug: '', tersedia: null, mesej: '' };
let slugTimer = null;
let slugPromise = null;

const save = () => store.set(DRAF, data);
const host = location.host;

// ---------------------------------------------------------------------------------------------
// Bahagian kongsi
// ---------------------------------------------------------------------------------------------
function googleG() {
  const NS = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 48 48');
  s.setAttribute('aria-hidden', 'true');
  for (const [fill, d] of [
    ['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
    ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
    ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
    ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z']
  ]) {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('fill', fill);
    p.setAttribute('d', d);
    s.append(p);
  }
  return s;
}

function brandbar(right) {
  return h('header', { class: 'brandbar' }, h('div', { class: 'mark', 'aria-hidden': 'true' }, 'A'), h('b', {}, 'Annur Booking'), h('span', { class: 'grow' }), right || null);
}

function footer() {
  return h('p', { class: 'footer' }, h('a', { href: '/privasi' }, 'Privasi'), ' · ', h('a', { href: '/terma' }, 'Terma'), ' · AnnurPro Solutions');
}

function notice(level, text, ...extra) {
  const ic = level === 'ok' ? 'check-circle' : level === 'info' ? 'info' : 'warning-circle';
  return h('div', { class: 'notice ' + level, role: level === 'urgent' || level === 'critical' ? 'alert' : 'status' }, icon(ic), h('div', {}, h('p', {}, text), ...extra));
}

function logoutLink() {
  return h('button', {
    class: 'btn ghost small', type: 'button',
    onclick: () => {
      store.clearSession();
      renderLogin();
    }
  }, 'Log keluar');
}

// ---------------------------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------------------------
async function boot() {
  if (!store.getSession()) return renderLogin();
  const r = await api('/api/me');
  if (r.status === 401) {
    store.clearSession();
    return renderLogin();
  }
  if (!r.ok) {
    clear(root, brandbar(), notice('urgent', r.data.mesej || 'Gagal memuatkan. Cuba lagi.'), h('button', { class: 'btn', type: 'button', onclick: boot }, 'Cuba lagi'));
    return;
  }
  me = r.data;
  if (!me.studio.perluSetup) {
    location.replace('/app/');
    return;
  }
  renderWizard();
}

// ---------------------------------------------------------------------------------------------
// S-02 Login Google
// ---------------------------------------------------------------------------------------------
function renderLogin(msg) {
  applyBrand('#2563EB');
  const errBox = h('div', {});
  const showErr = (m) => clear(errBox, m ? notice('urgent', m) : null);
  showErr(msg);
  const btn = h('button', { class: 'btn btn-google', type: 'button' }, googleG(), 'Teruskan dengan Google');
  btn.addEventListener('click', () => {
    showErr('');
    // requestCode dipanggil terus dalam klik supaya popup tidak disekat
    const p = requestCode({ clientId: CFG.googleClientId, scope: CFG.scopes });
    setBusy(btn, true, 'Menunggu Google...');
    p.then(async (code) => {
      setBusy(btn, true, 'Menyemak akaun...');
      const r = await api('/api/auth/google', { method: 'POST', body: { code } });
      if (!r.ok) {
        setBusy(btn, false);
        showErr(r.data.mesej || 'Gagal log masuk. Cuba lagi.');
        return;
      }
      store.setSession(r.data.sesi);
      if (r.data.perluSetup) await boot();
      else location.replace('/app/');
    }).catch((e) => {
      setBusy(btn, false);
      showErr((e && e.mesej) || 'Gagal. Cuba lagi.');
    });
  });

  const point = (ic, title, text) => h('div', { class: 'row' }, icon(ic, 'ic ic-lg'), h('div', {}, h('b', {}, title), h('div', { class: 'muted small' }, text)));
  clear(
    root,
    brandbar(),
    h('h1', { tabindex: '-1' }, 'Daftar atau log masuk'),
    h('p', { class: 'muted' }, 'Percubaan percuma 14 hari. Tiada kad kredit diperlukan.'),
    h('div', { class: 'card stack' },
      btn,
      errBox,
      h('p', { class: 'caption mb0' }, 'Guna akaun Gmail biasa. Akaun organisasi (contohnya DELIMa) mungkin disekat oleh pentadbirnya.')
    ),
    h('div', { class: 'card' },
      h('h2', {}, 'Apa yang Google akan tanya'),
      h('div', { class: 'list-rows' },
        point('envelope', 'Emel anda', 'Untuk log masuk dan akaun langganan.'),
        point('table', 'Akses Google Drive yang terhad', 'Sistem hanya boleh membuka fail yang ia cipta sendiri (Sheet tempahan anda). Fail lain dalam Drive anda tidak boleh dilihat.'),
        point('lock', 'Data pelanggan milik anda', 'Semua tempahan disimpan dalam Google Sheet dalam Drive anda, bukan di server kami.')
      ),
      h('p', { class: 'caption mt mb0' }, 'Pastikan kotak Google Drive ditanda bila Google bertanya.')
    ),
    h('p', { class: 'caption center' }, 'Dengan meneruskan, anda bersetuju dengan ', h('a', { href: '/terma' }, 'Terma'), ' dan ', h('a', { href: '/privasi' }, 'Notis Privasi'), '.'),
    h('p', { class: 'center' }, h('a', { href: '/?demo' }, 'Cuba demo dahulu tanpa daftar')),
    footer()
  );
}

// ---------------------------------------------------------------------------------------------
// Medan borang
// ---------------------------------------------------------------------------------------------
function field({ key, label, type = 'text', hint, placeholder, max, multiline, inputmode, prefix, money, onInput, autocomplete, optional }) {
  const id = 'f-' + key;
  const attrs = {
    id, name: key, type: multiline ? undefined : type, placeholder, maxlength: max, inputmode, autocomplete: autocomplete || 'off',
    'aria-describedby': [hint ? id + '-hint' : '', id + '-err'].filter(Boolean).join(' '),
    'aria-invalid': errors[key] ? 'true' : null, spellcheck: type === 'url' ? 'false' : null
  };
  const input = multiline ? h('textarea', attrs) : h('input', attrs);
  input.value = data[key] ?? '';
  const err = h('div', { class: 'err', id: id + '-err', hidden: !errors[key] }, errors[key] || '');
  input.addEventListener('input', () => {
    data[key] = input.value;
    save();
    if (errors[key]) {
      delete errors[key];
      err.hidden = true;
      input.removeAttribute('aria-invalid');
    }
    if (onInput) onInput(input.value, input);
  });
  const control = money ? h('div', { class: 'money' }, input) : prefix ? h('div', { class: 'prefix' }, h('span', {}, prefix), input) : input;
  return h('div', { class: 'field' },
    h('label', { for: id }, label, optional ? h('span', { class: 'muted' }, ' (pilihan)') : null),
    control,
    hint ? h('div', { class: 'hint', id: id + '-hint' }, hint) : null,
    err
  );
}

// ---------------------------------------------------------------------------------------------
// Langkah 1: nama dan slug (semak live)
// ---------------------------------------------------------------------------------------------
function slugStatusView() {
  const s = slugState;
  if (!data.slug) return h('div', { class: 'hint' }, 'Pelanggan akan membuka pautan ini untuk menempah.');
  if (s.slug !== data.slug || s.tersedia === null) return h('div', { class: 'hint' }, 'Menyemak...');
  if (s.tersedia) return h('div', { class: 'okmsg' }, icon('check-circle'), ' Tersedia: ', host + '/' + data.slug);
  return h('div', { class: 'err' }, s.mesej || 'Tidak tersedia.');
}

function checkSlug(updateView) {
  clearTimeout(slugTimer);
  const slug = data.slug;
  const v = validateSlug(slug);
  if (!v.ok) {
    slugState = { slug, tersedia: false, mesej: slug ? v.mesej : '' };
    slugPromise = null;
    updateView();
    return;
  }
  slugState = { slug, tersedia: null, mesej: '' };
  updateView();
  slugPromise = new Promise((resolve) => {
    slugTimer = setTimeout(async () => {
      const r = await api('/api/slug/check?slug=' + encodeURIComponent(slug));
      if (data.slug === slug) {
        slugState = r.ok ? { slug, tersedia: !!r.data.tersedia, mesej: r.data.mesej || '' } : { slug, tersedia: null, mesej: r.data.mesej || 'Gagal menyemak.' };
        updateView();
      }
      resolve();
    }, 400);
  });
}

function step1() {
  const status = h('div', { 'aria-live': 'polite' });
  const refresh = () => clear(status, slugStatusView());
  const slugField = field({
    key: 'slug', label: 'Pautan tempahan anda', prefix: host + '/', max: 30, autocomplete: 'off',
    hint: 'Huruf kecil, nombor dan sengkang (-) sahaja. Contoh: wakanda-studio',
    onInput: (v, el) => {
      const bersih = v.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (bersih !== v) el.value = bersih;
      data.slug = bersih;
      data.slugManual = true;
      save();
      checkSlug(refresh);
    }
  });
  const nama = field({
    key: 'nama_studio', label: 'Nama studio', max: 60, placeholder: 'Contoh: Wakanda Studio', autocomplete: 'organization',
    onInput: (v) => {
      if (!data.slugManual) {
        data.slug = suggestSlug(v);
        $('#f-slug').value = data.slug;
        save();
        checkSlug(refresh);
      }
    }
  });
  slugField.append(status);
  if (data.slug) checkSlug(refresh);
  else refresh();
  return [h('h2', { tabindex: '-1' }, 'Nama studio dan pautan'), h('p', { class: 'muted' }, 'Nama ini dipaparkan pada halaman tempahan anda.'), nama, slugField];
}

// ---------------------------------------------------------------------------------------------
// Langkah 2: WhatsApp dan lokasi
// ---------------------------------------------------------------------------------------------
function step2() {
  const waHint = h('span', {});
  const updWa = () => {
    const d = normalizePhone(data.whatsapp);
    clear(waHint, d ? `Disimpan sebagai ${d}. Pelanggan akan menghantar WhatsApp ke nombor ini.` : 'Contoh: 012-345 6789');
  };
  const wa = field({ key: 'whatsapp', label: 'Nombor WhatsApp studio', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: '012-345 6789', hint: ' ', onInput: updWa });
  $('.hint', wa).replaceChildren(waHint);
  updWa();
  return [
    h('h2', { tabindex: '-1' }, 'WhatsApp dan lokasi'),
    wa,
    field({ key: 'alamat', label: 'Alamat studio', multiline: true, max: 300, optional: true }),
    field({ key: 'maps_url', label: 'Pautan Google Maps', type: 'url', inputmode: 'url', optional: true, placeholder: 'https://maps.app.goo.gl/...', hint: 'Buka Google Maps, cari studio anda, tekan Kongsi dan salin pautan.' }),
    h('h3', { class: 'mt2' }, 'Waktu operasi'),
    h('p', { class: 'muted small' }, 'Dipaparkan kepada pelanggan sahaja. Slot sebenar ditetapkan dalam langkah 4.'),
    field({ key: 'waktu_pagi', label: 'Pagi', max: 40 }),
    field({ key: 'waktu_petang', label: 'Petang', max: 40 }),
    field({ key: 'waktu_malam', label: 'Malam', max: 40 })
  ];
}

// ---------------------------------------------------------------------------------------------
// Langkah 3: warna, logo, banner + pratonton langsung
// ---------------------------------------------------------------------------------------------
function previewCard() {
  const logo = isHttpsUrl(normalizeImageUrl(data.logo_url)) ? normalizeImageUrl(data.logo_url) : '';
  const banner = (data.banners || []).map(normalizeImageUrl).find(isHttpsUrl) || '';
  const hero = h('div', { class: 'hero' + (banner ? ' has-img' : '') });
  if (banner) hero.style.setProperty('background-image', `url(${JSON.stringify(banner)})`);
  const initial = (data.nama_studio || 'S').trim().charAt(0).toUpperCase() || 'S';
  const ph = h('div', { class: 'logo-ph', 'aria-hidden': 'true' }, initial);
  let logoEl = ph;
  if (logo) {
    logoEl = h('img', { class: 'logo', src: logo, alt: '', referrerpolicy: 'no-referrer' });
    logoEl.addEventListener('error', () => logoEl.replaceWith(ph));
  }
  hero.append(logoEl, h('h3', {}, data.nama_studio || 'Nama Studio'), h('p', { class: 'sub' }, 'Tempahan sesi fotografi Raya'));
  return h('div', { class: 'preview', 'aria-label': 'Pratonton halaman tempahan' },
    hero,
    h('div', { class: 'cards' }, h('div', {}, 'Tempah Sekarang'), h('div', {}, 'Semak Status')),
    h('div', { class: 'ticker' }, 'Promosi Raya: tempah awal untuk slot pagi')
  );
}

function contrastView() {
  const hex = data.warna_utama;
  if (contrastOk(hex)) return null;
  const c = suggestAccessibleColour(hex);
  return notice('warning', `Teks putih pada warna ini sukar dibaca (kontras ${contrastWithWhite(hex).toFixed(1)}:1, disyorkan sekurang-kurangnya 4.5:1).`,
    h('button', {
      class: 'btn secondary small', type: 'button',
      onclick: () => {
        data.warna_utama = c;
        save();
        renderWizard();
      }
    }, 'Guna warna dicadangkan ', h('span', { class: 'num' }, c)));
}

function step3() {
  const previewSlot = h('div', {});
  const contrastSlot = h('div', {});
  const upd = () => {
    applyBrand(data.warna_utama);
    clear(previewSlot, previewCard());
    clear(contrastSlot, contrastView());
    for (const b of document.querySelectorAll('.swatch')) b.setAttribute('aria-pressed', String(b.dataset.hex === data.warna_utama));
  };
  const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Warna preset' },
    PRESETS.map((p) => {
      const b = h('button', { class: 'swatch', type: 'button', title: p.nama, 'aria-label': p.nama, 'aria-pressed': String(p.hex === data.warna_utama), dataset: { hex: p.hex } });
      b.style.setProperty('background', p.hex);
      b.addEventListener('click', () => {
        data.warna_utama = p.hex;
        picker.value = p.hex;
        save();
        upd();
      });
      return b;
    })
  );
  const picker = h('input', { type: 'color', id: 'f-warna', value: data.warna_utama, 'aria-label': 'Warna sendiri', title: 'Warna sendiri' });
  picker.addEventListener('input', () => {
    data.warna_utama = picker.value.toUpperCase();
    save();
    upd();
  });
  swatches.append(picker);

  const bannerList = h('div', {});
  const renderBanners = () => {
    clear(bannerList, data.banners.map((u, i) => {
      const inp = h('input', { type: 'url', inputmode: 'url', id: 'f-banner-' + i, value: u, placeholder: 'https://...', 'aria-label': 'Pautan banner ' + (i + 1), spellcheck: 'false' });
      inp.addEventListener('input', () => {
        data.banners[i] = inp.value;
        save();
        upd();
      });
      const rm = h('button', {
        class: 'btn ghost small', type: 'button', 'aria-label': 'Buang banner ' + (i + 1),
        onclick: () => {
          data.banners.splice(i, 1);
          if (!data.banners.length) data.banners.push('');
          save();
          renderBanners();
          upd();
        }
      }, icon('trash'));
      return h('div', { class: 'btn-row mt' }, inp, data.banners.length > 1 || u ? rm : null);
    }),
    data.banners.length < MAX_BANNERS ? h('button', {
      class: 'btn ghost small mt', type: 'button',
      onclick: () => {
        data.banners.push('');
        save();
        renderBanners();
        $('#f-banner-' + (data.banners.length - 1)).focus();
      }
    }, icon('plus'), 'Tambah banner') : null);
  };
  renderBanners();
  upd();

  return [
    h('h2', { tabindex: '-1' }, 'Warna dan gambar'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Warna utama'), swatches, h('div', { class: 'hint' }, 'Pilih preset atau warna sendiri (bulatan terakhir).'), contrastSlot),
    field({
      key: 'logo_url', label: 'Pautan logo', type: 'url', inputmode: 'url', optional: true, placeholder: 'https://...',
      hint: 'Tampal pautan imej https. Untuk Google Drive, kongsi sebagai "Sesiapa yang mempunyai pautan". Boleh juga guna postimages.org.',
      onInput: upd
    }),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Banner', h('span', { class: 'muted' }, ' (pilihan, maksimum ' + MAX_BANNERS + ')')), bannerList, errors.banners ? h('div', { class: 'err' }, errors.banners) : null),
    h('span', { class: 'label' }, 'Pratonton halaman tempahan'),
    previewSlot
  ];
}

// ---------------------------------------------------------------------------------------------
// Langkah 4: harga, add-on, templat slot
// ---------------------------------------------------------------------------------------------
function step4() {
  const list = h('div', {});
  const renderAddons = () => {
    clear(list, data.addons.map((a, i) => {
      const nama = h('input', { type: 'text', value: a.nama || '', placeholder: 'Nama, cth: Frame', maxlength: 60, 'aria-label': 'Nama add-on ' + (i + 1) });
      const harga = h('input', { type: 'text', inputmode: 'decimal', value: a.harga ?? '', placeholder: '0', 'aria-label': 'Harga add-on ' + (i + 1) });
      nama.addEventListener('input', () => {
        data.addons[i].nama = nama.value;
        save();
      });
      harga.addEventListener('input', () => {
        data.addons[i].harga = harga.value;
        save();
      });
      return h('div', { class: 'btn-row mt' }, nama, h('div', { class: 'money' }, harga), h('button', {
        class: 'btn ghost small', type: 'button', 'aria-label': 'Buang add-on ' + (i + 1),
        onclick: () => {
          data.addons.splice(i, 1);
          save();
          renderAddons();
        }
      }, icon('trash')));
    }),
    data.addons.length < MAX_ADDONS ? h('button', {
      class: 'btn ghost small mt', type: 'button',
      onclick: () => {
        data.addons.push({ nama: '', harga: '' });
        save();
        renderAddons();
        list.querySelectorAll('input[type=text]')[data.addons.length * 2 - 2].focus();
      }
    }, icon('plus'), 'Tambah add-on') : null);
  };
  renderAddons();

  const radio = (val, title, desc) => h('label', {},
    h('input', {
      type: 'radio', name: 'templat', value: val, checked: data.templat === val,
      onchange: () => {
        data.templat = val;
        save();
      }
    }),
    h('div', {}, h('b', {}, title), h('div', { class: 'muted small' }, desc)));

  return [
    h('h2', { tabindex: '-1' }, 'Harga dan slot'),
    field({ key: 'harga_normal', label: 'Harga satu slot (hari biasa)', inputmode: 'decimal', money: true, placeholder: '80' }),
    field({ key: 'harga_special', label: 'Harga satu slot (hari special)', inputmode: 'decimal', money: true, optional: true, placeholder: 'Sama dengan harga biasa', hint: 'Kosongkan jika sama. Tarikh hari special (cth hari raya) ditetapkan kemudian dalam Tetapan.' }),
    field({ key: 'deposit', label: 'Deposit', inputmode: 'decimal', money: true, hint: 'Dipaparkan kepada pelanggan sahaja. Sistem tidak mengutip deposit.' }),
    h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Add-on', h('span', { class: 'muted' }, ' (pilihan)')),
      h('div', { class: 'hint' }, 'Item tambahan yang pelanggan boleh pilih, contohnya Frame RM30. Boleh diubah kemudian.'),
      list,
      errors.addons ? h('div', { class: 'err' }, errors.addons) : null),
    h('div', { class: 'field' },
      h('span', { class: 'label' }, 'Templat slot'),
      h('div', { class: 'choice' },
        radio('raya', 'Templat Raya (26 slot)', 'Pagi 9 slot (9:00 hingga 11:40 pagi), Petang 11 slot (2:20 hingga 5:40 petang), Malam 6 slot (9:00 hingga 10:40 malam). Selang 20 minit, satu tempahan setiap slot.'),
        radio('kosong', 'Kosong', 'Tiada slot. Anda tambah slot sendiri kemudian dalam Tetapan.')))
  ];
}

// ---------------------------------------------------------------------------------------------
// Langkah 5: semak dan terbit
// ---------------------------------------------------------------------------------------------
function step5() {
  const edit = (n) => h('button', {
    class: 'btn ghost small', type: 'button',
    onclick: () => {
      step = n;
      renderWizard();
    }
  }, icon('pencil-simple'), 'Ubah');
  const section = (title, n, rows) => h('div', { class: 'card flat' },
    h('div', { class: 'head-row' }, h('h3', {}, title), edit(n)),
    h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v || '-')])));
  const addons = data.addons.filter((a) => (a.nama || '').trim());
  const banners = data.banners.filter((b) => (b || '').trim());
  const sw = h('span', { class: 'dot', 'aria-hidden': 'true' });
  sw.style.setProperty('background', data.warna_utama);
  return [
    h('h2', { tabindex: '-1' }, 'Semak dan terbit'),
    section('Studio', 1, [['Nama', data.nama_studio], ['Pautan', host + '/' + data.slug]]),
    section('Hubungan', 2, [['WhatsApp', normalizePhone(data.whatsapp)], ['Alamat', data.alamat], ['Maps', data.maps_url ? 'Ada' : '']]),
    section('Rupa', 3, [['Warna', h('span', {}, sw, ' ', data.warna_utama)], ['Logo', data.logo_url ? 'Ada' : 'Tiada'], ['Banner', String(banners.length)]]),
    section('Harga dan slot', 4, [
      ['Hari biasa', data.harga_normal === '' ? '' : formatRM(data.harga_normal)],
      ['Hari special', data.harga_special === '' ? 'Sama dengan hari biasa' : formatRM(data.harga_special)],
      ['Deposit', data.deposit === '' ? '' : formatRM(data.deposit)],
      ['Add-on', addons.length ? addons.map((a) => `${a.nama} (+${formatRM(a.harga || 0)})`).join(', ') : 'Tiada'],
      ['Slot', data.templat === 'raya' ? 'Templat Raya (26 slot)' : 'Kosong']
    ]),
    notice('info', `Bila anda tekan Terbitkan, sistem akan mencipta Google Sheet "${sheetTitle(data.nama_studio || 'Studio')}" dalam Google Drive anda. Sheet itu ialah pangkalan data tempahan anda: jangan padam atau tukar nama tab.`)
  ];
}

// ---------------------------------------------------------------------------------------------
// Pengesahan setiap langkah (klien). Server menyemak semula semuanya.
// ---------------------------------------------------------------------------------------------
async function validateStep(n) {
  const e = {};
  const pick = (keys) => Object.fromEntries(keys.map((k) => [k, k === 'logo_url' ? normalizeImageUrl(data[k]) : data[k]]));
  if (n === 1) {
    const t = validateTetapan(pick(['nama_studio']), { partial: true });
    Object.assign(e, t.errors || {});
    if (!String(data.nama_studio || '').trim()) e.nama_studio = 'Wajib diisi.';
    const v = validateSlug(data.slug);
    if (!v.ok) e.slug = v.mesej;
    else {
      if (slugState.slug !== data.slug || slugState.tersedia === null) {
        if (!slugPromise) checkSlug(() => {});
        await slugPromise;
      }
      if (slugState.slug === data.slug && slugState.tersedia === false) e.slug = slugState.mesej || 'Tidak tersedia.';
      if (slugState.tersedia === null) e.slug = slugState.mesej || 'Gagal menyemak pautan. Cuba lagi.';
    }
  }
  if (n === 2) {
    const t = validateTetapan(pick(['whatsapp', 'alamat', 'maps_url', 'waktu_pagi', 'waktu_petang', 'waktu_malam']), { partial: true });
    Object.assign(e, t.errors || {});
    if (!String(data.whatsapp || '').trim()) e.whatsapp = 'Wajib diisi.';
  }
  if (n === 3) {
    const t = validateTetapan(pick(['warna_utama', 'logo_url']), { partial: true });
    Object.assign(e, t.errors || {});
    const b = validateBanners(data.banners);
    if (!b.ok) e.banners = b.mesej;
  }
  if (n === 4) {
    const t = validateTetapan(pick(['harga_normal', 'harga_special', 'deposit']), { partial: true });
    Object.assign(e, t.errors || {});
    if (String(data.harga_normal ?? '').trim() === '') e.harga_normal = 'Wajib diisi.';
    const a = validateAddons(data.addons);
    if (!a.ok) e.addons = a.errors.join(' ');
  }
  return e;
}

function payload() {
  const keys = ['nama_studio', 'slug', 'whatsapp', 'alamat', 'maps_url', 'waktu_pagi', 'waktu_petang', 'waktu_malam', 'warna_utama', 'harga_normal', 'harga_special', 'deposit', 'templat'];
  const p = Object.fromEntries(keys.map((k) => [k, typeof data[k] === 'string' ? data[k].trim() : data[k]]));
  p.logo_url = normalizeImageUrl(data.logo_url);
  p.banners = data.banners.map((b) => (b || '').trim()).filter(Boolean);
  p.addons = data.addons.filter((a) => (a.nama || '').trim() || String(a.harga ?? '').trim());
  return p;
}

// ---------------------------------------------------------------------------------------------
// Rangka wizard
// ---------------------------------------------------------------------------------------------
function renderWizard() {
  applyBrand(data.warna_utama);
  const views = { 1: step1, 2: step2, 3: step3, 4: step4, 5: step5 };
  const msgBox = h('div', { id: 'wizard-msg' });
  const back = step > 1 ? h('button', {
    class: 'btn secondary', type: 'button',
    onclick: () => {
      step--;
      renderWizard();
    }
  }, icon('arrow-left'), 'Kembali') : null;
  const next = h('button', { class: 'btn', type: 'submit' }, step < 5 ? 'Seterusnya' : 'Terbitkan', step < 5 ? icon('arrow-right') : icon('check'));
  const form = h('form', { novalidate: true, autocomplete: 'off' },
    ...views[step](),
    msgBox,
    h('div', { class: 'sticky-actions' }, h('div', { class: 'btn-row' }, back, next)));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (step < 5) {
      setBusy(next, true, 'Menyemak...');
      const e = await validateStep(step);
      setBusy(next, false);
      if (Object.keys(e).length) {
        errors = { ...errors, ...e };
        renderWizard();
        const first = $('[aria-invalid="true"]') || $('.err:not([hidden])');
        if (first && first.focus) first.focus();
        return;
      }
      step++;
      renderWizard();
      return;
    }
    await publish(next, msgBox);
  });

  clear(root,
    brandbar(logoutLink()),
    h('div', { class: 'step-label' }, `Langkah ${step} daripada 5: ${STEPS[step - 1]}`),
    h('div', { class: 'steps', 'aria-hidden': 'true' }, STEPS.map((_, i) => h('i', { class: i < step ? 'on' : '' }))),
    form);
  const hd = $('h2', form);
  if (hd) hd.focus({ preventScroll: false });
  window.scrollTo(0, 0);
}

async function publish(btn, msgBox) {
  // Semak semua langkah sekali lagi sebelum hantar
  for (let n = 1; n <= 4; n++) {
    const e = await validateStep(n);
    if (Object.keys(e).length) {
      errors = { ...errors, ...e };
      step = n;
      renderWizard();
      toast('Sila semak maklumat yang ditanda.');
      return;
    }
  }
  setBusy(btn, true, 'Mencipta Sheet dalam Drive anda...');
  clear(msgBox);
  const r = await api('/api/tenant/setup', { method: 'POST', body: payload() });
  if (r.ok) {
    store.forget(DRAF);
    renderSuccess(r.data);
    return;
  }
  setBusy(btn, false);
  const d = r.data || {};
  if (d.errors && Object.keys(d.errors).length) {
    errors = { ...d.errors };
    step = Math.min(...Object.keys(d.errors).map((k) => FIELD_STEP[k] || 1));
    if (d.kod === 'slug-diambil') slugState = { slug: data.slug, tersedia: false, mesej: 'Nama ini baru sahaja diambil. Pilih nama lain.' };
    renderWizard();
    toast(d.mesej || 'Sila semak maklumat yang ditanda.');
    return;
  }
  if (r.status === 401 && d.kod === 'sesi-tidak-sah') {
    store.clearSession();
    renderLogin('Sesi anda tamat. Sila log masuk semula. Maklumat yang anda isi masih disimpan.');
    return;
  }
  clear(msgBox, notice('urgent', d.mesej || 'Gagal. Cuba lagi.', d.kod === 'google-putus' ? h('p', { class: 'small' }, 'Tekan Log keluar, kemudian log masuk semula dengan akaun Google yang sama.') : null));
}

// ---------------------------------------------------------------------------------------------
// Skrin berjaya (AFD A3 langkah 9)
// ---------------------------------------------------------------------------------------------
function renderSuccess(r) {
  const nama = data.nama_studio || '';
  const shareText = `Tempah sesi fotografi di ${nama}: ${r.url}`;
  clear(root,
    brandbar(),
    h('div', { class: 'success-mark' }, icon('check', 'ic ic-xl')),
    h('h1', { class: 'center', tabindex: '-1' }, 'Studio anda sudah didaftarkan'),
    h('p', { class: 'center muted' }, 'Google Sheet untuk tempahan telah dicipta dalam Google Drive anda.'),
    h('div', { class: 'card stack' },
      h('span', { class: 'label' }, 'Pautan tempahan anda'),
      h('div', { class: 'linkbox' }, icon('link'), r.url),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn secondary', type: 'button', onclick: () => copyText(r.url) }, icon('copy'), 'Salin'),
        h('a', { class: 'btn wa', href: waShareUrl(shareText), target: '_blank', rel: 'noopener' }, icon('whatsapp-logo'), 'Kongsi'))),
    h('a', { class: 'btn secondary', href: r.sheetUrl, target: '_blank', rel: 'noopener' }, icon('table'), 'Buka Google Sheet saya'),
    h('div', { class: 'mt' }, h('a', { class: 'btn', href: '/app/' }, 'Teruskan ke dashboard', icon('arrow-right'))),
    r.warnings && r.warnings.warna_utama ? notice('warning', 'Warna tema anda agak cerah untuk teks putih. Anda boleh menukarnya kemudian dalam Tetapan.') : null,
    footer());
  $('h1', root).focus();
}

boot();
