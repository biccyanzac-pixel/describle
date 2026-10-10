// Which JS loop scores 46.5k int8 rows fastest? node bench/score-micro.mjs
const N = 46500, D = 384, mat = new Int8Array(N * D).map(() => (Math.random() * 60 - 30) | 0);
const qf = new Float32Array(D).map(() => Math.random() - 0.5), qi = Int8Array.from(qf, (x) => Math.round(x * 127));
const qi32 = Int32Array.from(qi), out = new Float32Array(N), outI = new Int32Array(N);
const time = (label, f) => { f(); const t = performance.now(); for (let k = 0; k < 10; k++) f(); console.log(label.padEnd(36), ((performance.now() - t) / 10).toFixed(1), 'ms'); };

time('float query × int8 row', () => { for (let i = 0, o = 0; i < N; i++, o += D) { let s = 0; for (let j = 0; j < D; j++) s += qf[j] * mat[o + j]; out[i] = s; } });
time('int32 query × int8 row (int sum)', () => { for (let i = 0, o = 0; i < N; i++, o += D) { let s = 0; for (let j = 0; j < D; j++) s = (s + qi32[j] * mat[o + j]) | 0; outI[i] = s; } });
time('int32 query, 4-way unrolled', () => {
  for (let i = 0, o = 0; i < N; i++, o += D) {
    let a = 0, b = 0, c = 0, d = 0;
    for (let j = 0; j < D; j += 4) { a = (a + qi32[j] * mat[o + j]) | 0; b = (b + qi32[j + 1] * mat[o + j + 1]) | 0; c = (c + qi32[j + 2] * mat[o + j + 2]) | 0; d = (d + qi32[j + 3] * mat[o + j + 3]) | 0; }
    outI[i] = a + b + c + d;
  }
});
time('float query, 4-way unrolled', () => {
  for (let i = 0, o = 0; i < N; i++, o += D) {
    let a = 0, b = 0, c = 0, d = 0;
    for (let j = 0; j < D; j += 4) { a += qf[j] * mat[o + j]; b += qf[j + 1] * mat[o + j + 1]; c += qf[j + 2] * mat[o + j + 2]; d += qf[j + 3] * mat[o + j + 3]; }
    out[i] = a + b + c + d;
  }
});
