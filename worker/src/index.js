/**
 * Describle shared leaderboard: Cloudflare Worker + D1. Same shape as Perceptle's and Factle's workers.
 *
 * The model runs in the player's browser and can't run here (a Worker can't load a 23 MB language model), so this
 * is the playbook's "check consistency" kind of validation, like Yogle and Pointle:
 *   - checked here, with the same code the site uses (bundled from site/js and site/data at deploy):
 *       the day (on or after EPOCH, not in the future; late = submitted after that UTC day), the attempt order
 *       (0, 1, 2, once each per run; under rules 1 none after a correct one), the description's word count (1-25)
 *       and the day's ban rules (ban.js), that the model's top 5 are 5 vocabulary words, that the place agrees with
 *       the top 5, and the score (scoring.js, the day's rules) from the attempt, the word count and the place
 *   - trusted from the browser: the top 5 and the place (what the model guessed)
 * The description text is checked, never stored.
 *
 * Boards (is_late): 0 = the first go on the day (one run), 2 = more goes on the day ("replays"), 1 = goes after the
 * day ("played later"). Boards 1 and 2 take any number of runs; attempt 0 starts a new one, and each player's best run
 * is their row in `totals` (the board and the hub read `totals`).
 */
import { EPOCH, entryFor, todayKey, validDay } from '../../site/js/daily.js';
import { isVariant, makeBanCheck } from '../../site/js/ban.js';
import { MAX_ATTEMPTS, MAX_WORDS, attemptPoints, attemptScore, rulesFor, wordCount } from '../../site/js/scoring.js';
import schedule from '../../site/data/schedule-v1.json';
import vocab from '../../site/data/vocab-v1.json';

const MAX_NAME = 20;
const MAX_TEXT = 400;
const BOARD_SIZE = 20;
const MAX_RUNS = 100; // per player, day and replay board
const BOARDS = new Map([['day', 0], ['late', 1], ['replay', 2]]);
const lexicon = new Set(vocab.words);

function validateName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!name || [...name].length > MAX_NAME) return null;
  return name;
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- HTTP plumbing ---

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!allowed.length) return '*';
  return allowed.includes(origin) ? origin : allowed[0];
}

function cors(request, env) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin(request, env),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(request, env) } });
}

function fail(request, env, code, message, status) {
  return json(request, env, { error: code, message }, status);
}

const hits = new Map(); // in-memory, per isolate: enough to blunt a burst
function rateLimited(ip, bucket, limit) {
  const now = Date.now(), key = `${bucket}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3600_000);
  const over = recent.length >= limit;
  if (!over) recent.push(now);
  hits.set(key, recent);
  return over;
}

// --- routes ---

async function handleSession(request, env, ip) {
  if (rateLimited(ip, 'session', 30)) return fail(request, env, 'rate_limited', 'Too many new sessions from here.', 429);
  const playerId = crypto.randomUUID(), token = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO players (id, token_hash, created_at) VALUES (?, ?, ?)')
    .bind(playerId, await sha256Hex(token), new Date().toISOString()).run();
  return json(request, env, { playerId, token });
}

async function verifyPlayer(env, playerId, token) {
  if (typeof playerId !== 'string' || typeof token !== 'string' || !playerId || !token) return false;
  const row = await env.DB.prepare('SELECT token_hash FROM players WHERE id = ?').bind(playerId).first();
  return !!row && row.token_hash === (await sha256Hex(token));
}

// ranks: per attempt of the player's best run, the rank in the top 5 (rules 1) or the place (rules 2).
const view = (r, rank, playerId) => ({
  rank, name: r.display_name, score: r.score, solved: !!r.solved, finished: !!r.finished, words: r.words,
  ranks: r.ranks ? r.ranks.split(',').map(Number) : [], runs: r.runs ?? 1, you: r.player_id === playerId,
});

const BOARD_COLS = 'player_id, display_name, score, solved, finished, words, ranks, runs, last_at';

export async function fetchBoard(env, day, board, playerId) {
  const lateN = BOARDS.get(board) ?? 0;
  const { results } = await env.DB.prepare(
    `SELECT ${BOARD_COLS} FROM totals WHERE day_key = ? AND is_late = ? ORDER BY score DESC, last_at ASC LIMIT ?`,
  ).bind(day, lateN, BOARD_SIZE).all();
  const top = (results ?? []).map((r, i) => view(r, i + 1, playerId));
  const stats = await env.DB.prepare('SELECT players, top FROM day_stats WHERE day_key = ? AND is_late = ?').bind(day, lateN).first();
  let you = null;
  if (playerId && !top.some((r) => r.you)) {
    const mine = await env.DB.prepare(`SELECT ${BOARD_COLS} FROM totals WHERE player_id = ? AND day_key = ? AND is_late = ?`)
      .bind(playerId, day, lateN).first();
    if (mine) {
      const above = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM totals WHERE day_key = ? AND is_late = ? AND (score > ? OR (score = ? AND last_at < ?))`,
      ).bind(day, lateN, mine.score, mine.score, mine.last_at).first();
      you = view(mine, (above?.n ?? 0) + 1, playerId);
    }
  }
  return { day, board, late: lateN === 1, rules: rulesFor(day), players: stats?.players ?? 0, top, you };
}

