// Phase 3, step 3: the daily schedule. One word per UTC day from EPOCH, WEEKS weeks long (105 weeks > 2 years,
// a whole number of weeks so that repeating it later keeps weekdays), no word or variant used twice.
//   node pipeline/schedule.mjs [--keep-until YYYY-MM-DD] [--epoch YYYY-MM-DD]
//     -> site/data/schedule-v1.json, data/schedule-review.txt (every word by weekday, for reading through)
// --keep-until: days up to and including that date are copied unchanged from the existing file (never change a
// past or current day once live; pass today's date). --epoch: only before launch (it renumbers every puzzle).
//
// Inputs: data/targets.json (pipeline/targets.mjs), data/validation.json (pipeline/validate.mjs: only targets that
// passed), data/target-exclude.txt (re-applied here, so curating needs no rerun of targets.mjs).
import fs from 'node:fs';
import { EPOCH, WEEKDAY_POOLS, addDays, weekday, validDay } from '../site/js/daily.js';
import { isVariant } from '../site/js/ban.js';
import { VOCAB_VERSION } from '../site/js/vocab.js';
import { hashString } from './rng.mjs';

export const WEEKS = 105;
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const epoch = arg('--epoch') ?? EPOCH;
const keepUntil = arg('--keep-until');
if (!validDay(epoch) || (keepUntil && !validDay(keepUntil))) throw new Error('dates must be YYYY-MM-DD');
if (epoch !== EPOCH) console.log(`NOTE: --epoch ${epoch} differs from daily.js EPOCH ${EPOCH}; update daily.js to match.`);

