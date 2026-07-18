import { pipeline, env } from './vendor/transformers.mjs';
import { state } from './state.js';
import { itemRecommendationProfile } from './taxonomy.js';

let embedder = null;

export async function initSemanticSearch() {
  if (embedder) return embedder;

  // Fully offline local configuration
  env.allowLocalModels = true;
  env.localModelPath = '/models/';
  env.allowRemoteModels = false;
  // Ensure ONNX uses the local WASM files in the vendor folder
  env.backends.onnx.wasm.wasmPaths = '/js/vendor/';

  embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  return embedder;
}

// IndexedDB setup for embeddings cache
const DB_NAME = 'lf-embeddings';
let dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = e => {
    e.target.result.createObjectStore('embeddings');
  };
  req.onsuccess = e => resolve(e.target.result);
  req.onerror = () => reject('IDB Error');
});

export async function getEmbedding(id) {
  const db = await dbPromise;
  return new Promise(resolve => {
    const tx = db.transaction('embeddings', 'readonly');
    const req = tx.objectStore('embeddings').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function saveEmbedding(id, array) {
  const db = await dbPromise;
  return new Promise(resolve => {
    const tx = db.transaction('embeddings', 'readwrite');
    tx.objectStore('embeddings').put(array, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

// Model singleton
let extractor = null;
async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return extractor;
}

export async function embedText(text) {
  const ex = await getExtractor();
  const output = await ex(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export function cosineSimilarity(a, b) {
  let dot = 0, nA = 0, nB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    nA += a[i] * a[i];
    nB += b[i] * b[i];
  }
  if (nA === 0 || nB === 0) return 0;
  return dot / (Math.sqrt(nA) * Math.sqrt(nB));
}

// Background worker to embed items once they have Ollama tags
export async function startSemanticWorker() {
  // Wait a moment so we don't block immediate startup
  await new Promise(r => setTimeout(r, 2000));
  for (const item of state.library) {
    if (item.ollamaTags && item.ollamaTags.length > 0) {
      const existing = await getEmbedding(item.id);
      if (!existing) {
        const profile = itemRecommendationProfile(item);
        try {
          const emb = await embedText(profile.text + ' ' + profile.tags.join(' '));
          await saveEmbedding(item.id, emb);
        } catch (e) {
          console.error('Failed to embed', item.id, e);
        }
      }
    }
  }
}

export async function rankLibrary(query) {
  try {
    const qEmb = await embedText(query);
    const scored = [];
    for (const item of state.library) {
      const emb = await getEmbedding(item.id);
      if (emb) {
        const score = cosineSimilarity(qEmb, emb);
        // Only return strong semantic matches
        if (score > 0.2) scored.push({ item, score });
      }
    }
    return scored.sort((a, b) => b.score - a.score).map(s => s.item);
  } catch (e) {
    console.error('Semantic search failed', e);
    return [];
  }
}
