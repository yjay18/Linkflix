/* Native <video> player for local files. The server transcodes/remuxes to HLS;
   Chromium (Electron) plays it via hls.js, Safari/WKWebView plays HLS natively.
   Embedded text subtitles are exposed as <track> elements (native CC menu). */

import { $ } from './dom.js';

let hlsLib = null;
let currentHls = null;

async function loadHls() {
  if (hlsLib) return hlsLib;
  const mod = await import('./vendor/hls.mjs');
  hlsLib = mod.default || mod.Hls;
  return hlsLib;
}

export function destroyLocalPlayer() {
  if (currentHls) {
    try { currentHls.destroy(); } catch { /* already gone */ }
    currentHls = null;
  }
}

export async function initLocalPlayer(id, s = 0, e = 0) {
  const video = $('#local-video');
  if (!video) return;
  const enc = encodeURIComponent(id);
  const base = `/hls/${enc}/${s}/${e}`;
  const src = `${base}/index.m3u8`;
  const status = t => { const el = $('#player-status'); if (el) el.textContent = t || ''; };
  status('Preparing stream…');
  video.addEventListener('playing', () => status(''), { once: true });
  video.addEventListener('canplay', () => status(''), { once: true });

  // subtitle tracks come from the probe
  let subs = [];
  try {
    const info = await fetch(`/probe/${enc}/${s}/${e}`).then(r => r.json());
    if (info && info.ok) subs = info.subs || [];
  } catch { /* no subs */ }

  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;                                   // Safari / WKWebView native HLS
  } else {
    const Hls = await loadHls();
    if (Hls && Hls.isSupported()) {
      destroyLocalPlayer();
      const hls = new Hls({ maxBufferLength: 30, enableWorker: true });
      currentHls = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => status(''));
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) status('Playback error: ' + (data.details || 'unknown') +
          ' — the file may use a codec ffmpeg could not transcode.');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src;                                 // last-ditch attempt
    }
  }

  for (const sub of subs) {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.lang || `Track ${sub.index}`;
    track.srclang = 'und';
    track.src = `/subs/${enc}/${s}/${e}/${sub.index}.vtt`;
    video.appendChild(track);
  }
  // show the first subtitle track by default
  video.addEventListener('loadedmetadata', () => {
    if (video.textTracks && video.textTracks[0]) video.textTracks[0].mode = 'showing';
  }, { once: true });

  video.play().catch(() => { /* autoplay may be blocked; user can hit play */ });
}
