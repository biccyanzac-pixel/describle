// Debug a single bench run: prints console output and the status line every 5 s.
//   node bench/debug-one.mjs <model> <runtime> [chrome|webkit]     (BASE=https://…/describle/ to test the live site)
import { chromium, webkit } from 'playwright-core';
import { serve } from '../tools/serve.mjs';

const [model = 'minilm-l6', runtime = 'lean', which = 'chrome'] = process.argv.slice(2);
const srv = await serve(8083);
const browser = which === 'chrome'
  ? await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  : await webkit.launch({ headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => console.log(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.url()}`); });
await page.goto(`${process.env.BASE || 'http://localhost:8083/'}bench/?model=${model}&runtime=${runtime}&auto=1`);
const t0 = Date.now();
while (Date.now() - t0 < 180000) {
  const r = await page.evaluate(() => window.__bench);
  console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s  ${await page.textContent('#status')}`);
  if (r) { console.log(JSON.stringify(r)); break; }
  await new Promise((res) => setTimeout(res, 5000));
}
await browser.close();
srv.closeAllConnections(); srv.close();
