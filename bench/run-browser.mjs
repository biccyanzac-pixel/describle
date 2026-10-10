// Drives site/bench/ in real browsers: each model gets a fresh context (empty cache) -> cold run, then a
// reload in the same context -> warm run (model from the Cache API).
//   node bench/run-browser.mjs [chrome|webkit ...]   -> prints a table, writes bench/results/desktop-<browsers>.json
import fs from 'node:fs';
import { chromium, webkit } from 'playwright-core';
import { serve } from '../tools/serve.mjs';

const PORT = 8082;
const want = process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'webkit'];
const RUNS = [['minilm-l6', 'lean'], ['minilm-l3', 'lean'], ['potion-8m', 'lean']];
const srv = await serve(PORT);
const all = [];

for (const which of want) {
  const browser = which === 'chrome'
    ? await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
    : await webkit.launch({ headless: true });
  for (const [model, runtime] of RUNS) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    for (const phase of ['cold', 'warm']) {
      await page.goto(`http://localhost:${PORT}/bench/?model=${model}&runtime=${runtime}&auto=1`);
      const r = await page.waitForFunction(() => window.__bench, null, { timeout: 300000, polling: 500 }).then((h) => h.jsonValue());
      r.browser = which; r.phase = phase;
      if (r.error) console.log(`FAIL ${which} ${model} ${runtime} ${phase}: ${r.error}\n${errors.join('\n')}`);
      else console.log(`${which.padEnd(6)} ${model.padEnd(9)} ${r.runtime.padEnd(7)} ${phase}  net ${(r.transfer / 1048576).toFixed(1)} MB  load ${r.loadMs} ms  first ${r.firstMs} ms  embed ${r.embedMedian} ms  score ${r.scoreMedian} ms  guess ${r.guessMedian} (max ${r.guessMax}) ms  wasm ${(r.wasmBytes / 1048576).toFixed(0)} MB  heap ${r.heapBytes == null ? '-' : (r.heapBytes / 1048576).toFixed(0)} MB (${r.heapHow})`);
      all.push(r);
    }
    await ctx.close();
  }
  await browser.close();
}
fs.mkdirSync('bench/results', { recursive: true });
fs.writeFileSync(`bench/results/desktop-${want.join('-')}.json`, JSON.stringify(all, null, 1));
srv.closeAllConnections(); srv.close();
