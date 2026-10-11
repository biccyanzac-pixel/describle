// localStorage, wrapped so the game works with storage blocked or empty (private mode, cleared data).
// Progress per day: { attempts: [{ text, words, rank, top: [{ word, score }] }] }.
// Today's real game and archive replays are kept apart ('day' vs 'late').
const KEY = 'describle:progress:v1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

let mem = readAll();

function writeAll() {
  try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* storage blocked: progress lasts for this page */ }
}

const k = (day, late) => `${late ? 'late' : 'day'}:${day}`;

export function attempts(day, late = false) {
  return mem[k(day, late)]?.attempts ?? [];
}

export function addAttempt(day, late, attempt) {
  const p = mem[k(day, late)] ?? { attempts: [] };
  p.attempts.push(attempt);
  mem[k(day, late)] = p;
  writeAll();
}

/** Consecutive days (ending today, or yesterday if today isn't finished) whose word was guessed on the day. */
export function streak(today, addDays, solvedOn) {
  let s = 0;
  let d = solvedOn(today) ? today : addDays(today, -1);
  while (solvedOn(d)) { s++; d = addDays(d, -1); }
  return s;
}