const targets = JSON.parse(fs.readFileSync('data/targets.json', 'utf8'));
const validation = JSON.parse(fs.readFileSync('data/validation.json', 'utf8'));
const irregular = JSON.parse(fs.readFileSync('data/irregular.json', 'utf8'));
const exclude = new Set(fs.readFileSync('data/target-exclude.txt', 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')));

// Difficulty within a tier, 0 (easiest) .. 1: half word frequency (common = easy), half the validation margin
// (how far the model's guess beat the runner-up from the reference description: wide = easy).
const eligible = targets.filter((t) => validation[t.w]?.pass && !exclude.has(t.w)).map((t) => ({ ...t, ...validation[t.w] }));
const pct = (list, key) => { const s = [...list].sort((a, b) => b[key] - a[key]); return new Map(s.map((t, i) => [t.w, i / Math.max(1, s.length - 1)])); };
const tiers = {};
for (const t of eligible) (tiers[t.tier] ??= []).push(t);
for (const list of Object.values(tiers)) {
  const pz = pct(list, 'zipf'), pm = pct(list, 'margin');
  for (const t of list) t.difficulty = +(0.5 * pz.get(t.w) + 0.5 * pm.get(t.w)).toFixed(4);
  list.sort((a, b) => a.difficulty - b.difficulty);
}
const slice = (list, from, to) => list.slice(Math.floor(list.length * from), Math.floor(list.length * to));
const top1 = (list) => list.filter((t) => t.rank === 1);
const POOLS = {
  'concrete-easy': top1(slice(tiers.concrete, 0, 1 / 3)),
  'concrete-medium': top1(slice(tiers.concrete, 1 / 3, 2 / 3)),
  'concrete-hard': slice(tiers.concrete, 2 / 3, 1),
  social: top1(slice(tiers.social, 0, 2 / 3)),
  'abstract-easy': top1(slice(tiers.abstract, 0, 1 / 2)),
  'abstract-hard': slice(tiers.abstract, 1 / 2, 1),
  // Sunday: verbs and adjectives, but not the very common, very vague ones (get, make, good, new: zipf > 5.2).
  'action-quality': top1(slice(tiers['action-quality'].filter((t) => t.zipf <= 5.2), 0, 2 / 3)),
};

// Keep past days.
const file = `site/data/schedule-v1.json`;
const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const days = [];
const used = [];
if (keepUntil && old) {
  if (old.epoch !== epoch) throw new Error(`--keep-until with a different epoch (${old.epoch} -> ${epoch}) would renumber live days`);
  for (let i = 0; i < old.days.length && addDays(epoch, i) <= keepUntil; i++) { days.push(old.days[i]); used.push(old.days[i].word); }
  console.log(`kept ${days.length} days up to ${keepUntil}`);
}

// Each pool in a fixed pseudo-random order: by a hash of the word, not a shuffle of the list. A word's place doesn't
// depend on which other words exist, so excluding one word only brings in one new word (later days of that weekday
// move up a week). The seed is NOT the epoch: moving launch day only shifts dates, the curated set of words stays.
const SEED = 'describle-v1';
const queues = Object.fromEntries(Object.entries(POOLS).map(([k, list]) => [k,
  [...list].sort((a, b) => hashString(`${SEED}:${a.w}`) - hashString(`${SEED}:${b.w}`))]));
// A new target clashes with an earlier one if it's a variant of it, or one is among the other's banned words
// (catches spelling twins the variant rule can't: aluminum/aluminium, chili/chile, whisky/whiskey).
const bannedOf = new Map(eligible.map((t) => [t.w, new Set(t.banned)]));
for (const d of days) bannedOf.set(d.word, new Set(d.banned));
const clashes = (w) => used.some((u) => u === w || isVariant(u, w, irregular) || bannedOf.get(u)?.has(w) || bannedOf.get(w)?.has(u));
const short = {};
for (let i = days.length; i < WEEKS * 7; i++) {
  const day = addDays(epoch, i);
  const pool = WEEKDAY_POOLS[weekday(day)];
  const q = queues[pool];
  let t;
  while (q.length && clashes((t = q.shift()).w)) t = null;
  if (!t) { short[pool] = (short[pool] ?? 0) + 1; throw new Error(`pool ${pool} ran out on ${day}`); }
  used.push(t.w);
  days.push({ word: t.w, pos: t.pos, pool, def: t.def, banned: t.banned, related: t.related });
}

// What changed since the previous schedule file: read these words before deploying.
if (old && old.epoch === epoch) {
  const changed = days.map((d, i) => [i, old.days[i]?.word, d.word]).filter(([, a, b]) => a !== b);
  fs.writeFileSync('data/schedule-changes.txt', changed.map(([i, a, b]) => `${addDays(epoch, i)} (#${i + 1}, ${days[i].pool}): ${a ?? '-'} -> ${b} [${days[i].banned.join(' ')}]`).join('\n') + '\n');
  // Excluding a word moves its weekday's later words up a week, so most changed days just shuffle known words.
  // The words to read are the ones not in the previous schedule at all.
  const before = new Set(old.days.map((d) => d.word));
  const fresh = days.map((d, i) => [i, d]).filter(([, d]) => !before.has(d.word));
  console.log(`${changed.length} days changed since the previous schedule (data/schedule-changes.txt); ${fresh.length} words are new:`);
  for (const [i, d] of fresh) console.log(`  ${addDays(epoch, i)} (${d.pool}): ${d.word} [${d.banned.join(' ')}]`);
}
fs.writeFileSync(file, JSON.stringify({ version: 1, epoch, vocab: VOCAB_VERSION, weeks: WEEKS, days }));
console.log(`${file}: ${days.length} days from ${epoch} to ${addDays(epoch, days.length - 1)}`);
for (const [k, list] of Object.entries(POOLS)) console.log(`  ${k.padEnd(16)} pool ${String(list.length).padStart(4)}, used ${days.filter((d) => d.pool === k).length}`);

// Every word, grouped by weekday, for reading through (curate into data/target-exclude.txt, then rerun).
const lines = [];
WEEKDAY_POOLS.forEach((pool, wd) => {
  lines.push(`== ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][wd]} (${pool})`);
  lines.push(days.map((d, i) => [d, addDays(epoch, i)]).filter(([, day]) => weekday(day) === wd).map(([d]) => `${d.word} [${d.banned.join(' ')}]`).join('; '));
});
fs.writeFileSync('data/schedule-review.txt', lines.join('\n') + '\n');
console.log('wrote data/schedule-review.txt');
