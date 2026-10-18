// Scoring, word counting and the share text. Shared by the game and the leaderboard worker (worker/src/index.js),
// so a score can never differ between them. Which rules a day uses comes from its date (rulesFor), so a past day's
// scores never change.
//
// Rules 1 (puzzles before V2_FROM; the owner's launch spec: "100 on a first-attempt correct guess, minus points per
// word over 5 and per extra attempt"):
//   - 3 attempts a day, each a fresh description of at most 25 words.
//   - The model is right if its top guess is the secret word (or a form of it, isVariant in ban.js).
//   - Score for the attempt that gets it: 100 - 25 per earlier attempt - 3 per word over 5, never below 10.
//       1st attempt, 5 words or fewer: 100.  1st attempt, 12 words: 79.  2nd attempt, 8 words: 66.
//       3rd attempt, 25 words: 10 (the floor).
//   - Not guessed in 3 attempts: 0. The day ends at the first correct attempt.
//
// Rules 2 (from V2_FROM; the owner, 18 Oct 2026: "average of three, a lot more points if it's the AI's first guess,
// and considering the number of words used"):
//   - All 3 attempts are always played, even after the AI gets it (to try it in fewer words).
//   - Each attempt scores by where the secret word lands among all 15,000 words (its "place", 1 = the AI's guess):
//       #1 100, #2 70, #3 55, #4 45, #5 40, #6-10 25, #11-25 15, #26-100 5, below 0
//     less 2.5% of that for each word over 5 (25 words: half).
//       #1 in 5 words: 100.  #1 in 12 words: 83.  #3 in 9 words: 50.  #20 in 25 words: 8.
//   - The day's score is the average of the 3, to one decimal.

export const MAX_ATTEMPTS = 3;
export const MAX_WORDS = 25;
export const FREE_WORDS = 5;
export const ATTEMPT_PENALTY = 25;
export const WORD_PENALTY = 3;
export const MIN_WIN = 10;
export const MAX_SCORE = 100;
export const SITE = 'https://biccyanzac-pixel.github.io/describle/';

/** Words in a description: runs of letters or digits (so "don't" and "e-mail" are one word each). */
export function wordCount(text) {
  return (String(text).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

/** Rules 1: points for getting it on attempt `index` (0-based) with `words` words; 0 if not guessed. */
export function attemptScore(index, words, correct) {
  if (!correct) return 0;
  return Math.max(MIN_WIN, MAX_SCORE - ATTEMPT_PENALTY * index - WORD_PENALTY * Math.max(0, words - FREE_WORDS));
}

// Rules 2 start with this puzzle day. Set before it went live; never move it once a day under either rule set has
// been played (it would rescore that day).
export const V2_FROM = '2026-10-20';
export const rulesFor = (day) => (day >= V2_FROM ? 2 : 1);

/** Rules 2: [last place, points] bands. */
export const PLACE_POINTS = [[1, 100], [2, 70], [3, 55], [4, 45], [5, 40], [10, 25], [25, 15], [100, 5]];
export const WORD_CUT = 40; // each word over 5 takes off 1/40 (2.5%)

export function placePoints(place) {
  if (!Number.isInteger(place) || place < 1) return 0;
  for (const [last, points] of PLACE_POINTS) if (place <= last) return points;
  return 0;
}

/** Rules 2: one attempt's points from its place and word count (integer maths, so halves round up everywhere). */
export function attemptPoints(place, words) {
  return Math.round((placePoints(place) * Math.max(0, WORD_CUT - Math.max(0, words - FREE_WORDS))) / WORD_CUT);
}

const round1 = (x) => Math.round(x * 10) / 10;

/**
 * The day's state from its attempts. Each attempt is { words, rank, place }: rank = where the secret word came in
 * the model's top 5 (1 = guessed, 0 = not in the top 5); place = where it came among all the words (rules 2;
 * attempts saved before places existed have none).
 * Rules 1: attempts after a correct one don't count. Rules 2: all 3 count; the score is their average.
 */
export function dayResult(attempts, day = null) {
  if (day && rulesFor(day) === 2) {
    const list = attempts.slice(0, MAX_ATTEMPTS);
    const points = list.map((a) => attemptPoints(a.place, a.words));
    let best = -1;
    points.forEach((p, i) => { if (best < 0 || p > points[best]) best = i; });
    return {
      rules: 2, solved: list.some((a) => a.place === 1), finished: list.length >= MAX_ATTEMPTS, used: list.length,
      score: round1(points.reduce((s, p) => s + p, 0) / MAX_ATTEMPTS), points,
      best: best < 0 ? null : { attempt: best + 1, place: list[best].place, words: list[best].words, points: points[best] },
    };
  }
  for (let i = 0; i < attempts.length && i < MAX_ATTEMPTS; i++) {
    if (attempts[i].rank === 1) return { rules: 1, solved: true, attempt: i + 1, words: attempts[i].words, score: attemptScore(i, attempts[i].words, true), finished: true, used: i + 1 };
  }
  const used = Math.min(attempts.length, MAX_ATTEMPTS);
  return { rules: 1, solved: false, attempt: null, words: null, score: 0, finished: used >= MAX_ATTEMPTS, used };
}

/** One square per attempt, from the rank (rules 1) or the place (rules 2): 🟩 #1, 🟨 #2-5, 🟧 #6-100, ⬛ below. */
export function attemptSquare(place) {
  return place === 1 ? '🟩' : place >= 2 && place <= 5 ? '🟨' : place >= 6 && place <= 100 ? '🟧' : '⬛';
}

/** The square for a saved attempt under a day's rules. */
export const squareFor = (a, day) => attemptSquare(rulesFor(day) === 2 ? a.place : a.rank);

/**
 * The share text, e.g. "✍️ Describle #41 — guessed in 7 words, attempt 1 (93/100)" (rules 1) or
 * "✍️ Describle #12 — 63.3/100, best #1 in 4 words" (rules 2).
 */
export function shareText({ number, attempts, streak = 0, late = false, url = SITE, day = null }) {
  const r = dayResult(attempts, day);
  const head = `✍️ Describle #${number}${late ? ' (replay)' : ''} — `;
  if (r.rules === 2) {
    const squares = attempts.slice(0, r.used).map((a) => attemptSquare(a.place)).join('');
    const best = r.best && r.best.points > 0 ? `, best #${r.best.place} in ${r.best.words} word${r.best.words === 1 ? '' : 's'}` : '';
    return `${head}${r.score}/${MAX_SCORE}${best}\n${squares}${streak > 1 ? `  🔥${streak}` : ''}\n${url}`;
  }
  const best = attempts.reduce((b, a) => (a.rank >= 1 && (b === 0 || a.rank < b) ? a.rank : b), 0);
  const what = r.solved
    ? `guessed in ${r.words} word${r.words === 1 ? '' : 's'}, attempt ${r.attempt} (${r.score}/${MAX_SCORE})`
    : `not guessed${best ? ` (closest: #${best})` : ''}`;
  const squares = attempts.slice(0, r.used).map((a) => attemptSquare(a.rank)).join('');
  return `${head}${what}\n${squares}${streak > 1 ? `  🔥${streak}` : ''}\n${url}`;
}
