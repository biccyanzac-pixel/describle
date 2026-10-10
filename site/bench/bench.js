// Model bench. ?model=<name>&rows=25024&guesses=20&auto=1   (?phone=1&of=3: the one-tap phone test)
// Results are kept in localStorage (so a phone can run several models and copy them all at once) and
// exposed as window.__bench for bench/run-browser.mjs.

// --- WASM memory: track every Memory the page creates or instantiates, so we can read its size on any browser.
const memories = new Set();
const memoryRequests = []; // what each new WebAssembly.Memory asked for (shows the 512 MB cap is applied)
const OrigMemory = WebAssembly.Memory;
WebAssembly.Memory = new Proxy(OrigMemory, {
  construct(T, args) {
    const d = args[0] ?? {};
    if (d.initial) memoryRequests.push(`${d.shared ? 'shared ' : ''}max ${d.maximum === undefined ? 'none' : `${Math.round(d.maximum / 16)} MB`}`);
    const m = new T(...args); memories.add(m); return m;
  },
});
const grab = (r) => {
  const inst = r?.instance ?? r;
  for (const v of Object.values(inst?.exports ?? {})) if (v instanceof OrigMemory) memories.add(v);
  return r;
};
for (const fn of ['instantiate', 'instantiateStreaming']) {
  const orig = WebAssembly[fn];
  if (orig) WebAssembly[fn] = (...a) => orig.apply(WebAssembly, a).then(grab);
}
const wasmBytes = () => [...memories].reduce((s, m) => s + m.buffer.byteLength, 0);

import { MODELS, loadEmbedder, createScorer, topK, clearModelCaches } from '../js/embed.js';
import { loadVocab } from '../js/vocab.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const STORE = 'describle:bench';
const MB = (b) => (b / 1048576).toFixed(1);
const ms = (x) => Math.round(x);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

function loadResults() { try { return JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { return []; } }
function saveResults(r) { try { localStorage.setItem(STORE, JSON.stringify(r)); } catch { /* storage blocked */ } }

function device() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) { const m = ua.match(/OS (\d+)_(\d+)/); return m ? `iOS ${m[1]}.${m[2]}` : 'iOS'; }
  if (/Android/.test(ua)) return 'Android';
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari/WebKit';
  if (/Firefox\//.test(ua)) return 'Firefox';
  return 'other';
}

async function jsHeap() {
  if (self.crossOriginIsolated && performance.measureUserAgentSpecificMemory) {
    try { return { total: (await performance.measureUserAgentSpecificMemory()).bytes, how: 'uaMemory' }; } catch { /* not allowed */ }
  }
  if (performance.memory) return { total: performance.memory.usedJSHeapSize, how: 'jsHeap' };
  return { total: null, how: 'none' };
}

