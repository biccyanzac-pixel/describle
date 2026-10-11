// The daily schedule (site/data/schedule-v1.json, pipeline/schedule.mjs): what every day must satisfy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EPOCH, WEEKDAY_POOLS, addDays, weekday } from '../site/js/daily.js';
import { isVariant, makeBanCheck } from '../site/js/ban.js';
import { VOCAB_VERSION } from '../site/js/vocab.js';

const read = (p) => JSON.parse(fs.readFileSync(new URL(p, import.meta.url), 'utf8'));
const schedule = read('../site/data/schedule-v1.json');
const meta = read(`../site/data/vocab-v${VOCAB_VERSION}.json`);
const validation = read('../data/validation.json');
const lexicon = new Set(meta.words);
const irregular = meta.irregular;
const exclude = new Set(fs.readFileSync(new URL('../data/target-exclude.txt', import.meta.url), 'utf8')
  .split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith('#')));
const days = schedule.days;

test('covers more than 2 years in whole weeks, from the epoch, with the current vocabulary', () => {
  assert.equal(schedule.epoch, EPOCH);
  assert.equal(schedule.vocab, VOCAB_VERSION);
  assert.equal(days.length % 7, 0);
  assert.ok(days.length >= 731, `${days.length} days`);
});

test('each day draws from its weekday pool', () => {
  days.forEach((d, i) => assert.equal(d.pool, WEEKDAY_POOLS[weekday(addDays(EPOCH, i))], `day ${i + 1} ${d.word}`));
});

test('no repeats: no word twice, no variants (dog/dogs), no spelling twins (each other\'s banned word)', () => {
  const words = days.map((d) => d.word);
  assert.equal(new Set(words).size, words.length);
  for (let i = 0; i < days.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = days[i], b = days[j];
      assert.ok(!isVariant(a.word, b.word, irregular), `${a.word} ~ ${b.word}`);
      assert.ok(!a.banned.includes(b.word) && !b.banned.includes(a.word), `${a.word} / ${b.word} share a ban`);
    }
  }
});

test('every target is a validated, non-excluded vocabulary word with a definition', () => {
  for (const d of days) {
    assert.ok(lexicon.has(d.word), d.word);
    assert.ok(validation[d.word]?.pass, `${d.word} failed validation`);
    assert.ok(!exclude.has(d.word), `${d.word} is excluded`);
    assert.ok(d.def && d.def.length > 5, `${d.word} has no definition`);
  }
});

test('5 distinct banned words per day: vocabulary words, not excluded, not a form of the target', () => {
  for (const d of days) {
    assert.equal(d.banned.length, 5, d.word);
    assert.equal(new Set(d.banned).size, 5, d.word);
    for (const b of d.banned) {
      assert.ok(lexicon.has(b), `${b} (banned for ${d.word}) not in vocabulary`);
      assert.ok(!exclude.has(b), `${b} (banned for ${d.word}) is excluded`);
      assert.ok(!isVariant(b, d.word, irregular), `${b} is a form of ${d.word}`);
    }
  }
});

test("each day's ban check refuses the target, its banned words and their plurals", () => {
  for (const d of days.slice(0, 120)) {
    const check = makeBanCheck({ banned: [d.word, ...d.banned], related: d.related, lexicon, irregular });
    for (const w of [d.word, ...d.banned]) assert.ok(!check(`it is a ${w}`).ok, `${w} allowed on ${d.word} day`);
    assert.ok(!check(`some ${d.word}s`).ok || !check(`some ${d.word}es`).ok, `plural of ${d.word}`);
    for (const [w, list] of Object.entries(d.related ?? {})) for (const r of list) assert.ok(!check(r).ok, `${r} (related to ${w})`);
  }
});

test('golden days: the first scheduled days never change (test/fixtures/schedule-golden.json)', () => {
  const golden = read('./fixtures/schedule-golden.json');
  assert.equal(golden.epoch, schedule.epoch);
  golden.days.forEach((g, i) => assert.deepEqual({ word: days[i].word, banned: days[i].banned }, g, `day ${i + 1} (${addDays(EPOCH, i)})`));
});