async function handleLeaderboard(request, env) {
  const url = new URL(request.url);
  const day = url.searchParams.get('day') || todayKey();
  if (!validDay(day)) return fail(request, env, 'bad_day', 'Invalid day.', 400);
  // ?late=1 is how pages before replays asked for the played-later board.
  const board = url.searchParams.get('board') || (url.searchParams.get('late') === '1' ? 'late' : 'day');
  if (!BOARDS.has(board)) return fail(request, env, 'bad_board', 'Invalid board.', 400);
  return json(request, env, await fetchBoard(env, day, board, url.searchParams.get('playerId')));
}

async function handleDays(request, env) {
  const url = new URL(request.url);
  const to = url.searchParams.get('to') || todayKey();
  const from = url.searchParams.get('from') || EPOCH;
  if (!validDay(from) || !validDay(to)) return fail(request, env, 'bad_day', 'Invalid day.', 400);
  const { results } = await env.DB.prepare('SELECT day_key, is_late, players, top FROM day_stats WHERE day_key BETWEEN ? AND ?').bind(from, to).all();
  const days = {};
  for (const r of results ?? []) {
    days[r.day_key] ??= { players: 0, top: null, latePlayers: 0, replayPlayers: 0 };
    if (r.is_late === 1) days[r.day_key].latePlayers = r.players;
    else if (r.is_late === 2) days[r.day_key].replayPlayers = r.players;
    else Object.assign(days[r.day_key], { players: r.players, top: r.top });
  }
  return json(request, env, { days });
}

