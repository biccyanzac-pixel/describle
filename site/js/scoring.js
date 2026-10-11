// Scoring, word counting and the share text. Shared by the game and the leaderboard worker (worker/src/index.js),
// so a score can never differ between them.
//
// The rules (the owner's spec: "100 on a first-attempt correct guess, minus points per word over 5 and per extra
// attempt"):
//   - 3 attempts a day, each a fresh description of at most 25 words.
//   - The model is right if its top guess is the secret word (or a form of it, isVariant in ban.js).
//   - Score for the attempt that gets it: 100 - 25 per earlier attempt - 3 per word over 5, never below 10.
//       1st attempt, 5 words or fewer: 100.  1st attempt, 12 words: 79.  2nd attempt, 8 words: 66.
//       3rd attempt, 25 words: 10 (the floor).
//   - Not guessed in 3 attempts: 0.

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

/** Points for getting it on attempt `index` (0-based) with `words` words; 0 if not guessed. */
export function attemptScore(index, words, correct) {
  if (!correct) return 0;
  return Math.max(MIN_WIN, MAX_SCORE - ATTEMPT_PENALTY * index - WORD_PENALTY * Math.max(0, words - FREE_WORDS));
}

/**
 * The day's state from its attempts ([{ words, rank }], rank = where the secret word came in the model's top 5,
 * 1 = guessed, 0 = not in the top 5). Attempts after a correct one don't count.
 */
export function dayResult(attempts) {
  for (let i = 0; i < attempts.length && i < MAX_ATTEMPTS; i++) {
    if (attempts[i].rank === 1) return { solved: true, attempt: i + 1, words: attempts[i].words, score: attemptScore(i, attempts[i].words, true), finished: true, used: i + 1 };
  }
  const used = Math.min(attempts.length, MAX_ATTEMPTS);
  return { solved: false, attempt: null, words: null, score: 0, finished: used >= MAX_ATTEMPTS, used };
}

/** One square per attempt: 🟩 guessed, 🟨 in the top 5 ("close"), ⬛ not in the top 5. */
export function attemptSquare(rank) {
  return rank === 1 ? '🟩' : rank >= 2 && rank <= 5 ? '🟨' : '⬛';
}

/** The share text, e.g. "✍️ Describle #41 — guessed in 7 words, attempt 1 (93/100)". */
export function shareText({ number, attempts, streak = 0, late = false, url = SITE }) {
  const r = dayResult(attempts);
  const head = `✍️ Describle #${number}${late ? ' (replay)' : ''} — `;
  const best = attempts.reduce((b, a) => (a.rank >= 1 && (b === 0 || a.rank < b) ? a.rank : b), 0);
  const what = r.solved
    ? `guessed in ${r.words} word${r.words === 1 ? '' : 's'}, attempt ${r.attempt} (${r.score}/${MAX_SCORE})`
    : `not guessed${best ? ` (closest: #${best})` : ''}`;
  const squares = attempts.slice(0, r.used).map((a) => attemptSquare(a.rank)).join('');
  return `${head}${what}\n${squares}${streak > 1 ? `  🔥${streak}` : ''}\n${url}`;
}
