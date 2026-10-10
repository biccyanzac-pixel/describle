// The game's vocabulary in the browser: words + int8 vectors (built by pipeline/build.mjs), scored with SIMD.
//   site/data/vocab-v<N>.json    words, senses per word, sense counts, word frequency, guess settings, irregular forms
//   site/data/vectors-v<N>.bin   int8 rows: [one per word, if the word vectors are used] then each word's senses
// The version is in the file names, so a rebuilt vocabulary never mixes with a cached old one.
// Changing the vocabulary or the vectors changes what the model guesses: never do it to a live or past day.
import { createScorer, fetchCached } from './embed.js';
import { combine, topIndices, senseBiasFrom } from './guess.js';

export const VOCAB_VERSION = 1;

export async function loadVocab({ onProgress = () => {}, base = new URL('../data/', import.meta.url) } = {}) {
  const meta = await (await fetch(new URL(`vocab-v${VOCAB_VERSION}.json`, base))).json();
  const buf = await fetchCached(new URL(`vectors-v${VOCAB_VERSION}.bin`, base).href, (loaded, total) => onProgress({ loaded, total }));
  return makeVocab(meta, new Int8Array(buf));
}

/** Also used by Node (tests, pipeline) with the files read from disk. */
export async function makeVocab(meta, vectors) {
  const n = meta.words.length, dim = meta.dim;
  const wordRows = meta.wordRows ? n : 0;
  const nSense = Int32Array.from(meta.senses);
  const firstSense = new Int32Array(n);
  for (let i = 1; i < n; i++) firstSense[i] = firstSense[i - 1] + nSense[i - 1];
  const rows = wordRows + firstSense[n - 1] + nSense[n - 1];
  if (vectors.length !== rows * dim) throw new Error(`vectors: expected ${rows * dim} bytes, got ${vectors.length}`);
  const scorer = await createScorer(rows, dim);
  scorer.mat.set(vectors);
  const zipf = Float32Array.from(meta.zipf, (z) => z / 100);
  const senseBias = senseBiasFrom(meta.counts ?? [], meta.guess.countBias ?? 0);
  const index = new Map(meta.words.map((w, i) => [w, i]));
  const out = new Float32Array(n);
  return {
    meta, words: meta.words, index, irregular: meta.irregular ?? {}, lexicon: new Set(meta.words), rows,
    /** Row of word i's k-th sense (for dropRows). */
    senseRow: (i, k) => wordRows + firstSense[i] + k,
    nSense,
    /**
     * Scores for every word (Float32Array, reused between calls) and the top k, for a unit query vector.
     * dropRows (tests only): rows to leave out, e.g. the very definition a reference description was made from.
     */
    guess(q, k = 5, { dropRows = [] } = {}) {
      const all = scorer.score(q);
      for (const r of dropRows) all[r] = -2;
      combine(all.subarray(wordRows), wordRows ? all.subarray(0, wordRows) : null, firstSense, nSense, { ...meta.guess, senseBias, zipf, out });
      return { scores: out, top: topIndices(out, k).map((i) => ({ word: meta.words[i], score: out[i] })) };
    },
  };
}
