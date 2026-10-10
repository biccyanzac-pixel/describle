// Text -> unit-length vector, in the browser. Two kinds of model:
//   onnx:   a small transformer (MiniLM) run directly on ONNX Runtime Web 1.18, single-threaded. Its tokenizer is
//           @huggingface/tokenizers; pooling and normalising are done here, exactly as Transformers.js's
//           feature-extraction pipeline does them (the offline vectors are built with that pipeline).
//   static: a model2vec table (one vector per token, averaged). No ONNX runtime at all, so a much smaller download.
// Used by the game and by the bench (site/bench/).
//
// Why ORT 1.18 and not Transformers.js + a current ORT (docs/model.md, "iPhone"): every ORT release since 1.19 ships
// only multi-threaded builds, which need *shared* WASM memory. iOS Safari reserves shared memory up front and was
// slow to release it, so on an iPhone the model failed to load ("RangeError: Out of memory") on most visits after the
// first. 1.18 is the last release with a single-threaded build (ort-wasm-simd.wasm), which uses ordinary memory.

export const MODELS = {
  // The game's model (docs/model.md). Pinned to a commit so the vectors in site/data/ always match it.
  // file = what the browser loads; dtype = the same weights as Transformers.js names them (the offline pipeline).
  'minilm-l6': { kind: 'onnx', repo: 'Xenova/all-MiniLM-L6-v2', revision: '751bff37182d3f1213fa05d7196b954e230abad9', file: 'onnx/model_quantized.onnx', dtype: 'q8', pooling: 'mean', dim: 384, licence: 'Apache-2.0' },
  'minilm-l3': { kind: 'onnx', repo: 'Xenova/paraphrase-MiniLM-L3-v2', file: 'onnx/model_quantized.onnx', dtype: 'q8', pooling: 'mean', dim: 384, licence: 'Apache-2.0' },
  'arctic-xs': { kind: 'onnx', repo: 'Snowflake/snowflake-arctic-embed-xs', file: 'onnx/model_quantized.onnx', dtype: 'q8', pooling: 'cls', dim: 384, licence: 'Apache-2.0' },
  'potion-8m': { kind: 'static', path: 'models/potion-base-8M/', dim: 256, licence: 'MIT' },
};

const VENDOR = new URL('../vendor/', import.meta.url);
const SITE = new URL('../', import.meta.url);
const MODEL_CACHE = 'describle-models-v1';
const MAX_TOKENS = 128; // descriptions are at most 25 words

/**
 * Load a model. onProgress({ loaded, total }) is called with byte counts summed over all files.
 * Returns { name, dim, embed(text) -> Float32Array, embedBatch(texts), bytes() }.
 */
export async function loadEmbedder(name, { onProgress = () => {} } = {}) {
  const spec = MODELS[name];
  if (!spec) throw new Error(`Unknown model ${name}`);
  return spec.kind === 'static' ? loadStatic(name, spec, onProgress) : loadOnnx(name, spec, onProgress);
}

/** Which step a load failed in, so phone reports say where (err.stage). */
const staged = async (stage, f) => {
  try { return await f(); } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    err.stage ??= stage;
    throw err;
  }
};

/**
 * Cache API stores that hold model files. Clearing them makes the next load a clean download.
 * (The transformers-* ones are from earlier versions of this page; clearing them frees the space.)
 */
export const MODEL_CACHES = [MODEL_CACHE, 'transformers-cache', 'experimental_transformers-hash-cache'];
export async function clearModelCaches() {
  try { if (typeof caches !== 'undefined') for (const k of await caches.keys()) if (MODEL_CACHES.includes(k)) await caches.delete(k); }
  catch { /* storage blocked */ }
}

/** Sums byte progress over several files into one onProgress({ loaded, total }). */
function progressOver(onProgress) {
  const files = new Map();
  return (name) => (loaded, total) => {
    files.set(name, { loaded, total });
    let l = 0, t = 0;
    for (const f of files.values()) { l += f.loaded; t += f.total; }
    onProgress({ loaded: l, total: t });
  };
}

