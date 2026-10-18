// Browser end-to-end: plays today's word in headless Chrome against a local worker, phone and desktop sizes.
//   cd worker && npm run db:init:local && npm run dev:local     (in another terminal)
//   node tools/e2e-ui.mjs                                       -> tools/results/*.png
// The model files are served from models/hub/ (pipeline/browser-embed.mjs downloads them) to keep it fast.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';
import { entryFor, todayKey } from '../site/js/daily.js';
import { rulesFor } from '../site/js/scoring.js';

const API = process.env.API || 'http://127.0.0.1:8812';
const schedule = JSON.parse(fs.readFileSync(new URL('../site/data/schedule-v1.json', import.meta.url), 'utf8'));
const e = entryFor(todayKey(), schedule);
const RULES = rulesFor(todayKey());
console.log(`today: ${e.word}, rules ${RULES}`);
fs.mkdirSync('tools/results', { recursive: true });
const srv = await serve(8082, { isolate: false });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let failures = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };
const local = (url) => path.join('models', 'hub', url.replace(/^https:\/\/huggingface\.co\//, '').replace(/[?#].*$/, ''));

for (const [label, viewport, scheme] of [['phone', { width: 360, height: 780 }, 'dark'], ['desktop', { width: 1280, height: 900 }, 'light']]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text()));
  await page.route('https://huggingface.co/**', (route) => {
    const f = local(route.request().url());
    return fs.existsSync(f) ? route.fulfill({ path: f }) : route.continue();
  });
  // A new player each time: a name is asked for.
  await page.goto(`http://localhost:8082/?hub=off&api=${encodeURIComponent(API)}`);
  await page.waitForFunction((w) => document.getElementById('secret')?.textContent === w, e.word);
  check(`${label}: today's word and banned words shown`, (await page.$$eval('#banned li', (ls) => ls.map((l) => l.textContent))).join() === e.banned.join());
  await page.screenshot({ path: `tools/results/1-loading-${label}.png`, fullPage: true });
  await page.waitForFunction(() => document.getElementById('guess-label').textContent === 'Guess', null, { timeout: 120000 });
  check(`${label}: the AI loads`, true);

  await page.fill('#text', `it is ${e.word}`);
  check(`${label}: the secret word is refused while typing`, await page.isVisible('#play-error') && await page.isDisabled('#guess'),
    await page.textContent('#play-error'));
  await page.fill('#text', `${e.banned[0]}s`);
  check(`${label}: a form of a banned word is refused`, await page.isDisabled('#guess'), await page.textContent('#play-error'));
  await page.fill('#text', Array(26).fill('word').join(' '));
  check(`${label}: 26 words are refused`, await page.isDisabled('#guess'));

  // Today's playtest descriptions first (they should get it), then filler.
  const playtests = JSON.parse(fs.readFileSync('data/playtest.json', 'utf8'))[e.word] ?? [];
  const descriptions = [...playtests.slice().reverse(), 'something you find in everyday life', 'a common thing people know', 'an ordinary object or idea'];
  await page.fill('#name', `Tester ${label}`);
  let made = 0;
  for (const d of descriptions) {
    if (await page.isHidden('#play-form')) break;
    await page.fill('#text', d);
    if (await page.isDisabled('#guess')) { console.log(`      (skipped, refused: "${d}")`); continue; }
    await page.click('#guess');
    made++;
    await page.waitForFunction((n) => document.querySelectorAll('#history > li').length === n, made, { timeout: 30000 });
    const bars = await page.$$eval('#history > li:last-child .guess-word', (ls) => ls.map((l) => l.textContent));
    const said = await page.textContent('#history > li:last-child .attempt-verdict');
    check(`${label}: attempt ${made} shows the top 5`, bars.length === 5, `"${d}" -> ${bars.join(', ')} · ${said}`);
    if (RULES === 2) check(`${label}: attempt ${made} shows where the word placed and its points`, /(Got it!|#[\d,]+ of 15,000) .*\d+ pts?/.test(said), said);
    if (made === 1) await page.screenshot({ path: `tools/results/2-attempt-${label}.png`, fullPage: true });
  }
  await page.waitForSelector('#done:not([hidden])', { timeout: 10000 });
  check(`${label}: results shown`, true, `score ${await page.textContent('#score')} · ${await page.textContent('#out-of')} · ${await page.textContent('#squares')}`);
  check(`${label}: the reveal shows the definition`, (await page.textContent('#reveal-def')) === e.def);
  await page.waitForTimeout(1500); // let the attempts reach the worker
  await page.evaluate(() => document.getElementById('board').scrollIntoView());
  await page.waitForFunction((n) => [...document.querySelectorAll('#rows .row-name')].some((x) => x.textContent === n), `Tester ${label}`, { timeout: 15000 })
    .then(() => check(`${label}: on the leaderboard`, true), () => check(`${label}: on the leaderboard`, false));
  await page.screenshot({ path: `tools/results/3-done-${label}.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label}: no horizontal scroll`, overflow <= 0, `${overflow}px`);
  check(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));

  // Reload: the finished day stays finished.
  await page.reload();
  await page.waitForSelector('#done:not([hidden])', { timeout: 15000 });
  check(`${label}: progress survives a reload`, await page.isHidden('#play-form'));
  if (RULES === 2) check(`${label}: all 3 attempts were played`, made === 3, `${made}`);

  // Play again: a replay of today, on its own board.
  const firstScore = await page.textContent('#score');
  await page.click('#again');
  await page.waitForSelector('#play-form:not([hidden])');
  check(`${label}: play again starts a fresh go`, (await page.$$('#history > li')).length === 0 && /replay/.test(await page.textContent('#daynum')), await page.textContent('#daynum'));
  for (let i = 0; i < 3 && await page.isVisible('#play-form'); i++) {
    await page.fill('#text', ['a thing people know about', 'something common', 'you see it often'][i]);
    await page.click('#guess');
    await page.waitForFunction((n) => document.querySelectorAll('#history > li').length === n, i + 1, { timeout: 30000 });
  }
  await page.waitForSelector('#done:not([hidden])', { timeout: 10000 });
  check(`${label}: the replay is scored`, /replay/i.test(await page.textContent('#score-caption')), `${await page.textContent('#score-caption')}: ${await page.textContent('#score')}`);
  await page.waitForTimeout(1500);
  await page.waitForFunction((n) => /replays/i.test(document.getElementById('board-title').textContent)
    && [...document.querySelectorAll('#rows .row-name')].some((x) => x.textContent === n), `Tester ${label}`, { timeout: 15000 })
    .then(() => check(`${label}: on the replay board`, true), () => check(`${label}: on the replay board`, false));
  await page.screenshot({ path: `tools/results/4-replay-${label}.png`, fullPage: true });
  await page.click('.board-tab:not(.on)');
  await page.waitForFunction(() => /Today's leaderboard/.test(document.getElementById('board-title').textContent));
  await page.waitForFunction((n) => [...document.querySelectorAll('#rows .row-name')].some((x) => x.textContent === n), `Tester ${label}`, { timeout: 15000 })
    .then(() => check(`${label}: the first-go board still has the first score`, true, firstScore), () => check(`${label}: the first-go board still has the first score`, false));
  check(`${label}: still no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
srv.closeAllConnections(); srv.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
