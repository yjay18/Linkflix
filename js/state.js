/* ================= App state & persistence ================= */
import { toast } from './dom.js';

export const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('lf:' + k)) ?? d; } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem('lf:' + k, JSON.stringify(v)); }
    catch { toast('Browser storage is full — change not saved. Try smaller cover images.'); }
  }
};

/* All mutable state that crosses module boundaries lives on this object, so
   modules can reassign properties (imported bindings can't be reassigned). */
export const state = {
  library: store.get('library', []),
  watchLog: store.get('watchLog', []),          // [{itemId, s, e, ts}]
  settings: Object.assign(
    {
      model: 'llama3.2',
      braveKey: '',
      allowOutsideSuggestions: false,
      useBraveSearch: false,
      groupByGenre: true,
      groundToLibrary: true,
      mediaRoots: []
    },
    store.get('settings', {})),
  view: { name: 'home' },
  searchQuery: '',
  conciergeContext: null
};

// migrate / normalise settings: old WebLLM (MLC) model ids -> local Ollama model
if (!state.settings.model || String(state.settings.model).includes('MLC'))
  state.settings.model = 'llama3.2';
state.settings.groundToLibrary = true;            // legacy flag; top scope controls outside suggestions
state.settings.allowOutsideSuggestions = Boolean(state.settings.allowOutsideSuggestions);
state.settings.useBraveSearch = Boolean(state.settings.useBraveSearch && state.settings.braveKey);

export const uid = () => Math.random().toString(36).slice(2, 10);

export function sampleItems(items, limit) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, limit);
}

/* ---- persistence ---- */
let diskSaveTimer = null;
let diskSaveWarned = false;

async function saveLibraryToDisk() {
  try {
    const r = await fetch('/api/save-library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ library: state.library })
    });
    if (!r.ok) throw new Error('autosave failed');
  } catch {
    if (!diskSaveWarned && location.protocol !== 'file:') {
      diskSaveWarned = true;
      toast('Disk autosave is off — launch with Linkflix.command/server.py to write library.json');
    }
  }
}

export function saveLibrary() {
  store.set('library', state.library);
  state.conciergeContext = null;                  // invalidate cached Concierge snapshot
  clearTimeout(diskSaveTimer);
  diskSaveTimer = setTimeout(saveLibraryToDisk, 300);
}

export const saveSettings = () => store.set('settings', state.settings);

saveSettings();
