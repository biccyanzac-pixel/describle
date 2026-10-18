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
  assert.deepEqual(dayResult([]), { rules: 1, solved: false, attempt: null, words: null, score: 0, finished: false, used: 0 });
  assert.deepEqual(dayResult([{ words: 9, rank: 3 }, { words: 6, rank: 1 }]),
    { rules: 1, solved: true, attempt: 2, words: 6, score: 72, finished: true, used: 2 });
  assert.equal(dayResult([{ words: 4, rank: 0 }, { words: 4, rank: 2 }]).finished, false);
  assert.deepEqual(dayResult([{ words: 4, rank: 0 }, { words: 4, rank: 2 }, { words: 4, rank: 4 }]),
    { rules: 1, solved: false, attempt: null, words: null, score: 0, finished: true, used: 3 });
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

// Rules 2: from V2_FROM every attempt scores by the word's place and the word count; the day is the average of 3.
import { V2_FROM, attemptPoints, placePoints, rulesFor, squareFor } from '../site/js/scoring.js';

test('rules by day: rules 1 before V2_FROM, rules 2 from it', () => {
  assert.equal(rulesFor('2026-10-11'), 1);
  assert.equal(rulesFor('2026-10-19'), 1);
  assert.equal(rulesFor(V2_FROM), 2);
  assert.equal(rulesFor('2027-01-01'), 2);
});

test('rules 2: points by place, less 2.5% per word over 5', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10, 11, 25, 26, 100, 101, 15000].map(placePoints), [100, 70, 55, 45, 40, 25, 25, 15, 15, 5, 5, 0, 0]);
  assert.equal(placePoints(0), 0);
  assert.equal(placePoints(null), 0);
  assert.equal(attemptPoints(1, 5), 100);
  assert.equal(attemptPoints(1, 2), 100);
  assert.equal(attemptPoints(1, 12), 83);   // 82.5 rounds up
  assert.equal(attemptPoints(3, 9), 50);    // 49.5 rounds up
  assert.equal(attemptPoints(20, 25), 8);   // 7.5 rounds up
  assert.equal(attemptPoints(1, 25), 50);
  assert.equal(attemptPoints(500, 3), 0);
});

test('rules 2: the day is the average of all 3; it goes on after a #1', () => {
  const day = V2_FROM;
  const one = dayResult([{ words: 4, rank: 1, place: 1 }], day);
  assert.equal(one.finished, false);
  assert.equal(one.solved, true);
  assert.equal(one.score, 33.3);
  const r = dayResult([{ words: 12, rank: 1, place: 1 }, { words: 4, rank: 1, place: 1 }, { words: 9, rank: 0, place: 37 }], day);
  assert.deepEqual(r, { rules: 2, solved: true, finished: true, used: 3, score: 62.7, points: [83, 100, 5],
    best: { attempt: 2, place: 1, words: 4, points: 100 } });
  assert.equal(dayResult([{ words: 9, rank: 0, place: 900 }, { words: 9, rank: 0, place: 300 }, { words: 9, rank: 0, place: 101 }], day).score, 0);
  assert.equal(dayResult([], day).finished, false);
});

test('rules 2: squares by place, and the share text', () => {
  assert.equal(attemptSquare(37), '🟧');
  assert.equal(attemptSquare(101), '⬛');
  assert.equal(squareFor({ rank: 0, place: 37 }, '2026-10-12'), '⬛'); // rules 1 days square by the top-5 rank
  assert.equal(squareFor({ rank: 0, place: 37 }, V2_FROM), '🟧');
  const attempts = [{ words: 12, rank: 1, place: 1 }, { words: 4, rank: 1, place: 1 }, { words: 9, rank: 0, place: 37 }];
  assert.equal(shareText({ number: 10, attempts, day: V2_FROM, streak: 2, url: 'U' }),
    '✍️ Describle #10 — 62.7/100, best #1 in 4 words\n🟩🟩🟧  🔥2\nU');
  assert.equal(shareText({ number: 10, attempts: [{ words: 9, place: 900 }, { words: 9, place: 300 }, { words: 9, place: 101 }], day: V2_FROM, late: true, url: 'U' }),
    '✍️ Describle #10 (replay) — 0/100\n⬛⬛⬛\nU');
});
