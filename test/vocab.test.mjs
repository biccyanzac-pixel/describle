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
