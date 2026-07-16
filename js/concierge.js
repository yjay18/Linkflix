/* ================= AI Concierge (local WebLLM + grounded recommendations) ================= */
import { state, store, saveSettings } from './state.js';
import { $, esc, toast } from './dom.js';
import { coverSrc, gradientFor } from './covers.js';
import { formatShowDates } from './format.js';
import { itemRecommendationProfile, isPlayable, labelCase, tagsFromText } from './taxonomy.js';
import { braveContext, wantsWebContext } from './metadata.js';
import { focusFirst } from './nav.js';

let chatLog = store.get('chat', []);          // [{role, text}]
let pendingPlaylist = store.get('pendingPlaylist', null);

const saveChat = () => { chatLog = chatLog.slice(-40); store.set('chat', chatLog); };
const savePendingPlaylist = () => store.set('pendingPlaylist', pendingPlaylist);

/* ---------- suggestion scope UI ---------- */
export function syncSuggestionScopeUi() {
  const outside = state.settings.allowOutsideSuggestions;
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
    ? (state.settings.useBraveSearch && state.settings.braveKey
      ? 'Outside suggestions · Brave context on'
      : 'Outside suggestions · model knowledge')
    : 'Runs locally on your GPU · library-only';
  const input = $('#chat-input');
  if (input) input.placeholder = outside
    ? 'Ask for library or outside ideas…'
    : 'Ask from your library…';
}

export function setOutsideSuggestions(enabled) {
  state.settings.allowOutsideSuggestions = Boolean(enabled);
  saveSettings();
  syncSuggestionScopeUi();
  if (!$('#chat-panel')?.hidden) renderChat();
  toast(state.settings.allowOutsideSuggestions
    ? (state.settings.useBraveSearch && state.settings.braveKey
      ? 'Outside suggestions on — Brave context enabled'
      : 'Outside suggestions on — using model knowledge')
    : 'Library-only suggestions on');
}

/* ---------- chat panel ---------- */
export function toggleChat(open) {
  const panel = $('#chat-panel');
  panel.hidden = open === undefined ? !panel.hidden : !open;
  if (!panel.hidden) {
    buildConciergeContext();
    renderChat();
    $('#chat-input').focus();
  }
  else focusFirst();
}

export function renderChat() {
  syncSuggestionScopeUi();
  const box = $('#chat-messages');
  if (!chatLog.length) {
    const outside = state.settings.allowOutsideSuggestions;
    box.innerHTML = `<div class="msg assistant">Hi! I'm your concierge — I run 100% in your
browser on your GPU. ${outside
  ? `Outside suggestions are <b>enabled</b>. ${state.settings.useBraveSearch && state.settings.braveKey
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
      item: state.library.find(i => i.id === id),
      reason: message.cardReasons?.[idx] || ''
    })).filter(x => x.item);
    return chatCardsHtml(cardItems, { playlist: message.cardStyle === 'playlist' });
  }
  return titleCardsHtml(message.text);
}

function titleCardsHtml(text) {
  const t = String(text || '').toLowerCase();
  const found = state.library.filter(i => i.title.length > 2 &&
    t.includes(i.title.toLowerCase())).slice(0, 4).map(item => ({ item }));
  if (!found.length) return '';
  return chatCardsHtml(found);
}

