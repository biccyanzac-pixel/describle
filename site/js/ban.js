// The ban check: a description may not use the secret word, the day's 5 banned words, or any form of them.
// Shared by the game, the offline pipeline (banned-word choice, validation) and the tests.
//
// A token is banned for word w when it is:
//   exact     w itself
//   form      a regular inflection of w (balls, ran -> irregular list, happier, running, …)
//   stem      the same Porter stem as w (generous -> gener = general; over-banning is accepted: the player knows the word)
//   related   on the day's precomputed list: vocabulary words that contain w and mean something close to it
//             (football for ball, kingdom for king; but not season for son). Built offline by relatedContaining().
//   compound  NOT a vocabulary word, and w plus a known word or a common prefix/suffix (snowmen, footballs, unhappily)
//   spelled   single letters that spell w ("b a l l", "b-a-l-l")
import { stemmer } from '../vendor/stemmer/stemmer.js';

/** Lowercase words of a description, accents removed, possessive 's dropped, apostrophes joined (don't -> dont). */
export function tokenize(text) {
  const t = String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’]s\b/g, '').replace(/['’]/g, '');
  return t.match(/[a-z]+/g) ?? [];
}

const VOWEL = /[aeiou]/;
const isCVC = (w) => w.length >= 3 && !VOWEL.test(w.at(-1)) && !/[wxy]/.test(w.at(-1)) && VOWEL.test(w.at(-2)) && !VOWEL.test(w.at(-3));

/** Regular inflections of w, generously (a few non-words are harmless). Irregular ones come from `irregular`. */
export function forms(w, irregular = {}) {
  const out = new Set([w]);
  const add = (...xs) => xs.forEach((x) => out.add(x));
  const stemE = w.endsWith('e') ? w.slice(0, -1) : w;
  const consY = /[^aeiou]y$/.test(w);
  const yI = consY ? w.slice(0, -1) + 'i' : w;
  const dbl = isCVC(w) ? w + w.at(-1) : null;
  // plural / 3rd person
  if (/(s|x|z|ch|sh)$/.test(w)) add(w + 'es'); else if (consY) add(yI + 'es'); else add(w + 's');
  if (/o$/.test(w)) add(w + 'es');
  if (/f$/.test(w)) add(w.slice(0, -1) + 'ves');
  if (/fe$/.test(w)) add(w.slice(0, -2) + 'ves');
  // past, -ing, comparative/superlative, agent
  for (const suf of ['ed', 'er', 'est', 'ers']) {
    add(w.endsWith('e') ? w + suf.slice(1) : yI + suf);
    if (dbl) add(dbl + suf);
  }
  add(stemE + 'ing', w + 'ing');
  if (w.endsWith('ie')) add(w.slice(0, -2) + 'ying');
  if (dbl) add(dbl + 'ing');
  // Own properties only: "constructor" and "valueOf" are vocabulary words too.
  for (const f of Object.hasOwn(irregular, w) ? irregular[w] : []) add(f);
  return out;
}

// Common derivational affixes, for tokens that aren't vocabulary words.
const SUFFIXES = ['y', 'ly', 'ily', 'ness', 'ful', 'fully', 'less', 'ish', 'ie', 'ies', 'er', 'ers', 'ed', 'ing', 'ings', 's', 'es',
  'ist', 'ists', 'ism', 'like', 'hood', 'ship', 'dom', 'ward', 'wards', 'en', 'ity', 'ic', 'al', 'ally', 'ous', 'able', 'let', 'lets', 'ette'];
const PREFIXES = ['un', 're', 'dis', 'mis', 'non', 'pre', 'anti', 'de', 'in', 'im', 'ir', 'il', 'sub', 'super', 'co', 'over', 'under', 'out', 'mini', 'mega'];

/** Is `t` (not a vocabulary word) built from w? */
function isCompoundOf(t, w, lexicon, irregular) {
  if (w.length < 3 || t.length <= w.length) return false;
  const known = (x) => x.length >= 3 && (lexicon.has(x) || [...baseCandidates(x, irregular)].some((b) => lexicon.has(b)));
  // w at the start: w + suffix/word (allowing a doubled consonant, a dropped e, y -> i)
  const heads = new Set([w, w.endsWith('e') ? w.slice(0, -1) : w, /y$/.test(w) ? w.slice(0, -1) + 'i' : w, isCVC(w) ? w + w.at(-1) : w]);
  for (const h of heads) {
    if (!t.startsWith(h)) continue;
    const rest = t.slice(h.length);
    if (SUFFIXES.includes(rest) || known(rest)) return true;
  }
  // w (or one of its forms) at the end: prefix/word + w
  for (const f of forms(w, irregular)) {
    if (t.length > f.length && t.endsWith(f)) {
      const rest = t.slice(0, -f.length);
      if (PREFIXES.includes(rest) || known(rest)) return true;
    }
  }
  // prefix + a derived/compound form: unhappily, overcooking
  for (const p of PREFIXES) {
    if (t.startsWith(p) && t.length - p.length > w.length) {
      const rest = t.slice(p.length);
      if (forms(w, irregular).has(rest) || stemmer(rest) === stemmer(w) || isCompoundOf(rest, w, lexicon, irregular)) return true;
    }
  }
  return false;
}

/** Possible base forms of an inflected word (men -> man via irregular; boxes -> box; tried -> try; running -> run). */
function baseCandidates(t, irregular) {
  const rev = irregularReverse(irregular);
  const out = new Set(Object.hasOwn(rev, t) ? rev[t] : []);
  const rules = [[/ies$/, 'y'], [/ves$/, 'f'], [/ves$/, 'fe'], [/es$/, ''], [/s$/, ''], [/ied$/, 'y'], [/ed$/, ''], [/ed$/, 'e'],
    [/ing$/, ''], [/ing$/, 'e'], [/ier$/, 'y'], [/er$/, ''], [/iest$/, 'y'], [/est$/, '']];
  for (const [re, rep] of rules) if (re.test(t)) out.add(t.replace(re, rep));
  for (const b of [...out]) if (/(.)\1$/.test(b)) out.add(b.slice(0, -1)); // running -> runn -> run
  return out;
}

const reverseCache = new WeakMap();
function irregularReverse(irregular) {
  let r = reverseCache.get(irregular);
  if (!r) {
    r = Object.create(null);
    for (const [base, fs] of Object.entries(irregular)) for (const f of fs) (r[f] ??= []).push(base);
    reverseCache.set(irregular, r);
  }
  return r;
}

/** Are a and b the same word up to inflection or stem? (Used for banned-word choice and for "the guess counts".) */
export function isVariant(a, b, irregular = {}) {
  if (a === b) return true;
  if (forms(b, irregular).has(a) || forms(a, irregular).has(b)) return true;
  return stemmer(a) === stemmer(b);
}

/**
 * Build a checker for one day.
 *   banned:    [target, ...banned words]
 *   related:   { word: [vocabulary words that count as using it] } (precomputed per day, see relatedContaining)
 *   lexicon:   Set of vocabulary words
 *   irregular: { base: [irregular forms] }
 * check(text) -> { ok, hits: [{ token, word, why }] }, one hit per offending token.
 */
export function makeBanCheck({ banned, related = {}, lexicon = new Set(), irregular = {} }) {
  const words = banned.map((w) => w.toLowerCase());
  const formSets = new Map(words.map((w) => [w, forms(w, irregular)]));
  const stems = new Map(words.map((w) => [w, stemmer(w)]));
  const rel = new Map(words.map((w) => [w, new Set(Object.hasOwn(related, w) ? related[w] : [])]));

  function why(t, w) {
    if (t === w) return 'exact';
    if (formSets.get(w).has(t)) return 'form';
    if (stemmer(t) === stems.get(w)) return 'stem';
    if (rel.get(w).has(t)) return 'related';
    if (!lexicon.has(t) && isCompoundOf(t, w, lexicon, irregular)) return 'compound';
    return null;
  }

  return function check(text) {
    const toks = tokenize(text);
    const hits = [];
    const seen = new Set();
    for (const t of toks) {
      if (seen.has(t) || t.length === 1) continue;
      for (const w of words) {
        const r = why(t, w);
        if (r) { hits.push({ token: t, word: w, why: r }); seen.add(t); break; }
      }
    }
    // Runs of 2+ single letters are also read as words: "it is a b a l l" -> any stretch of "aball", so "ball".
    // One hit per run and banned word, the longest stretch that matches.
    for (let i = 0; i < toks.length;) {
      let j = i;
      while (j < toks.length && toks[j].length === 1) j++;
      const run = toks.slice(i, j).join('').slice(0, 40);
      const done = new Set();
      for (let len = run.length; len >= 2; len--) {
        for (let a = 0; a + len <= run.length; a++) {
          const t = run.slice(a, a + len);
          for (const w of words) {
            if (!done.has(w) && why(t, w)) { hits.push({ token: t, word: w, why: 'spelled' }); done.add(w); }
          }
        }
      }
      i = Math.max(j, i + 1);
    }
    return { ok: hits.length === 0, hits };
  };
}

/**
 * Offline helper: vocabulary words that contain w (start or end, after small spelling changes) and whose
 * similarity to w is at least `minSim`. similarity(a, b) is supplied by the caller (word-vector cosine).
 */
export function relatedContaining(w, vocabWords, similarity, { minSim = 0.5, irregular = {} } = {}) {
  const out = [];
  for (const v of vocabWords) {
    if (v === w || v.length <= w.length) continue;
    if (!(v.startsWith(w) || v.endsWith(w) || (w.endsWith('e') && v.startsWith(w.slice(0, -1))))) continue;
    if (isVariant(v, w, irregular)) continue; // after the cheap test: stemming every word is slow
    if (similarity(v, w) >= minSim) out.push(v);
  }
  return out;
}
