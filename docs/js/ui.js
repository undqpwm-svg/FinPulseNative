// Навигация и общие элементы интерфейса: шторка, тост, экран успеха
import { I } from './icons.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const root = () => document.getElementById('app');

export const nav = {
  pendingDir: null,
  route: () => {},
  rerender: () => {},
};

// Номер записи в истории внутри приложения: «Назад» никогда не уводит со страницы
export const histIdx = () => (history.state && history.state.idx) || 0;

export function navigate(hash, dir) {
  if (location.hash === hash) {
    nav.rerender();
    return;
  }
  nav.pendingDir = dir || null;
  history.pushState({ idx: histIdx() + 1 }, '', hash);
  nav.route();
}

export function replace(hash, dir) {
  nav.pendingDir = dir || null;
  history.replaceState({ idx: histIdx() }, '', hash);
  nav.route();
}

export function back(fallback = '#/home') {
  nav.pendingDir = 'pop';
  if (histIdx() > 0) history.back();
  else replace(fallback, 'pop');
}

// ---------- шторка ----------
let sheetEl = null;

export function openSheet(html, { tall = false, onMount } = {}) {
  closeSheet(true);
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-act="sheet-close"></div>
    <div class="sheet ${tall ? 'sheet-tall' : ''}" role="dialog" aria-modal="true">
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="sheet-body">${html}</div>
    </div>`;
  root().appendChild(wrap);
  sheetEl = wrap;
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  onMount?.(wrap);
  return wrap;
}

export function closeSheet(instant = false) {
  const el = sheetEl;
  if (!el) return Promise.resolve();
  sheetEl = null;
  if (instant || reduced()) {
    el.remove();
    return Promise.resolve();
  }
  el.classList.remove('open');
  return new Promise((res) => setTimeout(() => {
    el.remove();
    res();
  }, 260));
}

export const sheetOpen = () => !!sheetEl;

// ---------- тост ----------
let toastTimer = null;
export function toast(text) {
  let el = root().querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    root().appendChild(el);
  }
  el.innerHTML = `${I.check}<span>${text}</span>`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- экран результата (согласовано / отклонено) ----------
export function success({ kind = 'approved', title, text }) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = `done-overlay ${kind}`;
    const mark = kind === 'approved'
      ? '<path class="done-mark" d="M30 50.5 43.5 64 70 37"/>'
      : '<path class="done-mark" d="M36 36 64 64M64 36 36 64"/>';
    el.innerHTML = `<div class="done-card">
        <svg class="done-svg" viewBox="0 0 100 100" aria-hidden="true">
          <circle class="done-ring" cx="50" cy="50" r="44"/>
          ${mark}
        </svg>
        <div class="done-title">${title}</div>
        <div class="done-text">${text}</div>
      </div>`;
    root().appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      el.classList.remove('show');
      el.classList.add('hide');
      setTimeout(() => el.remove(), 300);
      resolve();
    };
    el.addEventListener('click', finish);
    setTimeout(finish, reduced() ? 900 : 1600);
  });
}
