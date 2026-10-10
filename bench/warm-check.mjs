// Cold visit, then warm visits, in one persistent browser profile (so the Cache API survives reloads).
// Catches bugs that only happen when the model/runtime come from the cache, like the iPhone's second visit.
//   node bench/warm-check.mjs [webkit|chrome] [visits=3]     (BASE=https://…/describle/ for the live site)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, webkit } from 'playwright-core';
import { serve } from '../tools/serve.mjs';

const which = process.argv[2] || 'webkit', visits = Number(process.argv[3]) || 3;
const srv = process.env.BASE ? null : await serve(8085, { isolate: false }); // like GitHub Pages: no COOP/COEP
const base = process.env.BASE || 'http://localhost:8085/';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'describle-warm-'));
const ctx = which === 'chrome'
  ? await chromium.launchPersistentContext(dir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  : await webkit.launchPersistentContext(dir, { headless: true });
let failures = 0;
for (let v = 1; v <= visits; v++) {
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(`${base}bench/?model=minilm-l6&runtime=lean&auto=1&guesses=5`);
  const r = await page.waitForFunction(() => window.__bench, null, { timeout: 300000, polling: 500 }).then((h) => h.jsonValue());
  const cached = await page.evaluate(async () => { try { return (await caches.keys()).join(','); } catch (e) { return `caches: ${e.message}`; } });
  if (r.error) { failures++; console.log(`visit ${v}: FAILED ${r.error.split('\n')[0]}\n   ${errs.slice(0, 3).join('\n   ')}`); }
  else console.log(`visit ${v}: ok, load ${r.loadMs} ms, net ${(r.transfer / 1048576).toFixed(1)} MB, guess ${r.guessMedian} ms  [caches: ${cached}]`);
  await page.close();
}
await ctx.close();
srv?.closeAllConnections(); srv?.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
