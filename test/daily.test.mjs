// Dates, puzzle numbers, the weekday curve and date -> puzzle selection (site/js/daily.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EPOCH, WEEKDAY_POOLS, addDays, dayNumber, entryFor, msUntilNextUtcDay, todayKey, validDay, weekday } from '../site/js/daily.js';

test('the day is the UTC date, whatever the local timezone', () => {
  // 23:30 in New York on 11 Oct is already 12 Oct in UTC; 00:30 BST on 12 Oct is still 11 Oct in UTC
  assert.equal(todayKey(new Date('2026-10-11T23:30:00-04:00')), '2026-10-12');
  assert.equal(todayKey(new Date('2026-10-12T00:30:00+01:00')), '2026-10-11');
  assert.equal(todayKey(new Date('2026-10-11T23:59:59.999Z')), '2026-10-11');
  assert.equal(todayKey(new Date('2026-10-12T00:00:00.000Z')), '2026-10-12');
});

test('puzzle numbers count from the epoch, across DST and leap days', () => {
  assert.equal(dayNumber(EPOCH), 1);
  assert.equal(dayNumber(addDays(EPOCH, 1)), 2);
  assert.equal(dayNumber(addDays(EPOCH, -1)), 0);
  assert.equal(dayNumber('2028-03-01'), dayNumber('2028-02-28') + 2); // 2028 is a leap year
  assert.equal(dayNumber('2026-10-25') - dayNumber('2026-10-24'), 1); // UK clocks change that night
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('countdown to the next UTC midnight', () => {
  assert.equal(msUntilNextUtcDay(Date.parse('2026-10-11T23:59:59Z')), 1000);
  assert.equal(msUntilNextUtcDay(Date.parse('2026-10-12T00:00:00Z')), 864e5);
});

test('validDay rejects impossible dates', () => {
  assert.ok(validDay('2028-02-29'));
  assert.ok(!validDay('2027-02-29'));
  assert.ok(!validDay('2026-1-01'));
  assert.ok(!validDay(null));
});

test('weekday curve: one pool per weekday, Sunday special, Monday easiest', () => {
  assert.equal(WEEKDAY_POOLS.length, 7);
  assert.equal(WEEKDAY_POOLS[0], 'action-quality');
  assert.equal(WEEKDAY_POOLS[1], 'concrete-easy');
  assert.equal(WEEKDAY_POOLS[6], 'abstract-hard');
  assert.equal(weekday('2026-10-12'), 1); // a Monday
  assert.equal(weekday('2026-10-18'), 0); // a Sunday
});

test('entryFor: date -> the schedule entry, null before #1 or for a mismatched schedule', () => {
  const schedule = { epoch: EPOCH, days: Array.from({ length: 14 }, (_, i) => ({ word: `w${i}` })) };
  assert.equal(entryFor(EPOCH, schedule).word, 'w0');
  assert.equal(entryFor(EPOCH, schedule).number, 1);
  assert.equal(entryFor(addDays(EPOCH, 13), schedule).word, 'w13');
  assert.equal(entryFor(addDays(EPOCH, -1), schedule), null);
  assert.equal(entryFor('not a date', schedule), null);
  assert.equal(entryFor(EPOCH, { ...schedule, epoch: '2020-01-01' }), null);
});

test('past the end, the schedule repeats on the same weekdays', () => {
  const schedule = { epoch: EPOCH, days: Array.from({ length: 14 }, (_, i) => ({ word: `w${i}` })) };
  const late = addDays(EPOCH, 14 + 3);
  assert.equal(entryFor(late, schedule).word, 'w3');
  assert.equal(weekday(late), weekday(addDays(EPOCH, 3)));
  assert.equal(entryFor(late, schedule).number, 18);
});
