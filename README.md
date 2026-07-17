# Linkflix 

Your personal Netflix, powered by your own Google Drive links. Runs locally on your
laptop with no accounts, no databases, no paid APIs. The one-click launcher includes a
tiny local save endpoint so library changes are backed up to disk automatically.

## Run it

**One-click (recommended):**

- **Mac** — double-click **`Linkflix.command`**. It starts the server and opens
  Linkflix at `http://localhost:4173/index.html` in your default browser.
  First time only, macOS may block it: right-click
  the file → *Open* → *Open* (or run `chmod +x Linkflix.command` in Terminal once).
  For a Dock/Desktop shortcut, make an alias: right-click → *Make Alias*, drag it
  wherever you like.
- **Windows** — double-click **`Linkflix.bat`**. Same deal: server starts minimized,
  browser opens by itself. Needs Python from python.org (tick "Add to PATH" when
  installing). For a shortcut: right-click the .bat → *Send to* → *Desktop*, or pin it
  to Start/taskbar via a shortcut.

Close the little server window to stop the app.

**Or the one-liner** (any laptop with Python, with disk autosave):

```sh
python3 server.py
```

(from inside the linkflix folder, then open http://localhost:4173/index.html)

## Features

- **Movies & TV shows** — add titles with cover, subtitle and genre. Shows get seasons,
  each with per-episode titles, subtitles and Drive links.
- **Google Drive playback** — paste any share link (`/file/d/…/view` or `open?id=…`);
  it plays in Drive's embedded player. Share files as "Anyone with the link", or just
  stay signed in to Google in the same browser.
- **Auto-fill from the web** — type a title in the Add dialog and hit *Auto-fill*:
  genre, synopsis and poster come from TVMaze / Wikipedia. For TV shows it also fills
  in **every season, episode title and air date** (with mini-synopses) — you just paste
  your Drive links next to each one. You can click it again while adding or editing a
  show to refresh newly released episodes from TVMaze; links you've already pasted are
  kept. If title search picks the wrong item, paste an exact source first: TVMaze page
  URL / show ID for TV shows, or the movie's Wikipedia page URL / exact page title for
  films. Free, no key.
- **Automatic rows** — the home screen groups titles by explicit genre plus inferred
  categories such as thrillers, sci-fi, family, limited series and long-run shows
  (toggle in Settings).
- **Cover uploads** — upload an image file; it's downscaled and saved inside your
  library data, so it travels with exports.
- **Automatic disk backup** — when launched with `Linkflix.command`, `Linkflix.bat`,
  or `python3 server.py`, every library add/edit/import/delete is also saved to
  `library/library.json`. That file stays ignored by Git so private libraries are not
  uploaded by accident.
- **AI Concierge** — chat for recommendations. Runs 100% locally on your GPU via WebGPU
  (WebLLM). It defaults to **⌂ Library** mode, where even "what should I watch?" stays
  inside titles saved in Linkflix. Library-only recommendation requests use a grounded
  shortlist first: Linkflix scores real saved titles by type, genre, inferred mood tags
  such as funny/dark/mystery/sci-fi, continue-watching state and playable links, then
  shows styled playable cards. Use the top **◎ Outside** icon to allow outside
  suggestions when you explicitly ask for them; without a Brave key those ideas come
  from the model's own film/TV knowledge, and with a Brave key it can add search
  context. Outside titles are clearly marked as not in Linkflix. Ask for a library
  playlist, say "yes", and it turns a curated local-library lineup into styled play
  cards. First message downloads a small model (~0.9 GB) once, then it's cached.
- **Rotating showcase** — the big featured banner picks five random titles on start,
  cycles through them every few seconds, and has arrow + refresh controls for manual
  browsing.
- **Hover previews** — hover any card for a Netflix-style expanded preview: full
  cover, Play (resumes where you left off, or starts episode 1) and a quick
  episode picker for shows.
- **Shared library folder** — Settings → *Export library.json* still works manually,
  but the launcher now keeps `library/library.json` updated for you. Anyone with the
  folder (e.g. synced via Google Drive) runs the same launcher and presses *Reload
  from folder* to get your latest library, covers included. It also loads
  automatically on first run.
- **Private watch history** — Continue Watching is saved locally and exported as a
  separate optional `watch.json`, so sharing your library never shares what you've
  watched unless you drop that file in the folder too.
- **Live search, JSON export/import.**
- **Concierge snapshot refresh** — the AI reads a cached library snapshot when opened;
  every open rebuilds the context from the current library and Continue Watching, and
  the small ⟳ button can refresh it manually too.

## How it works

- **Frontend:** one HTML page (`index.html`), plain CSS (`css/styles.css`) and vanilla
  JavaScript (`js/app.js`). No framework, bundler or build step.
- **Local server:** `server.py` serves the files and exposes one same-origin endpoint,
  `POST /api/save-library`, which atomically writes `library/library.json`. It listens
  on local loopback only. The app still works from a plain static server, but disk
  autosave needs `server.py`.
- **Storage:** browser localStorage is the fast source of truth while the app is open;
  the local server mirrors the library to `library/library.json`. Continue Watching
  stays in localStorage unless you explicitly export/drop in `library/watch.json`.
- **Metadata:** TV shows use TVMaze search/show IDs/episode APIs. Movies use Wikipedia
  page summaries. Both are free and keyless. Brave Search is optional and only used
  for outside-suggestion context when the user enables it and provides a key.
- **AI safety:** Library mode never recommends outside titles. The deterministic
  shortlist returns saved title IDs, and the chat cards are rendered from those IDs so
  playable suggestions stay grounded in your library.

## Controls

Fully mouse-driven. Keyboard shortcuts also work:
`←↑↓→` navigate · `⏎` select · `⎋` back · `/` search · `A` add · `C` concierge · `S` settings

## Notes

- Your library still lives in the browser's localStorage for instant loading, and the
  local launcher mirrors it to `library/library.json`. If you serve the app with plain
  `python3 -m http.server`, the UI works but disk autosave cannot run.
- Privacy: your Brave API key (if you set one) and the Brave yes/no setting are stored
  only in your browser's localStorage. They are never written to `library.json`,
  `watch.json`, exports, or any file in this folder — safe to share the library freely.
- Uploaded covers keep their original quality (very large images are gently resized
  to 1200px). If the browser ever complains storage is full, use image URLs for a
  few covers instead.
- The Concierge needs WebGPU: recent Chrome, Edge or Safari.
