// Offline: the 5 banned words for a target, and the "related" compound lists for the ban check.
//
// Banned words = the 5 vocabulary words closest in meaning to the target, where a word's meaning is its
// "profile": the normalised mean of its word vector and its first 3 sense vectors (style 'plus').
// Skipped: variants of the target or of an already-banned word (no "rain" + "rainy"), and rare words
// (zipf < MIN_ZIPF), because a ban on a word nobody would use protects nothing.
import fs from 'node:fs';
import { isVariant, relatedContaining } from '../site/js/ban.js';

export const MIN_ZIPF = 3.3;
// Compounds at least this close (word-vector cosine) count as using the word: kingdom 0.74, sunlight 0.85,
// fireplace 0.64. 0.5 also caught look-alikes (articulation/art 0.54, balloon/ball 0.54, cargo/car 0.50);
// heart/art 0.44, hear/ear 0.47, season/son 0.34 stay allowed either way. See pipeline/show-related.mjs.
export const RELATED_MIN_SIM = 0.55;

export function loadBanData() {
  const vocab = JSON.parse(fs.readFileSync('data/vocab.json', 'utf8'));
  const irregular = JSON.parse(fs.readFileSync('data/irregular.json', 'utf8'));
  const rows = JSON.parse(fs.readFileSync('data/cache/rows.json', 'utf8'));
  const D = 384, W = vocab.length;
  const words = new Int8Array(fs.readFileSync('data/cache/words.i8').buffer.slice(0));
  const senses = new Int8Array(fs.readFileSync('data/cache/plus.i8').buffer.slice(0));
  const profiles = new Float32Array(W * D);
  const counts = new Int32Array(W);
  for (let i = 0; i < W; i++) for (let j = 0; j < D; j++) profiles[i * D + j] = words[i * D + j];
  rows.owner.forEach((o, r) => {
    if (rows.senseIdx[r] >= 3) return;
    counts[o]++;
    for (let j = 0; j < D; j++) profiles[o * D + j] += senses[r * D + j];
  });
  for (let i = 0; i < W; i++) {
    let n = 0;
    for (let j = 0; j < D; j++) n += profiles[i * D + j] ** 2;
    n = Math.sqrt(n) || 1;
    for (let j = 0; j < D; j++) profiles[i * D + j] /= n;
  }
  const index = new Map(vocab.map((e, i) => [e.w, i]));
  const dot = (m, a, b) => { let s = 0; for (let j = 0; j < D; j++) s += m[a * D + j] * m[b * D + j]; return s; };
  return {
    vocab, irregular, index, W,
    profileSim: (a, b) => dot(profiles, index.get(a), index.get(b)),
    wordSim: (a, b) => dot(words, index.get(a), index.get(b)) / (127 * 127),
  };
}

/** The 5 banned words for `target` (best first). `n` limits candidates to the game's vocabulary size. */
export function bannedFor(target, data, { n = data.W, count = 5 } = {}) {
  const { vocab, irregular, profileSim } = data;
  const scored = [];
  for (let i = 0; i < n; i++) {
    const w = vocab[i].w;
    if (w === target || vocab[i].zipf < MIN_ZIPF) continue;
    scored.push([profileSim(target, w), w]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const out = [];
  for (const [, w] of scored) {
    if (isVariant(w, target, irregular) || out.some((b) => isVariant(w, b, irregular))) continue;
    out.push(w);
    if (out.length === count) break;
  }
  return out;
}

/** { word: [vocabulary compounds that count as using it] } for the target and its banned words. */
export function relatedFor(wordsList, data, { n = data.W } = {}) {
  const pool = data.vocab.slice(0, n).map((e) => e.w);
  return Object.fromEntries(wordsList.map((w) => [w, relatedContaining(w, pool, data.wordSim, { minSim: RELATED_MIN_SIM, irregular: data.irregular })]));
}