let ortPromise = null;
function loadOrt() {
  ortPromise ??= import(new URL('ort/ort.wasm.min.js', VENDOR).href).then((ort) => {
    ort.env.wasm.wasmPaths = new URL('ort/', VENDOR).href; // -> ort-wasm-simd.wasm
    ort.env.wasm.numThreads = 1;                           // the single-threaded build: ordinary WASM memory
    ort.env.wasm.proxy = false;
    return ort;
  });
  return ortPromise;
}

export const hubUrl = (spec, file) => `https://huggingface.co/${spec.repo}/resolve/${spec.revision ?? 'main'}/${file}`;

async function loadOnnx(name, spec, onProgress) {
  const ort = await staged('library', loadOrt);
  const { Tokenizer } = await staged('library', () => import(new URL('tokenizers/tokenizers.min.mjs', VENDOR).href));
  const prog = progressOver(onProgress);
  const files = ['tokenizer.json', 'tokenizer_config.json', spec.file];
  const bufs = await staged('download', () => Promise.all(files.map((f) => fetchCached(hubUrl(spec, f), prog(f)))));
  const dec = new TextDecoder();
  const core = await staged('model', () => createOnnxEmbedder({
    ort, Tokenizer, spec, modelBytes: new Uint8Array(bufs[2]),
    tokenizerJson: JSON.parse(dec.decode(bufs[0])), tokenizerConfig: JSON.parse(dec.decode(bufs[1])),
  }));
  const bytes = bufs.reduce((s, b) => s + b.byteLength, 0);
  return { name, ...core, bytes: () => bytes };
}

/**
 * The embedding itself, shared by the browser (above) and the offline pipeline (pipeline/node-embed.mjs, which
 * passes in the very same ort.wasm.min.js), so the shipped vectors are exactly what a phone computes.
 * One text per model call, always: the int8 model quantises activations with a scale taken over the whole input,
 * so padding a text into a batch changes its vector (docs/model.md, "Parity").
 */
export async function createOnnxEmbedder({ ort, Tokenizer, spec, modelBytes, tokenizerJson, tokenizerConfig }) {
  const tok = new Tokenizer(tokenizerJson, tokenizerConfig);
  const session = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  const D = spec.dim;
  const hasTypes = session.inputNames.includes('token_type_ids');
  async function embed(text) {
    let ids = tok.encode(String(text)).ids;
    if (ids.length > MAX_TOKENS) ids = [...ids.slice(0, MAX_TOKENS - 1), ids.at(-1)]; // keep [SEP] last
    const L = ids.length;
    const feeds = {
      input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, L]),
      attention_mask: new ort.Tensor('int64', new BigInt64Array(L).fill(1n), [1, L]),
    };
    if (hasTypes) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(L), [1, L]);
    const out = await session.run(feeds);
    const h = out[session.outputNames[0]].data; // last_hidden_state [1, L, D]
    const v = new Float32Array(D);
    if (spec.pooling === 'cls') for (let j = 0; j < D; j++) v[j] = h[j];
    else {
      for (let i = 0; i < L; i++) for (let j = 0; j < D; j++) v[j] += h[i * D + j];
      for (let j = 0; j < D; j++) v[j] /= L;
    }
    return unit(v);
  }
  async function embedBatch(texts) {
    const res = [];
    for (const t of texts) res.push(await embed(t));
    return res;
  }
  return { dim: D, embed, embedBatch };
}

function unit(v) {
  let n = 0;
  for (let j = 0; j < v.length; j++) n += v[j] * v[j];
  n = Math.sqrt(n) || 1;
  for (let j = 0; j < v.length; j++) v[j] /= n;
  return v;
}

/** Fetch with byte progress, through the Cache API when the browser has it (it doesn't on plain http). */
export async function fetchCached(url, onBytes = () => {}) {
  let cache = null;
  try { if (typeof caches !== 'undefined') cache = await caches.open(MODEL_CACHE); } catch { /* private mode etc. */ }
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
