// Phase 3, step 2 (the spec's offline validation): for each candidate target, describe it with its own main WordNet
// definition minus everything the day's ban check refuses (data/targets.json "reference"), embed that exactly as the
// game would (headless Chrome, site/js/embed.js) and guess. A target passes if the model puts it in its top 5.
//   node pipeline/validate.mjs   ->  data/validation.json, prints the pass-rate report
// Also records the target's rank and margin (its score minus the best other word's): the schedule uses margin as
// part of difficulty.
import fs from 'node:fs';
import { makeVocab, VOCAB_VERSION } from '../site/js/vocab.js';
import { forms } from '../site/js/ban.js';
import { stemmer } from '../site/vendor/stemmer/stemmer.js';
import { nodeEmbedder } from './node-embed.mjs';

const targets = JSON.parse(fs.readFileSync('data/targets.json', 'utf8'));
const meta = JSON.parse(fs.readFileSync(`site/data/vocab-v${VOCAB_VERSION}.json`, 'utf8'));
const V = await makeVocab(meta, new Int8Array(fs.readFileSync(`site/data/vectors-v${VOCAB_VERSION}.bin`).buffer.slice(0)));
const E = await nodeEmbedder();
const withText = targets.filter((t) => t.reference);
const vecs = await E.batch(withText.map((t) => t.reference), { log: (m) => console.log(`  embedded ${m}`) });
await E.close();

// Which vocabulary words count as the target (isVariant), precomputed: stemming 15k words per target is too slow.
const stems = V.words.map((w) => stemmer(w));
const formOf = new Map(); // form -> indices of the words it's a form of
V.words.forEach((w, j) => { for (const f of forms(w, V.irregular)) (formOf.get(f) ?? formOf.set(f, []).get(f)).push(j); });
function variantsOf(w) {
  const s = new Set(formOf.get(w) ?? []);
  const st = stemmer(w), fw = forms(w, V.irregular);
  V.words.forEach((x, j) => { if (stems[j] === st || fw.has(x)) s.add(j); });
  return s;
}

const out = {};
withText.forEach((t, i) => {
  const { scores } = V.guess(vecs[i], 5);
  const variants = variantsOf(t.w);
  const ok = (j) => variants.has(j);
  // rank: 1 + number of non-variant words scoring above the target's best variant
  let best = -Infinity, rival = -Infinity, rivalWord = null;
  for (let j = 0; j < scores.length; j++) {
    if (ok(j)) { if (scores[j] > best) best = scores[j]; }
    else if (scores[j] > rival) { rival = scores[j]; rivalWord = V.words[j]; }
  }
  let rank = 1;
  for (let j = 0; j < scores.length; j++) if (!ok(j) && scores[j] > best) rank++;
  out[t.w] = { rank, margin: +(best - rival).toFixed(4), rival: rivalWord, pass: rank <= 5 };
});
for (const t of targets) if (!t.reference) out[t.w] = { rank: null, margin: null, rival: null, pass: false, why: 'empty reference' };
fs.writeFileSync('data/validation.json', JSON.stringify(out));

const pct = (a, b) => `${a}/${b} (${((100 * a) / b).toFixed(1)}%)`;
const report = (label, list) => {
  const v = list.map((t) => out[t.w]);
  console.log(`${label.padEnd(16)} top-5 ${pct(v.filter((x) => x.pass).length, v.length)}, top-1 ${pct(v.filter((x) => x.rank === 1).length, v.length)}`);
};
report('all', targets);
for (const tier of [...new Set(targets.map((t) => t.tier))]) report(tier, targets.filter((t) => t.tier === tier));
const fails = targets.filter((t) => !out[t.w].pass).slice(0, 12);
console.log(`failures, e.g.: ${fails.map((t) => `${t.w} (#${out[t.w].rank}, "${t.reference}" -> ${out[t.w].rival})`).join('; ')}`);
