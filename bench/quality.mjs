// Phase 1 quality probe: can each model turn a player-style clue into the right word?
// Vocabulary: bench/data/probe_vocab.json (15k words, up to 3 WordNet definitions each; bench/probe_vocab.py).
// Clues: site/bench/clues.json (101 hand-written, none contain the target).
// Vectors are int8-quantised exactly as the shipped file will be, so this measures what the game would see.
//   node bench/quality.mjs [model ...]   -> prints top-1/top-5 per model and weighting, writes bench/results/quality.json
import fs from 'node:fs';
import { pipeline, env } from '@huggingface/transformers';
import { Tokenizer } from '@huggingface/tokenizers';

env.cacheDir = 'models/tjs';
const MODELS = {
  'minilm-l6': { repo: 'Xenova/all-MiniLM-L6-v2', pooling: 'mean' },
  'minilm-l3': { repo: 'Xenova/paraphrase-MiniLM-L3-v2', pooling: 'mean' },
  'arctic-xs': { repo: 'Snowflake/snowflake-arctic-embed-xs', pooling: 'cls', queryPrefix: 'Represent this sentence for searching relevant passages: ' },
  'potion-8m': { static: 'site/models/potion-base-8M/' },
};
const vocab = JSON.parse(fs.readFileSync('bench/data/probe_vocab.json', 'utf8'));
const clues = JSON.parse(fs.readFileSync('site/bench/clues.json', 'utf8')).clues;
const wordIndex = new Map(vocab.map((e, i) => [e.w, i]));

async function makeEmbedder(name) {
  const m = MODELS[name];
  if (m.static) {
    const meta = JSON.parse(fs.readFileSync(m.static + 'meta.json'));
    const tj = JSON.parse(fs.readFileSync(m.static + 'tokenizer.json'));
    const tok = new Tokenizer(tj, {});
    const unk = tj.model.vocab[tj.model.unk_token ?? '[UNK]'];
    const emb = new Int8Array(fs.readFileSync(m.static + 'emb.i8.bin').buffer.slice(0));
    const scale = new Float32Array(fs.readFileSync(m.static + 'scale.f32.bin').buffer.slice(0));
    const one = (t) => {
      const v = new Float32Array(meta.dim);
      for (const id of tok.encode(t, { add_special_tokens: false }).ids) {
        if (id === unk) continue;
        for (let j = 0; j < meta.dim; j++) v[j] += emb[id * meta.dim + j] * scale[id];
      }
      return unit(v);
    };
    return { dim: meta.dim, batch: async (ts) => ts.map(one) };
  }
  const ex = await pipeline('feature-extraction', m.repo, { dtype: 'q8' });
  const dim = ex.model.config.hidden_size;
  return {
    dim, queryPrefix: m.queryPrefix,
    batch: async (ts) => {
      const out = await ex(ts, { pooling: m.pooling, normalize: true });
      return ts.map((_, i) => Float32Array.from(out.data.subarray(i * dim, (i + 1) * dim)));
    },
  };
}

function unit(v) {
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  for (let j = 0; j < v.length; j++) v[j] /= n;
  return v;
}
const q8 = (v) => Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x * 127))));

async function embedAll(name, E) {
  const cache = `bench/data/emb-${name}.bin`;
  const texts = [], owner = [], isWord = [];
  vocab.forEach((e, i) => {
    texts.push(e.w); owner.push(i); isWord.push(1);
    for (const d of e.defs) { texts.push(d); owner.push(i); isWord.push(0); }
  });
  let mat;
  if (fs.existsSync(cache)) mat = new Int8Array(fs.readFileSync(cache).buffer.slice(0));
  else {
    mat = new Int8Array(texts.length * E.dim);
    const t0 = Date.now();
    // Batch texts of similar length together, so little time goes on padding.
    const order = texts.map((_, i) => i).sort((a, b) => texts[a].length - texts[b].length);
    for (let i = 0; i < texts.length; i += 64) {
      const ids = order.slice(i, i + 64);
      const vs = await E.batch(ids.map((k) => texts[k]));
      vs.forEach((v, k) => mat.set(q8(v), ids[k] * E.dim));
      if (i % 6400 === 0) process.stderr.write(`  ${name}: ${i}/${texts.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
    }
    fs.writeFileSync(cache, mat);
  }
  return { mat, owner, isWord, n: texts.length };
}

// Weightings: each word's score = max(best definition score, wordWeight * word score), or one side only.
const WEIGHTS = [['defs only', 1, 0], ['word only', 0, 1], ['max(def, word)', 1, 1], ['max(def, 0.9·word)', 1, 0.9], ['max(def, 0.8·word)', 1, 0.8]];

function evaluate(E, data, qvecs) {
  const res = {};
  for (const [label, wd, ww] of WEIGHTS) {
    let top1 = 0, top5 = 0;
    const misses = [];
    qvecs.forEach((q, ci) => {
      const best = new Float32Array(vocab.length).fill(-9);
      for (let r = 0, o = 0; r < data.n; r++, o += E.dim) {
        const w = data.isWord[r] ? ww : wd;
        if (!w) continue;
        let s = 0;
        for (let j = 0; j < E.dim; j++) s += q[j] * data.mat[o + j];
        s = (s / 127) * w;
        if (s > best[data.owner[r]]) best[data.owner[r]] = s;
      }
      const target = wordIndex.get(clues[ci][0]);
      let rank = 0;
      for (let i = 0; i < best.length; i++) if (best[i] > best[target]) rank++;
      if (rank === 0) top1++;
      if (rank < 5) top5++;
      else {
        let top = 0; for (let i = 1; i < best.length; i++) if (best[i] > best[top]) top = i;
        misses.push(`${clues[ci][0]}→${vocab[top].w} (#${rank + 1})`);
      }
    });
    res[label] = { top1, top5, n: qvecs.length, misses };
  }
  return res;
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(MODELS);
const out = fs.existsSync('bench/results/quality.json') ? JSON.parse(fs.readFileSync('bench/results/quality.json')) : {};
for (const name of names) {
  const E = await makeEmbedder(name);
  const data = await embedAll(name, E);
  const variants = [[name, '']];
  if (E.queryPrefix) variants.push([`${name}+prefix`, E.queryPrefix]);
  for (const [label, prefix] of variants) {
    const qvecs = await E.batch(clues.map((c) => prefix + c[1]));
    out[label] = evaluate(E, data, qvecs);
    for (const [w, r] of Object.entries(out[label])) console.log(`${label.padEnd(17)} ${w.padEnd(20)} top-1 ${String(r.top1).padStart(3)}/${r.n}  top-5 ${String(r.top5).padStart(3)}/${r.n}`);
  }
}
fs.mkdirSync('bench/results', { recursive: true });
fs.writeFileSync('bench/results/quality.json', JSON.stringify(out, null, 1));
