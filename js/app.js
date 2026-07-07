/* ================= Linkflix ================= */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('lf:' + k)) ?? d; } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem('lf:' + k, JSON.stringify(v)); }
    catch { toast('Browser storage is full — change not saved. Try smaller cover images.'); }
  }
};

/* ---------------- State ---------------- */
let library  = store.get('library', []);
let watchLog = store.get('watchLog', []);      // [{itemId, s, e, ts}]
let settings = Object.assign(
  {
    model: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    braveKey: '',
    allowOutsideSuggestions: false,
    useBraveSearch: false,
    groupByGenre: true,
    groundToLibrary: true
  },
  store.get('settings', {}));
if (!String(settings.model).includes('MLC'))          // migrate old settings
  settings.model = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
settings.groundToLibrary = true;                      // legacy flag; top scope controls outside suggestions
settings.allowOutsideSuggestions = Boolean(settings.allowOutsideSuggestions);
settings.useBraveSearch = Boolean(settings.useBraveSearch && settings.braveKey);
let chatLog  = store.get('chat', []);          // [{role, text}]
let pendingPlaylist = store.get('pendingPlaylist', null);
let view = { name: 'home' };
let searchQuery = '';

const saveLibrary = () => store.set('library', library);
const saveSettings = () => store.set('settings', settings);
const saveChat = () => { chatLog = chatLog.slice(-40); store.set('chat', chatLog); };
const savePendingPlaylist = () => store.set('pendingPlaylist', pendingPlaylist);
const uid = () => Math.random().toString(36).slice(2, 10);
saveSettings();

function sampleItems(items, limit) {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, limit);
}

/* ---------------- Google Drive helpers ---------------- */
function driveFileId(link) {
  const m = String(link || '').match(/\/file\/d\/([\w-]{10,})/) ||
            String(link || '').match(/[?&]id=([\w-]{10,})/);
  return m ? m[1] : null;
}
function embedUrl(link) {
  const id = driveFileId(link);
  return id ? `https://drive.google.com/file/d/${id}/preview` : link;
}

/* ---------------- Covers (data-URLs stored right in the library JSON) ---------------- */
function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

// keep the original file untouched when it's reasonably sized; only very large
// images get resized (still generous: 1200px wide, 90% quality)
async function coverFromFile(file) {
  if (file.size <= 400 * 1024) return fileToDataUrl(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('bad image')); };
    img.src = URL.createObjectURL(file);
  });
}

/* ---------------- Visual helpers ---------------- */
const coverSrc = item => item.cover || '';

const PALETTES = [
  ['#5b3df0', '#b8367a'], ['#0e5aa8', '#4fd1ff'], ['#b8367a', '#ff9d5c'],
  ['#1c8f6e', '#4fd1ff'], ['#8b7bff', '#ff5c8a'], ['#d97b28', '#8b2f8f']
];
function gradientFor(seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = PALETTES[h % PALETTES.length];
  return `linear-gradient(140deg, ${a}, ${b})`;
}
function coverHtml(item) {
  const src = coverSrc(item);
  return `<div class="cover" style="background:${gradientFor(item.title)}">
    ${src ? `<img src="${esc(src)}" alt="" loading="lazy"
      onerror="this.remove()">` : ''}
    <div class="cover-fallback">${esc((item.title || '?')[0].toUpperCase())}</div>
    <span class="type-tag">${item.type === 'show' ? 'SERIES' : 'FILM'}</span>
  </div>`;
}

