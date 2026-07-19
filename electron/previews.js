/* Hover teaser previews: stitch a few short segments of a local file into a tiny,
   silent, low-bitrate MP4 (H.264 — hardware-encoded via VideoToolbox, universal
   playback) and cache it as <dataRoot>/previews/<itemId>.mp4. The hover popup
   loops it Netflix-style instead of showing a static cover. */

const { spawn } = require('child_process');
const fsp = require('fs/promises');
const path = require('path');
const media = require('./media');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const SEGMENTS = 5;          // how many peeks into the file
const SEG_SECONDS = 3;       // length of each peek
const WIDTH = 384;           // tiny — it's a 320px-wide popup

const building = new Map();  // id -> in-flight promise (dedup concurrent builds)

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr.on('data', d => (err += d));
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve()
      : reject(new Error(err.split('\n').filter(Boolean).pop() || `ffmpeg exit ${code}`)));
  });
}

function previewPath(dataRoot, id) {
  // ids are app-generated (alnum), but basename() guards against anything odd
  return path.join(dataRoot, 'previews', path.basename(String(id)) + '.mp4');
}

async function hasPreview(dataRoot, id) {
  try { return (await fsp.stat(previewPath(dataRoot, id))).size > 0; }
  catch { return false; }
}

async function buildPreview(dataRoot, id, file) {
  const out = previewPath(dataRoot, id);
  if (await hasPreview(dataRoot, id)) return out;
  if (building.has(id)) return building.get(id);

  const job = (async () => {
    const info = await media.probe(file);
    const dur = info && info.duration || 0;
    if (dur < 30) throw new Error('file too short for a teaser');

    // segments spread across 8%..85% of the runtime, with a little jitter
    const lo = dur * 0.08, hi = dur * 0.85;
    const ts = Array.from({ length: SEGMENTS }, (_, i) =>
      lo + ((hi - lo) * (i + 0.2 + Math.random() * 0.6)) / SEGMENTS);

    const inputs = [];
    for (const t of ts) inputs.push('-ss', t.toFixed(2), '-t', String(SEG_SECONDS), '-i', file);
    const filter = ts.map((_, i) => `[${i}:v]`).join('') +
      `concat=n=${SEGMENTS}:v=1:a=0,scale=${WIDTH}:-2,fps=24[v]`;

    await fsp.mkdir(path.dirname(out), { recursive: true });
    const tmp = out + '.tmp.mp4';
    const argsFor = codec => ['-hide_banner', '-loglevel', 'error', ...inputs,
      '-filter_complex', filter, '-map', '[v]', '-an', ...codec,
      '-movflags', '+faststart', '-y', tmp];
    try {
      await run(FFMPEG, argsFor(['-c:v', 'h264_videotoolbox', '-b:v', '400k']));
    } catch {   // no VideoToolbox (or it rejected the source) — software fallback
      await run(FFMPEG, argsFor(['-c:v', 'libx264', '-crf', '30', '-preset', 'veryfast']));
    }
    await fsp.rename(tmp, out);
    return out;
  })().finally(() => building.delete(id));
  building.set(id, job);
  return job;
}

module.exports = { buildPreview, hasPreview, previewPath };
