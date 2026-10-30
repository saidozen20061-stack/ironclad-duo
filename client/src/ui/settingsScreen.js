import { settings, saveSettings, keyLabel } from '../settings.js';
import { $, $$, backScreen, toast } from './screens.js';

function bindRange(id, key, fmt) {
  const input = $(id);
  const out = input.parentElement.querySelector('output');
  input.value = settings[key];
  out.textContent = fmt(settings[key]);
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    out.textContent = fmt(settings[key]);
    saveSettings();
  });
}

async function refreshMics() {
  const select = $('#set-mic');
  let devices = [];
  try {
    devices = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
  } catch {
    // ignore
  }
  const mics = devices.filter((d) => d.kind === 'audioinput');
  select.innerHTML = '';
  const def = new Option('System default', '');
  select.add(def);
  mics.forEach((d, i) => {
    if (d.deviceId === 'default' || d.deviceId === '') return;
    select.add(new Option(d.label || `Microphone ${i + 1}`, d.deviceId));
  });
  select.value = settings.micId;
  if (select.value !== settings.micId) select.value = '';
  // Labels are hidden until permission is granted; hide the button once we have them.
  $('#btn-mic-perm').style.display = mics.some((d) => d.label) ? 'none' : '';
}

export function initSettingsScreen() {
  bindRange('#set-master', 'masterVolume', (v) => `${Math.round(v * 100)}%`);
  bindRange('#set-voice', 'voiceVolume', (v) => `${Math.round(v * 100)}%`);
  bindRange('#set-sens', 'sensitivity', (v) => `${v.toFixed(2)}x`);

  $('#set-mic').addEventListener('change', (e) => {
    settings.micId = e.target.value;
    saveSettings();
  });
  $('#btn-mic-perm').addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      refreshMics();
    } catch {
      toast('Microphone permission was denied.', { error: true });
    }
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshMics);

  for (const radio of $$('input[name=voicemode]')) {
    radio.checked = radio.value === settings.voiceMode;
    radio.addEventListener('change', () => {
      settings.voiceMode = radio.value;
      saveSettings();
    });
  }

  const ptt = $('#set-ptt');
  ptt.textContent = keyLabel(settings.pttKey);
  ptt.addEventListener('click', () => {
    ptt.classList.add('listening');
    ptt.textContent = 'Press a key…';
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        settings.pttKey = e.code;
        saveSettings();
      }
      ptt.textContent = keyLabel(settings.pttKey);
      ptt.classList.remove('listening');
      window.removeEventListener('keydown', onKey, true);
    };
    window.addEventListener('keydown', onKey, true);
  });

  const segs = $$('#set-quality button');
  const markQuality = () => segs.forEach((b) => b.classList.toggle('sel', b.dataset.q === settings.quality));
  markQuality();
  segs.forEach((b) =>
    b.addEventListener('click', () => {
      settings.quality = b.dataset.q;
      saveSettings();
      markQuality();
    }),
  );

  for (const [id, key] of [['#set-turn-url', 'turnUrl'], ['#set-turn-user', 'turnUser'], ['#set-turn-pass', 'turnPass']]) {
    const input = $(id);
    input.value = settings[key] ?? '';
    input.addEventListener('change', () => {
      settings[key] = input.value.trim();
      saveSettings();
    });
  }

  $('#btn-settings-back').addEventListener('click', () => backScreen());
}

export function onSettingsOpen() {
  refreshMics();
}
