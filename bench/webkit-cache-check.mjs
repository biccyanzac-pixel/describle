// Does Playwright's WebKit keep Cache API entries across a reload?  node bench/webkit-cache-check.mjs
import { webkit } from 'playwright-core';
import { serve } from '../tools/serve.mjs';

const srv = await serve(8084);
const browser = await webkit.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:8084/bench/');
console.log('first load:', await page.evaluate(async () => {
  if (typeof caches === 'undefined') return 'caches undefined';
  try { const c = await caches.open('t'); await c.put('/x', new Response('hi')); return `put ok, keys: ${(await caches.keys()).join(',')}`; }
  catch (e) { return `error: ${e.message}`; }
}));
await page.reload();
console.log('after reload:', await page.evaluate(async () => {
  try { const c = await caches.open('t'); const r = await c.match('/x'); return r ? `hit: ${await r.text()}` : 'miss'; }
  catch (e) { return `error: ${e.message}`; }
}));
await browser.close();
srv.closeAllConnections(); srv.close();
