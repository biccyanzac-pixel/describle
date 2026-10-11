// Try descriptions against a word, exactly as the game would (headless Chrome, the shipped vocabulary).
//   node pipeline/try.mjs earn "get money for doing your job" "be paid for work"
//   node pipeline/try.mjs --file data/clues-dev.json --file data/clues-schedule-probe.json [--quiet]
//     (files: [[word, description], ...] or { clues: [...] })
// Prints each description's rank and top 5, and totals with and without the "never guess a word the description
// uses" rule (the game uses it).
import fs from 'node:fs';
import { makeVocab, VOCAB_VERSION } from '../site/js/vocab.js';
import { isVariant } from '../site/js/ban.js';
import { nodeEmbedder } from './node-embed.mjs';

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
let pairs = [];
const files = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--file') files.push(args[++i]);
if (files.length) {
  for (const f of files) { const d = JSON.parse(fs.readFileSync(f, 'utf8')); pairs.push(...(Array.isArray(d) ? d : d.clues).map((c) => [...c, f])); }
} else pairs = args.filter((a) => !a.startsWith('--')).slice(1).map((d) => [args[0], d, 'args']);

const meta = JSON.parse(fs.readFileSync(`site/data/vocab-v${VOCAB_VERSION}.json`, 'utf8'));
const V = await makeVocab(meta, new Int8Array(fs.readFileSync(`site/data/vectors-v${VOCAB_VERSION}.bin`).buffer.slice(0)));
pairs = pairs.filter(([w]) => V.index.has(w));
const E = await nodeEmbedder({ workers: 4 });
const vecs = await E.batch(pairs.map((p) => p[1]));
await E.close();

const totals = {};
for (const mode of ['plain', 'mentioned']) {
  pairs.forEach(([w, d, src], i) => {
    const { scores, top } = V.guess(vecs[i], 5, { mentioned: mode === 'mentioned' ? d : null });
    const t = V.index.get(w);
    let rank = 1;
    for (let j = 0; j < scores.length; j++) if (scores[j] > scores[t] && !isVariant(V.words[j], w, V.irregular)) rank++;
    const s = (totals[`${mode} ${src}`] ??= [0, 0, 0]);
    s[0]++;
    if (isVariant(top[0].word, w, V.irregular)) s[1]++;
    if (rank <= 5) s[2]++;
    if (!quiet && mode === 'mentioned') console.log(`${w.padEnd(12)} #${String(rank).padEnd(4)} "${d}" -> ${top.map((x) => x.word).join(', ')}`);
  });
}
for (const [k, [n, a, b]] of Object.entries(totals)) console.log(`${k.padEnd(44)} right first time ${a}/${n} (${Math.round((100 * a) / n)}%), top 5 ${b}/${n} (${Math.round((100 * b) / n)}%)`);
