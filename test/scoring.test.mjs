// Scoring, word counting and the share text (site/js/scoring.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attemptScore, attemptSquare, dayResult, shareText, wordCount } from '../site/js/scoring.js';

test('word count: letters/digits runs; contractions and hyphenated words are one word', () => {
  assert.equal(wordCount('a yellow fruit monkeys love'), 5);
  assert.equal(wordCount("  don't over-think it!  "), 3);
  assert.equal(wordCount('café, 24 hours'), 3);
  assert.equal(wordCount(''), 0);
  assert.equal(wordCount('!!! ...'), 0);
});

test('score: 100 first try with 5 words or fewer, -25 per extra attempt, -3 per word over 5, floor 10', () => {
  assert.equal(attemptScore(0, 3, true), 100);
  assert.equal(attemptScore(0, 5, true), 100);
  assert.equal(attemptScore(0, 12, true), 79);
  assert.equal(attemptScore(1, 8, true), 66);
  assert.equal(attemptScore(2, 5, true), 50);
  assert.equal(attemptScore(2, 25, true), 10);
  assert.equal(attemptScore(0, 25, false), 0);
});

test('day result: the first correct attempt counts; 3 misses finish the day with 0', () => {
  assert.deepEqual(dayResult([]), { solved: false, attempt: null, words: null, score: 0, finished: false, used: 0 });
  assert.deepEqual(dayResult([{ words: 9, rank: 3 }, { words: 6, rank: 1 }]),
    { solved: true, attempt: 2, words: 6, score: 72, finished: true, used: 2 });
  assert.equal(dayResult([{ words: 4, rank: 0 }, { words: 4, rank: 2 }]).finished, false);
  assert.deepEqual(dayResult([{ words: 4, rank: 0 }, { words: 4, rank: 2 }, { words: 4, rank: 4 }]),
    { solved: false, attempt: null, words: null, score: 0, finished: true, used: 3 });
  assert.equal(dayResult([{ words: 5, rank: 1 }, { words: 5, rank: 0 }]).used, 1); // nothing after a win counts
});

test('squares and the share text', () => {
  assert.equal(attemptSquare(1), '🟩');
  assert.equal(attemptSquare(4), '🟨');
  assert.equal(attemptSquare(0), '⬛');
  assert.equal(shareText({ number: 41, attempts: [{ words: 7, rank: 1 }], url: 'U' }),
    '✍️ Describle #41 — guessed in 7 words, attempt 1 (94/100)\n🟩\nU');
  assert.equal(shareText({ number: 3, attempts: [{ words: 9, rank: 0 }, { words: 6, rank: 3 }, { words: 1, rank: 1 }], streak: 4, url: 'U' }),
    '✍️ Describle #3 — guessed in 1 word, attempt 3 (50/100)\n⬛🟨🟩  🔥4\nU');
  assert.equal(shareText({ number: 2, attempts: [{ words: 9, rank: 0 }, { words: 6, rank: 3 }, { words: 5, rank: 2 }], late: true, url: 'U' }),
    '✍️ Describle #2 (replay) — not guessed (closest: #2)\n⬛🟨🟨\nU');
});
