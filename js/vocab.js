// The game's vocabulary in the browser: words + int8 vectors (built by pipeline/build.mjs), scored with SIMD.
//   site/data/vocab-v<N>.json    words, senses per word, sense counts, word frequency, guess settings, irregular forms
//   site/data/vectors-v<N>.bin   int8 rows: [one per word, if the word vectors are used] then each word's senses
// The version is in the file names, so a rebuilt vocabulary never mixes with a cached old one.
// Changing the vocabulary or the vectors changes what the model guesses: never do it to a live or past day.
import { createScorer, fetchCached } from './embed.js';
import { combine, topIndices, senseBiasFrom } from './guess.js';
import { forms, tokenize } from './ban.js';
import { stemmer } from '../vendor/stemmer/stemmer.js';

export const VOCAB_VERSION = 1;

/** The vocabulary's word list, forms and settings (small; the game needs it early for the ban check). */
export async function loadVocabMeta({ base = new URL('../data/', import.meta.url) } = {}) {
  const res = await fetch(new URL(`vocab-v${VOCAB_VERSION}.json`, base));
  if (!res.ok) throw new Error(`vocabulary: HTTP ${res.status}`);
  return res.json();
}

export async function loadVocab({ onProgress = () => {}, base = new URL('../data/', import.meta.url), meta = null } = {}) {
  meta ??= await loadVocabMeta({ base });
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
  const irregular = meta.irregular ?? {};
  const out = new Float32Array(n);
  // Which vocabulary words a description mentions (by form or stem), built on first use.
  let byStem = null, byForm = null;
  function mentionedIn(text) {
    if (!byStem) {
      byStem = new Map(); byForm = new Map();
      meta.words.forEach((w, i) => {
        const s = stemmer(w);
        (byStem.get(s) ?? byStem.set(s, []).get(s)).push(i);
        for (const f of forms(w, irregular)) (byForm.get(f) ?? byForm.set(f, []).get(f)).push(i);
      });
    }
    const hit = new Set();
    for (const t of tokenize(text)) {
      for (const i of byForm.get(t) ?? []) hit.add(i);
      for (const i of byStem.get(stemmer(t)) ?? []) hit.add(i);
    }
    return hit;
  }
  return {
    meta, words: meta.words, index, irregular, lexicon: new Set(meta.words), rows, mentionedIn,
    /** Row of word i's k-th sense (for dropRows). */
    senseRow: (i, k) => wordRows + firstSense[i] + k,
    nSense,
    /**
     * Scores for every word (Float32Array, reused between calls) and the top k, for a unit query vector.
     * mentioned: the description's text. Words it uses (any form or stem) are never guessed: nobody describes a
     *            mouse as "the animal that catches mice" (see docs/vocab.md, "Mentioned words").
     * dropRows (tests only): rows to leave out, e.g. the very definition a reference description was made from.
     */
    guess(q, k = 5, { dropRows = [], mentioned = null } = {}) {
      const all = scorer.score(q);
      for (const r of dropRows) all[r] = -2;
      combine(all.subarray(wordRows), wordRows ? all.subarray(0, wordRows) : null, firstSense, nSense, { ...meta.guess, senseBias, zipf, out });
      if (mentioned) for (const i of mentionedIn(mentioned)) out[i] = -9;
      return { scores: out, top: topIndices(out, k).map((i) => ({ word: meta.words[i], score: out[i] })) };
    },
  };
}
