// Leaderboard client (worker/). Every call fails soft: with no backend the game still works, just without a board.
// The URL comes from data/config.json; ?api=<url> overrides it for local testing (?api=off disables it).

const SESSION_KEY = 'describle:session';
const NAME_KEY = 'describle:name';
let base;
let memSession = null;

export async function loadConfig() {
  if (base !== undefined) return base;
  try {
    const cfg = await (await fetch('data/config.json', { cache: 'no-cache' })).json();
    const override = new URLSearchParams(location.search).get('api');
    base = override === 'off' ? null : (override || cfg.leaderboardUrl || '').replace(/\/+$/, '') || null;
  } catch { base = null; }
  return base;
}

export const enabled = () => !!base;

async function call(path, body) {
  if (!base) throw new Error('No leaderboard configured.');
  const res = await fetch(base + path, body === undefined ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* handled below */ }
  if (!res.ok) {
    const e = new Error(data?.message || `Leaderboard error (HTTP ${res.status}).`);
    e.status = res.status; e.code = data?.error;
    throw e;
  }
  return data;
}

function readSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { return null; } }
function writeSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* private mode */ } }

export async function session(fresh = false) {
  if (!fresh) { const s = memSession || readSession(); if (s?.playerId && s?.token) return (memSession = s); }
  memSession = await call('/api/session', {});
  writeSession(memSession);
  return memSession;
}

export function playerId() { return (memSession || readSession())?.playerId ?? null; }
// Describle's name, else the one used in any other jacob.gg game (kit/jgg.js); saving shares it back.
export function savedName() { try { return window.JGG?.name() || localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } }
export function saveName(n) { window.JGG?.setName(n); try { localStorage.setItem(NAME_KEY, n); } catch { /* ignore */ } }

/**
 * Record one attempt. The description is sent so the server can check it against the day's ban rules and the word
 * limit; it isn't stored. `top` is the model's top 5 and `place` where the secret word came among all the words
 * (the server works out the rank and the score itself). `board`: 'day', 'replay' or 'late'; attempt 0 on a replay
 * board starts a new run.
 */
export async function submitAttempt({ day, board, attempt, text, top, place, name }) {
  const body = { day, board, attempt, text, top, place, name };
  let s = await session();
  try { return await call('/api/attempt', { ...s, ...body }); }
  catch (e) {
    if (e.code !== 'bad_session') throw e;
    s = await session(true);
    return call('/api/attempt', { ...s, ...body });
  }
}

/** A day's board: 'day' (first goes on the day), 'replay' (more goes on the day) or 'late' (played later). */
export function board(day, which = 'day') {
  const pid = playerId();
  return call(`/api/leaderboard?day=${day}&board=${which}${pid ? '&playerId=' + encodeURIComponent(pid) : ''}`);
}

export function days(from, to) { return call(`/api/days?from=${from}&to=${to}`); }
