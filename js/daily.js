// Which day it is and which puzzle that day gets. Shared by the site, the schedule generator, the tests and (Phase 4)
// the leaderboard worker, so the day, puzzle number and target can never disagree between them.
// The day is the UTC date: everyone gets the same word, and it changes at 00:00 UTC.

// Puzzle #1: launch day (Sunday 11 Oct 2026). NEVER change it: it renumbers every puzzle and moves every word.
export const EPOCH = '2026-10-11';

/** UTC day key YYYY-MM-DD. */
export function todayKey(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

export function validDay(day) {
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
    && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))
    && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}

export function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

/** Puzzle number: EPOCH is #1. */
export function dayNumber(day) {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${EPOCH}T00:00:00Z`)) / 864e5) + 1;
}

export function msUntilNextUtcDay(now = Date.now()) {
  return Math.ceil((now + 1) / 864e5) * 864e5 - now;
}

/** 0 = Sunday … 6 = Saturday, of the UTC day. */
export function weekday(day) {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

// The jacob.gg weekday curve (jacob.gg/PLAYBOOK.md, kit/jgg.js): Monday easiest, rising to Saturday; Sunday special.
// What each day's word is drawn from (pipeline/schedule.mjs, docs/schedule.md):
export const WEEKDAY_POOLS = [
  'action-quality',   // Sunday special: a verb or an adjective ("describe an action or a quality")
  'concrete-easy',    // Monday: a common, easy physical thing
  'concrete-medium',  // Tuesday
  'social',           // Wednesday: a person, place, group, time, event or something people say
  'concrete-hard',    // Thursday: a less common physical thing
  'abstract-easy',    // Friday: an idea, feeling or quality (noun)
  'abstract-hard',    // Saturday: a harder abstract noun
];

/**
 * The day's puzzle from the schedule (site/data/schedule-v1.json), or null before puzzle #1.
 * The schedule is a whole number of weeks long; past its end it repeats from the start, on the same weekdays,
 * so the game never runs out (regenerate future days before then: docs/schedule.md).
 */
export function entryFor(day, schedule) {
  const n = dayNumber(day);
  if (!validDay(day) || n < 1 || schedule.epoch !== EPOCH) return null;
  const days = schedule.days;
  return { day, number: n, ...days[(n - 1) % days.length] };
}
