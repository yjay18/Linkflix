This folder holds your local Linkflix library files:

  library.json — your titles, links and covers (share this one if you want)
  watch.json   — your personal watch history / Continue Watching (optional, private)

When you launch Linkflix with Linkflix.command, Linkflix.bat, or
python3 server.py, library changes are automatically mirrored here as
library.json. The app also loads library.json automatically on first run,
and Settings -> "Reload from folder" pulls in the latest version anytime.

watch.json is never autosaved by default. Export/drop it here only if you
want Continue Watching to travel too.

Share/sync this folder, for example via Google Drive, so another copy of
the app can reload the same library.
