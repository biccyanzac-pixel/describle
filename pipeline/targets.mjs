// Phase 3, step 1: every word that could be a daily target, with its tier, banned words, compound lists and the
// reference description used to validate it.
//   node pipeline/targets.mjs   ->  data/targets.json, data/targets_rejected.json
//
// A target must be (in the game's 15k vocabulary):
//   - common: zipf >= 3.6 (about 4 uses per million words)
//   - mostly used as what its main WordNet sense is: when the Brown corpus has the word 5+ times, at least half of
//     its uses are that part of speech (drops names like "john", function words like "must", "despite")
//   - a base form, not an inflection of another vocabulary word ("humans", "feelings", "going")
//   - not sensitive: no main/second sense about sex, killing, death, drugs and the like (SENSITIVE), and not in
//     data/target-exclude.txt
//   - in a tier (by WordNet category of its main sense): see TIERS
import fs from 'node:fs';
import { forms, makeBanCheck, tokenize } from '../site/js/ban.js';
import { stemmer } from '../site/vendor/stemmer/stemmer.js';
import { loadBanData, bannedFor, relatedFor } from './ban-words.mjs';

export const N_VOCAB = 15000;
export const MIN_ZIPF = 3.6;
// Nouns this close to the top of WordNet's hierarchy are too generic to describe (object 2, people 3). Depth 5 also
// cut good words (music, law, story, friend: 4), and depth can't separate world from water (both 5), so the rest
// is curated in data/target-exclude.txt after reading the schedule.
export const MIN_NOUN_DEPTH = 4;
export const TIERS = {
  concrete: ['noun.artifact', 'noun.animal', 'noun.food', 'noun.plant', 'noun.object', 'noun.body', 'noun.substance', 'noun.phenomenon'],
  social: ['noun.person', 'noun.location', 'noun.group', 'noun.time', 'noun.event', 'noun.communication'],
  abstract: ['noun.act', 'noun.attribute', 'noun.state', 'noun.feeling', 'noun.cognition', 'noun.possession', 'noun.quantity',
    'noun.relation', 'noun.process', 'noun.shape', 'noun.motive'],
  'action-quality': ['verb.*', 'adj.all'],
};
// Not "sex" (child: "a young person of either sex") or "terror" (terrible, awful: "causing terror").
const SENSITIVE = /\b(sexual|sexually|genital|genitals|penis|vagina|breast|breasts|erotic|suicide|murder|kill|killing|killed|corpse|torture|slave|slavery|terrorist|genocide|abortion|prostitute|prostitution|narcotic|drug|drugs|heroin|cocaine|execution|rape|racial|racist|nazi|excrement|feces|urine)\b/i;

const tierOf = (lex) => Object.entries(TIERS).find(([, ls]) => ls.some((l) => l === lex || (l.endsWith('.*') && lex.startsWith(l.slice(0, -1)))))?.[0] ?? null;
const POS_GROUP = { n: 'noun', v: 'verb', a: 'adj' };

