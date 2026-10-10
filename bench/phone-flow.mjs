// Runs the bench's one-tap "phone test" (3 visits, the page reloading itself) in a persistent profile and
// prints what "Copy all results" would give.
//   node bench/phone-flow.mjs [webkit|chrome]     (BASE=https://…/describle/ for the live site; SIMULATE_IOS=1 too)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, webkit } from 'playwright-core';
import { serve } from '../tools/serve.mjs';

const which = process.argv[2] || 'webkit';
const srv = process.env.BASE ? null : await serve(8086, { isolate: false }); // like GitHub Pages: no COOP/COEP
const base = process.env.BASE || 'http://localhost:8086/';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'describle-phone-'));
const ctx = which === 'chrome'
  ? await chromium.launchPersistentContext(dir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  : await webkit.launchPersistentContext(dir, { headless: true });
if (process.env.SIMULATE_IOS) {
  await ctx.addInitScript(() => {
    const Orig = WebAssembly.Memory;
    const Strict = function (d) { if (d?.shared && (d.maximum ?? 65536) > 16384) throw new RangeError('Out of memory'); return new Orig(d); };
    Strict.prototype = Orig.prototype;
    WebAssembly.Memory = Strict;
  });
}
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.goto(`${base}bench/`);
await page.click('#forget');
await page.click('#phone');
await page.waitForFunction(() => /All done/.test(document.getElementById('status')?.textContent ?? ''), null, { timeout: 600000, polling: 1000 });
const results = await page.evaluate(() => JSON.parse(localStorage.getItem('describle:bench') || '[]'));
let failed = 0;
for (const r of results) {
  if (r.error) { failed++; console.log(`visit ${r.visit}: FAILED while ${r.stage}: ${r.error}`); }
  else console.log(`visit ${r.visit}: ok, load ${r.loadMs} ms, guess ${r.guessMedian} ms, memory ${r.memoryRequests}; cached before: ${r.cachedBefore}; hub: ${r.hubRequests}`);
}
await ctx.close();
srv?.closeAllConnections(); srv?.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed || results.length !== 3 ? 1 : 0);
