// Inspect "related" compound lists and the similarities behind them.
//   node pipeline/show-related.mjs ball king sun snow son ear fire
import { loadBanData } from './ban-words.mjs';
import { isVariant } from '../site/js/ban.js';

const data = loadBanData();
const pool = data.vocab.slice(0, 15000).map((e) => e.w);
for (const w of process.argv.slice(2)) {
  const cands = pool.filter((v) => v !== w && v.length > w.length && (v.startsWith(w) || v.endsWith(w)) && !isVariant(v, w, data.irregular))
    .map((v) => [v, data.wordSim(v, w)]).sort((a, b) => b[1] - a[1]);
  console.log(`${w}: ${cands.slice(0, 14).map(([v, s]) => `${v} ${s.toFixed(2)}`).join(', ')}`);
}
