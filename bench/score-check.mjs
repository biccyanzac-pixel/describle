// SIMD scorer vs plain JS: same answers? how much faster?  node bench/score-check.mjs
import { createScorer, scoreAll } from '../site/js/embed.js';

for (const D of [256, 384]) {
  const N = 46500;
  const unit = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
  const simd = await createScorer(N, D);
  const js = await createScorer(N, D, { simd: false });
  for (let i = 0; i < N; i++) {
    const row = unit(Float32Array.from({ length: D }, () => Math.random() - 0.5));
    for (let j = 0; j < D; j++) simd.mat[i * D + j] = js.mat[i * D + j] = Math.round(row[j] * 127);
  }
  const q = unit(Float32Array.from({ length: D }, () => Math.random() - 0.5));
  const a = Float32Array.from(simd.score(q)), b = Float32Array.from(js.score(q));
  let maxErr = 0;
  for (let i = 0; i < N; i++) maxErr = Math.max(maxErr, Math.abs(a[i] - b[i]));
  const time = (s) => { s.score(q); const t = performance.now(); for (let k = 0; k < 20; k++) s.score(q); return (performance.now() - t) / 20; };
  console.log(`dim ${D}: simd=${simd.simd} ${time(simd).toFixed(1)} ms, js ${time(js).toFixed(1)} ms, max |diff| ${maxErr.toExponential(2)}`);
}
