// Tune how definitions, sense usage and word frequency combine into a guess (site/js/guess.js).
// Chooses on data/clues-dev.json only. The chosen setting is then scored once on each held-out set:
//   test   data/clues-test.json   (its misses were looked at once, which led to the sense-count settings)
//   test2  data/clues-test2.json  (written after that; never looked at before the final run)
//   node pipeline/tune.mjs [--n 15000]   ->  prints the best settings and each setting's effect, writes data/tune.json
// A guess counts if the top word is the target or a variant of it (isVariant: same stem or an inflection).
import fs from 'node:fs';
import { createScorer } from '../site/js/embed.js';
import { combine, topIndices, senseBiasFrom } from '../site/js/guess.js';
import { isVariant } from '../site/js/ban.js';
import { nodeEmbedder } from './node-embed.mjs';

const vocab = JSON.parse(fs.readFileSync('data/vocab.json', 'utf8'));
const irregular = JSON.parse(fs.readFileSync('data/irregular.json', 'utf8'));
const rows = JSON.parse(fs.readFileSync('data/cache/rows.json', 'utf8'));
const W = vocab.length, S = rows.owner.length;
const zipf = Float32Array.from(vocab, (e) => Math.round(e.zipf * 100) / 100); // as shipped (build.mjs)
const firstSense = new Int32Array(W), nSense = new Int32Array(W);
rows.owner.forEach((o, r) => { if (nSense[o]++ === 0) firstSense[o] = r; });
const counts = rows.owner.map((o, r) => vocab[o].senses[rows.senseIdx[r]].count);
const index = new Map(vocab.map((e, i) => [e.w, i]));
const STYLES = ['def', 'plus', 'hyper'];

const sets = { dev: 'data/clues-dev.json', test: 'data/clues-test.json', test2: 'data/clues-test2.json' };
const clues = {};
for (const [k, f] of Object.entries(sets)) clues[k] = JSON.parse(fs.readFileSync(f, 'utf8')).clues.filter(([t]) => index.has(t));

// Cosines of every clue against every row, once.
const E = await nodeEmbedder();
const pre = {};
for (const st of STYLES) {
  const sc = await createScorer(S, E.dim);
  sc.mat.set(new Int8Array(fs.readFileSync(`data/cache/${st}.i8`).buffer.slice(0)));
  for (const [set, list] of Object.entries(clues)) {
    const qs = await E.batch(list.map((c) => c[1]));
    pre[set] ??= list.map(([target]) => ({
      target, ti: index.get(target),
      ok: new Set([index.get(target), ...vocab.flatMap((e, j) => (isVariant(e.w, target, irregular) ? [j] : []))]),
    }));
    pre[set].forEach((c, i) => { c[st] = Float32Array.from(sc.score(qs[i])); });
  }
}

// minCount: rows after a word's first sense need at least this SemCor count, or they're left out.
const masks = {};
for (const m of [0, 1]) masks[m] = rows.senseIdx.map((k, r) => k === 0 || counts[r] >= m);
const biases = {};
const scratch = new Float32Array(S), out = new Float32Array(W);

function evaluate(set, cfg) {
  let top1 = 0, top5 = 0, n = 0;
  const misses = [];
  const bias = (biases[cfg.countBias] ??= senseBiasFrom(counts, cfg.countBias));
  const mask = masks[cfg.minCount];
  for (const c of pre[set]) {
    if (c.ti >= cfg.n) continue;
    n++;
    const src = c[cfg.style];
    for (let r = 0; r < S; r++) scratch[r] = mask[r] ? src[r] : -2;
    combine(scratch, null, firstSense, nSense, { ...cfg, senseBias: bias, zipf, out });
    const top = topIndices(out.subarray(0, cfg.n), 5);
    if (c.ok.has(top[0])) top1++;
    if (top.some((t) => c.ok.has(t))) top5++;
    else misses.push(`${c.target}→${vocab[top[0]].w}`);
  }
  return { top1, top5, n, misses };
}

// --n 15000 fixes the vocabulary size (the spec asks for 15–20k words; on dev 10k–20k are within noise).
const nArg = process.argv.indexOf('--n');
const sizes = nArg > 0 ? [Number(process.argv[nArg + 1])] : [10000, 12000, 15000, 20000];
const grid = [];
for (const n of sizes)
  for (const style of STYLES)
    for (const maxSenses of [2, 3, 4, 6])
      for (const senseDecay of [1, 0.97])
        for (const countBias of [0, 0.005, 0.01, 0.02])
          for (const minCount of [0, 1])
            for (const freqPrior of [0, 0.02, 0.04]) grid.push({ n, style, maxSenses, senseDecay, countBias, minCount, freqPrior });

const t0 = Date.now();
const results = grid.map((cfg) => ({ cfg, dev: evaluate('dev', cfg) }));
const value = (r) => r.dev.top1 / r.dev.n + 0.5 * r.dev.top5 / r.dev.n;
results.sort((a, b) => value(b) - value(a));
console.log(`${grid.length} settings in ${((Date.now() - t0) / 1000).toFixed(0)} s. Best on dev:`);
for (const r of results.slice(0, 8)) console.log(`  ${JSON.stringify(r.cfg)}  top-1 ${r.dev.top1}/${r.dev.n}  top-5 ${r.dev.top5}/${r.dev.n}`);

const effects = {};
for (const key of Object.keys(grid[0])) {
  effects[key] = {};
  for (const r of results) {
    const v = String(r.cfg[key]);
    if (!effects[key][v]) effects[key][v] = `${r.dev.top1}/${r.dev.top5} of ${r.dev.n}`;
  }
  console.log(`  best with ${key} = ${Object.entries(effects[key]).map(([v, s]) => `${v}: ${s}`).join(', ')}`);
}

const best = results[0];
const test = evaluate('test', best.cfg), test2 = evaluate('test2', best.cfg);
console.log(`\nChosen: ${JSON.stringify(best.cfg)}`);
for (const [name, r] of [['dev', best.dev], ['test', test], ['test2', test2]]) console.log(`  ${name.padEnd(5)} top-1 ${r.top1}/${r.n}, top-5 ${r.top5}/${r.n}`);
console.log(`  test2 misses: ${test2.misses.join(', ')}`);
// For comparison only (never used to choose): the untuned rule, as in the Phase 1 probe.
const baseCfg = { n: 15000, style: 'def', maxSenses: 3, senseDecay: 1, countBias: 0, minCount: 0, freqPrior: 0 };
const baseline = Object.fromEntries(['dev', 'test', 'test2'].map((s) => [s, evaluate(s, baseCfg)]));
console.log(`Baseline ${JSON.stringify(baseCfg)}: ${Object.entries(baseline).map(([s, r]) => `${s} ${r.top1}/${r.top5} of ${r.n}`).join(', ')}`);
fs.writeFileSync('data/tune.json', JSON.stringify({ chosen: best.cfg, dev: best.dev, test, test2, baseline: { cfg: baseCfg, ...baseline }, top: results.slice(0, 30).map((r) => ({ ...r.cfg, dev1: r.dev.top1, dev5: r.dev.top5 })), effects }, null, 1));
