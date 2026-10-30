// Screen switching + small DOM helpers shared by the menu modules.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let current = null;
const history = [];
const showListeners = new Set();

export function showScreen(name, { remember = true } = {}) {
  if (remember && current && current !== name) history.push(current);
  for (const el of $$('.screen')) el.classList.toggle('active', el.id === `screen-${name}`);
  current = name;
  for (const fn of showListeners) fn(name);
}

export function hideScreens() {
  for (const el of $$('.screen')) el.classList.remove('active');
  current = null;
  for (const fn of showListeners) fn(null);
}

export function backScreen(fallback = 'menu') {
  showScreen(history.pop() ?? fallback, { remember: false });
}

export function clearHistory() {
  history.length = 0;
}

export function currentScreen() {
  return current;
}

export function onScreenChange(fn) {
  showListeners.add(fn);
}

export function toast(text, { error = false, ms = 3500 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = text;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function setStatus(id, text, error = false) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.classList.toggle('error', error);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
