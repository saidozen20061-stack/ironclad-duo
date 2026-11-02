import { ACTIONS, GROUPS, KEY_ONLY, binding, setBinding, resetBindings } from '../keybinds.js';
import { keyLabel } from '../settings.js';
import { $, backScreen, toast } from './screens.js';

// Rebind every key and mouse button. Click a row, then press the new key or button.
let stopListening = null;

function render() {
  $('#controls-list').innerHTML = Object.entries(GROUPS)
    .map(([group, title]) => `<h3>${title}</h3><div class="settings-grid controls-grid">${ACTIONS.filter((a) => a.group === group)
      .map((a) => `<label>${a.label}</label><div class="row"><button class="btn small keybind" data-bind="${a.id}">${keyLabel(binding(a.id))}</button></div>`)
      .join('')}</div>`)
    .join('');
}

function listen(btn) {
  stopListening?.();
  const id = btn.dataset.bind;
  btn.classList.add('listening');
  btn.textContent = 'Press a key or button…';
  const swallow = (e) => e.preventDefault();
  const finish = () => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    window.removeEventListener('contextmenu', swallow, true);
    stopListening = null;
    render();
  };
  const take = (code) => {
    if (KEY_ONLY.has(id) && code.startsWith('Mouse')) {
      toast('Talking needs a keyboard key.', { error: true });
      return finish();
    }
    setBinding(id, code);
    finish();
  };
  const onKey = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') return finish(); // Esc always cancels and always pauses
    // Ctrl and the Windows key combine with the game's keys into browser shortcuts (Ctrl+W closes the tab).
    if (/^(Control|Meta|OS)/.test(e.code)) {
      toast('Ctrl and the Windows key can\'t be used: Ctrl+W would close the game.', { error: true });
      return finish();
    }
    take(e.code);
  };
  const onMouse = (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    // The click that ends this press must not start listening again.
    window.addEventListener('click', (c) => c.stopImmediatePropagation(), { capture: true, once: true });
    take(`Mouse${e.button}`);
  };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('mousedown', onMouse, true);
  window.addEventListener('contextmenu', swallow, true);
  stopListening = finish;
}

export function initControlsScreen() {
  $('#controls-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bind]');
    if (b) listen(b);
  });
  $('#btn-controls-reset').addEventListener('click', () => {
    stopListening?.();
    resetBindings();
    render();
  });
  $('#btn-controls-back').addEventListener('click', () => {
    stopListening?.();
    backScreen();
  });
  render();
}

export function onControlsOpen() {
  stopListening?.();
  render();
}
