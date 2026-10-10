// Offline embeddings computed by the game's own code (site/js/embed.js) in headless Chrome, so the shipped vectors
// are exactly what a phone computes: same ORT Web 1.18 WASM, same tokenizer, one text per call.
// (ORT's browser build can't run in plain Node: its Node file-loading code is stripped out.)
// Several Chrome instances embed in parallel; the model files are fetched once into models/hub/ and served to
// the browsers from there.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from '../tools/serve.mjs';
import { MODELS, hubUrl } from '../site/js/embed.js';

export const MODEL = MODELS['minilm-l6'];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8088;

async function localFile(url) {
  const file = path.join('models', 'hub', url.replace(/^https:\/\/huggingface\.co\//, '').replace(/[?#].*$/, ''));
  if (!fs.existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

/**
 * Same interface as before: { dim, revision, recipe, batch(texts) -> Float32Array[], matrix(texts) -> Int8Array,
 * close() }. `workers` Chrome instances share the work.
 */
export async function nodeEmbedder({ workers = Math.max(1, Math.min(6, os.cpus().length - 2)) } = {}) {
  for (const f of ['tokenizer.json', 'tokenizer_config.json', MODEL.file]) await localFile(hubUrl(MODEL, f));
  const srv = await serve(PORT, { isolate: false });
  const browsers = [], pages = [];
  for (let w = 0; w < workers; w++) {
    const browser = await chromium.launch({ executablePath: CHROME, headless: true });
    const page = await browser.newPage();
    await page.route('https://huggingface.co/**', async (route) => route.fulfill({ path: await localFile(route.request().url()) }));
    await page.goto(`http://localhost:${PORT}/bench/`);
    await page.evaluate(async (url) => {
      const m = await import(url);
      window.__emb = await m.loadEmbedder('minilm-l6');
    }, `http://localhost:${PORT}/js/embed.js`);
    browsers.push(browser); pages.push(page);
  }
  const dim = MODEL.dim;

  async function batch(texts, { log = () => {} } = {}) {
    const out = new Array(texts.length);
    let next = 0, done = 0;
    const CHUNK = 200;
    const t0 = Date.now();
    await Promise.all(pages.map(async (page) => {
      while (next < texts.length) {
        const start = next; next += CHUNK;
        const part = texts.slice(start, start + CHUNK);
        const vecs = await page.evaluate(async (ts) => {
          const res = [];
          for (const t of ts) res.push(Array.from(await window.__emb.embed(t)));
          return res;
        }, part);
        vecs.forEach((v, i) => { out[start + i] = Float32Array.from(v); });
        done += part.length;
        if (Math.floor(done / 10000) !== Math.floor((done - part.length) / 10000)) log(`${done}/${texts.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      }
    }));
    return out;
  }
  async function matrix(texts, opts) {
    const vs = await batch(texts, opts);
    const mat = new Int8Array(texts.length * dim);
    vs.forEach((v, i) => mat.set(q8(v), i * dim));
    return mat;
  }
  async function close() {
    for (const b of browsers) await b.close();
    srv.closeAllConnections(); srv.close();
  }
  return { dim, revision: MODEL.revision, recipe: 'browser:ort-web-1.18', batch, matrix, close };
}

export const q8 = (v) => Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x * 127))));