let stage = 'start';
async function run(name, runtime) {
  // minilm-l6 uses the game's real vocabulary (site/data, 25k rows); other models a random matrix of that size.
  const real = name === 'minilm-l6' && params.get('real') !== '0';
  let rows = Number(params.get('rows')) || 25024;
  const guesses = Number(params.get('guesses')) || 20;
  stage = 'clues';
  const clues = (await (await fetch('clues.json')).json()).clues.map((c) => c[1]);
  // Was the model in the Cache API before this visit? (number of cached files per cache)
  let cachedBefore = 'no Cache API';
  try {
    if (typeof caches !== 'undefined') {
      const parts = [];
      for (const k of await caches.keys()) parts.push(`${k}: ${(await (await caches.open(k)).keys()).length}`);
      cachedBefore = parts.join(', ') || 'empty';
    }
  } catch (e) { cachedBefore = `error: ${e.message}`; }
  stage = 'loading the model';
  $('status').textContent = `Loading ${name} (${runtime})…`;
  $('bar').hidden = false;
  const t0 = performance.now();
  let downloaded = 0;
  const emb = await loadEmbedder(name, {
    runtime,
    onProgress: ({ loaded, total }) => { downloaded = Math.max(downloaded, loaded); $('bar').max = total || 1; $('bar').value = loaded; },
  });
  const loadMs = performance.now() - t0;
  // Bytes the network actually delivered. Same-origin files report transferSize (0 for Cache API hits);
  // Hugging Face responses report 0 (no Timing-Allow-Origin), so count the model bytes if they were fetched at all.
  const entries = performance.getEntriesByType('resource');
  const hub = entries.filter((e) => /huggingface\.co|hf\.co|xethub|cas-bridge/.test(e.name));
  const fromHub = hub.length > 0;
  const hubRequests = `${hub.length} requests, ${Math.round(hub.reduce((s, e) => s + e.duration, 0))} ms`;
  const transfer = entries.reduce((s, e) => s + (e.transferSize || 0), 0) + (fromHub ? downloaded : 0);

  stage = 'first description';
  $('status').textContent = 'First description…';
  let t = performance.now();
  await emb.embed('a warm-up sentence to compile everything');
  const firstMs = performance.now() - t;

  const dim = emb.dim;
  let score, simd, vocabMs = 0, vocabBytes = 0;
  stage = 'vocabulary';
  if (real) {
    $('status').textContent = 'Loading the vocabulary…';
    const tv = performance.now();
    const V = await loadVocab({ onProgress: ({ loaded, total }) => { vocabBytes = loaded; $('bar').max = total || 1; $('bar').value = loaded; } });
    vocabMs = performance.now() - tv;
    rows = V.rows; simd = true;
    score = (q) => V.guess(q);
  } else {
    // A vocabulary-sized int8 matrix of random unit vectors (content doesn't matter for timing).
    const scorer = await createScorer(rows, dim, { simd: params.get('simd') !== '0' });
    for (let i = 0; i < scorer.mat.length; i++) scorer.mat[i] = (Math.random() * 60 - 30) | 0;
    simd = scorer.simd;
    score = (q) => topK(scorer.score(q), 5);
  }
  let lastTop = null;
  stage = 'guesses';

  const embedMs = [], scoreMs = [], totalMs = [];
  for (let g = 0; g < guesses; g++) {
    $('status').textContent = `Guess ${g + 1}/${guesses}…`;
    await new Promise((r) => setTimeout(r, 0)); // let the page paint, as the game would
    const t1 = performance.now();
    const q = await emb.embed(clues[g % clues.length]);
    const t2 = performance.now();
    lastTop = score(q);
    const t3 = performance.now();
    embedMs.push(t2 - t1); scoreMs.push(t3 - t2); totalMs.push(t3 - t1);
  }
  const heap = await jsHeap();
  const result = {
    when: new Date().toISOString(), device: device(), ua: navigator.userAgent, model: name, runtime: MODELS[name].kind === 'static' ? 'static' : 'ort-1.18',
    threads: 1, isolated: self.crossOriginIsolated, cores: navigator.hardwareConcurrency,
    modelBytes: emb.bytes(), downloaded, transfer, cachedBefore, hubRequests, loadMs: ms(loadMs), firstMs: ms(firstMs),
    embedMedian: +median(embedMs).toFixed(1), embedP95: +pct(embedMs, 0.95).toFixed(1),
    scoreMedian: +median(scoreMs).toFixed(1), guessMedian: +median(totalMs).toFixed(1), guessMax: +Math.max(...totalMs).toFixed(1),
    rows, dim, simd, matrixBytes: rows * dim, real, vocabMs: ms(vocabMs), vocabBytes,
    wasmBytes: wasmBytes(), memoryRequests: memoryRequests.join('; '), heapBytes: heap.total, heapHow: heap.how, guesses,
    lastGuess: real ? lastTop.top.map((t) => t.word).join(', ') : undefined,
  };
  result.cold = result.downloaded > 0 && result.transfer > 1e6;
  return result;
}

