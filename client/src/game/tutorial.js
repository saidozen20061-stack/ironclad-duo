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
  pilot: [
    'You are the PILOT. W = more throttle. Roll down the runway, then pull the mouse back to lift off.',
    'Mouse or A/D rolls, mouse pitches, Q/E rudder. Bank and pull to turn. Too slow and you stall!',
    'Left click fires the forward guns, Space drops bombs, R fires rockets. Hold C to look around.',
    'Land on your own runway and stop: the ground crew repairs, refuels and rearms you.',
    'About to go down? X bails both of you out with parachutes.',
  ],
  planeGunner: [
    'You are the SIDE GUNNER on the door minigun. Mouse turns the gun anywhere except straight up, left click fires. Call out enemies on your six!',
    'On bombers, F switches to the bomb sight looking straight down: left click drops, and tell the pilot to steer.',
    'T switches thermal. Q pings a spot on the pilot\'s compass. X bails out.',
  ],
  planeSolo: [
    'SOLO PLANE: W throttle up, mouse aims the plane, it flies where you point. Pull up past take-off speed to lift off.',
    'Left click guns, Space bombs, R rockets. Hold right click for the cockpit view. The side gun fires by itself.',
    'Land on your own runway and stop to repair, refuel and rearm. X bails out.',
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
    `In Flag Capture, stand in the A/B/C zones to capture them. Hold ${keyLabel(settings.pttKey)} to talk.`,
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
