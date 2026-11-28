// Pembantu DOM. Semua teks dimasukkan dengan textContent: tiada innerHTML dengan data pengguna (TRD 6, XSS).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// h('div', { class: 'x', onclick: fn, dataset: {a:1} }, 'teks', anakElemen, [lagi])
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden' || k === 'required') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
export function icon(name, cls = 'ic') {
  const s = document.createElementNS(SVG, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS(SVG, 'use');
  u.setAttribute('href', '/icons/sprite.svg#i-' + name);
  s.append(u);
  return s;
}

// Butang sibuk: spinner dan dinyahaktifkan sehingga selesai (DBD B6, elak klik berganda)
export function setBusy(btn, on, label) {
  if (on) {
    if (btn.dataset.asal === undefined) btn.dataset.asal = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    clear(btn, h('span', { class: 'spin', 'aria-hidden': 'true' }), label || btn.dataset.asal);
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (btn.dataset.asal !== undefined) {
      clear(btn, btn.dataset.asal);
      delete btn.dataset.asal;
    }
  }
}

let toastTimer;
export function toast(msg, ms = 3000) {
  let wrap = $('.toast-wrap');
  if (!wrap) {
    wrap = h('div', { class: 'toast-wrap', role: 'status', 'aria-live': 'polite' });
    document.body.append(wrap);
  }
  clear(wrap, h('div', { class: 'toast' }, msg));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => wrap.replaceChildren(), ms);
}

// Modal: tutup dengan X, Esc dan klik luar; fokus dikunci dalam modal (DBD B6)
export function openModal(title, ...content) {
  const prev = document.activeElement;
  const titleId = 'm' + Math.random().toString(36).slice(2, 8);
  const closeBtn = h('button', { class: 'x', type: 'button', 'aria-label': 'Tutup' }, icon('x'));
  const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, closeBtn, h('h2', { id: titleId }, title), ...content);
  const bg = h('div', { class: 'modal-bg' }, box);
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const f = $$('button, [href], input, select, textarea', box).filter((x) => !x.disabled);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  function close() {
    document.removeEventListener('keydown', onKey);
    bg.remove();
    if (prev && prev.focus) prev.focus();
  }
  closeBtn.addEventListener('click', close);
  bg.addEventListener('click', (e) => e.target === bg && close());
  document.addEventListener('keydown', onKey);
  document.body.append(bg);
  ($('input, textarea, select', box) || closeBtn).focus();
  return close;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Disalin');
    return true;
  } catch {
    toast('Gagal salin. Tekan lama pada pautan untuk salin.');
    return false;
  }
}

export function waShareUrl(text) {
  return 'https://wa.me/?text=' + encodeURIComponent(text);
}
