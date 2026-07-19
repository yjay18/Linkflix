/* Hover teaser previews (frontend): a gentle background worker asks the server to
   build a tiny looping clip for every title with a local file, and keeps a registry
   of which previews are ready so the hover popup can swap the static cover for a
   playing teaser. */

import { state } from './state.js';

const ready = new Set();
const failed = new Set();
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const previewUrl = id => `/preview/${encodeURIComponent(id)}.mp4`;
export const hasPreview = id => ready.has(id);

function hasLocalSource(item) {
  return !!(item.localPath ||
    (item.seasons || []).some(s => (s.episodes || []).some(ep => ep.localPath)));
}

async function ensureOne(item) {
  if (ready.has(item.id) || failed.has(item.id)) return;
  try {                                      // already cached on disk?
    const head = await fetch(previewUrl(item.id), { method: 'HEAD' });
    if (head.ok) { ready.add(item.id); return; }
  } catch { /* fall through to build */ }
  try {
    const r = await fetch('/api/preview/build', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id })
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.ok) ready.add(item.id);
    else failed.add(item.id);                // too short / file missing — don't retry
  } catch { failed.add(item.id); }
}

export async function startPreviewWorker() {
  await sleep(8000);                         // let boot, tagging, embeddings settle first
  for (;;) {
    for (const item of state.library.filter(hasLocalSource)) {
      await ensureOne(item);
      await sleep(2000);                     // one at a time, gently
    }
    await sleep(10 * 60 * 1000);             // re-sweep for newly scanned titles
  }
}
