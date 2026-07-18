/* Native playback for local files. Chromium can't demux MKV/AVI, so instead of the
   in-app HLS transcode we hand the file to a real media engine that plays everything
   natively: a bundled IINA if present, else system IINA, else mpv, else VLC. */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function firstExisting(paths) {
  for (const p of paths) { try { if (p && fs.existsSync(p)) return p; } catch { /* skip */ } }
  return null;
}

// Pick the best available native player. Prefer a bundled IINA,
// then a system IINA, then mpv / VLC.
function resolvePlayer(resourcesDir) {
  const iina = firstExisting([
    resourcesDir && path.join(resourcesDir, 'iina', 'IINA.app', 'Contents', 'MacOS', 'iina-cli'),
    path.join(__dirname, '..', 'build', 'iina', 'IINA.app', 'Contents', 'MacOS', 'iina-cli'),
    '/Applications/IINA.app/Contents/MacOS/iina-cli'
  ]);
  if (iina) return { kind: 'iina', bin: iina };

  // Resolve system mpv from PATH dynamically
  let mpv = null;
  try {
    const { execSync } = require('child_process');
    const pathBin = execSync('which mpv', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (pathBin && fs.existsSync(pathBin)) {
      mpv = pathBin;
    }
  } catch { /* not in PATH */ }

  if (mpv) return { kind: 'mpv', bin: mpv };
  
  if (fs.existsSync('/Applications/VLC.app')) return { kind: 'vlc' };
  return { kind: 'system' };
}

function launch(bin, args) {
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => { /* surfaced to caller via existence checks */ });
  child.unref();
}

// Play in the best native player. Returns the player kind used.
// playlist: optional array of additional file paths
function playNative(filePath, resourcesDir, title, playlist, pip) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('file not found');
  const player = resolvePlayer(resourcesDir);
  
  if (player.kind === 'iina') {
    const appPath = player.bin.replace('/Contents/MacOS/iina-cli', '');
    const args = ['-a', appPath, filePath];
    launch('open', args);
  } else if (player.kind === 'mpv') {
    const args = [
      '--force-window=yes', '--sub-auto=fuzzy',
      ...(title ? [`--title=${title}`] : []),
      filePath,
      ...(Array.isArray(playlist) ? playlist : [])
    ];
    launch(player.bin, args);
  } else if (player.kind === 'vlc') {
    launch('open', ['-a', 'VLC', filePath]);
  } else {
    launch('open', [filePath]);
  }
  return player.kind;
}

// Option 3: hand off to whatever app the user has set as the default for the file.
function openExternal(filePath) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('file not found');
  launch('open', [filePath]);
  return 'system';
}

module.exports = { resolvePlayer, playNative, openExternal };
