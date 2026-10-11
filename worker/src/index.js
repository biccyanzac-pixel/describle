/**
 * Describle shared leaderboard: Cloudflare Worker + D1. Same shape as Perceptle's and Factle's workers.
 *
 * The model runs in the player's browser and can't run here (a Worker can't load a 23 MB language model), so this
 * is the playbook's "check consistency" kind of validation, like Yogle and Pointle:
 *   - checked here, with the same code the site uses (bundled from site/js and site/data at deploy):
 *       the day (on or after EPOCH, not in the future; late = submitted after that UTC day), the attempt order
 *       (0, 1, 2, once each, none after a correct one), the description's word count (1-25) and the day's ban rules
 *       (ban.js), that the model's top 5 are 5 vocabulary words, and the score (scoring.js) from the attempt number,
 *       the word count and where the secret word is in that top 5
 *   - trusted from the browser: the top 5 itself (what the model guessed)
 * The description text is checked, never stored.
 */
import { EPOCH, entryFor, todayKey, validDay } from '../../site/js/daily.js';
import { isVariant, makeBanCheck } from '../../site/js/ban.js';
import { MAX_ATTEMPTS, MAX_WORDS, attemptScore, wordCount } from '../../site/js/scoring.js';
import schedule from '../../site/data/schedule-v1.json';
import vocab from '../../site/data/vocab-v1.json';

const MAX_NAME = 20;
const MAX_TEXT = 400;
const BOARD_SIZE = 20;
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

const view = (r, rank, playerId) => ({
  rank, name: r.display_name, score: r.score, solved: !!r.solved, finished: !!r.finished, words: r.words,
  ranks: r.ranks ? r.ranks.split(',').map(Number) : [], you: r.player_id === playerId,
});

const BOARD_COLS = 'player_id, display_name, score, solved, finished, words, ranks, last_at';

export async function fetchBoard(env, day, late, playerId) {
  const lateN = late ? 1 : 0;
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
  return { day, late: !!late, players: stats?.players ?? 0, top, you };
}

async function handleLeaderboard(request, env) {
  const url = new URL(request.url);
  const day = url.searchParams.get('day') || todayKey();
  if (!validDay(day)) return fail(request, env, 'bad_day', 'Invalid day.', 400);
  return json(request, env, await fetchBoard(env, day, url.searchParams.get('late') === '1', url.searchParams.get('playerId')));
}

async function handleDays(request, env) {
  const url = new URL(request.url);
  const to = url.searchParams.get('to') || todayKey();
  const from = url.searchParams.get('from') || EPOCH;
  if (!validDay(from) || !validDay(to)) return fail(request, env, 'bad_day', 'Invalid day.', 400);
  const { results } = await env.DB.prepare('SELECT day_key, is_late, players, top FROM day_stats WHERE day_key BETWEEN ? AND ?').bind(from, to).all();
  const days = {};
  for (const r of results ?? []) {
    days[r.day_key] ??= { players: 0, top: null, latePlayers: 0 };
    if (r.is_late) days[r.day_key].latePlayers = r.players;
    else Object.assign(days[r.day_key], { players: r.players, top: r.top });
  }
  return json(request, env, { days });
}

async function handleAttempt(request, env, ip) {
  if (rateLimited(ip, 'attempt', 300)) return fail(request, env, 'rate_limited', 'Too many submissions from here. Try again later.', 429);
  let body;
  try { body = await request.json(); } catch { return fail(request, env, 'bad_request', 'Invalid JSON.', 400); }
  const { playerId, token, day, attempt, text, top } = body ?? {};
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

  const late = day !== today ? 1 : 0;
  const prev = await env.DB.prepare('SELECT attempts, solved FROM totals WHERE player_id = ? AND day_key = ? AND is_late = ?')
    .bind(playerId, day, late).first();
  const done = prev?.attempts ?? 0;
  if (prev?.solved || done >= MAX_ATTEMPTS) return fail(request, env, 'finished', "You've finished that day.", 409);
  if (attempt < done) return fail(request, env, 'already', 'You already made that attempt.', 409);
  if (attempt > done) return fail(request, env, 'out_of_order', 'Attempts must come in order.', 409);

  const rank = top.findIndex((w) => isVariant(w, entry.word, vocab.irregular)) + 1;
  const solved = rank === 1;
  const points = attemptScore(attempt, words, solved);
  const finished = solved || attempt + 1 >= MAX_ATTEMPTS;
  const now = new Date().toISOString();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO attempts (id, player_id, day_key, is_late, attempt, words, rank, points, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), playerId, day, late, attempt, words, rank, points, now),
    env.DB.prepare(
      `INSERT INTO totals (player_id, day_key, is_late, display_name, score, solved, finished, attempts, words, ranks, last_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT (player_id, day_key, is_late) DO UPDATE SET
         score = excluded.score, solved = excluded.solved, finished = excluded.finished, attempts = attempts + 1,
         words = excluded.words, ranks = ranks || ',' || excluded.ranks, last_at = excluded.last_at`,
    ).bind(playerId, day, late, name, points, solved ? 1 : 0, finished ? 1 : 0, solved ? words : null, String(rank), now),
  ];
  if (attempt === 0) {
    stmts.push(env.DB.prepare(
      `INSERT INTO day_stats (day_key, is_late, players, top) VALUES (?, ?, 1, 0)
       ON CONFLICT (day_key, is_late) DO UPDATE SET players = players + 1`,
    ).bind(day, late));
  }
  if (points > 0) {
    stmts.push(env.DB.prepare('UPDATE day_stats SET top = MAX(top, ?) WHERE day_key = ? AND is_late = ?').bind(points, day, late));
  }
  try {
    await env.DB.batch(stmts);
  } catch (e) {
    if (String(e).includes('UNIQUE')) return fail(request, env, 'already', 'You already made that attempt.', 409);
    throw e;
  }
  return json(request, env, { ok: true, late: !!late, rank, solved, points, finished });
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
