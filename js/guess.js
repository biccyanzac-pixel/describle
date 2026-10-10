// How a description becomes a guess: combine per-row cosine scores into one score per vocabulary word.
// Shared by the game and the offline tuner/validator (pipeline/tune.mjs), so they can't disagree.
//
// score(word) = max( max over its senses k of  senseScore_k * senseDecay^k + countBias * ln(1 + count_k) ,
//                    wordWeight * wordScore )
//               + freqPrior * (zipf(word) - 4)
// Senses are most-used first (count_k = how often WordNet's SemCor corpus tagged that sense). The weights are
// tuned in pipeline/tune.mjs; see docs/vocab.md.

/** Per-row additive bias from sense counts: countBias * ln(1 + count). */
export function senseBiasFrom(counts, countBias) {
  return countBias ? Float32Array.from(counts, (c) => countBias * Math.log1p(c)) : null;
}

/**
 * senseScores: cosine per sense row; rows of word i are firstSense[i] .. firstSense[i] + nSense[i] - 1.
 * wordScores:  cosine per word (or null when the word vectors aren't used).
 * opts: { maxSenses, wordWeight, senseDecay, senseBias (per row, from senseBiasFrom), freqPrior, zipf (per word),
 *         n (only the first n words), out }
 */
export function combine(senseScores, wordScores, firstSense, nSense, opts) {
  const { maxSenses = Infinity, wordWeight = 0, senseDecay = 1, senseBias = null, freqPrior = 0, zipf = null } = opts;
  const n = opts.n ?? firstSense.length;
  const out = opts.out ?? new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let best = -2;
    const k1 = Math.min(nSense[i], maxSenses);
    let d = 1;
    for (let k = 0, r = firstSense[i]; k < k1; k++, r++, d *= senseDecay) {
      const s = senseScores[r] * d + (senseBias ? senseBias[r] : 0);
      if (s > best) best = s;
    }
    if (wordScores && wordWeight) {
      const w = wordScores[i] * wordWeight;
      if (w > best) best = w;
    }
    out[i] = best + (freqPrior && zipf ? freqPrior * (zipf[i] - 4) : 0);
  }
  return out;
}

/** Indices of the k highest scores, best first. */
export function topIndices(scores, k = 5) {
  const idx = [];
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (idx.length === k && s <= scores[idx[k - 1]]) continue;
    let j = Math.min(idx.length, k - 1);
    idx[j] = i;
    while (j > 0 && scores[idx[j - 1]] < s) { idx[j] = idx[j - 1]; idx[j - 1] = i; j--; }
  }
  return idx;
}
