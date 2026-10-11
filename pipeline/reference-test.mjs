// Quality test from the spec: 200 targets, each described by WordNet's own first definition with the day's
// banned words (and the target's forms) removed and cut to 25 words. Reports top-1 / top-5.
// "as spec'd" is optimistic: that very definition is in the index. "leave-one-out" hides it, which is closer
// to a player who describes the thing in their own words.
//   node pipeline/reference-test.mjs [count=200] [seed=41]   ->  data/reference-test.json
import fs from 'node:fs';
import { makeVocab, VOCAB_VERSION } from '../site/js/vocab.js';
import { makeBanCheck, tokenize, isVariant } from '../site/js/ban.js';
import { mulberry32 } from './rng.mjs';
import { loadBanData, bannedFor, relatedFor } from './ban-words.mjs';
import { nodeEmbedder } from './node-embed.mjs';

const COUNT = Number(process.argv[2]) || 200, SEED = Number(process.argv[3]) || 41;
const meta = JSON.parse(fs.readFileSync(`site/data/vocab-v${VOCAB_VERSION}.json`, 'utf8'));
const V = await makeVocab(meta, new Int8Array(fs.readFileSync(`site/data/vectors-v${VOCAB_VERSION}.bin`).buffer.slice(0)));
const full = JSON.parse(fs.readFileSync('data/vocab.json', 'utf8'));
const data = await loadBanData();
const E = await nodeEmbedder();

// Candidate targets: common nouns (as the schedule will use), drawn with a fixed seed.
const pool = full.slice(0, meta.words.length).filter((e) => e.zipf >= 4 && e.senses[0].pos === 'n').map((e) => e.w);
const rnd = mulberry32(SEED);
const picks = new Set();
while (picks.size < Math.min(COUNT, pool.length)) picks.add(pool[Math.floor(rnd() * pool.length)]);

const res = { spec: { top1: 0, top5: 0 }, loo: { top1: 0, top5: 0 }, n: 0, examples: [], emptied: 0 };
for (const target of picks) {
  const i = V.index.get(target);
  const banned = bannedFor(target, data, { n: meta.words.length });
  const check = makeBanCheck({ banned: [target, ...banned], related: relatedFor([target, ...banned], data, { n: meta.words.length }), lexicon: V.lexicon, irregular: V.irregular });
  const def = full[i].senses[0].def;
  const bad = new Set(check(def).hits.map((h) => h.token));
  const desc = tokenize(def).filter((t) => !bad.has(t)).slice(0, 25).join(' ');
  if (!desc) { res.emptied++; continue; }
  const [q] = await E.batch([desc]);
  const ok = (w) => isVariant(w, target, V.irregular);
  res.n++;
  for (const [mode, dropRows] of [['spec', []], ['loo', [V.senseRow(i, 0)]]]) {
    const top = V.guess(q, 5, { dropRows }).top.map((t) => t.word);
    if (ok(top[0])) res[mode].top1++;
    if (top.some(ok)) res[mode].top5++;
    if (mode === 'loo' && res.examples.length < 25) res.examples.push({ target, banned, desc, top });
  }
}
const pct = (x) => `${x}/${res.n} (${Math.round((100 * x) / res.n)}%)`;
console.log(`${res.n} targets (${res.emptied} definitions emptied by the ban check)`);
console.log(`  as spec'd:     top-1 ${pct(res.spec.top1)}, top-5 ${pct(res.spec.top5)}`);
console.log(`  leave-one-out: top-1 ${pct(res.loo.top1)}, top-5 ${pct(res.loo.top5)}`);
for (const e of res.examples.slice(0, 12)) console.log(`  ${e.target} [${e.banned.join(', ')}] "${e.desc}" -> ${e.top.join(', ')}`);
fs.writeFileSync('data/reference-test.json', JSON.stringify(res, null, 1));
await E.close();