function chatCardsHtml(cards, opts = {}) {
  if (!cards.length) return '';
  return `<div class="chat-cards ${opts.playlist ? 'playlist' : ''}">${cards.map((card, idx) => {
    const i = card.item;
    const log = state.watchLog.find(w => w.itemId === i.id);
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

const STOP_WORDS = new Set('a an and are as at be by for from give i in is it make me my of on or please something the to watch with you your show shows series episode episodes movie movies film films title titles tonight'.split(' '));

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

function queryPreferenceTags(query) {
  return tagsFromText(query);
}

function playlistReason(item, tokens, queryTags = []) {
  const profile = itemRecommendationProfile(item);
  const tagMatches = queryTags.filter(t => profile.tags.includes(t));
  if (tagMatches.length && profile.categories.length)
    return `Tagged ${tagMatches.slice(0, 2).join(' + ')} · ${profile.categories.slice(0, 2).join(' + ')}.`;
  if (tagMatches.length) return `Tagged ${tagMatches.slice(0, 2).join(' + ')}.`;
  const matched = tokens.find(t => profile.text.toLowerCase().includes(t));
  if (matched) return `Matches “${matched}” in this title's details.`;
  if (profile.categories.length) return `Fits ${profile.categories.slice(0, 2).join(' + ')}.`;
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
  const playable = state.library.filter(isPlayable);
  const pool = playable.length ? playable : state.library;
  const tokens = preferenceTokens(query);
  const queryTags = queryPreferenceTags(query);
  const wantsShow = /\b(show|shows|series|episode|binge)\b/i.test(query);
  const wantsMovie = /\b(movie|movies|film|films)\b/i.test(query);
  const scored = pool.map((item, idx) => {
    const profile = itemRecommendationProfile(item);
    const text = profile.text.toLowerCase();
    const cats = profile.categories.join(' ').toLowerCase();
    let score = 0;
    const matchedTags = queryTags.filter(t => profile.tags.includes(t));
    score += matchedTags.length * 7;
    for (const t of tokens) {
      if (item.title.toLowerCase().includes(t)) score += 5;
      if (String(item.genre || '').toLowerCase().includes(t)) score += 4;
      if (cats.includes(t)) score += 3;
      if (text.includes(t)) score += 2;
    }
    if (queryTags.length && !matchedTags.length) score -= 2;
    if (wantsShow && item.type === 'show') score += 3;
    if (wantsMovie && item.type === 'movie') score += 3;
    if (state.watchLog.some(w => w.itemId === item.id)) score += 1;
    score += Math.max(0, 2 - idx / 100);       // stable tie-breaker: newer additions first
    return { item, score, reason: playlistReason(item, tokens, queryTags) };
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
    item: state.library.find(i => i.id === id),
    reason: pendingPlaylist.reasons?.[idx] || ''
  })).filter(x => x.item);
}

function pushAssistant(text, extra = {}) {
  chatLog.push({ role: 'assistant', text, ...extra });
  saveChat();
  renderChat();
}

function continueSummary() {
  const parts = state.watchLog.slice(0, 5).map(w => {
    const item = state.library.find(i => i.id === w.itemId);
    if (!item) return null;
    return item.type === 'show' ? `${item.title} (at S${w.s + 1} E${w.e + 1})` : item.title;
  }).filter(Boolean);
  return parts.length ? parts.join('; ') : 'nothing in progress';
}

function librarySummary() {
  if (!state.library.length) return 'The library is currently empty.';
  return state.library.map((i, n) => {
    const kind = i.type === 'movie'
      ? 'Movie' : `Series, ${(i.seasons || []).length} season(s)`;
    const profile = itemRecommendationProfile(i);
    const cats = profile.categories.slice(0, 5).join(', ');
    const tags = profile.tags.slice(0, 8).join(', ');
    const meta = [
      i.genre && `genre: ${i.genre}`,
      cats && `categories: ${cats}`,
      tags && `tags: ${tags}`,
      formatShowDates(i) && `dates: ${formatShowDates(i)}`,
      i.subtitle && `about: ${i.subtitle}`,
      isPlayable(i) ? 'playable: yes' : 'playable: missing Drive link'
    ]
      .filter(Boolean).join('; ');
    return `${n + 1}. "${i.title}" — ${kind}${meta ? ` (${meta})` : ''}`;
  }).join('\n');
}

function buildConciergeContext() {
  state.conciergeContext = {
    library: librarySummary(),
    continueWatching: continueSummary(),
    ts: Date.now()
  };
  return state.conciergeContext;
}

function conciergeSnapshot() {
  return state.conciergeContext || buildConciergeContext();
}

export function refreshConciergeContext(showToast = false) {
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
  if (engine && engineModelId === state.settings.model) return engine;
  if (!navigator.gpu)
    throw new Error('WebGPU is not available in this browser. Use a recent Chrome, Edge or Safari.');
  setChatStatus('Loading model… first time downloads it, then it is cached.');
  const webllm = await import('https://esm.run/@mlc-ai/web-llm');
  engine = await webllm.CreateMLCEngine(state.settings.model, {
    initProgressCallback: p => setChatStatus(p.text)
  });
  engineModelId = state.settings.model;
  return engine;
}

export async function sendChat(text) {
  chatLog.push({ role: 'user', text });
  saveChat();
  renderChat();

  const outsideMode = state.settings.allowOutsideSuggestions;
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
    if (!state.library.length) {
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
    if (!state.library.length) {
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
  const canSearch = outsideMode && state.settings.useBraveSearch && state.settings.braveKey;
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

LIBRARY (${state.library.length} titles):
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
