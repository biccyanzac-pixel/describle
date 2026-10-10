// Build the files the game ships, from data/vocab.json, the cached vectors and the settings chosen by tune.mjs.
//   node pipeline/build.mjs   ->  site/data/vocab-v<N>.json + site/data/vectors-v<N>.bin
// Bump VOCAB_VERSION in site/js/vocab.js for any change once the game is live, and keep the old files for past days.
import fs from 'node:fs';
import { VOCAB_VERSION } from '../site/js/vocab.js';
import { MODEL } from './node-embed.mjs';

const { chosen } = JSON.parse(fs.readFileSync('data/tune.json', 'utf8'));
const vocab = JSON.parse(fs.readFileSync('data/vocab.json', 'utf8')).slice(0, chosen.n);
const irregularAll = JSON.parse(fs.readFileSync('data/irregular.json', 'utf8'));
const rows = JSON.parse(fs.readFileSync('data/cache/rows.json', 'utf8'));
const D = MODEL.dim;
const senses = new Int8Array(fs.readFileSync(`data/cache/${chosen.style}.i8`).buffer.slice(0));

// Same row selection as tune.mjs: at most maxSenses per word (most used first); senses after the first need
// at least minCount uses in SemCor.
const keep = [];
rows.owner.forEach((o, r) => {
  if (o >= chosen.n) return;
  const k = rows.senseIdx[r], count = vocab[o].senses[k].count;
  if (k < chosen.maxSenses && (k === 0 || count >= chosen.minCount)) keep.push(r);
});
const nSense = vocab.map(() => 0);
for (const r of keep) nSense[rows.owner[r]]++;
const bin = new Int8Array(keep.length * D);
keep.forEach((r, i) => bin.set(senses.subarray(r * D, (r + 1) * D), i * D));

const lex = new Set(vocab.map((e) => e.w));
const meta = {
  version: VOCAB_VERSION,
  model: { repo: MODEL.repo, revision: MODEL.revision, dtype: MODEL.dtype },
  dim: D,
  wordRows: false,
  guess: { senseDecay: chosen.senseDecay, countBias: chosen.countBias, freqPrior: chosen.freqPrior },
  built: { style: chosen.style, maxSenses: chosen.maxSenses, minCount: chosen.minCount },
  words: vocab.map((e) => e.w),
  senses: nSense,
  counts: keep.map((r) => vocab[rows.owner[r]].senses[rows.senseIdx[r]].count),
  zipf: vocab.map((e) => Math.round(e.zipf * 100)), // hundredths, as tune.mjs uses them
  irregular: Object.fromEntries(Object.entries(irregularAll).filter(([b]) => lex.has(b))),
  credits: 'Definitions: WordNet 3.0, Princeton University (WordNet 3.0 licence). Model: all-MiniLM-L6-v2 (Apache-2.0).',
};
fs.mkdirSync('site/data', { recursive: true });
fs.writeFileSync(`site/data/vocab-v${VOCAB_VERSION}.json`, JSON.stringify(meta));
fs.writeFileSync(`site/data/vectors-v${VOCAB_VERSION}.bin`, bin);
const mb = (b) => (b / 1048576).toFixed(1);
console.log(`v${VOCAB_VERSION}: ${vocab.length} words, ${keep.length} sense rows`);
console.log(`  vectors ${mb(bin.length)} MB, vocab ${(fs.statSync(`site/data/vocab-v${VOCAB_VERSION}.json`).size / 1024).toFixed(0)} KB`);