function render() {
  const res = loadResults();
  const cols = [['device', (r) => r.device], ['visit', (r) => r.visit ?? ''], ['model', (r) => r.model], ['runtime', (r) => r.runtime], ['cold?', (r) => r.cold ? 'cold' : 'warm'],
    ['net MB', (r) => MB(r.transfer)], ['model MB', (r) => MB(r.modelBytes)], ['load ms', (r) => r.loadMs], ['1st ms', (r) => r.firstMs],
    ['embed ms', (r) => r.embedMedian], ['score ms', (r) => r.scoreMedian], ['simd', (r) => r.simd === false ? 'no' : 'yes'], ['guess ms', (r) => r.guessMedian], ['max', (r) => r.guessMax],
    ['WASM MB', (r) => MB(r.wasmBytes)], ['heap MB', (r) => r.heapBytes == null ? '–' : MB(r.heapBytes)]];
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const row = (r) => r.error
    ? `<tr><td>${esc(r.device)}</td><td>${esc(r.model)}</td><td colspan="${cols.length - 2}" style="text-align:left">failed: ${esc(r.error)}</td></tr>`
    : `<tr>${cols.map((c) => `<td>${c[1](r)}</td>`).join('')}</tr>`;
  $('table').innerHTML = res.length ? `<tr>${cols.map((c) => `<th>${c[0]}</th>`).join('')}</tr>` + res.map(row).join('') : '';
}

function links() {
  const cur = params.get('model');
  const mk = (model, runtime, label) => {
    const a = document.createElement('a');
    a.className = 'btn' + (cur === model && (params.get('runtime') || 'lean') === runtime ? ' primary' : '');
    a.href = `?model=${model}&runtime=${runtime}&auto=1`;
    a.textContent = label;
    $('links').append(a);
  };
  mk('minilm-l6', 'lean', 'MiniLM-L6');
  mk('minilm-l3', 'lean', 'MiniLM-L3');
  mk('potion-8m', 'lean', 'potion-8M (static)');
}

$('clear').onclick = async () => { await clearModelCaches(); $('status').textContent = 'Model cache cleared.'; };
$('copy').onclick = async () => {
  const text = JSON.stringify(loadResults(), null, 1);
  try { await navigator.clipboard.writeText(text); $('status').textContent = 'Copied.'; }
  catch { $('out').hidden = false; $('out').textContent = text; $('status').textContent = 'Clipboard blocked: select the text below.'; }
};
$('forget').onclick = () => { saveResults([]); render(); $('status').textContent = 'Results cleared.'; };

// The one-tap phone test: ?phone=N runs MiniLM-L6 with the real vocabulary, then reloads itself (a repeat visit,
// loading from the cache) until N visits are done.
$('phone').href = '?model=minilm-l6&runtime=lean&auto=1&phone=1&of=3';

links();
render();
if (params.get('model') && params.get('auto')) {
  const visit = Number(params.get('phone')) || 0, of = Number(params.get('of')) || 0;
  const label = visit ? `Visit ${visit} of ${of}: ` : '';
  try {
    const r = await run(params.get('model'), params.get('runtime') || 'lean');
    if (visit) r.visit = `${visit}/${of}`;
    saveResults([...loadResults(), r]);
    render();
    $('status').textContent = `${label}done: ${r.model}, load ${r.loadMs} ms, guess ${r.guessMedian} ms.`;
    window.__bench = r;
  } catch (e) {
    // Saved too, so "Copy all results" reports failures: which step, the message, the memory asked for.
    const fail = { when: new Date().toISOString(), device: device(), ua: navigator.userAgent, model: params.get('model'),
      visit: visit ? `${visit}/${of}` : undefined, stage: e?.stage ?? stage, error: String(e?.message || e),
      memoryRequests: memoryRequests.join('; '), wasmBytes: wasmBytes() };
    saveResults([...loadResults(), fail]);
    render();
    // Start the next try from a clean download, as the game will.
    await clearModelCaches();
    $('status').textContent = `${label}failed while ${fail.stage}: ${fail.error}. The model cache has been cleared.`;
    window.__bench = { ...fail, error: String(e?.stack || e) };
  }
  $('bar').hidden = true;
  if (visit && visit < of) {
    // 10 s, not 2: an instant reload left the previous page's WASM memory still reserved on iOS (out of memory).
    $('status').textContent += ' Next visit in 10 seconds…';
    setTimeout(() => location.replace(`?model=minilm-l6&runtime=lean&auto=1&phone=${visit + 1}&of=${of}`), 10000);
  } else if (visit) {
    $('status').textContent += ' All done: tap "Copy all results" and paste them back.';
  }
}
