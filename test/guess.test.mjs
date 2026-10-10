// The guess rule (site/js/guess.js) and the SIMD scorer it relies on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combine, topIndices, senseBiasFrom } from '../site/js/guess.js';
import { createScorer, scoreAll } from '../site/js/embed.js';

// 3 words; word 0 has senses rows 0-1, word 1 has rows 2-4, word 2 has row 5.
const firstSense = Int32Array.of(0, 2, 5), nSense = Int32Array.of(2, 3, 1);
const senses = Float32Array.of(0.2, 0.5, 0.1, 0.3, 0.9, 0.4);
const words = Float32Array.of(0.6, 0.2, 0.45);

test('a word scores its best sense', () => {
  assert.deepEqual([...combine(senses, null, firstSense, nSense, {})].map((x) => +x.toFixed(3)), [0.5, 0.9, 0.4]);
});

test('maxSenses ignores later senses', () => {
  assert.deepEqual([...combine(senses, null, firstSense, nSense, { maxSenses: 2 })].map((x) => +x.toFixed(3)), [0.5, 0.3, 0.4]);
});

test('the word vector counts at its weight, when it beats the senses', () => {
  const s = combine(senses, words, firstSense, nSense, { wordWeight: 0.9 });
  assert.deepEqual([...s].map((x) => +x.toFixed(3)), [0.54, 0.9, 0.405]);
});

test('sense decay and the frequency prior', () => {
  const s = combine(senses, null, firstSense, nSense, { senseDecay: 0.5, freqPrior: 0.1, zipf: Float32Array.of(5, 4, 3) });
  // word 0: max(0.2, 0.5*0.5) = 0.25, +0.1; word 1: max(0.1, 0.15, 0.225) = 0.225; word 2: 0.4 - 0.1
  assert.deepEqual([...s].map((x) => +x.toFixed(3)), [0.35, 0.225, 0.3]);
});

test('sense counts add a bias, so a much-used sense beats a rarely used one', () => {
  // word 1's row 4 (0.9) has count 0; row 3 (0.3) has count 100: bias 0.1 * ln(101) = 0.4615
  const bias = senseBiasFrom([0, 0, 0, 100, 0, 0], 0.1);
  const s = combine(senses, null, firstSense, nSense, { senseBias: bias });
  assert.deepEqual([...s].map((x) => +x.toFixed(3)), [0.5, 0.9, 0.4]);
  const s2 = combine(senses, null, firstSense, nSense, { senseBias: senseBiasFrom([0, 0, 0, 1000, 0, 0], 0.1) });
  assert.equal(+s2[1].toFixed(3), +(0.3 + 0.1 * Math.log1p(1000)).toFixed(3));
  assert.equal(senseBiasFrom([1, 2], 0), null);
});

test('topIndices: best first, ties keep the earlier word, k larger than n', () => {
  assert.deepEqual(topIndices(Float32Array.of(0.1, 0.9, 0.5, 0.9, 0.3), 3), [1, 3, 2]);
  assert.deepEqual(topIndices(Float32Array.of(0.2, 0.1), 5), [0, 1]);
});

test('SIMD scorer matches plain JS', async () => {
  const n = 500, d = 384;
  const simd = await createScorer(n, d);
  assert.ok(simd.simd, 'Node has WASM SIMD');
  const ref = new Int8Array(n * d);
  for (let i = 0; i < ref.length; i++) ref[i] = ((i * 7919) % 255) - 127;
  simd.mat.set(ref);
  const q = Float32Array.from({ length: d }, (_, j) => Math.sin(j) / 14);
  const a = simd.score(q), b = scoreAll(q, ref, d, new Float32Array(n));
  for (let i = 0; i < n; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-3, `row ${i}: ${a[i]} vs ${b[i]}`);
});
