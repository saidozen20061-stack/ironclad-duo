import { settings, saveSettings } from '../settings.js';
import { keyName } from '../keybinds.js';

// Short hint popups shown during a player's first match in each role.
const K = keyName;
const hints = () => ({
  driver: [
    'You are the DRIVER. You can\'t see outside — trust your gunner and your radar.',
    `${K('drive.forward')}/${K('drive.back')} throttle · ${K('drive.left')}/${K('drive.right')} steer (you can spin in place) · ${K('drive.boost')} boost · ${K('drive.brake')} brake.`,
    'The radar sweep shows contacts for a moment: green = friendly, grey = unknown.',
    'A yellow pulse on the radar is your gunner\'s PING — drive there. It shows distance and direction.',
    `Took damage? Stop and hold ${K('drive.repair')} to repair the worst module. Tracks out = you can't move.`,
    `Talk to your gunner: hold ${K('all.talk')} (or use open mic in Settings).`,
  ],
  pilot: [
    `You are the PILOT. Roll out of the hangar and hold ${K('plane.up')}: it builds up speed and lifts off on its own, on the runway or anywhere flat enough. ${K('plane.left')}/${K('plane.right')} steer on the ground.`,
    `In the air ${K('plane.up')} climbs, ${K('plane.down')} descends, ${K('plane.left')}/${K('plane.right')} turn, ${K('plane.more')}/${K('plane.less')} change throttle. Too slow and you stall! On a jet, keep holding ${K('plane.more')} at full throttle for the afterburner.`,
    `The mouse aims the guns wherever you look, ${K('plane.fire')} fires. ${K('plane.bomb')} drops bombs, ${K('plane.rocket')} fires rockets along the nose. ${K('plane.view')} switches 1st/3rd person, ${K('plane.ahead')} looks ahead again.`,
    'Land on your own runway and stop: the ground crew repairs, refuels and rearms you.',
    `About to go down? ${K('plane.bail')} bails both of you out with parachutes.`,
  ],
  heliPilot: [
    `You are the PILOT of a helicopter. ${K('plane.more')} lifts off and rises, ${K('plane.less')} sinks. Let go of everything and it hangs still in the air.`,
    `${K('plane.up')}/${K('plane.down')} go forward and back, ${K('plane.left')}/${K('plane.right')} sideways, all at once and very sharply. The mouse turns the nose and aims, ${K('plane.fire')} fires your side minigun. Your gunner has the other one.`,
    `Set it down on your own helipad or airfield to repair, refuel and rearm. ${K('plane.bail')} bails out. Stay out of the enemy half for long: after two minutes their AA turrets open up.`,
  ],
  heliSolo: [
    `SOLO HELICOPTER: ${K('plane.more')} lifts off and rises, ${K('plane.less')} sinks. Let go of everything and it hangs still in the air.`,
    `${K('plane.up')}/${K('plane.down')} go forward and back, ${K('plane.left')}/${K('plane.right')} sideways, all at once and very sharply. The mouse turns the nose and aims, ${K('plane.fire')} fires both side miniguns.`,
    `Set it down on your own helipad or airfield to repair, refuel and rearm. ${K('plane.bail')} bails out. Stay out of the enemy half for long: after two minutes their AA turrets open up.`,
  ],
  planeGunner: [
    `You are the SIDE GUNNER on the door minigun. Mouse turns the gun anywhere except straight up, ${K('door.fire')} fires. Call out enemies on your six!`,
    `On bombers, ${K('door.sight')} switches to the bomb sight looking straight down: ${K('door.fire')} drops, and tell the pilot to steer.`,
    `${K('door.thermal')} switches thermal. ${K('door.ping')} pings a spot on the pilot's compass. ${K('door.bail')} bails out.`,
  ],
  planeOperator: [
    `You are the WEAPONS OPERATOR on the targeting camera. Mouse looks around, ${K('door.fire')} fires 2 rockets along the nose, so call the turns to your pilot.`,
    `${K('door.thermal')} switches thermal. ${K('door.ping')} pings a spot on the pilot's compass. ${K('door.bail')} bails out.`,
  ],
  planeSolo: [
    `SOLO PLANE: roll out of the hangar and hold ${K('plane.up')}: it builds up speed and lifts off on its own, on the runway or anywhere flat enough. ${K('plane.left')}/${K('plane.right')} steer on the ground. In the air ${K('plane.up')} climbs, ${K('plane.down')} descends, ${K('plane.left')}/${K('plane.right')} turn, ${K('plane.more')}/${K('plane.less')} change throttle.`,
    `The mouse aims the guns wherever you look, ${K('plane.fire')} fires. ${K('plane.bomb')} bombs, ${K('plane.rocket')} rockets along the nose. ${K('plane.view')} switches 1st/3rd person, ${K('plane.ahead')} looks ahead again. The side gun fires by itself.`,
    `Land on your own runway and stop to repair, refuel and rearm. ${K('plane.bail')} bails out.`,
  ],
  solo: [
    `SOLO: you drive and shoot. ${K('drive.forward')}/${K('drive.back')} throttle · ${K('drive.left')}/${K('drive.right')} steer · ${K('drive.boost')} boost · ${K('drive.brake')} brake.`,
    `Mouse aims the turret where the camera looks. ${K('gun.fire')} fires. ${K('solo.view')} switches 1st/3rd person, hold ${K('solo.sight')} for a quick look through the sight.`,
    'The orange circle is where the gun really points — wait for it to turn green before firing.',
    `Took damage? Stop and hold ${K('drive.repair')} to repair the worst module. ${K('gun.ap')} / ${K('gun.he')} switch AP / HE, ${K('solo.mg')} = machine gun.`,
    `Press ${K('gun.thermal')} for the thermal sight: in the gun sight, warm targets glow through fog and smoke.`,
  ],
  gunner: [
    'You are the GUNNER. You see everything — the driver sees almost nothing. Guide them!',
    `Click to take the gun. Mouse aims, ${K('gun.fire')} fires, scroll zooms (2×/6×).`,
    'The orange circle is where the gun actually points. Wait for it to turn green.',
    `Press ${K('gunner.ping')} to PING a spot on the driver's radar. 5 s cooldown.`,
    `Press ${K('gun.thermal')} for the thermal sight: warm targets glow through fog and smoke.`,
    'The hull indicator (bottom centre) shows which way the driver is facing.',
    `In Flag Capture, stand in the A/B/C zones to capture them. Hold ${K('all.talk')} to talk.`,
  ],
});

export function showTutorial(role, hud) {
  if (settings.seenTutorial?.[role]) return;
  const el = document.createElement('div');
  el.className = 'tutorial panel';
  hud.appendChild(el);
  const list = hints()[role];
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
