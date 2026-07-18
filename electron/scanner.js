/* Local media scanner: walk media roots, parse messy file/folder names into
   movie / show-episode candidates. Deterministic heuristics here; the frontend
   falls back to the local LLM for names this can't crack, then matches TVMaze /
   Wikipedia for real metadata. */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const VIDEO_EXT = new Set(['.mkv', '.mp4', '.m4v', '.mov', '.avi', '.webm', '.ts', '.wmv', '.flv', '.mpg', '.mpeg']);

// release/quality noise stripped from titles
const JUNK = new RegExp('\\b(' + [
  '1080p', '2160p', '720p', '480p', '4k', 'uhd', 'hdr', 'sdr', 'x264', 'x265', 'h264', 'h265',
  'hevc', 'avc', 'xvid', 'divx', 'aac', 'aac2', 'ac3', 'eac3', 'dts', 'dd5', 'ddp5', 'truehd',
  'atmos', '5 1', '7 1', 'bluray', 'blu ray', 'brrip', 'bdrip', 'bdremux', 'remux', 'webrip',
  'web dl', 'webdl', 'web', 'hdrip', 'dvdrip', 'dvd', 'hdtv', 'proper', 'repack', 'extended',
  'unrated', 'uncut', 'internal', 'limited', 'amzn', 'nf', 'hmax', 'dsnp', 'atvp', 'yts', 'yify',
  'rarbg', 'evo', 'ettv', 'ntb', 'tgx', 'multi', 'dual', 'dubbed', 'subbed'
].join('|') + ')\\b', 'gi');

const SEASONISH = /^(specials?|season[\s._-]*\d+|s\d{1,2})$/i;

function titleCase(s) {
  return s.split(' ').filter(Boolean).map(w =>
    /^[A-Z0-9]{2,4}$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

function cleanTitle(s) {
  return String(s || '')
    .replace(/[._]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/[()[\]{}]/g, ' ')             // stray brackets/parens
    .replace(JUNK, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')      // stray years
    .replace(/\s+/g, ' ')
    .trim();
}

function showFromDirs(dirs) {
  for (let i = dirs.length - 1; i >= 0; i--)
    if (!SEASONISH.test(dirs[i])) return cleanTitle(dirs[i]);
  return '';
}

function seasonFromDirs(dirs) {
  for (let i = dirs.length - 1; i >= 0; i--) {
    const m = dirs[i].match(/season[\s._-]*(\d{1,2})|^s(\d{1,2})$/i);
    if (m) return +(m[1] || m[2]);
    if (/^specials?$/i.test(dirs[i])) return 0;
  }
  return null;
}

// Parse one video file into a best-guess candidate.
function parseVideo(absPath, root) {
  const rel = path.relative(root, absPath);
  const parts = rel.split(path.sep);
  const file = parts.pop();
  const dirs = parts;
  const base = file.replace(/\.[^.]+$/, '');
  const rawName = file;

  // season/episode: SxxExx, SxxEyy-Ezz, 1x02, "Season 1 Episode 2", or E## with season from folder
  let m = base.match(/[Ss](\d{1,2})[\s._-]*[Ee](\d{1,3})/) ||
          base.match(/\b(\d{1,2})x(\d{1,3})\b/) ||
          base.match(/season[\s._-]*(\d{1,2})[\s._-]*episode[\s._-]*(\d{1,3})/i);
  let season = null, episode = null, markerIdx = -1, markerEnd = -1;
  if (m) { season = +m[1]; episode = +m[2]; markerIdx = m.index; markerEnd = m.index + m[0].length; }
  else {
    // bare "E03" / "Ep 3" with the season coming from a "Season N" folder
    const em = base.match(/\b[Ee]p?[\s._-]*(\d{1,3})\b/);
    const sd = seasonFromDirs(dirs);
    if (em && sd != null) { season = sd; episode = +em[1]; markerIdx = em.index; markerEnd = em.index + em[0].length; }
  }

  if (season != null && episode != null) {
    let show = cleanTitle(base.slice(0, markerIdx));
    if (!show || show.length < 2) show = showFromDirs(dirs);
    const epTitle = cleanTitle(base.slice(markerEnd));
    return {
      kind: 'episode',
      show: titleCase(show) || 'Unknown Show',
      season, episode,
      epTitle: epTitle && epTitle.length > 1 ? titleCase(epTitle) : '',
      rawName, path: absPath
    };
  }

  // movie: pull year, title from text before it (else folder)
  const ym = base.match(/\b(19|20)\d{2}\b/);
  const year = ym ? ym[0] : '';
  let title = cleanTitle(ym ? base.slice(0, ym.index) : base);
  if (!title || title.length < 2) title = showFromDirs(dirs) || cleanTitle(base);
  return { kind: 'movie', title: titleCase(title) || rawName, year, rawName, path: absPath };
}

const EXCLUDE_PATTERN = /\b(extras?|bonus|featurettes?|behind the scenes|deleted scenes|interviews?|trailers?|sample|bloopers?|making of|torrents?)\b/i;

async function walk(dir, out, depth = 0) {
  if (depth > 8) return;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    if (EXCLUDE_PATTERN.test(ent.name)) continue;
    
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(full, out, depth + 1);
    else if (VIDEO_EXT.has(path.extname(ent.name).toLowerCase())) out.push(full);
  }
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Scan roots, returning grouped movie/show candidates. `knownPaths` (Set) marks
// files already linked in the library so the UI can highlight only what's new.
async function scanRoots(roots, knownPaths = new Set()) {
  const flat = [];
  for (const root of roots) {
    try { if (!fs.statSync(root).isDirectory()) continue; } catch { continue; }
    await walk(root, flat, 0);
  }
  const movies = [];
  const showsMap = new Map();

  for (const abs of flat) {
    const root = roots.find(r => abs.startsWith(r + path.sep)) || roots[0];
    const c = parseVideo(abs, root);
    c.isNew = !knownPaths.has(abs);
    if (c.kind === 'movie') movies.push(c);
    else {
      const key = norm(c.show);
      if (!showsMap.has(key)) showsMap.set(key, { show: c.show, episodes: [] });
      showsMap.get(key).episodes.push(c);
    }
  }
  for (const s of showsMap.values())
    s.episodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));

  const shows = [...showsMap.values()];
  const newFiles = flat.filter(f => !knownPaths.has(f)).length;
  return { movies, shows, counts: { files: flat.length, newFiles } };
}

module.exports = { scanRoots, parseVideo };