async function handleAttempt(request, env, ip) {
  if (rateLimited(ip, 'attempt', 300)) return fail(request, env, 'rate_limited', 'Too many submissions from here. Try again later.', 429);
  let body;
  try { body = await request.json(); } catch { return fail(request, env, 'bad_request', 'Invalid JSON.', 400); }
  const { playerId, token, day, attempt, text, top, place } = body ?? {};
  if (!(await verifyPlayer(env, playerId, token))) return fail(request, env, 'bad_session', 'Invalid or missing session. Reload the page.', 401);
  const today = todayKey();
  if (!validDay(day) || day < EPOCH) return fail(request, env, 'bad_day', 'There is no word for that day.', 400);
  if (day > today) return fail(request, env, 'bad_day', "That day hasn't happened yet.", 400);
  const entry = entryFor(day, schedule);
  if (!entry) return fail(request, env, 'bad_day', 'There is no word for that day.', 400);
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= MAX_ATTEMPTS) return fail(request, env, 'bad_attempt', 'Invalid attempt.', 400);
  if (typeof text !== 'string' || text.length > MAX_TEXT) return fail(request, env, 'bad_text', 'Invalid description.', 400);
  const words = wordCount(text);
  if (words < 1 || words > MAX_WORDS) return fail(request, env, 'bad_text', `A description is 1-${MAX_WORDS} words.`, 400);
  const check = makeBanCheck({ banned: [entry.word, ...entry.banned], related: entry.related, lexicon, irregular: vocab.irregular });
  if (!check(text).ok) return fail(request, env, 'banned', 'That description uses a banned word.', 400);
  if (!Array.isArray(top) || top.length !== 5 || !top.every((w) => typeof w === 'string' && lexicon.has(w))) {
    return fail(request, env, 'bad_top', 'Invalid guesses.', 400);
  }
  const name = validateName(body.name);
  if (!name) return fail(request, env, 'bad_name', `Name must be 1-${MAX_NAME} characters.`, 400);

  // The board: after the day, always "played later" (decided by the server's clock); on the day, the first go or a
  // replay. Pages from before replays send no board.
  const board = day !== today ? 'late' : body.board === 'replay' ? 'replay' : 'day';
  const late = BOARDS.get(board);
  const rules = rulesFor(day);

  const rank = top.findIndex((w) => isVariant(w, entry.word, vocab.irregular)) + 1;
  // The place must agree with the top 5: the same number when the word is in it, below 5 when it isn't.
  const placeOk = Number.isInteger(place) && place >= 1 && place <= lexicon.size && (rank ? place === rank : place > 5);
  if (rules === 2 && !placeOk) return fail(request, env, 'bad_place', 'The game has been updated: reload the page.', 400);
  if (place !== undefined && place !== null && !placeOk) return fail(request, env, 'bad_place', 'Invalid place.', 400);
  const where = placeOk ? place : null;

  // Which run this attempt belongs to. The first-go board has one run; on the replay boards attempt 0 starts a new one.
  const latest = await env.DB.prepare(
    'SELECT run, attempts, points, best_points, solved, finished, words, ranks FROM runs WHERE player_id = ? AND day_key = ? AND is_late = ? ORDER BY run DESC LIMIT 1',
  ).bind(playerId, day, late).first();
  let run = 0, cur = null;
  if (board === 'day' || attempt > 0) {
    cur = latest;
    run = cur?.run ?? 0;
    const done = cur?.attempts ?? 0;
    if (board === 'day' && cur?.finished) return fail(request, env, 'finished', "You've finished today's first go: more goes are replays.", 409);
    if (cur?.finished) return fail(request, env, 'out_of_order', 'Start a new go with attempt 1.', 409);
    if (attempt < done) return fail(request, env, 'already', 'You already made that attempt.', 409);
    if (attempt > done) return fail(request, env, 'out_of_order', 'Attempts must come in order.', 409);
  } else {
    run = latest ? latest.run + 1 : 0;
    if (run >= MAX_RUNS) return fail(request, env, 'too_many', `That's ${MAX_RUNS} goes at this day: enough!`, 429);
  }

  // The run after this attempt (scoring.js has the rules).
  let points, solved, finished, score, bestWords, bestPoints, runPoints;
  if (rules === 2) {
    points = attemptPoints(where, words);
    const sum = (cur?.points ?? 0) + points;
    score = Math.round((sum / MAX_ATTEMPTS) * 10) / 10;
    solved = !!cur?.solved || where === 1;
    finished = attempt + 1 >= MAX_ATTEMPTS;
    const better = !cur || points > cur.best_points;
    bestPoints = better ? points : cur.best_points;
    bestWords = better ? words : cur.words;
    runPoints = sum;
  } else {
    solved = rank === 1;
    points = attemptScore(attempt, words, solved);
    finished = solved || attempt + 1 >= MAX_ATTEMPTS;
    score = points;
    bestPoints = points;
    bestWords = solved ? words : null;
    runPoints = points;
  }
  const ranks = [cur?.ranks, String(rules === 2 ? where : rank)].filter(Boolean).join(',');
  const now = new Date().toISOString();

  // The board row is the player's best run: this one, if it's already the best or now beats it.
  const total = await env.DB.prepare('SELECT score, best_run, runs FROM totals WHERE player_id = ? AND day_key = ? AND is_late = ?')
    .bind(playerId, day, late).first();
  const takes = !total || total.best_run === run || score > total.score;
  const runsSoFar = Math.max(total?.runs ?? 0, run + 1);

  const stmts = [
    env.DB.prepare(
      `INSERT INTO attempts (id, player_id, day_key, is_late, run, attempt, words, rank, place, points, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), playerId, day, late, run, attempt, words, rank, where, points, now),
    env.DB.prepare(
      `INSERT INTO runs (player_id, day_key, is_late, run, attempts, points, best_points, score, solved, finished, words, ranks, last_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (player_id, day_key, is_late, run) DO UPDATE SET
         attempts = attempts + 1, points = excluded.points, best_points = excluded.best_points, score = excluded.score,
         solved = excluded.solved, finished = excluded.finished, words = excluded.words, ranks = excluded.ranks,
         last_at = excluded.last_at`,
    ).bind(playerId, day, late, run, runPoints, bestPoints, score, solved ? 1 : 0, finished ? 1 : 0, bestWords, ranks, now),
  ];
  if (takes) {
    stmts.push(env.DB.prepare(
      `INSERT INTO totals (player_id, day_key, is_late, display_name, score, solved, finished, attempts, words, ranks, runs, best_run, last_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (player_id, day_key, is_late) DO UPDATE SET
         display_name = excluded.display_name, score = excluded.score, solved = excluded.solved, finished = excluded.finished,
         attempts = excluded.attempts, words = excluded.words, ranks = excluded.ranks, runs = excluded.runs,
         best_run = excluded.best_run, last_at = excluded.last_at`,
    ).bind(playerId, day, late, name, score, solved ? 1 : 0, finished ? 1 : 0, (cur?.attempts ?? 0) + 1, bestWords, ranks, runsSoFar, run, now));
  } else if (runsSoFar > total.runs) {
    stmts.push(env.DB.prepare('UPDATE totals SET runs = ? WHERE player_id = ? AND day_key = ? AND is_late = ?').bind(runsSoFar, playerId, day, late));
  }
  if (!total) {
    stmts.push(env.DB.prepare(
      `INSERT INTO day_stats (day_key, is_late, players, top) VALUES (?, ?, 1, 0)
       ON CONFLICT (day_key, is_late) DO UPDATE SET players = players + 1`,
    ).bind(day, late));
  }
  if (score > 0) {
    stmts.push(env.DB.prepare('UPDATE day_stats SET top = MAX(top, ?) WHERE day_key = ? AND is_late = ?').bind(score, day, late));
  }
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(request, env, 'already', 'You already made that attempt.', 409);
    throw e;
  }
  return json(request, env, { ok: true, board, late: late === 1, rules, run, rank, place: where, solved, points, score, finished });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(request, env) });
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    try {
      if (url.pathname === '/api/session' && request.method === 'POST') return await handleSession(request, env, ip);
      if (url.pathname === '/api/attempt' && request.method === 'POST') return await handleAttempt(request, env, ip);
      if (url.pathname === '/api/leaderboard' && request.method === 'GET') return await handleLeaderboard(request, env);
      if (url.pathname === '/api/days' && request.method === 'GET') return await handleDays(request, env);
      return fail(request, env, 'not_found', 'No such endpoint.', 404);
    } catch (err) {
      console.error(err);
      return fail(request, env, 'server_error', 'Something broke. Try again.', 500);
    }
  },
};
