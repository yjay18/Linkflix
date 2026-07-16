/* ================= Modals (add / edit / settings / folder IO) ================= */
import { state, store, saveLibrary, saveSettings, uid } from './state.js';
import { $, $$, esc, toast } from './dom.js';
import { coverFromFile } from './covers.js';
import { formatShowDates } from './format.js';
import { searchTVMaze, tvmazeShow, tvmazeEpisodes, wikiSummary, wikiLookup, withTimeout } from './metadata.js';
import { render, removeFromContinueWatching } from './views.js';
import { syncSuggestionScopeUi } from './concierge.js';
import { focusFirst } from './nav.js';

export function closeModal() { $('#modal-root').innerHTML = ''; focusFirst(); }
export function modalOpen() { return !!$('#modal-root').firstElementChild; }

/* ---------- Add / Edit ---------- */
function epEditorHtml(ep = {}) {
  return `<div class="ep-editor" data-tvmaze-id="${esc(ep.tvmazeId || '')}"
    data-season="${esc(ep.season ?? '')}" data-number="${esc(ep.number ?? '')}">
    <input placeholder="Episode title" class="f-ep-title" value="${esc(ep.title || '')}">
    <input type="date" class="f-ep-airdate" value="${esc(ep.airdate || '')}" title="Air date">
    <textarea rows="2" placeholder="Episode bio / subtitle (optional)" class="f-ep-sub">${esc(ep.subtitle || '')}</textarea>
    <input placeholder="Google Drive link" class="f-ep-link" value="${esc(ep.link || '')}">
    <button type="button" class="icon-btn" data-remove-ep title="Remove episode">✕</button>
  </div>`;
}
function seasonEditorHtml(season = {}, idx = 0) {
  return `<div class="season-editor">
    <div class="season-editor-head">
      <input placeholder="Season name" class="f-season-name"
        value="${esc(season.name || `Season ${idx + 1}`)}">
      <button type="button" class="icon-btn" data-remove-season title="Remove season">✕</button>
    </div>
    <div class="ep-editors">
      ${(season.episodes?.length ? season.episodes : [{}]).map(epEditorHtml).join('')}
    </div>
    <button type="button" class="icon-btn" data-add-ep>＋ Episode</button>
  </div>`;
}

function episodeKey(ep, fallbackSeason, fallbackNumber) {
  const season = ep.season ?? fallbackSeason;
  const number = ep.number ?? fallbackNumber;
  return `${season}:${number}`;
}

