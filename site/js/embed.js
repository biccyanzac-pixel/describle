// Text -> unit-length vector, in the browser. Two kinds of model:
//   onnx:   a small transformer run by Transformers.js on ONNX Runtime (WASM, one thread: GitHub Pages can't
//           send the COOP/COEP headers that multi-threaded WASM needs).
//   static: a model2vec table (one vector per token, averaged). No ONNX runtime at all, so a much smaller download.
// Used by the game and by the Phase 1 bench (site/bench/).

export const MODELS = {
  // The game's model (docs/model.md). Pinned to a commit so the vectors in site/data/ always match it.
  'minilm-l6': { kind: 'onnx', repo: 'Xenova/all-MiniLM-L6-v2', revision: '751bff37182d3f1213fa05d7196b954e230abad9', dtype: 'q8', pooling: 'mean', dim: 384, licence: 'Apache-2.0' },
  'minilm-l3': { kind: 'onnx', repo: 'Xenova/paraphrase-MiniLM-L3-v2', dtype: 'q8', pooling: 'mean', dim: 384, licence: 'Apache-2.0' },
  'arctic-xs': { kind: 'onnx', repo: 'Snowflake/snowflake-arctic-embed-xs', dtype: 'q8', pooling: 'cls', dim: 384, licence: 'Apache-2.0' },
  'potion-8m': { kind: 'static', path: 'models/potion-base-8M/', dim: 256, licence: 'MIT' },
};

const VENDOR = new URL('../vendor/', import.meta.url);
// Transformers.js comes from jsDelivr, pinned: GitHub's secret scanner mistakes some of its minified class names
// for an API key and refuses the push, so it can't be vendored. ONNX Runtime (the big part) is still served from here.
const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/';
const SITE = new URL('../', import.meta.url);
const STATIC_CACHE = 'describle-models-v1';

/**
 * Load a model. onProgress({ loaded, total }) is called with byte counts summed over all files.
 * runtime: 'lean' = Transformers.js web build + ORT's WASM-only bundle (14 MB .wasm, served from this site);
 *          'default' = Transformers.js's own choice (27 MB asyncify .wasm from jsDelivr).
 * Returns { name, dim, embed(text) -> Float32Array, bytes }.
 */
export async function loadEmbedder(name, { onProgress = () => {}, runtime = 'lean' } = {}) {
  const spec = MODELS[name];
  if (!spec) throw new Error(`Unknown model ${name}`);
  return spec.kind === 'static' ? loadStatic(name, spec, onProgress) : loadOnnx(name, spec, onProgress, runtime);
}

async function loadOnnx(name, spec, onProgress, runtime) {
  // 'lean' needs the page's import map: onnxruntime-web/webgpu and onnxruntime-common -> vendor/ort/ort.wasm.min.mjs
  const tf = runtime === 'lean'
    ? await import(`${TJS}transformers.web.min.js`)
    : await import(`${TJS}transformers.min.js`);
  const { pipeline, env } = tf;
  env.allowLocalModels = false;
  const wasm = env.backends.onnx.wasm;
  wasm.numThreads = 1;
  if (runtime === 'lean') {
    wasm.wasmPaths = {
      mjs: new URL('ort/ort-wasm-simd-threaded.mjs', VENDOR).href,
      wasm: new URL('ort/ort-wasm-simd-threaded.wasm', VENDOR).href,
    };
  }
  const files = new Map();
  let bytes = 0;
  const extractor = await pipeline('feature-extraction', spec.repo, {
    dtype: spec.dtype,
    ...(spec.revision && { revision: spec.revision }),
    device: 'wasm',
    progress_callback: (e) => {
      if (e.status === 'progress' && e.file) {
        files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 });
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        bytes = total;
        onProgress({ loaded, total });
      }
    },
  });
  return {
    name, dim: spec.dim, bytes: () => bytes,
    async embed(text) {
      const out = await extractor(text, { pooling: spec.pooling, normalize: true });
      return Float32Array.from(out.data);
    },
    async embedBatch(texts) {
      const out = await extractor(texts, { pooling: spec.pooling, normalize: true });
      const d = spec.dim, res = [];
      for (let i = 0; i < texts.length; i++) res.push(Float32Array.from(out.data.subarray(i * d, (i + 1) * d)));
      return res;
    },
  };
}

/** Fetch with byte progress, through the Cache API when the browser has it (it doesn't on plain http). */
export async function fetchCached(url, onBytes = () => {}) {
  let cache = null;
  try { if (typeof caches !== 'undefined') cache = await caches.open(STATIC_CACHE); } catch { /* private mode etc. */ }
  let res = cache && await cache.match(url).catch(() => null);
  const fromCache = !!res;
  if (!res) {
    res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('Content-Length')) || 0;
  const reader = res.clone().body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); loaded += value.length;
    onBytes(loaded, Math.max(total, loaded));
  }
  if (cache && !fromCache) await cache.put(url, res).catch(() => {});
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return buf.buffer;
}