function toast(msg) {
  $$('.toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast glass';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function syncSuggestionScopeUi() {
  const outside = settings.allowOutsideSuggestions;
  const btn = $('#btn-scope');
  if (btn) {
    btn.classList.toggle('outside', outside);
    btn.textContent = outside ? '◎ Outside' : '⌂ Library';
    btn.title = outside
      ? 'Outside suggestions enabled'
      : 'Library-only suggestions';
  }
  $('#chat-scope-library')?.classList.toggle('active', !outside);
  $('#chat-scope-outside')?.classList.toggle('active', outside);
  const sub = $('#chat-sub');
  if (sub) sub.textContent = outside
    ? (settings.useBraveSearch && settings.braveKey
      ? 'Outside suggestions · Brave context on'
      : 'Outside suggestions · model knowledge')
    : 'Runs locally on your GPU · library-only';
  const input = $('#chat-input');
  if (input) input.placeholder = outside
    ? 'Ask for library or outside ideas…'
    : 'Ask from your library…';
}

function setOutsideSuggestions(enabled) {
  settings.allowOutsideSuggestions = Boolean(enabled);
  saveSettings();
  syncSuggestionScopeUi();
  if (!$('#chat-panel')?.hidden) renderChat();
  toast(settings.allowOutsideSuggestions
    ? (settings.useBraveSearch && settings.braveKey
      ? 'Outside suggestions on — Brave context enabled'
      : 'Outside suggestions on — using model knowledge')
    : 'Library-only suggestions on');
}

/* ---------------- Dates ---------------- */
function formatDate(date) {
  const s = String(date || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function formatShowDates(item) {
  if (item?.dates) return item.dates;
  const start = item?.premiered || '';
  const end = item?.ended || '';
  if (start && end) return `${formatDate(start)} - ${formatDate(end)}`;
  if (start && item?.status && !/ended/i.test(item.status))
    return `${formatDate(start)} - ${item.status}`;
  return start ? formatDate(start) : '';
}

function episodeMeta(ep) {
  return [ep.airdate && formatDate(ep.airdate), ep.subtitle].filter(Boolean).join(' · ');
}

/* ---------------- Library intelligence ---------------- */
const GENRE_ALIASES = {
  'sci fi': 'Sci-Fi & Fantasy',
  'sci-fi': 'Sci-Fi & Fantasy',
  'science fiction': 'Sci-Fi & Fantasy',
  'fantasy': 'Sci-Fi & Fantasy',
  'thriller': 'Thrillers',
  'mystery': 'Crime & Mystery',
  'crime': 'Crime & Mystery',
  'detective': 'Crime & Mystery',
  'romcom': 'Romance',
  'rom-com': 'Romance',
  'family': 'Family',
  'kids': 'Family',
  'children': 'Family',
  'stand up': 'Stand-Up & Variety',
  'stand-up': 'Stand-Up & Variety'
};

const CATEGORY_RULES = [
  ['Action & Adventure', /\b(action|adventure|superhero|spy|martial|mission|quest|battle|war|survival)\b/i],
  ['Comedy', /\b(comedy|comic|funny|sitcom|satire|parody)\b/i],
  ['Drama', /\b(drama|dramatic|family saga|coming.of.age|period)\b/i],
  ['Sci-Fi & Fantasy', /\b(sci.?fi|science fiction|fantasy|space|alien|future|supernatural|magic|dystopia|time travel)\b/i],
  ['Thrillers', /\b(thriller|suspense|tense|paranoid|survival|conspiracy)\b/i],
  ['Crime & Mystery', /\b(crime|mystery|detective|murder|heist|investigation|noir|serial killer)\b/i],
  ['Horror', /\b(horror|scary|haunted|ghost|monster|slasher|zombie|vampire)\b/i],
  ['Romance', /\b(romance|romantic|love story|rom-com|relationship)\b/i],
  ['Animation', /\b(animation|animated|anime|cartoon)\b/i],
  ['Family', /\b(family|kids|children|all ages)\b/i],
  ['Documentaries', /\b(documentary|docuseries|true story|biography|nature)\b/i],
  ['Reality & Competition', /\b(reality|competition|contest|cooking|makeover|dating)\b/i],
  ['Stand-Up & Variety', /\b(stand.?up|variety|sketch|special)\b/i],
  ['Music & Musicals', /\b(music|musical|concert|band|singer)\b/i],
  ['Sports', /\b(sport|football|basketball|soccer|tennis|boxing|racing)\b/i]
];

const CATEGORY_ORDER = [
  'Action & Adventure', 'Comedy', 'Drama', 'Sci-Fi & Fantasy', 'Thrillers',
  'Crime & Mystery', 'Horror', 'Romance', 'Animation', 'Family',
  'Documentaries', 'Reality & Competition', 'Stand-Up & Variety',
  'Music & Musicals', 'Sports', 'Limited Series', 'Long-Run Shows'
];

function labelCase(raw) {
  const clean = String(raw || '').replace(/\s+/g, ' ').trim();
  const key = clean.toLowerCase().replace(/[&/]+/g, ' ').replace(/\s+/g, ' ');
  if (!clean) return '';
  if (GENRE_ALIASES[key]) return GENRE_ALIASES[key];
  return clean.split(' ').map(w => {
    const lower = w.toLowerCase();
    if (['tv', 'ii', 'iii', 'iv'].includes(lower)) return lower.toUpperCase();
    if (['and', 'or', 'of', 'the'].includes(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

function explicitGenreLabels(item) {
  return [...new Set(String(item.genre || '')
    .split(/[,·|/]/)
    .map(labelCase)
    .filter(Boolean))];
}

function episodeCount(item) {
  return (item.seasons || []).reduce((n, s) => n + (s.episodes || []).length, 0);
}

function itemText(item) {
  const episodes = (item.seasons || []).flatMap(s => (s.episodes || [])
    .flatMap(ep => [ep.title, ep.subtitle, ep.airdate])).filter(Boolean).slice(0, 30).join(' ');
  return [item.title, item.genre, item.subtitle, formatShowDates(item), item.type, episodes]
    .filter(Boolean).join(' ');
}

function itemCategories(item) {
  const text = itemText(item);
  const labels = new Set(explicitGenreLabels(item));
  for (const [label, re] of CATEGORY_RULES)
    if (re.test(text)) labels.add(label);
  if (item.type === 'movie') labels.add('Movies');
  if (item.type === 'show') {
    labels.add('TV Shows');
    const eps = episodeCount(item);
    if (eps && eps <= 10) labels.add('Limited Series');
    if (eps >= 30) labels.add('Long-Run Shows');
  }
  return [...labels];
}

function playablePosition(item) {
  if (!item) return null;
  if (item.type === 'movie') return driveFileId(item.link) ? { s: 0, e: 0 } : null;
  for (let s = 0; s < (item.seasons || []).length; s++) {
    const episodes = item.seasons[s].episodes || [];
    for (let e = 0; e < episodes.length; e++)
      if (driveFileId(episodes[e].link)) return { s, e };
  }
  return null;
}

function isPlayable(item) {
  return Boolean(playablePosition(item));
}

/* ================= Views ================= */
function render() {
  hidePop();
  const main = $('#view');
  if (view.name === 'home')   main.innerHTML = homeHtml();
  if (view.name === 'detail') main.innerHTML = detailHtml(view.id);
  if (view.name === 'player') { main.innerHTML = playerHtml(view); }
  bindView();
  focusFirst();
}

/* ---------- Home ---------- */
function matches(item) {
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  return (item.title + ' ' + (item.subtitle || '') + ' ' + (item.genre || '') + ' ' +
    formatShowDates(item) + ' ' + itemText(item))
    .toLowerCase().includes(q);
}

function cardHtml(item, sub) {
  return `<button class="card focusable" data-open="${item.id}">
    ${coverHtml(item)}
    <div class="card-label">
      <div class="card-title">${esc(item.title)}</div>
      <div class="card-sub">${esc(sub ?? item.subtitle ?? (item.type === 'show'
        ? `${(item.seasons || []).length} season${(item.seasons || []).length === 1 ? '' : 's'}`
        : 'Movie'))}</div>
    </div>
  </button>`;
}

function rowHtml(title, items, subFn) {
  if (!items.length) return '';
  return `<section class="row-section">
    <div class="row-title">${esc(title)}<span class="count">${items.length}</span></div>
    <div class="row-wrap">
      <button class="row-arrow left" data-scroll="-1" title="Scroll left">‹</button>
      <div class="row" data-navrow>${items.map(i => cardHtml(i, subFn && subFn(i))).join('')}</div>
      <button class="row-arrow right" data-scroll="1" title="Scroll right">›</button>
    </div>
  </section>`;
}

function groupedRowsHtml(items) {
  const rows = new Map();
  for (const item of items) {
    for (const label of itemCategories(item)) {
      if (label === 'Movies' || label === 'TV Shows') continue;
      if (!rows.has(label)) rows.set(label, []);
      const bucket = rows.get(label);
      if (!bucket.some(i => i.id === item.id)) bucket.push(item);
    }
  }
  return [...rows.entries()]
    .map(([label, rowItems]) => ({
      label,
      items: rowItems,
      order: CATEGORY_ORDER.indexOf(label)
    }))
    .sort((a, b) =>
      (a.order < 0 ? 999 : a.order) - (b.order < 0 ? 999 : b.order) ||
      b.items.length - a.items.length ||
      a.label.localeCompare(b.label))
    .map(g => rowHtml(g.label, g.items))
    .join('');
}

/* ---------- Hero (rotates through your titles every so often) ---------- */
let heroPool = [], heroIndex = 0, heroTimer = null;

function heroHtml(item) {
  const resume = watchLog.some(w => w.itemId === item.id);
  const dates = formatShowDates(item);
  return `<section class="hero glass">
    <div class="hero-backdrop" style="background:${coverSrc(item)
      ? `url('${esc(coverSrc(item))}') center/cover` : gradientFor(item.title)}"></div>
    <button class="hero-side hero-side-left focusable" data-hero-prev title="Previous featured title" aria-label="Previous featured title">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5"/></svg>
    </button>
    <button class="hero-side hero-side-right focusable" data-hero-next title="Next featured title" aria-label="Next featured title">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6.5 5.5 5.5-5.5 5.5"/></svg>
    </button>
    <button class="hero-refresh focusable" data-hero-refresh title="Refresh featured picks" aria-label="Refresh featured picks">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.6 7.2A7.2 7.2 0 1 0 19 12"/><path d="M17.6 3.8v3.4H21"/></svg>
    </button>
    <div class="hero-cover card" style="cursor:default">${coverHtml(item)}</div>
    <div class="hero-info">
      <div class="badges">
        <span class="badge">${item.type === 'show' ? 'Series' : 'Film'}</span>
        ${item.genre ? `<span class="badge">${esc(item.genre)}</span>` : ''}
        ${dates ? `<span class="badge">${esc(dates)}</span>` : ''}
        ${item.type === 'show' ? `<span class="badge">${(item.seasons || []).length} seasons</span>` : ''}
      </div>
      <h1>${esc(item.title)}</h1>
      <p class="hero-sub">${esc(item.subtitle || 'From your personal collection.')}</p>
      <div class="hero-actions" data-navrow>
        <button class="pill-btn accent focusable" data-play-featured="${item.id}">▶ ${resume ? 'Resume' : 'Play'}</button>
        <button class="pill-btn focusable" data-open="${item.id}">Details</button>
      </div>
    </div>
  </section>`;
}

function buildHeroPool(items, force = false) {
  const ids = new Set(items.map(i => i.id));
  heroPool = heroPool.filter(id => ids.has(id));
  if (!force && heroPool.length) {
    heroIndex %= heroPool.length;
    return;
  }
  heroPool = sampleItems(items, 5).map(i => i.id);
  heroIndex = 0;
}

function currentHeroItem() {
  return library.find(i => i.id === heroPool[heroIndex]);
}

function updateHeroSlot() {
  const slot = $('#hero-slot');
  const item = currentHeroItem();
  if (!slot || !item) return;
  const hadFocus = slot.contains(document.activeElement);
  slot.innerHTML = heroHtml(item);
  if (hadFocus) $('.focusable', slot)?.focus();
}

function moveHero(delta) {
  if (!heroPool.length) return;
  heroIndex = (heroIndex + delta + heroPool.length) % heroPool.length;
  updateHeroSlot();
}

function refreshHeroPool(showToast = false) {
  const items = library.filter(matches);
  if (!items.length || searchQuery) return;
  buildHeroPool(items, true);
  updateHeroSlot();
  scheduleHeroRotation();
  if (showToast) toast(`Refreshed ${heroPool.length} featured pick${heroPool.length === 1 ? '' : 's'} ✓`);
}

function scheduleHeroRotation() {
  clearInterval(heroTimer);
  if (heroPool.length < 2) return;
  heroTimer = setInterval(() => {
    const slot = $('#hero-slot');
    if (!slot || view.name !== 'home') { clearInterval(heroTimer); return; }
    if (slot.matches(':hover')) return;             // paused while you're looking at it
    moveHero(1);
  }, 12000);
}

function homeHtml() {
  const items = library.filter(matches);
  if (!library.length) {
    return `<div class="empty glass">
      <div class="big">🎬</div>
      <h2>Welcome to Linkflix</h2>
      <p>Your personal cinema. Add a movie or show with a Google Drive link —
         or load a shared library.</p>
      <div class="hero-actions" data-navrow>
        <button class="pill-btn accent focusable" data-action="add">＋ Add your first title <kbd>A</kbd></button>
        <button class="pill-btn focusable" data-action="scan">⟳ Scan library folder</button>
        <button class="pill-btn focusable" data-action="import">⇧ Import JSON</button>
      </div>
    </div>`;
  }

  const continueItems = [];
  for (const log of watchLog) {
    const item = library.find(i => i.id === log.itemId);
    if (item && matches(item) && !continueItems.some(c => c.item.id === item.id))
      continueItems.push({ item, log });
  }

  let hero = '';
  if (items.length && !searchQuery) {
    buildHeroPool(items);
    const featured = currentHeroItem() || items[0];
    hero = `<div id="hero-slot">${heroHtml(featured)}</div>`;
    scheduleHeroRotation();
  } else clearInterval(heroTimer);

  const cw = rowHtml('Continue Watching', continueItems.map(c => c.item), item => {
    const log = continueItems.find(c => c.item.id === item.id).log;
    return item.type === 'show' ? `S${log.s + 1} · E${log.e + 1}` : 'Resume';
  });

  let genreRows = '';
  if (settings.groupByGenre) genreRows = groupedRowsHtml(items);

  const body =
    hero + cw + genreRows +
    rowHtml('Movies', items.filter(i => i.type === 'movie')) +
    rowHtml('TV Shows', items.filter(i => i.type === 'show'));

  return body || `<div class="empty glass"><div class="big">⌕</div>
    <h2>No matches for “${esc(searchQuery)}”</h2><p>Try a different search.</p></div>`;
}

/* ---------- Detail ---------- */
function detailHtml(id) {
  const item = library.find(i => i.id === id);
  if (!item) { view = { name: 'home' }; return homeHtml(); }
  const dates = formatShowDates(item);
  const inContinueWatching = watchLog.some(w => w.itemId === item.id);

  const head = `<section class="hero glass">
    <div class="hero-backdrop" style="background:${coverSrc(item)
      ? `url('${esc(coverSrc(item))}') center/cover` : gradientFor(item.title)}"></div>
    <div class="hero-cover card" style="cursor:default">${coverHtml(item)}</div>
    <div class="hero-info">
      <div class="badges">
        <span class="badge">${item.type === 'show' ? 'Series' : 'Film'}</span>
        ${item.genre ? `<span class="badge">${esc(item.genre)}</span>` : ''}
        ${dates ? `<span class="badge">${esc(dates)}</span>` : ''}
      </div>
      <h1>${esc(item.title)}</h1>
      <p class="hero-sub">${esc(item.subtitle || '')}</p>
      <div class="hero-actions" data-navrow>
        ${item.type === 'movie'
          ? `<button class="pill-btn accent focusable" data-play="${item.id}">▶ Play</button>` : ''}
        ${inContinueWatching
          ? `<button class="pill-btn focusable" data-clear-watch="${item.id}">Remove from Continue Watching</button>` : ''}
        <button class="pill-btn focusable" data-edit="${item.id}">✎ Edit</button>
        <button class="pill-btn danger focusable" data-delete="${item.id}">🗑 Delete</button>
        <button class="pill-btn focusable" data-action="back">← Back <kbd>⎋</kbd></button>
      </div>
    </div>
  </section>`;

  let body = '';
  if (item.type === 'show') {
    const seasons = item.seasons || [];
    const selectedSeason = Math.min(Math.max(+(view.season ?? 0), 0), Math.max(0, seasons.length - 1));
    const season = seasons[selectedSeason];
    body = `<div class="detail-body">
      ${seasons.length > 1 ? `<div class="season-picker glass">
        <label for="season-select">Season</label>
        <select id="season-select" class="focusable" data-season-select>
          ${seasons.map((s, si) => `<option value="${si}" ${si === selectedSeason ? 'selected' : ''}>
            ${esc(s.name || `Season ${si + 1}`)} · ${(s.episodes || []).length} episodes
          </option>`).join('')}
        </select>
      </div>` : ''}
      <div class="season-block">
        <div class="season-title">${esc(season?.name || `Season ${selectedSeason + 1}`)}</div>
        <div class="ep-list" data-navrow>
          ${(season?.episodes || []).map((ep, ei) => `
            <button class="ep-btn focusable" data-play="${item.id}" data-s="${selectedSeason}" data-e="${ei}">
              <span class="ep-num">${ei + 1}</span>
              <span class="ep-info">
                <div class="ep-title">${esc(ep.title || `Episode ${ei + 1}`)}</div>
                ${episodeMeta(ep) ? `<div class="ep-sub">${esc(episodeMeta(ep))}</div>` : ''}
              </span>
              <span class="ep-play">▶</span>
            </button>`).join('')}
        </div>
      </div>
    </div>`;
  }
  return head + body;
}

/* ---------- Player ---------- */
function playerHtml({ id, s, e }) {
  const item = library.find(i => i.id === id);
  if (!item) { view = { name: 'home' }; return homeHtml(); }
  let link = item.link, sub = 'Movie';
  if (item.type === 'show') {
    const ep = item.seasons?.[s]?.episodes?.[e];
    link = ep?.link;
    sub = `S${s + 1} · E${e + 1}${ep?.title ? ' — ' + ep.title : ''}${ep?.airdate ? ` · ${formatDate(ep.airdate)}` : ''}`;
  }
  // log for Continue Watching
  watchLog = [{ itemId: id, s: s ?? 0, e: e ?? 0, ts: Date.now() },
    ...watchLog.filter(w => w.itemId !== id)].slice(0, 20);
  store.set('watchLog', watchLog);

  const src = embedUrl(link);
  const valid = driveFileId(link);
  return `<div class="player">
    <div class="player-top glass">
      <button class="pill-btn small focusable" data-action="back">← Back <kbd>⎋</kbd></button>
      <span class="pt-title">${esc(item.title)}</span>
      <span class="pt-sub">${esc(sub)}</span>
    </div>
    ${valid
      ? `<iframe src="${esc(src)}" allow="autoplay; fullscreen" allowfullscreen></iframe>`
      : `<div class="empty" style="margin:auto"><div class="big">⚠️</div>
          <h2>That doesn't look like a Google Drive link</h2>
          <p>${esc(link || 'No link set for this title.')}</p></div>`}
  </div>`;
}

function rememberWatchPosition(id, s = 0, e = 0) {
  watchLog = [{ itemId: id, s, e, ts: Date.now() },
    ...watchLog.filter(w => w.itemId !== id)].slice(0, 20);
  store.set('watchLog', watchLog);
}

function removeFromContinueWatching(id) {
  const before = watchLog.length;
  watchLog = id ? watchLog.filter(w => w.itemId !== id) : [];
  store.set('watchLog', watchLog);
  return watchLog.length !== before;
}

function openDriveLink(link) {
  window.location.href = link;
  return true;
}

function playEpisode(id, s = 0, e = 0) {
  const item = library.find(i => i.id === id);
  const ep = item?.seasons?.[s]?.episodes?.[e];
  if (!item || item.type !== 'show') return false;
  if (!driveFileId(ep?.link)) {
    toast('That episode needs a valid Google Drive link first.');
    return false;
  }
  rememberWatchPosition(id, s, e);
  if (!openDriveLink(ep?.link)) return false;
  return true;
}

/* ================= Modals ================= */
function closeModal() { $('#modal-root').innerHTML = ''; focusFirst(); }
function modalOpen() { return !!$('#modal-root').firstElementChild; }

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

function openAddModal(editId = null) {
  const item = editId ? library.find(i => i.id === editId) : null;
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
    if (item) library = library.map(i => i.id === item.id ? data : i);
    else library.unshift(data);

    saveLibrary();
    closeModal();
    toast(item ? 'Saved ✓' : `Added “${data.title}” ✓`);
    render();
  });

  $('#f-title').focus();
}

/* ---------- Settings ---------- */
function openSettings() {
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
              `<option value="${id}" ${settings.model === id ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
          <div class="hint">Downloads once via WebGPU, then cached in your browser. No API, no account.</div></div>
        <div class="field"><label>Concierge</label>
          <label class="check-row"><input type="checkbox" id="f-outside"
            ${settings.allowOutsideSuggestions ? 'checked' : ''}> Allow outside suggestions when I turn them on
            <span class="hint" style="margin:0">(top ◎ icon — outside titles are not playable cards)</span></label>
          <label class="check-row"><input type="checkbox" id="f-use-brave"
            ${settings.useBraveSearch ? 'checked' : ''}> Yes, use Brave Search when I ask for web context</label>
          <input id="f-brave" value="${esc(settings.braveKey || '')}"
            placeholder="Brave Search API key (optional)" style="margin-top:8px">
          <div class="hint">With ⌂ Library active, recommendations stay inside your saved titles.
            With ◎ Outside active, no Brave key means the model uses its own film/TV knowledge;
            with a Brave key, it can add search context.</div></div>
        <div class="field"><label>Behaviour</label>
          <label class="check-row"><input type="checkbox" id="f-group"
            ${settings.groupByGenre ? 'checked' : ''}> Group home rows by genre automatically</label></div>
        <div class="field"><label>Continue Watching</label>
          <div class="hero-actions">
            <button type="button" class="pill-btn danger" id="btn-clear-watch"
              ${watchLog.length ? '' : 'disabled'}>Clear Continue Watching</button>
          </div>
          <div class="hint">${watchLog.length
            ? `This removes ${watchLog.length} saved progress entr${watchLog.length === 1 ? 'y' : 'ies'} from this browser.`
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
    settings = { ...settings, model: $('#f-model').value,
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
    if (!watchLog.length) return;
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
    download('library.json', { library });
    toast('Downloaded — move it into the app\'s library/ folder');
  });
  $('#btn-export-watch').addEventListener('click', () => {
    download('watch.json', { watchLog });
    toast('watch.json downloaded — sharing it is optional');
  });
  $('#btn-import').addEventListener('click', importLibraryFile);
  $('#f-model').focus();
}

/* ---------------- Library folder (share it via Google Drive) ---------------- */
async function loadFromFolder(silent) {
  try {
    const r = await fetch('library/library.json', { cache: 'no-store' });
    if (!r.ok) throw 0;
    const data = await r.json();
    if (!Array.isArray(data.library)) throw 0;
    library = data.library;
    saveLibrary();
    try {   // watch history is a separate, optional file — personal by default
      const w = await fetch('library/watch.json', { cache: 'no-store' });
      if (w.ok) {
        const wd = await w.json();
        if (Array.isArray(wd.watchLog)) { watchLog = wd.watchLog; store.set('watchLog', watchLog); }
      }
    } catch { /* no watch.json — keep local history */ }
    render();
    if (!silent) toast(`Loaded ${library.length} title${library.length === 1 ? '' : 's'} from library folder ✓`);
    return true;
  } catch {
    if (!silent) toast('No library/library.json found next to the app');
    return false;
  }
}

function importLibraryFile() {
  const inp = Object.assign(document.createElement('input'),
    { type: 'file', accept: '.json' });
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      let got = false;
      if (Array.isArray(data.library)) { library = data.library; saveLibrary(); got = true; }
      if (Array.isArray(data.watchLog)) { watchLog = data.watchLog; store.set('watchLog', watchLog); got = true; }
      if (!got) throw 0;
      closeModal();
      render();
      toast('Imported ✓');
    } catch { toast('Could not read that file'); }
  };
  inp.click();
}

/* ================= Web lookup (free — TVMaze + Wikipedia, optional Brave) ================= */
const stripTags = s => String(s || '').replace(/<[^>]+>/g, '').trim();
const withTimeout = (p, ms = 5000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function searchTVMaze(q) {
  const r = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  return (await r.json()).slice(0, 5).map(x => tvmazeShowInfo(x.show));
}

async function tvmazeShow(showId) {
  const r = await fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(showId)}`);
  if (!r.ok) return null;
  return tvmazeShowInfo(await r.json());
}

function tvmazeShowInfo(show) {
  return {
    id: show.id,
    title: show.name,
    year: (show.premiered || '').slice(0, 4),
    premiered: show.premiered || '',
    ended: show.ended || '',
    status: show.status || '',
    genres: show.genres || [],
    summary: stripTags(show.summary),
    image: show.image?.medium || ''
  };
}

/* full episode list for a TVMaze show id — keyless, grouped by season */
async function tvmazeEpisodes(showId) {
  const r = await fetch(`https://api.tvmaze.com/shows/${showId}/episodes`);
  if (!r.ok) return [];
  const bySeason = {};
  for (const e of await r.json()) {
    (bySeason[e.season] ??= []).push({
      tvmazeId: e.id || '',
      season: e.season,
      number: e.number || '',
      title: e.name || `Episode ${e.number}`,
      airdate: e.airdate || '',
      subtitle: stripTags(e.summary)
    });
  }
  return Object.keys(bySeason).sort((a, b) => a - b)
    .map(n => ({ name: n === '0' ? 'Specials' : `Season ${n}`, episodes: bySeason[n] }));
}

async function wikiSummary(title) {
  const sum = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' +
    encodeURIComponent(title)).then(r => r.json());
  return { title: sum.title, summary: sum.extract || '',
    image: sum.thumbnail?.source || '', genres: null, wikiTitle: sum.title };
}

async function wikiLookup(q) {
  const s = await fetch('https://en.wikipedia.org/w/api.php?action=opensearch' +
    `&search=${encodeURIComponent(q)}&limit=1&origin=*&format=json`).then(r => r.json());
  const title = s[1]?.[0];
  if (!title) return null;
  return wikiSummary(title);
}

async function braveSearch(q) {
  if (!settings.useBraveSearch || !settings.braveKey) return null;
  const r = await fetch('https://api.search.brave.com/res/v1/web/search' +
    `?q=${encodeURIComponent(q)}&count=5`,
    { headers: { 'X-Subscription-Token': settings.braveKey, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Brave search: HTTP ${r.status}`);
  const d = await r.json();
  return (d.web?.results || []).map(x =>
    ({ title: x.title, desc: stripTags(x.description), url: x.url }));
}

function wantsWebContext(text) {
  return /\b(search|web|lookup|look up|current|latest|new|news|brave)\b/i.test(text);
}

async function braveContext(query) {
  const results = await withTimeout(braveSearch(query), 6000);
  if (!results?.length) return '';
  return 'Brave Search results for optional recommendation context:\n' +
    results.map(x => `- ${x.title}: ${x.desc.slice(0, 200)}`).join('\n');
}

/* ================= AI Concierge ================= */
function toggleChat(open) {
  const panel = $('#chat-panel');
  panel.hidden = open === undefined ? !panel.hidden : !open;
  if (!panel.hidden) {
    conciergeSnapshot();
    renderChat();
    $('#chat-input').focus();
  }
  else focusFirst();
}

function renderChat() {
  syncSuggestionScopeUi();
  const box = $('#chat-messages');
  if (!chatLog.length) {
    const outside = settings.allowOutsideSuggestions;
    box.innerHTML = `<div class="msg assistant">Hi! I'm your concierge — I run 100% in your
browser on your GPU. ${outside
  ? `Outside suggestions are <b>enabled</b>. ${settings.useBraveSearch && settings.braveKey
    ? 'I can use Brave context when useful.'
    : 'No Brave key is active, so outside ideas come from my model knowledge, not live search.'}`
  : `I'm in <b>library-only</b> mode. Even “what should I watch?” stays inside your saved titles.`}\n\nUse the top icons:
⌂ library-only · ◎ outside suggestions\n\nTry:
${outside
  ? `“outside suggestions like Severance” or “what should I add next?”`
  : `“what should I watch from my library?” or “make me a thriller playlist” then say “yes” for playable cards.`}\n\nPress ⟳ in this header to refresh the Concierge's library snapshot.\n
(First message downloads the model once — ~0.9 GB, then it's cached.)</div>`;
    return;
  }
  box.innerHTML = chatLog.map(m =>
    `<div class="msg ${m.role}">${esc(m.text)}</div>${
      m.role === 'assistant' ? chatCardsForMessage(m) : ''}`).join('');
  box.scrollTop = box.scrollHeight;
}

/* library titles mentioned in a reply become clickable play-cards */
function chatCardsForMessage(message) {
  if (Array.isArray(message.cards) && message.cards.length) {
    const cardItems = message.cards.map((id, idx) => ({
      item: library.find(i => i.id === id),
      reason: message.cardReasons?.[idx] || ''
    })).filter(x => x.item);
    return chatCardsHtml(cardItems, { playlist: message.cardStyle === 'playlist' });
  }
  return titleCardsHtml(message.text);
}

function titleCardsHtml(text) {
  const t = String(text || '').toLowerCase();
  const found = library.filter(i => i.title.length > 2 &&
    t.includes(i.title.toLowerCase())).slice(0, 4).map(item => ({ item }));
  if (!found.length) return '';
  return chatCardsHtml(found);
}

function chatCardsHtml(cards, opts = {}) {
  if (!cards.length) return '';
  return `<div class="chat-cards ${opts.playlist ? 'playlist' : ''}">${cards.map((card, idx) => {
    const i = card.item;
    const log = watchLog.find(w => w.itemId === i.id);
    const sub = i.type === 'show'
      ? (log ? `Resume S${log.s + 1} E${log.e + 1}` : 'Series · play E1')
      : (log ? 'Film · resume' : 'Film · play');
    const src = coverSrc(i);
    return `<button class="chat-card ${opts.playlist ? 'playlist-card' : ''}" data-chat-play="${i.id}">
      ${opts.playlist ? `<span class="chat-card-rank">${idx + 1}</span>` : ''}
      <span class="chat-card-cover" style="background:${gradientFor(i.title)}">
        ${src ? `<img src="${esc(src)}" alt="">` : esc((i.title[0] || '?').toUpperCase())}
      </span>
      <span class="chat-card-info"><b>${esc(i.title)}</b><small>▶ ${sub}</small>
        ${card.reason ? `<span class="chat-card-reason">${esc(card.reason)}</span>` : ''}</span>
    </button>`;
  }).join('')}</div>`;
}

const STOP_WORDS = new Set('a an and are as at be by for from give i in is it make me my of on or please something the to watch with you your'.split(' '));

function isPlaylistIntent(text) {
  return /\b(playlist|queue|lineup|curate|watchlist|movie night|binge)\b/i.test(text);
}

function isRecommendationIntent(text) {
  return /\b(recommend|suggest|what should i watch|what to watch|pick|choose|find me|something like|similar to|playlist|queue|lineup|curate|watchlist|movie night|binge|good|best|tonight|mood)\b/i.test(text);
}

function isAffirmation(text) {
  return /^(yes|yeah|yep|yup|sure|ok|okay|do it|please do|go ahead|sounds good|make it)\b/i.test(text.trim());
}

function isRejection(text) {
  return /^(no|nope|nah|cancel|stop|not now)\b/i.test(text.trim());
}

function preferenceTokens(text) {
  return String(text || '').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function playlistReason(item, tokens) {
  const cats = itemCategories(item).filter(c => c !== 'Movies' && c !== 'TV Shows');
  const matched = tokens.find(t => itemText(item).toLowerCase().includes(t));
  if (matched) return `Matches “${matched}” in your library metadata.`;
  if (cats.length) return `Fits ${cats.slice(0, 2).join(' + ')}.`;
  return item.type === 'show' ? 'A series from your saved library.' : 'A film from your saved library.';
}

function recommendationItems(query, limit = 3) {
  const playlist = curatePlaylist(query, Math.max(limit, 6)).items;
  const wantsShow = /\b(show|shows|series|episode|binge)\b/i.test(query);
  const wantsMovie = /\b(movie|movies|film|films)\b/i.test(query);
  const typed = playlist.filter(x =>
    (wantsShow && x.item.type === 'show') || (wantsMovie && x.item.type === 'movie'));
  return (typed.length ? typed : playlist).slice(0, limit);
}

function recommendationIntro(items, query) {
  const playable = items.filter(x => isPlayable(x.item)).length;
  if (!items.length) return 'I could not find any saved titles to recommend from your library yet.';
  const linkNote = playable ? '' : ' These will need valid Google Drive links before playback works.';
  return `From your library, I would pick ${items[0].item.title} tonight.${linkNote}\n\nI kept this strictly to saved Linkflix titles.`;
}

function curatePlaylist(query, limit = 6) {
  const playable = library.filter(isPlayable);
  const pool = playable.length ? playable : library;
  const tokens = preferenceTokens(query);
  const wantsShow = /\b(show|shows|series|episode|binge)\b/i.test(query);
  const wantsMovie = /\b(movie|movies|film|films)\b/i.test(query);
  const scored = pool.map((item, idx) => {
    const text = itemText(item).toLowerCase();
    const cats = itemCategories(item).join(' ').toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (item.title.toLowerCase().includes(t)) score += 5;
      if (String(item.genre || '').toLowerCase().includes(t)) score += 4;
      if (cats.includes(t)) score += 3;
      if (text.includes(t)) score += 2;
    }
    if (wantsShow && item.type === 'show') score += 3;
    if (wantsMovie && item.type === 'movie') score += 3;
    if (watchLog.some(w => w.itemId === item.id)) score += 1;
    score += Math.max(0, 2 - idx / 100);       // stable tie-breaker: newer additions first
    return { item, score, reason: playlistReason(item, tokens) };
  }).sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, Math.min(limit, scored.length));
  const theme = tokens.find(t => !['playlist', 'queue', 'lineup', 'curate', 'watchlist'].includes(t));
  return {
    title: theme ? `${labelCase(theme)} playlist` : 'library playlist',
    items: picked,
    hasPlayableLinks: Boolean(playable.length)
  };
}

function pendingPlaylistCards() {
  if (!pendingPlaylist?.ids?.length) return [];
  return pendingPlaylist.ids.map((id, idx) => ({
    item: library.find(i => i.id === id),
    reason: pendingPlaylist.reasons?.[idx] || ''
  })).filter(x => x.item);
}

function pushAssistant(text, extra = {}) {
  chatLog.push({ role: 'assistant', text, ...extra });
  saveChat();
  renderChat();
}

function continueSummary() {
  const parts = watchLog.slice(0, 5).map(w => {
    const item = library.find(i => i.id === w.itemId);
    if (!item) return null;
    return item.type === 'show' ? `${item.title} (at S${w.s + 1} E${w.e + 1})` : item.title;
  }).filter(Boolean);
  return parts.length ? parts.join('; ') : 'nothing in progress';
}

function librarySummary() {
  if (!library.length) return 'The library is currently empty.';
  return library.map((i, n) => {
    const kind = i.type === 'movie'
      ? 'Movie' : `Series, ${(i.seasons || []).length} season(s)`;
    const cats = itemCategories(i).filter(c => c !== 'Movies' && c !== 'TV Shows').slice(0, 5).join(', ');
    const meta = [
      i.genre && `genre: ${i.genre}`,
      cats && `categories: ${cats}`,
      formatShowDates(i) && `dates: ${formatShowDates(i)}`,
      i.subtitle && `about: ${i.subtitle}`,
      isPlayable(i) ? 'playable: yes' : 'playable: missing Drive link'
    ]
      .filter(Boolean).join('; ');
    return `${n + 1}. "${i.title}" — ${kind}${meta ? ` (${meta})` : ''}`;
  }).join('\n');
}

let conciergeContext = null;

function buildConciergeContext() {
  conciergeContext = {
    library: librarySummary(),
    continueWatching: continueSummary(),
    ts: Date.now()
  };
  return conciergeContext;
}

function conciergeSnapshot() {
  return conciergeContext || buildConciergeContext();
}

function refreshConciergeContext(showToast = false) {
  buildConciergeContext();
  if (showToast) toast('Concierge context refreshed ✓');
}

/* --- WebLLM engine (runs on your GPU via WebGPU — no API, no key) --- */
let engine = null, engineModelId = null;

function setChatStatus(text) {
  let s = $('#chat-status');
  if (!s) {
    $('#chat-messages').insertAdjacentHTML('beforeend',
      '<div class="msg status" id="chat-status"></div>');
    s = $('#chat-status');
  }
  s.textContent = text;
  $('#chat-messages').scrollTop = $('#chat-messages').scrollHeight;
}

async function ensureEngine() {
  if (engine && engineModelId === settings.model) return engine;
  if (!navigator.gpu)
    throw new Error('WebGPU is not available in this browser. Use a recent Chrome, Edge or Safari.');
  setChatStatus('Loading model… first time downloads it, then it is cached.');
  const webllm = await import('https://esm.run/@mlc-ai/web-llm');
  engine = await webllm.CreateMLCEngine(settings.model, {
    initProgressCallback: p => setChatStatus(p.text)
  });
  engineModelId = settings.model;
  return engine;
}

async function sendChat(text) {
  chatLog.push({ role: 'user', text });
  saveChat();
  renderChat();

  const outsideMode = settings.allowOutsideSuggestions;
  const wantsRecommendation = isRecommendationIntent(text);

  if (pendingPlaylist && isAffirmation(text)) {
    const cards = pendingPlaylistCards();
    const playlistTitle = pendingPlaylist.title || 'library playlist';
    pendingPlaylist = null;
    savePendingPlaylist();
    if (!cards.length) {
      pushAssistant('That playlist went stale because those titles are no longer in your library.');
      return;
    }
    pushAssistant(`Yes — here is your ${cards.length}-title ${playlistTitle}. Every card below is from your saved library.`,
      {
        cards: cards.map(c => c.item.id),
        cardReasons: cards.map(c => c.reason),
        cardStyle: 'playlist'
      });
    return;
  }

  if (pendingPlaylist && isRejection(text)) {
    pendingPlaylist = null;
    savePendingPlaylist();
    pushAssistant('No problem — I cleared that playlist idea.');
    return;
  }

  const wantsLocalPlaylist = isPlaylistIntent(text) &&
    (!outsideMode || /\b(library|saved|local|linkflix|my titles|what i have|playable)\b/i.test(text));
  if (wantsLocalPlaylist) {
    if (!library.length) {
      pushAssistant('Your library is empty right now, so I cannot curate a playlist yet. Add a few linked titles first and I will keep it strictly local.');
      return;
    }
    const playlist = curatePlaylist(text);
    if (!playlist.items.length) {
      pushAssistant('I could not find any saved titles to build that playlist from yet.');
      return;
    }
    pendingPlaylist = {
      title: playlist.title,
      ids: playlist.items.map(x => x.item.id),
      reasons: playlist.items.map(x => x.reason),
      ts: Date.now()
    };
    savePendingPlaylist();
    const names = playlist.items.slice(0, 4).map(x => x.item.title).join(', ');
    const linkNote = playlist.hasPlayableLinks
      ? ''
      : ' A heads-up: these titles need valid Google Drive links before playback will work.';
    pushAssistant(`I found a ${playlist.items.length}-title ${playlist.title} from your library: ${names}${playlist.items.length > 4 ? ', and more' : ''}.${linkNote}\n\nSay yes and I will turn it into playable cards.`);
    return;
  }

  if (!outsideMode && wantsRecommendation) {
    if (!library.length) {
      pushAssistant('Your library is empty right now, so I cannot suggest anything yet. Add a few linked titles first and I will keep recommendations strictly local.');
      return;
    }
    const items = recommendationItems(text);
    if (!items.length) {
      pushAssistant('I could not find a saved title that fits that request. I can only suggest from your Linkflix library while library-only mode is on.');
      return;
    }
    pushAssistant(recommendationIntro(items, text), {
      cards: items.map(x => x.item.id),
      cardReasons: items.map(x => x.reason)
    });
    return;
  }

  let webCtx = '';
  const canSearch = outsideMode && settings.useBraveSearch && settings.braveKey;
  if (canSearch && (wantsWebContext(text) || wantsRecommendation)) {
    setChatStatus('checking Brave Search…');
    try { webCtx = await braveContext(text); } catch { /* search is optional context */ }
  }
  setChatStatus('thinking…');

  try {
    const eng = await ensureEngine();
    const context = conciergeSnapshot();
    const prompt = `You are the Linkflix Concierge inside the user's personal
streaming app.

Suggestion scope selected by the top icon: ${outsideMode ? '◎ OUTSIDE ENABLED' : '⌂ LIBRARY ONLY'}
${outsideMode
  ? `Outside recommendations are allowed when, and only when, the user asks for recommendations. The library below is what the user can play in Linkflix; outside titles are ideas to find/add elsewhere.`
  : `You may ONLY recommend titles from THIS library. The exact list below is the complete set of everything available to watch. Nothing else exists to the user, even for "what should I watch?" requests.`}

LIBRARY (${library.length} titles):
${context.library}

Currently partway through (continue watching): ${context.continueWatching}

Latest user message is a recommendation request: ${wantsRecommendation ? 'YES' : 'NO'}

Brave Search setting: ${canSearch
  ? 'YES. The app may provide Brave context below for outside suggestions.'
  : (outsideMode
    ? 'NO active Brave key/search. For outside suggestions, use your general film and TV knowledge; do not claim live or current web access.'
    : 'NO. Do not search, do not claim you searched, and do not rely on outside recommendations.')}
${webCtx ? `\nOptional Brave context, for understanding only:\n${webCtx}\n` : ''}

Hard rules:
- Only recommend, suggest, rank, curate, or pitch titles when "Latest user message is
  a recommendation request" is YES. If it is NO, answer the exact question without
  volunteering picks. You may mention library titles only as factual inventory answers,
  not as recommendations.
- In ⌂ LIBRARY ONLY scope: recommend ONLY titles from the numbered list above. Never
  invent, assume, suggest, compare, or mention any movie or show that is not on the
  list, even if the user asks for something you don't have.
- In ◎ OUTSIDE ENABLED scope: you may suggest titles outside the library only for
  recommendation requests. Mark each outside title with "outside library" or "not in
  Linkflix", and do not imply it can play here. If you mention a library title, write
  it EXACTLY as listed above so the app can turn it into a play card.
- If nothing in the library fits while in ⌂ LIBRARY ONLY scope, say so honestly and
  suggest closest library matches only if the user asked for a recommendation.
- If the user asks for something current or from the web and Brave Search is not
  active, say there is no live search active. In ◎ OUTSIDE ENABLED scope you may still
  use general model knowledge; in ⌂ LIBRARY ONLY scope answer only from the library.
- If Brave context is present, use it only when ◎ OUTSIDE ENABLED is selected or to
  understand taste. Do not use Brave context to override ⌂ LIBRARY ONLY scope.
- In ⌂ LIBRARY ONLY scope, playlist requests use the local playlist-card flow after
  confirmation. In ◎ OUTSIDE ENABLED scope, you may curate a plain-text outside list;
  outside titles will not be playable cards.
- For library-only "what should I watch?" requests, first consider whether they should
  continue an unfinished show from the continue-watching list.
- Base your picks on the genres and descriptions given. Keep replies short and
  conversational — a few picks with a one-line reason each. Plain text, no markdown.`;

    const messages = [
      { role: 'system', content: prompt },
      ...chatLog.slice(-12).map(m => ({ role: m.role, content: m.text }))
    ];
    const stream = await eng.chat.completions.create({
      messages, stream: true, temperature: outsideMode ? 0.7 : 0.35, max_tokens: 400
    });
    $('#chat-status')?.remove();
    chatLog.push({ role: 'assistant', text: '' });
    for await (const chunk of stream) {
      chatLog[chatLog.length - 1].text += chunk.choices[0]?.delta?.content || '';
      renderChat();
    }
  } catch (err) {
    $('#chat-status')?.remove();
    chatLog.push({ role: 'assistant', text: `⚠️ ${err.message || err}` });
  }
  saveChat();
  renderChat();
}

/* ================= Keyboard navigation ================= */
function focusFirst() {
  if (modalOpen() || !$('#chat-panel').hidden) return;
  const el = $('#view .focusable');
  if (el) el.focus({ preventScroll: false });
}

function moveFocus(dx, dy) {
  const rows = $$('#view [data-navrow]')
    .map(r => $$('.focusable', r)).filter(r => r.length);
  if (!rows.length) return;
  let ri = rows.findIndex(r => r.includes(document.activeElement));
  let ci = ri >= 0 ? rows[ri].indexOf(document.activeElement) : 0;
  if (ri < 0) { rows[0][0].focus(); return; }
  if (dy) ri = Math.min(rows.length - 1, Math.max(0, ri + dy));
  if (dx) ci = Math.min(rows[ri].length - 1, Math.max(0, ci + dx));
  ci = Math.min(ci, rows[ri].length - 1);
  const target = rows[ri][ci];
  target.focus();
  target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function isTyping(e) {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
}

document.addEventListener('keydown', e => {
  // Escape works everywhere
  if (e.key === 'Escape') {
    if (modalOpen()) { closeModal(); return; }
    if (!$('#chat-panel').hidden) { toggleChat(false); return; }
    if (isTyping(e)) { e.target.blur(); focusFirst(); return; }
    if (view.name !== 'home') { goBack(); return; }
    return;
  }
  if (modalOpen()) return;                    // native Tab/Enter inside modals
  if (isTyping(e)) return;                    // don't hijack typing

  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); moveFocus(-1, 0); break;
    case 'ArrowRight': e.preventDefault(); moveFocus(1, 0);  break;
    case 'ArrowUp':    e.preventDefault(); moveFocus(0, -1); break;
    case 'ArrowDown':  e.preventDefault(); moveFocus(0, 1);  break;
    case 'Backspace':  if (view.name !== 'home') goBack(); break;
    case '/': e.preventDefault(); $('#search-input').focus(); break;
    case 'a': case 'A': openAddModal(); break;
    case 'c': case 'C': toggleChat(); break;
    case 's': case 'S': openSettings(); break;
    case 'h': case 'H': view = { name: 'home' }; render(); break;
    case 'e': case 'E': if (view.name === 'detail') openAddModal(view.id); break;
  }
});

function playItem(id) {                 // resume where you left off, else episode 1
  const item = library.find(i => i.id === id);
  if (!item) return;
  if (item.type === 'show') {
    const log = watchLog.find(w => w.itemId === id);
    const fallback = playablePosition(item) || { s: 0, e: 0 };
    const loggedLink = item.seasons?.[log?.s]?.episodes?.[log?.e]?.link;
    const canResume = driveFileId(loggedLink);
    playEpisode(id, canResume ? (log?.s ?? fallback.s) : fallback.s,
      canResume ? (log?.e ?? fallback.e) : fallback.e);
    return;
  }
  const log = watchLog.find(w => w.itemId === id);
  const loggedLink = item.type === 'show'
    ? item.seasons?.[log?.s]?.episodes?.[log?.e]?.link
    : item.link;
  const fallback = playablePosition(item) || { s: 0, e: 0 };
  const canResume = item.type === 'movie'
    ? driveFileId(item.link)
    : driveFileId(loggedLink);
  view = { name: 'player', id,
    s: canResume ? (log?.s ?? fallback.s) : fallback.s,
    e: canResume ? (log?.e ?? fallback.e) : fallback.e };
  render();
}

function goBack() {
  view = view.name === 'player'
    ? { name: 'detail', id: view.id }
    : { name: 'home' };
  render();
}

/* ================= Event wiring ================= */
function bindView() {
  $('#view').onclick = e => {
    const open = e.target.closest('[data-open]');
    if (open) { view = { name: 'detail', id: open.dataset.open }; render(); return; }

    const seasonSelect = e.target.closest('[data-season-select]');
    if (seasonSelect) return;

    const play = e.target.closest('[data-play]');
    if (play) {
      const item = library.find(i => i.id === play.dataset.play);
      if (item?.type === 'show') {
        playEpisode(item.id, +(play.dataset.s ?? 0), +(play.dataset.e ?? 0));
        return;
      }
      view = { name: 'player', id: play.dataset.play,
        s: +(play.dataset.s ?? 0), e: +(play.dataset.e ?? 0) };
      render(); return;
    }
    const featured = e.target.closest('[data-play-featured]');
    if (featured) { playItem(featured.dataset.playFeatured); return; }
    if (e.target.closest('[data-hero-prev]')) { moveHero(-1); return; }
    if (e.target.closest('[data-hero-next]')) { moveHero(1); return; }
    if (e.target.closest('[data-hero-refresh]')) { refreshHeroPool(true); return; }
    const clearWatch = e.target.closest('[data-clear-watch]');
    if (clearWatch) {
      const item = library.find(i => i.id === clearWatch.dataset.clearWatch);
      if (removeFromContinueWatching(clearWatch.dataset.clearWatch)) {
        render();
        toast(`Removed “${item?.title || 'title'}” from Continue Watching`);
      }
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) { openAddModal(edit.dataset.edit); return; }

    const del = e.target.closest('[data-delete]');
    if (del) {
      const item = library.find(i => i.id === del.dataset.delete);
      if (confirm(`Delete “${item.title}” from your library?`)) {
        library = library.filter(i => i.id !== item.id);
        watchLog = watchLog.filter(w => w.itemId !== item.id);
        saveLibrary(); store.set('watchLog', watchLog);
        view = { name: 'home' }; render(); toast('Deleted');
      }
      return;
    }
    const scroll = e.target.closest('[data-scroll]');
    if (scroll) {
      const row = $('.row', scroll.closest('.row-wrap'));
      row.scrollBy({ left: +scroll.dataset.scroll * row.clientWidth * 0.8, behavior: 'smooth' });
      return;
    }
    const action = e.target.closest('[data-action]');
    if (action) {
      const a = action.dataset.action;
      if (a === 'back') goBack();
      if (a === 'add') openAddModal();
      if (a === 'scan') loadFromFolder(false);
      if (a === 'import') importLibraryFile();
    }
  };

  const seasonSelect = $('[data-season-select]');
  if (seasonSelect) {
    seasonSelect.onchange = e => {
      view = { name: 'detail', id: view.id, season: +e.target.value };
      render();
    };
  }
}

$('#brand').addEventListener('click', () => { view = { name: 'home' }; render(); });
$('#btn-add').addEventListener('click', () => openAddModal());
$('#btn-chat').addEventListener('click', () => toggleChat());
$('#btn-scope').addEventListener('click', () =>
  setOutsideSuggestions(!settings.allowOutsideSuggestions));
$('#btn-settings').addEventListener('click', () => openSettings());
$('#chat-close').addEventListener('click', () => toggleChat(false));
$('#chat-refresh').addEventListener('click', () => refreshConciergeContext(true));
$('#chat-scope-library').addEventListener('click', () => setOutsideSuggestions(false));
$('#chat-scope-outside').addEventListener('click', () => setOutsideSuggestions(true));

$('#chat-messages').addEventListener('click', e => {
  const card = e.target.closest('[data-chat-play]');
  if (card) { toggleChat(false); playItem(card.dataset.chatPlay); }
});

$('#chat-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  sendChat(text);
});

$('#search-input').addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  if (view.name !== 'home') view = { name: 'home' };
  const focused = document.activeElement;
  render();
  focused.focus();
});
$('#search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusFirst(); }
});

$('#modal-root').addEventListener('click', e => {
  if (e.target.dataset.overlay !== undefined && e.target === e.currentTarget.firstElementChild)
    closeModal();
  if (e.target.closest('[data-action="close-modal"]')) closeModal();
});

/* ================= Hover preview (Netflix-style expand) ================= */
const pop = document.createElement('div');
pop.id = 'hover-pop';
pop.className = 'glass';
pop.hidden = true;
document.body.appendChild(pop);
let popCardId = null, popShowTimer = null, popHideTimer = null;

function popEpisodeList(item) {
  if (item.type !== 'show') return '';
  const eps = [];
  (item.seasons || []).forEach((se, si) => (se.episodes || []).forEach((ep, ei) =>
    eps.push({
      si,
      ei,
      label: `S${si + 1} E${ei + 1}`,
      title: ep.title || `Episode ${ei + 1}`,
      airdate: ep.airdate || ''
    })));
  if (!eps.length) return '';
  return `<div class="pop-eps">${eps.map(e =>
    `<button class="pop-ep" data-pop-ep data-s="${e.si}" data-e="${e.ei}">
      <span class="pop-ep-num">${e.label}</span>${esc(e.title)}
      ${e.airdate ? `<span class="pop-ep-date">${esc(formatDate(e.airdate))}</span>` : ''}</button>`).join('')}</div>`;
}

function showPop(card) {
  const id = card.dataset.open;
  const item = library.find(i => i.id === id);
  if (!item) return;
  popCardId = id;
  const src = coverSrc(item);
  const resume = watchLog.some(w => w.itemId === id);
  pop.innerHTML = `
    <div class="pop-cover" style="background:${gradientFor(item.title)}">
      ${src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : ''}
      <div class="cover-fallback">${esc((item.title || '?')[0].toUpperCase())}</div>
    </div>
    <div class="pop-body">
      <div class="pop-title">${esc(item.title)}</div>
      ${item.subtitle ? `<div class="pop-sub">${esc(item.subtitle)}</div>` : ''}
      <div class="pop-actions">
        <button class="pill-btn accent small" data-pop-play>▶ ${resume ? 'Resume' : 'Play'}</button>
        <button class="pill-btn small" data-pop-details>Details</button>
      </div>
      ${popEpisodeList(item)}
    </div>`;
  const r = card.getBoundingClientRect();
  const w = 320;
  pop.style.width = w + 'px';
  pop.style.left = Math.max(12, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 12)) + 'px';
  pop.style.top = Math.max(84, r.top - 46) + 'px';
  pop.hidden = false;
  requestAnimationFrame(() => {           // keep it on screen
    const pr = pop.getBoundingClientRect();
    if (pr.bottom > innerHeight - 12)
      pop.style.top = Math.max(84, innerHeight - 12 - pr.height) + 'px';
  });
}

function hidePop() { pop.hidden = true; popCardId = null; }

$('#view').addEventListener('mouseover', e => {
  const card = e.target.closest('.card[data-open]');
  if (!card) return;
  clearTimeout(popHideTimer);
  if (card.dataset.open === popCardId && !pop.hidden) return;
  clearTimeout(popShowTimer);
  popShowTimer = setTimeout(() => showPop(card), 420);
});
$('#view').addEventListener('mouseout', e => {
  const card = e.target.closest('.card[data-open]');
  if (!card) return;
  if (e.relatedTarget && (pop.contains(e.relatedTarget) || card.contains(e.relatedTarget))) return;
  clearTimeout(popShowTimer);
  popHideTimer = setTimeout(hidePop, 200);
});
pop.addEventListener('mouseenter', () => clearTimeout(popHideTimer));
pop.addEventListener('mouseleave', () => { popHideTimer = setTimeout(hidePop, 200); });
pop.addEventListener('click', e => {
  const id = popCardId;
  if (!id) return;
  const ep = e.target.closest('[data-pop-ep]');
  if (e.target.closest('[data-pop-play]')) { hidePop(); playItem(id); }
  else if (e.target.closest('[data-pop-details]')) { hidePop(); view = { name: 'detail', id }; render(); }
  else if (ep) { hidePop(); playEpisode(id, +ep.dataset.s, +ep.dataset.e); }
});
window.addEventListener('scroll', hidePop, { passive: true });

/* ================= Boot ================= */
// clean up demo entries left over from earlier versions
const isDemoLink = s => String(s || '').includes('1DemoFileIdReplaceMe123');
const cleaned = library.filter(i => !(i.demo || isDemoLink(i.link) ||
  (i.seasons || []).some(se => (se.episodes || []).some(ep => isDemoLink(ep.link)))));
if (cleaned.length !== library.length) { library = cleaned; saveLibrary(); }

syncSuggestionScopeUi();
render();
if (!library.length) loadFromFolder(true);   // pick up a shared library/ folder if present
