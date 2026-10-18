// localStorage, wrapped so the game works with storage blocked or empty (private mode, cleared data).
// Progress per day and board: { runs: [[attempt, ...], ...] }, attempt = { text, words, rank, place, top: [{ word, score }] }.
// Boards: 'day' (the first go, on the day: one run), 'replay' (more goes on the day), 'late' (goes after the day).
// Older saves hold { attempts: [...] } for a single run; they're read as one run.
const KEY = 'describle:progress:v1';

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

let mem = readAll();

function writeAll() {
  try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* storage blocked: progress lasts for this page */ }
}

const k = (day, board) => `${board}:${day}`;

/** Every run on a board, oldest first. */
export function runs(day, board = 'day') {
  const p = mem[k(day, board)];
  if (!p) return [];
  return p.runs ?? [p.attempts ?? []];
}

/** The attempts of the current (latest) run. */
export function attempts(day, board = 'day') {
  const r = runs(day, board);
  return r[r.length - 1] ?? [];
}

function save(day, board, list) {
  mem[k(day, board)] = { runs: list };
  writeAll();
}

export function addAttempt(day, board, attempt) {
  const list = runs(day, board);
  if (!list.length) list.push([]);
  list[list.length - 1].push(attempt);
  save(day, board, list);
}

/** Start another run on a replay board. */
export function newRun(day, board) {
  const list = runs(day, board);
  list.push([]);
  save(day, board, list);
}

/** Consecutive days (ending today, or yesterday if today isn't finished) whose word was guessed on the day. */
export function streak(today, addDays, solvedOn) {
  let s = 0;
  let d = solvedOn(today) ? today : addDays(today, -1);
  while (solvedOn(d)) { s++; d = addDays(d, -1); }
  return s;
}
