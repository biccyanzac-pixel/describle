// Checks the live game without playing (so the real leaderboard isn't touched): today's word shows, the AI loads,
// the leaderboard answers, no console errors; and the jacob.gg hub has the card.
//   node tools/live-check.mjs [chrome|webkit]
import fs from 'node:fs';
import { chromium, webkit } from 'playwright-core';
import { entryFor, todayKey } from '../site/js/daily.js';

const which = process.argv[2] || 'chrome';
const SITE = 'https://biccyanzac-pixel.github.io/describle/';
const e = entryFor(todayKey(), JSON.parse(fs.readFileSync(new URL('../site/data/schedule-v1.json', import.meta.url), 'utf8')));
const browser = which === 'webkit' ? await webkit.launch({ headless: true })
  : await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('console', (m) => m.type() === 'error' && !/favicon/.test(m.text()) && errors.push(m.text()));
let failures = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

await page.goto(SITE + `?nocache=${Date.now()}`);
await page.waitForFunction((w) => document.getElementById('secret')?.textContent === w, e.word, { timeout: 60000 });
check(`${which}: today's word (#${e.number} ${e.word}) shown`, true);
const t0 = Date.now();
await page.waitForFunction(() => document.getElementById('guess-label').textContent === 'Guess', null, { timeout: 180000 })
  .then(() => check(`${which}: the AI loads`, true, `${((Date.now() - t0) / 1000).toFixed(1)} s`), () => check(`${which}: the AI loads`, false, errors.join(' | ')));
await page.waitForSelector('#board:not([hidden])', { timeout: 30000 }).then(() => check(`${which}: leaderboard shown`, true), () => check(`${which}: leaderboard shown`, false));
check(`${which}: leaderboard reachable`, await page.isHidden('#board-note'), await page.textContent('#board-note'));
check(`${which}: no console errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
await page.screenshot({ path: `tools/results/live-${which}.png`, fullPage: true });

await page.goto('https://biccyanzac-pixel.github.io/jacob.gg/?nocache=' + Date.now());
check(`${which}: hub has the Describle card`, await page.locator('[data-game="describle"]').count() === 1);
await browser.close();
console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
