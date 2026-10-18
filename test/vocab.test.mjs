// The shipped vocabulary + vector files (pipeline/build.mjs), loaded the way the browser loads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeVocab, VOCAB_VERSION } from '../site/js/vocab.js';
import { isVariant } from '../site/js/ban.js';

const metaFile = new URL(`../site/data/vocab-v${VOCAB_VERSION}.json`, import.meta.url);
const binFile = new URL(`../site/data/vectors-v${VOCAB_VERSION}.bin`, import.meta.url);
const built = fs.existsSync(metaFile) && fs.existsSync(binFile);
const meta = built && JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const bin = built && new Int8Array(fs.readFileSync(binFile).buffer.slice(0));

test('vector file matches its vocabulary', { skip: !built && 'run pipeline/build.mjs' }, () => {
  const rows = meta.senses.reduce((a, b) => a + b, 0);
  assert.equal(bin.length, rows * meta.dim);
  assert.equal(meta.counts.length, rows);
  assert.equal(new Set(meta.words).size, meta.words.length);
  assert.ok(meta.senses.every((n) => n >= 1));
  assert.ok(meta.zipf.every((z, i) => i === 0 || z <= meta.zipf[i - 1]), 'most frequent words first');
  assert.ok(Object.keys(meta.irregular).every((w) => meta.words.includes(w)));
  assert.equal(meta.model.revision, '751bff37182d3f1213fa05d7196b954e230abad9');
  // Rows are unit vectors * 127: norms close to 127.
  for (const r of [0, 1, Math.floor(rows / 2), rows - 1]) {
    let n = 0;
    for (let j = 0; j < meta.dim; j++) n += bin[r * meta.dim + j] ** 2;
    assert.ok(Math.abs(Math.sqrt(n) - 127) < 3, `row ${r} norm ${Math.sqrt(n)}`);
  }
});

test('the AI never guesses a word the description uses (any form or stem)', { skip: !built && 'run pipeline/build.mjs' }, async () => {
  const V = await makeVocab(meta, bin);
  const hit = V.mentionedIn('a small animal that catches mice and has whiskers');
  for (const w of ['mouse', 'catch', 'animal', 'whisker', 'small']) if (V.index.has(w)) assert.ok(hit.has(V.index.get(w)), w);
  assert.ok(!hit.has(V.index.get('cat')));
  // and guess() leaves them out of the top
  const q = new Float32Array(meta.dim); q[0] = 1;
  const { scores } = V.guess(q, 5, { mentioned: 'mice' });
  assert.equal(scores[V.index.get('mouse')], -9);
});

test('the browser path reproduces the tuner on every clue set', { skip: !built && 'run pipeline/build.mjs', timeout: 300000 }, async () => {
  const { nodeEmbedder } = await import('../pipeline/node-embed.mjs');
  const tune = JSON.parse(fs.readFileSync(new URL('../data/tune.json', import.meta.url), 'utf8'));
  const V = await makeVocab(meta, bin);
  const E = await nodeEmbedder({ workers: 2 }); // headless Chrome running site/js/embed.js
  const sets = [['dev', tune.dev], ['test', tune.test], ['test2', tune.test2]];
  const clueSets = sets.map(([set]) => JSON.parse(fs.readFileSync(new URL(`../data/clues-${set}.json`, import.meta.url), 'utf8')).clues.filter(([t]) => V.index.has(t)));
  const queries = [];
  try { for (const clues of clueSets) queries.push(await E.batch(clues.map((c) => c[1]))); } finally { await E.close(); }
  for (const [k, [set, expected]] of sets.entries()) {
    const clues = clueSets[k], qs = queries[k];
    let top1 = 0, top5 = 0;
    clues.forEach(([target], i) => {
      const top = V.guess(qs[i]).top.map((t) => t.word);
      assert.equal(top.length, 5);
      const ok = (w) => isVariant(w, target, V.irregular);
      if (ok(top[0])) top1++;
      if (top.some(ok)) top5++;
    });
    assert.deepEqual({ n: clues.length, top1, top5 }, { n: expected.n, top1: expected.top1, top5: expected.top5 }, set);
  }
});

test("the word's place among all the words agrees with the top 5", { skip: !built && 'run pipeline/build.mjs' }, async () => {
  const V = await makeVocab(meta, bin);
  // A query that is some word's own sense vector: a spread of places for other targets.
  const q = Float32Array.from(bin.subarray(V.senseRow(V.index.get('apple'), 0) * meta.dim, (V.senseRow(V.index.get('apple'), 0) + 1) * meta.dim), (x) => x / 127);
  const { scores, top } = V.guess(q, 5);
  top.forEach((t, i) => assert.equal(V.place(scores, t.word), i + 1, t.word));
  for (const w of ['democracy', 'run', 'blue']) {
    const p = V.place(scores, w);
    assert.ok(p > 5 && p <= meta.words.length, `${w}: ${p}`);
    // exactly the words above it score higher (or tie and come first)
    const s = Math.max(...meta.words.flatMap((x, i) => (isVariant(x, w, meta.irregular) ? [scores[i]] : [])));
    const above = [...scores].filter((x) => x > s).length, level = [...scores].filter((x) => x >= s).length;
    assert.ok(p >= above + 1 && p <= level, `${w}: ${p} not in ${above + 1}..${level}`);
  }
  assert.equal(V.place(scores, 'notaword-xyz'), 0);
});
