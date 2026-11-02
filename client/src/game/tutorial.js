import { settings, saveSettings, keyLabel } from '../settings.js';

// Short hint popups shown during a player's first match in each role.
const HINTS = {
  driver: [
    'You are the DRIVER. You can\'t see outside — trust your gunner and your radar.',
    'W/S throttle · A/D steer (you can spin in place) · Shift boost · Space brake.',
    'The radar sweep shows contacts for a moment: green = friendly, grey = unknown.',
    'A yellow pulse on the radar is your gunner\'s PING — drive there. It shows distance and direction.',
    'Took damage? Stop and hold R to repair the worst module. Tracks out = you can\'t move.',
    `Talk to your gunner: hold ${keyLabel(settings.pttKey)} (or use open mic in Settings).`,
  ],
  solo: [
    'SOLO: you drive and shoot. W/S throttle · A/D steer · Shift boost · Space brake.',
    'Mouse aims the turret where the camera looks. Left click fires. Hold right click for the gun sight.',
    'The orange circle is where the gun really points — wait for it to turn green before firing.',
    'Took damage? Stop and hold R to repair the worst module. 1 / 2 switch AP / HE, middle mouse = machine gun.',
    'Press T for the thermal sight: in the gun sight, warm targets glow through fog and smoke.',
  ],
  gunner: [
    'You are the GUNNER. You see everything — the driver sees almost nothing. Guide them!',
    'Click to take the gun. Mouse aims, left click fires, scroll zooms (2×/6×).',
    'The orange circle is where the gun actually points. Wait for it to turn green.',
    'Press Q (or middle mouse) to PING a spot on the driver\'s radar. 5 s cooldown.',
    'Press T for the thermal sight: warm targets glow through fog and smoke.',
    'The hull indicator (bottom centre) shows which way the driver is facing.',
    `Stand in the A/B/C zones to capture them. Hold ${keyLabel(settings.pttKey)} to talk.`,
  ],
};

export function showTutorial(role, hud) {
  if (settings.seenTutorial?.[role]) return;
  const el = document.createElement('div');
  el.className = 'tutorial panel';
  hud.appendChild(el);
  const list = HINTS[role];
  let i = 0;
  const next = () => {
    if (!el.isConnected) return;
    if (i >= list.length) {
      el.remove();
      settings.seenTutorial = { ...settings.seenTutorial, [role]: true };
      saveSettings();
      return;
    }
    el.innerHTML = `<small>TIP ${i + 1}/${list.length}</small>${list[i]}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    i++;
    setTimeout(next, 6500);
  };
  setTimeout(next, 1500);
}
