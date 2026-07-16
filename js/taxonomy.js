/* ================= Library intelligence (genres, categories, tags) ================= */
import { driveFileId } from './drive.js';
import { formatShowDates } from './format.js';

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

export const CATEGORY_ORDER = [
  'Action & Adventure', 'Comedy', 'Drama', 'Sci-Fi & Fantasy', 'Thrillers',
  'Crime & Mystery', 'Horror', 'Romance', 'Animation', 'Family',
  'Documentaries', 'Reality & Competition', 'Stand-Up & Variety',
  'Music & Musicals', 'Sports', 'Limited Series', 'Long-Run Shows'
];

const RECOMMENDATION_TAG_RULES = [
  ['funny', /\b(comedy|comic|funny|sitcom|joke|jokes|laugh|hilarious|humor|humour|satire|parody|witty|absurd|goofy|silly|sketch)\b/i],
  ['light', /\b(light|comfort|cozy|cosy|feel.?good|easy|warm|charming|wholesome|breezy)\b/i],
  ['dark', /\b(dark|gritty|bleak|violent|twisted|brooding|antihero|revenge|tragic)\b/i],
  ['intense', /\b(intense|tense|thriller|suspense|stressful|edge|high.?stakes|survival|danger)\b/i],
  ['mystery', /\b(mystery|detective|investigation|clue|case|murder|secret|conspiracy|noir)\b/i],
  ['crime', /\b(crime|criminal|heist|gang|mafia|cartel|police|cop|detective|prison)\b/i],
  ['sci-fi', /\b(sci.?fi|science fiction|space|alien|future|robot|android|dystopia|time travel|multiverse)\b/i],
  ['fantasy', /\b(fantasy|magic|dragon|kingdom|myth|supernatural|witch|wizard|prophecy)\b/i],
  ['romantic', /\b(romance|romantic|love|relationship|dating|crush|wedding|heartbreak|rom-com)\b/i],
  ['animated', /\b(animation|animated|anime|cartoon)\b/i],
  ['family', /\b(family|kids|children|teen|school|all ages)\b/i],
  ['action', /\b(action|adventure|fight|battle|war|mission|spy|superhero|chase|martial)\b/i],
  ['scary', /\b(horror|scary|haunted|ghost|monster|slasher|zombie|vampire|terror)\b/i],
  ['short', /\b(short|quick|limited|miniseries|mini-series|special)\b/i],
  ['binge', /\b(binge|long|long-running|many episodes|season|seasons)\b/i]
];

export function labelCase(raw) {
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

export function explicitGenreLabels(item) {
  return [...new Set(String(item.genre || '')
    .split(/[,·|/]/)
    .map(labelCase)
    .filter(Boolean))];
}

export function episodeCount(item) {
  return (item.seasons || []).reduce((n, s) => n + (s.episodes || []).length, 0);
}

export function itemText(item) {
  const episodes = (item.seasons || []).flatMap(s => (s.episodes || [])
    .flatMap(ep => [ep.title, ep.subtitle, ep.airdate])).filter(Boolean).slice(0, 30).join(' ');
  return [item.title, item.genre, item.subtitle, formatShowDates(item), item.type, episodes]
    .filter(Boolean).join(' ');
}

export function tagsFromText(text) {
  const tags = new Set();
  for (const [tag, re] of RECOMMENDATION_TAG_RULES)
    if (re.test(text)) tags.add(tag);
  return [...tags];
}

export function itemRecommendationProfile(item) {
  const topText = [item.title, item.genre, item.subtitle, formatShowDates(item), item.type]
    .filter(Boolean).join(' ');
  const categorySet = new Set(explicitGenreLabels(item));
  for (const [label, re] of CATEGORY_RULES)
    if (re.test(topText)) categorySet.add(label);
  if (item.type === 'show') {
    const eps = episodeCount(item);
    if (eps && eps <= 10) categorySet.add('Limited Series');
    if (eps >= 30) categorySet.add('Long-Run Shows');
  }
  const categories = [...categorySet];
  const categoryText = categories.join(' ');
  const tags = [...new Set([
    ...tagsFromText(topText),
    ...tagsFromText(categoryText),
    ...categories.map(c => c.toLowerCase().replace(/&/g, '').replace(/\s+/g, '-'))
  ])];
  return { text: topText, categories, tags };
}

export function itemCategories(item) {
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

export function playablePosition(item) {
  if (!item) return null;
  if (item.type === 'movie') return driveFileId(item.link) ? { s: 0, e: 0 } : null;
  for (let s = 0; s < (item.seasons || []).length; s++) {
    const episodes = item.seasons[s].episodes || [];
    for (let e = 0; e < episodes.length; e++)
      if (driveFileId(episodes[e].link)) return { s, e };
  }
  return null;
}

export function isPlayable(item) {
  return Boolean(playablePosition(item));
}
