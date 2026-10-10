// Do the browser's embeddings (site/js/embed.js on the live or local site, in Chrome or WebKit) match the offline
// pipeline's (pipeline/node-embed.mjs), which built site/data/vectors? Does the page avoid shared WASM memory
// entirely (the iPhone problem)? And do the browser vectors give the tuner's scores?
//   node bench/parity.mjs [chrome|webkit]     (BASE=https://…/describle/ for the live site)
import fs from 'node:fs';
import { chromium, webkit } from 'playwright-core';
import { serve } from '../tools/serve.mjs';
import { nodeEmbedder } from '../pipeline/node-embed.mjs';
import { makeVocab, VOCAB_VERSION } from '../site/js/vocab.js';
import { isVariant } from '../site/js/ban.js';

const which = process.argv[2] || 'chrome';
const sets = ['dev', 'test', 'test2'];
const clues = Object.fromEntries(sets.map((s) => [s, JSON.parse(fs.readFileSync(`data/clues-${s}.json`, 'utf8')).clues]));
const texts = sets.flatMap((s) => clues[s].map((c) => c[1]));

const srv = process.env.BASE ? null : await serve(8087, { isolate: false });
const base = process.env.BASE || 'http://localhost:8087/';
const browser = which === 'chrome'
  ? await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  : await webkit.launch({ headless: true });
const page = await browser.newPage();
// Any shared WebAssembly.Memory is refused, as a strict stand-in for iOS.
await page.addInitScript(() => {
  const Orig = WebAssembly.Memory;
  const NoShared = function (d) { if (d?.shared) throw new RangeError('shared memory refused (parity test)'); return new Orig(d); };
  NoShared.prototype = Orig.prototype;
  WebAssembly.Memory = NoShared;
});
await page.goto(`${base}bench/`);
const browserVecs = await page.evaluate(async ({ url, texts }) => {
  const m = await import(url);
  const e = await m.loadEmbedder('minilm-l6');
  const out = [];
  for (const t of texts) out.push(Array.from(await e.embed(t)));
  return out;
}, { url: new URL('js/embed.js', base).href, texts });
await browser.close();
srv?.closeAllConnections(); srv?.close();

const E = await nodeEmbedder(); // the offline pipeline's embedder (headless Chrome)
const nodeVecs = await E.batch(texts);
await E.close();
const cos = browserVecs.map((b, i) => b.reduce((s, x, j) => s + x * nodeVecs[i][j], 0));
console.log(`${which}: ${texts.length} texts, cosine browser vs offline: min ${Math.min(...cos).toFixed(6)}, mean ${(cos.reduce((a, b) => a + b) / cos.length).toFixed(6)}`);
const worst = cos.map((c, i) => [c, texts[i]]).sort((a, b) => a[0] - b[0]).slice(0, 4);
console.log(`  lowest: ${worst.map(([c, t]) => `${c.toFixed(4)} "${t}"`).join('; ')}`);

const meta = JSON.parse(fs.readFileSync(`site/data/vocab-v${VOCAB_VERSION}.json`, 'utf8'));
const V = await makeVocab(meta, new Int8Array(fs.readFileSync(`site/data/vectors-v${VOCAB_VERSION}.bin`).buffer.slice(0)));
const tune = JSON.parse(fs.readFileSync('data/tune.json', 'utf8'));
let k = 0, bad = Math.min(...cos) < 0.999;
for (const s of sets) {
  let top1 = 0, top5 = 0, n = 0;
  for (const [target] of clues[s]) {
    const q = Float32Array.from(browserVecs[k++]);
    if (!V.index.has(target)) continue;
    n++;
    const top = V.guess(q).top.map((t) => t.word);
    if (isVariant(top[0], target, V.irregular)) top1++;
    if (top.some((w) => isVariant(w, target, V.irregular))) top5++;
  }
  const same = top1 === tune[s].top1 && top5 === tune[s].top5;
  bad ||= !same;
  console.log(`  ${s.padEnd(5)} with browser vectors: top-1 ${top1}/${n}, top-5 ${top5}/${n}  (tuner: ${tune[s].top1}/${tune[s].top5}) ${same ? 'same' : 'DIFFERENT'}`);
}
process.exit(bad ? 1 : 0);
