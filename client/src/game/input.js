import { codesFor, isBound } from '../keybinds.js';

// Keyboard and mouse-button state that ignores keys typed into form fields.
export class Keys {
  constructor() {
    this.down = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.onDown = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!this.enabled) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      // Bound keys shouldn't also scroll the page or move focus; browser shortcuts stay alone.
      if (!e.ctrlKey && !e.metaKey && isBound(e.code)) e.preventDefault();
      this.onChange?.();
    };
    this.onUp = (e) => {
      this.down.delete(e.code);
      this.onChange?.();
    };
    this.onBlur = () => this.down.clear();
    // Mouse buttons count as keys too, 'Mouse0' and up, but only on the game itself (not the menus).
    this.onMouseDown = (e) => {
      if (!this.enabled || e.target !== document.getElementById('scene')) return;
      const code = `Mouse${e.button}`;
      if (e.button === 1) e.preventDefault();
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
      this.onChange?.();
    };
    this.onMouseUp = (e) => {
      this.down.delete(`Mouse${e.button}`);
      this.onChange?.();
    };
    this.enabled = true;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
  }
  // Is the action's key or button held?
  on(action) {
    return this.enabled && codesFor(action).some((c) => this.down.has(c));
  }
  // Was the action's key or button just pressed? (Once per press.)
  hit(action) {
    let p = false;
    for (const c of codesFor(action)) p = this.pressed.delete(c) || p;
    return this.enabled && p;
  }
  // A press that only grabbed the mouse pointer: it shouldn't also do anything.
  swallow(code) {
    this.down.delete(code);
    this.pressed.delete(code);
  }
  has(code) {
    return this.enabled && this.down.has(code);
  }
  took(code) {
    const p = this.pressed.has(code);
    this.pressed.delete(code);
    return this.enabled && p;
  }
  endFrame() {
    this.pressed.clear();
  }
  setEnabled(on) {
    this.enabled = on;
    if (!on) this.down.clear();
  }
  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
  }
}