function titleKey(title) {
  return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tvmazeShowRef(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const fromUrl = raw.match(/tvmaze\.com\/shows\/(\d+)/i) ||
    raw.match(/api\.tvmaze\.com\/shows\/(\d+)/i);
  if (fromUrl) return fromUrl[1];
  return /^\d+$/.test(raw) ? raw : '';
}

function wikiPageRef(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const fromUrl = raw.match(/wikipedia\.org\/wiki\/([^?#]+)/i);
  if (fromUrl) return decodeURIComponent(fromUrl[1]).replace(/_/g, ' ');
  if (/^https?:\/\//i.test(raw)) return '';
  return raw;
}

function seasonNumberFromEditor(se, fallback) {
  const name = $('.f-season-name', se)?.value.trim() || '';
  if (/specials?/i.test(name)) return 0;
  const m = name.match(/\d+/);
  return m ? +m[0] : fallback;
}

function currentEpisodeLookups(form) {
  const byId = new Map(), byNumber = new Map(), byTitle = new Map();
  $$('.season-editor', form).forEach((se, si) => {
    const fallbackSeason = seasonNumberFromEditor(se, si + 1);
    $$('.ep-editor', se).forEach((ee, ei) => {
      const ep = {
        tvmazeId: ee.dataset.tvmazeId || '',
        season: ee.dataset.season || fallbackSeason,
        number: ee.dataset.number || (ei + 1),
        title: $('.f-ep-title', ee).value.trim(),
        airdate: $('.f-ep-airdate', ee).value.trim(),
        subtitle: $('.f-ep-sub', ee).value.trim(),
        link: $('.f-ep-link', ee).value.trim()
      };
      if (ep.tvmazeId) byId.set(String(ep.tvmazeId), ep);
      byNumber.set(episodeKey(ep, si + 1, ei + 1), ep);
      const tk = titleKey(ep.title);
      if (tk) byTitle.set(tk, ep);
    });
  });
  return { byId, byNumber, byTitle };
}

function mergeEpisodeLinks(seasons, lookups) {
  let keptLinks = 0;
  for (const season of seasons) {
    for (const ep of season.episodes || []) {
      const match = (ep.tvmazeId && lookups.byId.get(String(ep.tvmazeId))) ||
        lookups.byNumber.get(episodeKey(ep, ep.season, ep.number)) ||
        lookups.byTitle.get(titleKey(ep.title));
      if (match?.link) {
        ep.link = match.link;
        keptLinks++;
      }
    }
  }
  return keptLinks;
}

export function openAddModal(editId = null) {
  const item = editId ? state.library.find(i => i.id === editId) : null;
  const type = item?.type || 'movie';
  let currentTvmazeId = item?.tvmazeId || '';
  let currentWikiTitle = item?.wikiTitle || '';
  $('#modal-root').innerHTML = `
  <div class="modal-overlay" data-overlay>
    <form class="modal glass" id="add-form">
      <div class="modal-head">
        <h2>${item ? 'Edit' : 'Add'} title</h2>
        <div class="seg" role="radiogroup" aria-label="Type">
          <button type="button" data-type="movie" class="${type === 'movie' ? 'active' : ''}">Movie</button>
          <button type="button" data-type="show"  class="${type === 'show'  ? 'active' : ''}">TV Show</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field"><label>Title</label>
            <input id="f-title" required value="${esc(item?.title || '')}" placeholder="e.g. Interstellar"></div>
          <div class="field"><label>Genre (optional)</label>
            <input id="f-genre" value="${esc(item?.genre || '')}" placeholder="Sci-fi"></div>
        </div>
        <div class="field">
          <button type="button" class="pill-btn" id="btn-autofill">✦ Auto-fill / refresh details from the web</button>
        </div>
        <div class="field-row">
          <div class="field"><label>Subtitle / description (optional)</label>
            <input id="f-subtitle" value="${esc(item?.subtitle || '')}" placeholder="A short tagline or synopsis"></div>
          <div class="field"><label>Dates (optional)</label>
            <input id="f-dates" value="${esc(formatShowDates(item))}" placeholder="2020 - Running"></div>
        </div>
        <div class="field"><label>Cover image (optional)</label>
          <input id="f-cover" value="${esc(item?.cover?.startsWith('data:') ? '' : (item?.cover || ''))}"
            placeholder="https://…/poster.jpg">
          <div class="hero-actions" style="margin-top:8px; align-items:center">
            <button type="button" class="icon-btn" id="btn-upload-cover">⇧ Upload image</button>
            <span class="hint" id="cover-status" style="margin:0">${item?.cover?.startsWith('data:')
              ? 'Using uploaded cover ✓' : ''}</span>
          </div>
          <input type="file" id="f-cover-file" accept="image/*" hidden>
          <div class="hint">Paste an image URL or upload a file — uploads are saved with your library
            and included in exports. Leave blank for a generated cover.</div></div>

        <div id="movie-fields" ${type === 'show' ? 'hidden' : ''}>
          <div class="field"><label>Wikipedia movie URL or page title (optional)</label>
            <input id="f-wiki" value="${esc(currentWikiTitle)}"
              placeholder="https://en.wikipedia.org/wiki/Interstellar_(film)">
            <div class="hint">Use this when movie search picks the wrong page. Open the movie's
              Wikipedia page, copy its URL, then press Auto-fill.</div></div>
          <div class="field"><label>Google Drive link</label>
            <input id="f-link" value="${esc(item?.link || '')}"
              placeholder="https://drive.google.com/file/d/…/view">
            <div class="hint">Share the file as “Anyone with the link” (or stay signed in to Google here).</div></div>
        </div>

        <div id="show-fields" ${type === 'movie' ? 'hidden' : ''}>
          <div class="field"><label>TVMaze show URL or ID (optional)</label>
            <input id="f-tvmaze" value="${esc(currentTvmazeId)}"
              placeholder="https://www.tvmaze.com/shows/123/show-name or 123">
            <div class="hint">Use this when title search picks the wrong show. Find the show on
              TVMaze, copy its page URL, then press Auto-fill / refresh.</div></div>
          <div class="field"><label>Seasons & episodes</label></div>
          <div id="season-editors">
            ${(item?.seasons?.length ? item.seasons : [{}])
              .map((s, i) => seasonEditorHtml(s, i)).join('')}
          </div>
          <button type="button" class="icon-btn" id="add-season">＋ Season</button>
        </div>
      </div>
      <div class="modal-foot">
        <button type="button" class="pill-btn" data-action="close-modal">Cancel <kbd>⎋</kbd></button>
        <button type="submit" class="pill-btn accent">${item ? 'Save changes' : 'Add to library'} <kbd>⏎</kbd></button>
      </div>
    </form>
  </div>`;

  const form = $('#add-form');
  let curType = type;

  form.addEventListener('click', e => {
    const t = e.target.closest('[data-type]');
    if (t) {
      curType = t.dataset.type;
      $$('.seg button', form).forEach(b => b.classList.toggle('active', b === t));
      $('#movie-fields').hidden = curType === 'show';
      $('#show-fields').hidden = curType === 'movie';
    }
    if (e.target.closest('#add-season')) {
      const wrap = $('#season-editors');
      wrap.insertAdjacentHTML('beforeend', seasonEditorHtml({}, wrap.children.length));
    }
    if (e.target.closest('[data-add-ep]')) {
      e.target.closest('.season-editor').querySelector('.ep-editors')
        .insertAdjacentHTML('beforeend', epEditorHtml());
    }
    if (e.target.closest('[data-remove-ep]')) e.target.closest('.ep-editor').remove();
    if (e.target.closest('[data-remove-season]')) e.target.closest('.season-editor').remove();
  });

  let pendingCover = null;                             // uploaded file as data-URL
  const keepUploaded = item?.cover?.startsWith('data:') ? item.cover : null;

  $('#btn-upload-cover').addEventListener('click', () => $('#f-cover-file').click());
  $('#f-cover-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingCover = await coverFromFile(file);
      $('#cover-status').textContent = `${file.name} attached ✓`;
    } catch { toast('Could not read that image'); }
  });

  $('#btn-autofill').addEventListener('click', async () => {
    const q = $('#f-title').value.trim();
    const tvmazeInput = curType === 'show' ? $('#f-tvmaze').value.trim() : '';
    const exactTvmazeId = curType === 'show' ? tvmazeShowRef(tvmazeInput) : '';
    const wikiInput = curType === 'movie' ? $('#f-wiki').value.trim() : '';
    const exactWikiTitle = curType === 'movie' ? wikiPageRef(wikiInput) : '';
    if (curType === 'show' && tvmazeInput && !exactTvmazeId) {
      toast('Paste a TVMaze show URL or numeric show ID');
      $('#f-tvmaze').focus();
      return;
    }
    if (curType === 'movie' && wikiInput && !exactWikiTitle) {
      toast('Paste a Wikipedia movie URL or exact page title');
      $('#f-wiki').focus();
      return;
    }
    if (!q && !exactTvmazeId && !exactWikiTitle && !(curType === 'show' && currentTvmazeId)) {
      toast(curType === 'show'
        ? 'Type a title or paste a TVMaze show URL'
        : 'Type a title or paste a Wikipedia movie URL');
      (curType === 'show' ? $('#f-tvmaze') : $('#f-wiki')).focus();
      return;
    }
    const btn = $('#btn-autofill');
    btn.disabled = true; btn.textContent = curType === 'show'
      ? '✦ Refreshing from TVMaze…'
      : '✦ Searching the web…';
    try {
      let info = null;
      if (curType === 'show' && exactTvmazeId)
        info = await withTimeout(tvmazeShow(exactTvmazeId));
      if (curType === 'show' && !info && currentTvmazeId)
        info = await withTimeout(tvmazeShow(currentTvmazeId));
      if (curType === 'show' && !info) info = (await withTimeout(searchTVMaze(q)))[0];
      if (curType === 'movie' && exactWikiTitle)
        info = await withTimeout(wikiSummary(exactWikiTitle));
      if (!info) info = await withTimeout(wikiLookup(curType === 'movie' ? `${q} (film)` : q));
      if (!info || (!info.id && !info.summary && !info.image)) throw 0;
      if (info.id) {
        currentTvmazeId = String(info.id);
        if (curType === 'show') $('#f-tvmaze').value = currentTvmazeId;
      }
      if (info.wikiTitle) {
        currentWikiTitle = info.wikiTitle;
        if (curType === 'movie') $('#f-wiki').value = currentWikiTitle;
      }
      if (info.title && !$('#f-title').value.trim()) $('#f-title').value = info.title;
      if (info.genres?.length && !$('#f-genre').value)
        $('#f-genre').value = info.genres.slice(0, 2).join(' · ');
      if (info.summary && !$('#f-subtitle').value)
        $('#f-subtitle').value = info.summary.slice(0, 180);
      if (curType === 'show' && formatShowDates(info))
        $('#f-dates').value = formatShowDates(info);
      if (info.image && !$('#f-cover').value.trim() && !pendingCover)
        $('#f-cover').value = info.image;

      let epCount = 0;
      if (curType === 'show' && info.id) {           // fill every episode title too
        const seasons = await withTimeout(tvmazeEpisodes(info.id), 8000);
        if (seasons.length) {
          const oldCount = $$('.ep-editor', form).length;
          const keptLinks = mergeEpisodeLinks(seasons, currentEpisodeLookups(form));
          seasons.forEach(s => s.episodes.forEach(() => epCount++));
          $('#season-editors').innerHTML =
            seasons.map((s, i) => seasonEditorHtml(s, i)).join('');
          const addedCount = Math.max(0, epCount - oldCount);
          toast(`Refreshed ${epCount} episodes${addedCount ? `, added ${addedCount} new` : ''}${keptLinks ? `, kept ${keptLinks} Drive links` : ''} ✓`);
        } else {
          toast('Show details filled, but TVMaze returned no episodes yet');
        }
      } else {
        toast('Details filled from the web ✓');
      }
    } catch { toast('Nothing found — check the spelling'); }
    btn.disabled = false; btn.textContent = '✦ Auto-fill / refresh details from the web';
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const coverUrl = $('#f-cover').value.trim();
    const data = {
      id: item?.id || uid(),
      type: curType,
      title: $('#f-title').value.trim(),
      genre: $('#f-genre').value.trim(),
      subtitle: $('#f-subtitle').value.trim(),
      dates: $('#f-dates').value.trim(),
      cover: pendingCover || coverUrl || keepUploaded || '',
      added: item?.added || Date.now()
    };
    if (!data.title) return;
    if (curType === 'movie') {
      data.wikiTitle = wikiPageRef($('#f-wiki').value) || currentWikiTitle || item?.wikiTitle || '';
      data.link = $('#f-link').value.trim();
    } else {
      data.tvmazeId = tvmazeShowRef($('#f-tvmaze').value) || currentTvmazeId || item?.tvmazeId || '';
      data.seasons = $$('.season-editor', form).map(se => ({
        name: $('.f-season-name', se).value.trim(),
        episodes: $$('.ep-editor', se).map(ee => ({
          tvmazeId: ee.dataset.tvmazeId || '',
          season: ee.dataset.season || '',
          number: ee.dataset.number || '',
          title: $('.f-ep-title', ee).value.trim(),
          airdate: $('.f-ep-airdate', ee).value.trim(),
          subtitle: $('.f-ep-sub', ee).value.trim(),
          link: $('.f-ep-link', ee).value.trim()
        })).filter(ep => ep.title || ep.link)
      })).filter(s => s.episodes.length);
    }
    if (item) state.library = state.library.map(i => i.id === item.id ? data : i);
    else state.library.unshift(data);

    saveLibrary();
    closeModal();
    toast(item ? 'Saved ✓' : `Added “${data.title}” ✓`);
    render();
  });

  $('#f-title').focus();
}

/* ---------- Settings ---------- */
export function openSettings() {
  $('#modal-root').innerHTML = `
  <div class="modal-overlay" data-overlay>
    <form class="modal glass" id="settings-form">
      <div class="modal-head"><h2>Settings</h2></div>
      <div class="modal-body">
        <div class="field"><label>AI Concierge model (runs locally, free)</label>
          <select id="f-model">
            ${[
              ['Llama-3.2-1B-Instruct-q4f16_1-MLC',  'Llama 3.2 1B — fastest (~0.9 GB)'],
              ['Qwen2.5-1.5B-Instruct-q4f16_1-MLC',  'Qwen 2.5 1.5B — balanced (~1 GB)'],
              ['Llama-3.2-3B-Instruct-q4f16_1-MLC',  'Llama 3.2 3B — smartest (~2 GB)']
            ].map(([id, label]) =>
              `<option value="${id}" ${state.settings.model === id ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
          <div class="hint">Downloads once via WebGPU, then cached in your browser. No API, no account.</div></div>
        <div class="field"><label>Concierge</label>
          <label class="check-row"><input type="checkbox" id="f-outside"
            ${state.settings.allowOutsideSuggestions ? 'checked' : ''}> Allow outside suggestions when I turn them on
            <span class="hint" style="margin:0">(top ◎ icon — outside titles are not playable cards)</span></label>
          <label class="check-row"><input type="checkbox" id="f-use-brave"
            ${state.settings.useBraveSearch ? 'checked' : ''}> Yes, use Brave Search when I ask for web context</label>
          <input id="f-brave" value="${esc(state.settings.braveKey || '')}"
            placeholder="Brave Search API key (optional)" style="margin-top:8px">
          <div class="hint">With ⌂ Library active, recommendations stay inside your saved titles.
            With ◎ Outside active, no Brave key means the model uses its own film/TV knowledge;
            with a Brave key, it can add search context.</div></div>
        <div class="field"><label>Behaviour</label>
          <label class="check-row"><input type="checkbox" id="f-group"
            ${state.settings.groupByGenre ? 'checked' : ''}> Group home rows by genre automatically</label></div>
        <div class="field"><label>Continue Watching</label>
          <div class="hero-actions">
            <button type="button" class="pill-btn danger" id="btn-clear-watch"
              ${state.watchLog.length ? '' : 'disabled'}>Clear Continue Watching</button>
          </div>
          <div class="hint">${state.watchLog.length
            ? `This removes ${state.watchLog.length} saved progress entr${state.watchLog.length === 1 ? 'y' : 'ies'} from this browser.`
            : 'There is nothing in Continue Watching right now.'}</div></div>
        <div class="field"><label>Library folder — share it via Google Drive</label>
          <div class="hero-actions">
            <button type="button" class="pill-btn" id="btn-folder-reload">⟳ Reload from folder</button>
            <button type="button" class="pill-btn" id="btn-export">⇩ Export library.json</button>
            <button type="button" class="pill-btn" id="btn-export-watch">⇩ Export watch.json</button>
            <button type="button" class="pill-btn" id="btn-import">⇧ Import file</button>
          </div>
          <div class="hint">Drop <b>library.json</b> (titles &amp; covers) in the app's <b>library/</b>
            folder and share that folder — e.g. synced via Google Drive. <b>watch.json</b> holds your
            personal watch history / continue-watching; it's a separate file so sharing it is optional.
            Reload picks up both.</div></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="pill-btn" data-action="close-modal">Cancel <kbd>⎋</kbd></button>
        <button type="submit" class="pill-btn accent">Save <kbd>⏎</kbd></button>
      </div>
    </form>
  </div>`;

  $('#settings-form').addEventListener('submit', e => {
    e.preventDefault();
    const braveKey = $('#f-brave').value.trim();
    const wantsBrave = $('#f-use-brave').checked;
    state.settings = { ...state.settings, model: $('#f-model').value,
      braveKey,
      allowOutsideSuggestions: $('#f-outside').checked,
      useBraveSearch: wantsBrave && Boolean(braveKey),
      groundToLibrary: true,
      groupByGenre: $('#f-group').checked };
    saveSettings();
    syncSuggestionScopeUi();
    closeModal();
    toast(wantsBrave && !braveKey
      ? 'Settings saved — Brave Search is off until you add a key'
      : 'Settings saved ✓');
    render();
  });
  $('#btn-folder-reload').addEventListener('click', async () => {
    if (await loadFromFolder(false)) closeModal();
  });
  $('#btn-clear-watch').addEventListener('click', () => {
    if (!state.watchLog.length) return;
    if (!confirm('Clear everything from Continue Watching? Your library titles will stay saved.')) return;
    removeFromContinueWatching();
    closeModal();
    render();
    toast('Continue Watching cleared');
  });
  const download = (name, obj) => {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)],
        { type: 'application/json' })),
      download: name });
    a.click();
  };
  $('#btn-export').addEventListener('click', () => {
    download('library.json', { library: state.library });
    toast('Downloaded — move it into the app\'s library/ folder');
  });
  $('#btn-export-watch').addEventListener('click', () => {
    download('watch.json', { watchLog: state.watchLog });
    toast('watch.json downloaded — sharing it is optional');
  });
  $('#btn-import').addEventListener('click', importLibraryFile);
  $('#f-model').focus();
}

/* ---------------- Library folder (share it via Google Drive) ---------------- */
export async function loadFromFolder(silent) {
  try {
    const r = await fetch('library/library.json', { cache: 'no-store' });
    if (!r.ok) throw 0;
    const data = await r.json();
    if (!Array.isArray(data.library)) throw 0;
    state.library = data.library;
    saveLibrary();
    try {   // watch history is a separate, optional file — personal by default
      const w = await fetch('library/watch.json', { cache: 'no-store' });
      if (w.ok) {
        const wd = await w.json();
        if (Array.isArray(wd.watchLog)) { state.watchLog = wd.watchLog; store.set('watchLog', state.watchLog); }
      }
    } catch { /* no watch.json — keep local history */ }
    render();
    if (!silent) toast(`Loaded ${state.library.length} title${state.library.length === 1 ? '' : 's'} from library folder ✓`);
    return true;
  } catch {
    if (!silent) toast('No library/library.json found next to the app');
    return false;
  }
}

export function importLibraryFile() {
  const inp = Object.assign(document.createElement('input'),
    { type: 'file', accept: '.json' });
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      let got = false;
      if (Array.isArray(data.library)) { state.library = data.library; saveLibrary(); got = true; }
      if (Array.isArray(data.watchLog)) { state.watchLog = data.watchLog; store.set('watchLog', state.watchLog); got = true; }
      if (!got) throw 0;
      closeModal();
      render();
      toast('Imported ✓');
    } catch { toast('Could not read that file'); }
  };
  inp.click();
}
