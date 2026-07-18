/* Native playback for local files. Chromium can't demux MKV/AVI, so instead of the
   in-app HLS transcode we hand the file to a real media engine that plays everything
   natively: a bundled mpv if present, else system mpv, else IINA (which IS mpv),
   else VLC, else the system default app. */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function firstExisting(paths) {
  for (const p of paths) { try { if (p && fs.existsSync(p)) return p; } catch { /* skip */ } }
  return null;
}

// Pick the best available native player. Prefer a bundled mpv (self-contained),
// then a system mpv, then IINA / VLC.
function resolvePlayer(resourcesDir) {
  const mpv = firstExisting([
    resourcesDir && path.join(resourcesDir, 'mpv', 'mpv'),   // bundled
    '/opt/homebrew/bin/mpv', '/usr/local/bin/mpv', '/usr/bin/mpv'
  ]);
  if (mpv) return { kind: 'mpv', bin: mpv };
  const iina = firstExisting(['/Applications/IINA.app/Contents/MacOS/iina-cli']);
  if (iina) return { kind: 'iina', bin: iina };
  if (fs.existsSync('/Applications/VLC.app')) return { kind: 'vlc' };
  return { kind: 'system' };
}

function launch(bin, args) {
  const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => { /* surfaced to caller via existence checks */ });
  child.unref();
}

// Play in the best native player. Returns the player kind used.
// playlist: optional array of additional file paths (e.g. remaining episodes in a season)
function playNative(filePath, resourcesDir, title, playlist) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('file not found');
  const player = resolvePlayer(resourcesDir);
  if (player.kind === 'mpv') {
    // Resolve portable_config location.
    // In the packaged app, it's under resourcesPath/mpv/portable_config.
    // In dev mode, it's under build/mpv/portable_config.
    const configDir = firstExisting([
      resourcesDir && path.join(resourcesDir, 'mpv', 'portable_config'),
      path.join(__dirname, '..', 'build', 'mpv', 'portable_config')
    ]);
    const args = [
      ...(configDir ? [`--config-dir=${configDir}`] : ['--force-window=yes', '--sub-auto=fuzzy']),
      ...(title ? [`--title=${title}`] : []),
      filePath,
      ...(Array.isArray(playlist) ? playlist : [])  // remaining episodes for ⏭
    ];
    launch(player.bin, args);
  } else if (player.kind === 'iina') {
    launch(player.bin, [filePath]);
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
