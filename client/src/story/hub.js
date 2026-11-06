import { $, showScreen, backScreen, toast, escapeHtml } from '../ui/screens.js';
import { story, saveStory, exportCode, importCode, resetStory, rankInfo } from './save.js';
import { STORY_TANKS, TIERS } from './data.js';
import { openMap } from './map.js';
import { initShop, openShop } from './shop.js';
import { initWorkshop, openWorkshop } from './workshop.js';
import { tankInfo, fitOf, battleTank, buildSpec, combatRating } from './tanks.js';
import { dress, lookKey } from './looks.js';

// The story mode hub: the workshop picture, the crew's tank on the turntable in the middle, and the
// places to go from here as signs around it.

let scene = null;

export function initStoryHub(menuScene) {
  scene = menuScene;
  $('#btn-story').addEventListener('click', () => {
    showScreen('story');
    renderHub();
  });
  $('#btn-story-back').addEventListener('click', () => backScreen());
  initShop({ renderHub });
  initWorkshop(menuScene, { renderHub, showTank });
  $('#screen-story').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    const go = { map: openMap, shop: () => openShop(), workshop: openWorkshop }[b?.dataset.open];
    if (go) go();
    else if (b) open(b.dataset.open);
  });
  const panel = $('#story-panel');
  panel.addEventListener('click', (e) => {
    if (e.target === panel || e.target.closest('[data-close]')) return close();
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tank) {
      story.current = b.dataset.tank;
      saveStory();
      renderHub();
      open('motor');
    } else if (b.dataset.act === 'copy') {
      navigator.clipboard?.writeText($('#story-code').value).then(() => toast('Save code copied.'), () => toast('Select the code and copy it by hand.'));
    } else if (b.dataset.act === 'load') {
      try {
        importCode($('#story-code').value);
        renderHub();
        close();
        toast('Save loaded.');
      } catch (err) {
        $('#story-error').textContent = err.message;
      }
    } else if (b.dataset.act === 'reset') {
      if (!b.classList.contains('armed')) {
        b.classList.add('armed');
        b.textContent = 'Yes, wipe everything';
        return;
      }
      resetStory();
      renderHub();
      close();
      toast('Story progress reset.');
    }
  });
}

function open(what) {
  const tier = (id) => `Tier ${TIERS[STORY_TANKS[id].tier]}`;
  const pages = {
    motor: ['Motor pool', `<p>Your tanks. The one you pick goes into battle. Buy more in the shop.</p><div class="story-list">${Object.keys(story.tanks).map((id) => `<button data-tank="${id}" class="${id === story.current ? 'sel' : ''}"><b>${escapeHtml(tankInfo(id).name)}</b><small>${tier(id)} · ${tankInfo(id).class} · combat rating ${combatRating(buildSpec(id))}</small></button>`).join('')}</div>`],
    export: ['Export save', `<p>Copy this code and keep it. Import it on another computer or browser to carry on there.</p><textarea id="story-code" readonly>${exportCode()}</textarea><button class="btn small" data-act="copy">Copy code</button>`],
    import: ['Import save', `<p>Paste a save code. It replaces the progress here.</p><textarea id="story-code" spellcheck="false" placeholder="Save code"></textarea><p class="error" id="story-error"></p><button class="btn small" data-act="load">Load save</button>`],
    reset: ['Reset story progress', `<p>This wipes your rank, silver, tanks and stars, and it can't be undone. Export your save first if you might want it back.</p><button class="btn small danger" data-act="reset">Reset progress</button>`],
  };
  const [title, body] = pages[what];
  const panel = $('#story-panel');
  panel.innerHTML = `<div class="story-card"><h3>${title}</h3>${body}<button class="btn ghost small" data-close>Close</button></div>`;
  panel.hidden = false;
  if (what === 'export') $('#story-code').select();
}

function close() {
  $('#story-panel').hidden = true;
}

export function renderHub() {
  const r = rankInfo();
  $('#story-rank').textContent = `Rank ${r.rank} · ${r.name}`;
  $('#story-xp').style.width = `${r.need ? Math.round((r.into / r.need) * 100) : 100}%`;
  $('#story-xp-text').textContent = r.need ? `${r.into} / ${r.need} XP` : 'Top rank';
  $('#story-coins').textContent = story.coins.toLocaleString('en');
  const t = tankInfo(story.current);
  const tier = `Tier ${TIERS[t.tier]}`;
  $('#story-tank').textContent = t.name;
  $('#story-tier').textContent = `${tier} · ${t.class} · rating ${combatRating(buildSpec(story.current))}`;
  showTank();
  $('#preview-story .preview-cap').innerHTML = `<b>${escapeHtml(t.name)}</b><small>${tier} ${t.class}${t.inspired ? ` · inspired by the ${t.inspired}` : ''}</small>`;
}

// The crew's tank on the turntable, with its fitted parts showing.
export function showTank() {
  const { model, paint } = battleTank();
  const fit = fitOf(story.current);
  scene.setShowcase(model, paint, (v) => dress(v, model, fit), lookKey(fit));
}