const vocab = JSON.parse(fs.readFileSync('data/vocab.json', 'utf8')).slice(0, N_VOCAB);
const pos = JSON.parse(fs.readFileSync('data/pos.json', 'utf8'));
const exclude = new Set(fs.existsSync('data/target-exclude.txt')
  ? fs.readFileSync('data/target-exclude.txt', 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')) : []);
const names = new Set(JSON.parse(fs.readFileSync('data/names.json', 'utf8')));
const data = await loadBanData();
const lexicon = new Set(vocab.map((e) => e.w));
const irregular = data.irregular;

// Words that are an inflection of another vocabulary word: a generated form that also shares its Porter stem
// (humans/human, feelings/feel), or a WordNet irregular form (best/good). The stem condition keeps "number"
// (not numb + er) and "matter" (not mat + er).
// Comparatives/superlatives of adjectives count too (smaller, finest: Porter leaves "smaller" alone).
const inflected = new Set();
for (const e of vocab) {
  const irr = new Set(Object.hasOwn(irregular, e.w) ? irregular[e.w] : []);
  const adj = e.senses[0].pos === 'a';
  for (const f of forms(e.w, irregular)) {
    if (f === e.w || !lexicon.has(f)) continue;
    // -er/-est only when Brown mostly uses the word as an adjective ("smaller" yes; "number", from numb, no).
    const mostlyAdj = !pos[f] || (pos[f].adj ?? 0) / pos[f].n >= 0.5;
    if (irr.has(f) || stemmer(f) === stemmer(e.w) || (adj && /(er|est)$/.test(f) && mostlyAdj)) inflected.add(f);
  }
}

const kept = [], rejected = {};
const reject = (why, w) => (rejected[why] ??= []).push(w);
for (const e of vocab) {
  const s0 = e.senses[0], w = e.w;
  const tier = tierOf(s0.lex);
  const p = pos[w];
  if (e.zipf < MIN_ZIPF) { reject('rare', w); continue; }
  if (!tier) { reject(`category ${s0.lex}`, w); continue; }
  if (p && p.n >= 5 && (p[POS_GROUP[s0.pos]] ?? 0) / p.n < 0.5) { reject('mostly used otherwise (Brown)', w); continue; }
  if (inflected.has(w)) { reject('inflection', w); continue; }
  if (s0.pos === 'n' && s0.depth < MIN_NOUN_DEPTH) { reject('too generic (WordNet depth)', w); continue; }
  if (exclude.has(w)) { reject('target-exclude.txt', w); continue; }
  // Bureaucratic nominalisations make dull puzzles (procurement, cancellation, validation, coordination): in the
  // abstract tier, drop -tion/-sion/-ment/-ance/-ence words whose main sense is an act, a process or a relation.
  // Feelings and states stay (curiosity, jealousy, celebration is an event).
  if (tier === 'abstract' && /(tion|sion|ment|ance|ence)$/.test(w) && ['noun.act', 'noun.process', 'noun.relation'].includes(s0.lex)) { reject('dull nominalisation', w); continue; }
  // A first name (NLTK names list) is out unless Brown has it 5+ times and under a quarter of those are proper
  // nouns, i.e. it's mostly an ordinary word ("hope", "grace"), not a name ("josh", "brent").
  if (names.has(w) && !(p && p.n >= 5 && (p.proper ?? 0) / p.n < 0.25)) { reject('first name', w); continue; }
  if (e.senses.slice(0, 2).some((s) => SENSITIVE.test(s.def))) { reject('sensitive', w); continue; }
  kept.push({ w, zipf: e.zipf, tier, pos: s0.pos, lex: s0.lex, depth: s0.depth, def: s0.def });
}

// Banned words, compound lists and the reference description (the main definition minus everything the day's
// ban check refuses, at most 25 words).
const t0 = Date.now();
for (const [i, t] of kept.entries()) {
  t.banned = bannedFor(t.w, data, { n: N_VOCAB, skip: exclude });
  t.related = relatedFor([t.w, ...t.banned], data, { n: N_VOCAB });
  for (const k of Object.keys(t.related)) if (!t.related[k].length) delete t.related[k];
  const check = makeBanCheck({ banned: [t.w, ...t.banned], related: t.related, lexicon, irregular });
  const bad = new Set(check(t.def).hits.map((h) => h.token));
  t.reference = tokenize(t.def).filter((x) => !bad.has(x)).slice(0, 25).join(' ');
  if (i % 1000 === 0) console.log(`  ${i}/${kept.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

fs.writeFileSync('data/targets.json', JSON.stringify(kept));
fs.writeFileSync('data/targets_rejected.json', JSON.stringify(rejected, null, 0));
const byTier = {};
for (const t of kept) byTier[t.tier] = (byTier[t.tier] ?? 0) + 1;
console.log(`${kept.length} candidate targets: ${Object.entries(byTier).map(([k, v]) => `${k} ${v}`).join(', ')}`);
for (const [k, v] of Object.entries(rejected)) if (!k.startsWith('category')) console.log(`  rejected ${k}: ${v.length}  e.g. ${v.slice(0, 14).join(', ')}`);
console.log(`  rejected by category: ${Object.entries(rejected).filter(([k]) => k.startsWith('category')).reduce((s, [, v]) => s + v.length, 0)}`);
console.log(`  all sensitive: ${(rejected.sensitive ?? []).join(', ')}`);
for (const tier of Object.keys(TIERS)) console.log(`  ${tier}: ${kept.filter((t) => t.tier === tier).slice(0, 30).map((t) => t.w).join(', ')}`);
