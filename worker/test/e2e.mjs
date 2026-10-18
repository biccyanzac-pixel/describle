// Worker API end-to-end, against a running worker (local: npm run db:init:local && npm run dev:local).
//   node test/e2e.mjs http://127.0.0.1:8812
// Today is played under whichever rules it has (scoring.js rulesFor); to try the other rules locally, set V2_FROM in
// site/js/scoring.js to today (or tomorrow), restart the worker, run this, and put it back.
import fs from 'node:fs';
import { entryFor, todayKey, addDays, EPOCH } from '../../site/js/daily.js';
import { rulesFor } from '../../site/js/scoring.js';

const BASE = process.argv[2] || 'http://127.0.0.1:8812';
const schedule = JSON.parse(fs.readFileSync(new URL('../../site/data/schedule-v1.json', import.meta.url), 'utf8'));
const vocab = JSON.parse(fs.readFileSync(new URL('../../site/data/vocab-v1.json', import.meta.url), 'utf8'));
let failures = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

async function call(path, body) {
  const res = await fetch(BASE + path, body === undefined ? undefined
    : { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8082' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const today = todayKey();
const RULES = rulesFor(today);
console.log(`today ${today}: rules ${RULES}`);
const e = entryFor(today, schedule);
const filler = vocab.words.filter((w) => w !== e.word && !e.banned.includes(w)).slice(100, 110);
// The top 5 with the secret word at `at` (0 = not in it), and the matching place.
const topWith = (word, at) => { const t = filler.slice(0, 5); if (at) t[at - 1] = word; return t; };
const go = (who, day, attempt, at, { place = at || 40, text = clean, board, name = who.name } = {}) =>
  call('/api/attempt', { playerId: who.playerId, token: who.token, day, attempt, text, top: topWith(entryFor(day, schedule).word, at), place, board, name });
const clean = 'something you might find around the house';
const board = (day, which, pid) => call(`/api/leaderboard?day=${day}&board=${which}${pid ? `&playerId=${pid}` : ''}`);

const a = { ...(await call('/api/session', {})).data, name: 'Ann' };
const b = { ...(await call('/api/session', {})).data, name: 'Bob' };
check('sessions are issued', !!a?.playerId && !!a?.token && a.playerId !== b.playerId);

let r = await go({ ...a, token: 'nope' }, today, 0, 0);
check('a bad token is refused', r.status === 401 && r.data.error === 'bad_session');

r = await call('/api/attempt', { ...a, day: addDays(today, 1), attempt: 0, text: clean, top: topWith(e.word, 0), place: 40, name: 'Ann' });
check('a future day is refused', r.status === 400);

r = await go(a, today, 0, 1, { text: `it is a ${e.word}` });
check('using the secret word is refused', r.status === 400 && r.data.error === 'banned', JSON.stringify(r.data));

r = await go(a, today, 0, 1, { text: `a ${e.banned[0]} thing` });
check('using a banned word is refused', r.status === 400 && r.data.error === 'banned');

r = await go(a, today, 0, 1, { text: Array(26).fill('word').join(' ') });
check('26 words are refused', r.status === 400 && r.data.error === 'bad_text');

r = await call('/api/attempt', { ...a, day: today, attempt: 0, text: clean, top: ['notaword', ...filler.slice(0, 4)], place: 40, name: 'Ann' });
check('guesses must be vocabulary words', r.status === 400 && r.data.error === 'bad_top');

r = await go(a, today, 0, 2, { place: 3 });
check('the place must agree with the top 5', r.status === 400 && r.data.error === 'bad_place');
r = await go(a, today, 0, 0, { place: 4 });
check('a word not in the top 5 is placed below 5', r.status === 400 && r.data.error === 'bad_place');
if (RULES === 2) {
  r = await go(a, today, 0, 0, { place: null });
  check('rules 2 needs the place (an old page is told to reload)', r.status === 400 && r.data.error === 'bad_place');
}

r = await go(a, today, 1, 0);
check('attempts come in order', r.status === 409 && r.data.error === 'out_of_order');

if (RULES === 1) {
  r = await go(a, today, 0, 3);
  check('attempt 1: close (#3), no points', r.status === 200 && r.data.rank === 3 && r.data.place === 3 && r.data.points === 0 && !r.data.finished, JSON.stringify(r.data));
  r = await go(a, today, 0, 1);
  check('the same attempt twice is refused', r.status === 409 && r.data.error === 'already');
  r = await go(a, today, 1, 1, { text: 'useful at home' });
  check('attempt 2 with 3 words: guessed, 75 points', r.status === 200 && r.data.solved && r.data.points === 75 && r.data.finished, JSON.stringify(r.data));
  r = await go(a, today, 2, 1);
  check('nothing after a correct guess', r.status === 409 && r.data.error === 'finished');
  for (let i = 0; i < 3; i++) r = await go(b, today, i, 0, { place: 300 });
  check('3 misses finish the day with 0', r.status === 200 && r.data.finished && r.data.points === 0);
  r = await board(today, 'day', b.playerId);
  const top = r.data?.top ?? [];
  check('leaderboard: Ann first with 75, Bob 0', top[0]?.name === 'Ann' && top[0].score === 75 && top[0].solved && top[0].words === 3
    && top.find((x) => x.name === 'Bob')?.score === 0 && top.find((x) => x.name === 'Bob')?.you === true, JSON.stringify(top));
  check('leaderboard: ranks per attempt', JSON.stringify(top[0]?.ranks) === '[3,1]');
  check('leaderboard: player count', r.data.players === 2);
} else {
  r = await go(a, today, 0, 1, { text: 'a thing in the house you use every day' }); // 9 words, #1: 90
  check('attempt 1: #1 in 9 words, 90 points, not finished', r.status === 200 && r.data.points === 90 && r.data.score === 30 && !r.data.finished, JSON.stringify(r.data));
  r = await go(a, today, 0, 1);
  check('the same attempt twice is refused', r.status === 409 && r.data.error === 'already');
  r = await go(a, today, 1, 1, { text: 'useful at home' }); // 3 words: 100
  check('attempt 2 still counts after a #1: 100 points', r.status === 200 && r.data.points === 100 && r.data.score === 63.3, JSON.stringify(r.data));
  r = await go(a, today, 2, 0, { place: 37 }); // 7 words, #37: 5 * 38/40 = 4.75 -> 5
  check('attempt 3: #37, 5 points; the day is the average', r.status === 200 && r.data.points === 5 && r.data.score === 65 && r.data.finished, JSON.stringify(r.data));
  r = await go(a, today, 0, 1, { board: 'day' });
  check('no 4th attempt on the first-go board', r.status === 409 && r.data.error === 'finished');
  for (let i = 0; i < 3; i++) r = await go(b, today, i, 0, { place: 300 + i });
  check('3 places below #100 finish the day with 0', r.status === 200 && r.data.finished && r.data.score === 0);
  r = await board(today, 'day', b.playerId);
  const top = r.data?.top ?? [];
  check('leaderboard: Ann first with 65, Bob 0', top[0]?.name === 'Ann' && top[0].score === 65 && top[0].words === 3
    && top.find((x) => x.name === 'Bob')?.score === 0 && top.find((x) => x.name === 'Bob')?.you === true, JSON.stringify(top));
  check('leaderboard: places per attempt', JSON.stringify(top[0]?.ranks) === '[1,1,37]', JSON.stringify(top[0]?.ranks));
  check('leaderboard: player count and rules', r.data.players === 2 && r.data.rules === 2);
}

// Replays of today: their own board; each player's best go; the first-go board doesn't move.
const dayScore = (await board(today, 'day')).data.top.find((x) => x.name === 'Ann').score;
const replayGo = async (who, ats) => { let last; for (let i = 0; i < ats.length; i++) last = await go(who, today, i, ats[i], { board: 'replay', place: ats[i] || 60 }); return last; };
r = await replayGo(a, [0, 0, 0]);
check('a replay of today is accepted', r.status === 200 && r.data.board === 'replay' && r.data.run === 0 && r.data.finished, JSON.stringify(r.data));
const low = r.data.score;
r = await replayGo(a, RULES === 1 ? [1] : [1, 1, 1]);
check('a second replay is a new go', r.status === 200 && r.data.run === 1 && r.data.finished, JSON.stringify(r.data));
r = await go(a, today, 0, 0, { board: 'replay', place: 900 }); // a third go, started but worse
r = await board(today, 'replay', a.playerId);
const mine = r.data?.top?.find((x) => x.name === 'Ann');
check('the replay board shows the best go, best of 3', mine && mine.score > low && mine.runs === 3, JSON.stringify(mine));
check('the replay board counts players once', r.data.players === 1);
r = await board(today, 'day');
check("replays don't change the first-go board", r.data.top.find((x) => x.name === 'Ann').score === dayScore && r.data.players === 2);
r = await call(`/api/leaderboard?day=${today}&late=1`);
check('the old ?late=1 still reads the played-later board', r.status === 200 && r.data.board === 'late');

// A past day: any number of goes, all on the played-later board, whatever board the page asks for.
const y = addDays(today, -1);
if (y >= EPOCH) {
  r = await go(a, y, 0, 1, { board: 'day' });
  check('a past day goes on the played-later board', r.status === 200 && r.data.late === true && r.data.board === 'late', JSON.stringify(r.data));
  if (!r.data.finished) for (let i = 1; i < 3; i++) r = await go(a, y, i, 1, { board: 'late' });
  r = await go(a, y, 0, 2, { board: 'late' });
  check('a past day can be played again', r.status === 200 && r.data.run === 1, JSON.stringify(r.data));
  r = await board(y, 'late', a.playerId);
  check('played later: best of 2', r.data.top.find((x) => x.name === 'Ann')?.runs === 2, JSON.stringify(r.data.top));
}
// The launch day is always rules 1.
r = await go(b, EPOCH, 0, 1, { board: 'late', text: 'useful at home' });
check('a rules-1 day played later: first-try #1 in 3 words is 100', r.status === 200 && r.data.rules === 1 && r.data.points === 100 && r.data.finished, JSON.stringify(r.data));
r = await go(b, EPOCH, 0, 0, { board: 'late', place: null });
check('a rules-1 day takes attempts without a place (old pages)', r.status === 200 && r.data.place === null, JSON.stringify(r.data));

r = await call(`/api/days?from=${EPOCH}&to=${today}`);
check('days summary', r.data?.days?.[today]?.players === 2 && r.data.days[today].top === dayScore && r.data.days[today].replayPlayers === 1, JSON.stringify(r.data?.days?.[today]));

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
