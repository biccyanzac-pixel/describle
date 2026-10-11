// Playtest: can a natural description get the word? The schedule's definition-based validation (validate.mjs) is
// lenient (a word's own definition is in the index), so before a word goes live, someone writes how a player would
// describe it, without tuning it to the model, and the game's AI must put the word in its top 3 (PASS_RANK).
//
//   data/playtest.json           { word: ["a description", "another one"], ... }   (written by hand)
//   node pipeline/playtest.mjs   -> data/playtest-results.json { word: { ranks: [...], best, pass } }
//   node pipeline/playtest.mjs --todo [weeks=8]   -> the scheduled words in the next N weeks without a playtest
//
// schedule.mjs leaves out words that failed; test/schedule.test.mjs requires the next 8 weeks to be playtested.
// Write each description once, as a player would. Don't rewrite a failing one until it passes: drop the word.
import fs from 'node:fs';
import { makeVocab, VOCAB_VERSION } from '../site/js/vocab.js';
import { isVariant, makeBanCheck } from '../site/js/ban.js';
import { MAX_WORDS, wordCount } from '../site/js/scoring.js';
import { addDays, todayKey, EPOCH, dayNumber } from '../site/js/daily.js';

export const PASS_RANK = 3;
const args = process.argv.slice(2);
const tests = fs.existsSync('data/playtest.json') ? JSON.parse(fs.readFileSync('data/playtest.json', 'utf8')) : {};

if (args[0] === '--todo') {
  const weeks = Number(args[1]) || 8;
  const s = JSON.parse(fs.readFileSync('site/data/schedule-v1.json', 'utf8'));
  const from = Math.max(0, dayNumber(todayKey()) - 1);
  const results = fs.existsSync('data/playtest-results.json') ? JSON.parse(fs.readFileSync('data/playtest-results.json', 'utf8')) : {};
  // No playtest yet, or every description was invalid (results has no entry for the word).
  const todo = s.days.slice(from, from + weeks * 7).map((d, i) => [addDays(EPOCH, from + i), d]).filter(([, d]) => !tests[d.word] || !results[d.word]);
  for (const [day, d] of todo) console.log(`${day} ${d.pool.padEnd(16)} ${d.word} (${d.pos}) [${d.banned.join(' ')}]  ${d.def}`);
  console.log(`${todo.length} scheduled words in the next ${weeks} weeks have no playtest`);
  process.exit(0);
}

const { nodeEmbedder } = await import('./node-embed.mjs');
const meta = JSON.parse(fs.readFileSync(`site/data/vocab-v${VOCAB_VERSION}.json`, 'utf8'));
const V = await makeVocab(meta, new Int8Array(fs.readFileSync(`site/data/vectors-v${VOCAB_VERSION}.bin`).buffer.slice(0)));
// A playtest description must be one the game would accept: the word's banned words and forms are refused.
const targets = new Map(JSON.parse(fs.readFileSync('data/targets.json', 'utf8')).map((t) => [t.w, t]));
const invalid = {};
const pairs = Object.entries(tests).flatMap(([w, ds]) => ds.filter((d) => {
  const t = targets.get(w);
  const hits = t ? makeBanCheck({ banned: [w, ...t.banned], related: t.related, lexicon: V.lexicon, irregular: V.irregular })(d).hits : [];
  if (hits.length || wordCount(d) > MAX_WORDS) { (invalid[w] ??= []).push(`"${d}" (${hits.map((h) => h.token).join(', ') || 'too long'})`); return false; }
  return true;
}).map((d) => [w, d]));
for (const [w, list] of Object.entries(invalid)) console.log(`  invalid for ${w}, not counted: ${list.join('; ')}`);
const E = await nodeEmbedder({ workers: 4 });
const vecs = await E.batch(pairs.map((p) => p[1]));
await E.close();
const results = {};
pairs.forEach(([w, d], i) => {
  const { scores, top } = V.guess(vecs[i], 5, { mentioned: d });
  const t = V.index.get(w);
  let rank = 1;
  for (let j = 0; j < scores.length; j++) if (scores[j] > scores[t] && !isVariant(V.words[j], w, V.irregular)) rank++;
  const r = (results[w] ??= { ranks: [], tops: [] });
  r.ranks.push(rank);
  r.tops.push(top.map((x) => x.word).join(', '));
});
for (const r of Object.values(results)) { r.best = Math.min(...r.ranks); r.pass = r.best <= PASS_RANK; }
fs.writeFileSync('data/playtest-results.json', JSON.stringify(results, null, 1));
const all = Object.values(results);
console.log(`${all.length} words playtested: ${all.filter((r) => r.pass).length} pass (a description in the top ${PASS_RANK}), ${all.filter((r) => !r.pass).length} fail`);
for (const [w, r] of Object.entries(results)) if (!r.pass) console.log(`  fail ${w}: best #${r.best}  (${tests[w].map((d, i) => `"${d}" #${r.ranks[i]} -> ${r.tops[i]}`).join('; ')})`);
