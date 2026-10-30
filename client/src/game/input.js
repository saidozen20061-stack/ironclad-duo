// Keyboard state that ignores keys typed into form fields.
export class Keys {
  constructor() {
    this.down = new Set();
    this.pressed = new Set(); // edge-triggered this frame
    this.onDown = (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!this.enabled) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
      this.onChange?.();
    };
    this.onUp = (e) => {
      this.down.delete(e.code);
      this.onChange?.();
    };
    this.onBlur = () => this.down.clear();
    this.enabled = true;
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
    window.addEventListener('blur', this.onBlur);
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
  }
}