async function loadStatic(name, spec, onProgress) {
  const base = new URL(spec.path, SITE);
  const parts = ['meta.json', 'tokenizer.json', 'emb.i8.bin', 'scale.f32.bin'];
  const prog = new Map();
  const bufs = await Promise.all(parts.map((p) => fetchCached(new URL(p, base).href, (loaded, total) => {
    prog.set(p, { loaded, total });
    let l = 0, t = 0;
    for (const v of prog.values()) { l += v.loaded; t += v.total; }
    onProgress({ loaded: l, total: t });
  })));
  const dec = new TextDecoder();
  const meta = JSON.parse(dec.decode(bufs[0]));
  const tokJson = JSON.parse(dec.decode(bufs[1]));
  const emb = new Int8Array(bufs[2]);
  const scale = new Float32Array(bufs[3]);
  const { Tokenizer } = await import(new URL('tokenizers/tokenizers.min.mjs', VENDOR).href);
  const tok = new Tokenizer(tokJson, {});
  const unk = tokJson.model?.vocab?.[tokJson.model?.unk_token ?? '[UNK]'];
  const dim = meta.dim;
  const bytes = bufs.reduce((s, b) => s + b.byteLength, 0);
  const embed = (text) => {
    const ids = tok.encode(text, { add_special_tokens: false }).ids.filter((id) => id !== unk && id < meta.vocab);
    const v = new Float32Array(dim);
    for (const id of ids) {
      const s = scale[id], o = id * dim;
      for (let j = 0; j < dim; j++) v[j] += emb[o + j] * s;
    }
    let n = 0;
    for (let j = 0; j < dim; j++) n += v[j] * v[j];
    n = Math.sqrt(n) || 1;
    for (let j = 0; j < dim; j++) v[j] /= n;
    return v;
  };
  return { name, dim, bytes: () => bytes, embed: async (t) => embed(t), embedBatch: async (ts) => ts.map(embed) };
}

/**
 * Cosine scores of a unit query against N int8 rows (each row a unit vector scaled by 127, so the
 * dot product / 127 is the cosine). Writes into out (Float32Array(N)).
 */
export function scoreAll(q, mat, dim, out) {
  const n = out.length;
  for (let i = 0, o = 0; i < n; i++, o += dim) {
    let s = 0;
    for (let j = 0; j < dim; j++) s += q[j] * mat[o + j];
    out[i] = s / 127;
  }
  return out;
}

/**
 * Scorer for n int8 rows of `dim`, kept in WASM memory and scored with SIMD (tools/score.wat), falling back to
 * scoreAll() where WASM SIMD isn't available. Fill `mat` (n*dim int8, rows = unit vector * 127) once, then
 * score(q) returns cosines as a Float32Array(n), reused between calls.
 */
export async function createScorer(n, dim, { simd = true } = {}) {
  const { SCORE_WASM } = await import('./score.wasm.js');
  const bytes = Uint8Array.from(atob(SCORE_WASM), (c) => c.charCodeAt(0));
  const out = new Float32Array(n);
  if (!simd || dim % 16 || !WebAssembly.validate(bytes)) {
    const mat = new Int8Array(n * dim);
    return { simd: false, mat, score: (q) => scoreAll(q, mat, dim, out) };
  }
  const { instance } = await WebAssembly.instantiate(bytes);
  const { mem, score } = instance.exports;
  const align = (x) => (x + 15) & ~15;
  const qOff = 0, outOff = align(dim * 2), matOff = align(outOff + n * 4);
  mem.grow(Math.ceil((matOff + n * dim) / 65536) - mem.buffer.byteLength / 65536);
  const Q = 16383; // query scale: |q| <= 1, so int16 products summed over 384 dims stay far inside int32
  const q16 = new Int16Array(mem.buffer, qOff, dim), outI = new Int32Array(mem.buffer, outOff, n);
  const mat = new Int8Array(mem.buffer, matOff, n * dim);
  return {
    simd: true, mat,
    score(q) {
      for (let j = 0; j < dim; j++) q16[j] = Math.round(q[j] * Q);
      score(qOff, matOff, n, dim, outOff);
      const k = 1 / (127 * Q);
      for (let i = 0; i < n; i++) out[i] = outI[i] * k;
      return out;
    },
  };
}

/** Indices of the k largest values. */
export function topK(scores, k) {
  const idx = [];
  for (let i = 0; i < scores.length; i++) {
    if (idx.length < k) { idx.push(i); idx.sort((a, b) => scores[b] - scores[a]); }
    else if (scores[i] > scores[idx[k - 1]]) { idx[k - 1] = i; idx.sort((a, b) => scores[b] - scores[a]); }
  }
  return idx;
}
