// The garage screen the game opens on. It's up from the moment the page starts loading, and once
// everything's ready it waits for a click (or Enter or Space) before showing the menu.

const FADE = 500; // ms, the same as #intro's transition
const READY_AT_LATEST = 3000; // ms

export function introReady() {
  const intro = document.getElementById('intro');
  if (!intro) return;
  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    intro.classList.add('ready');
    document.getElementById('intro-status').textContent = 'Ready. Click anywhere to continue';
    const go = () => {
      intro.removeEventListener('click', go);
      window.removeEventListener('keydown', key, true);
      intro.classList.add('gone');
      setTimeout(() => intro.remove(), FADE);
    };
    const key = (e) => {
      if (e.code !== 'Enter' && e.code !== 'Space') return;
      e.preventDefault();
      e.stopPropagation();
      go();
    };
    intro.addEventListener('click', go);
    window.addEventListener('keydown', key, true);
  };
  // Two frames: the menu has drawn itself behind the picture by then. Frames stop coming while the
  // window's covered, so it doesn't wait for them for long.
  requestAnimationFrame(() => requestAnimationFrame(show));
  setTimeout(show, READY_AT_LATEST);
}
