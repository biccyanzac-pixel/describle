// Worker API end-to-end, against a running worker (local: npm run db:init:local && npm run dev:local).
//   node test/e2e.mjs http://127.0.0.1:8812
import fs from 'node:fs';
import { entryFor, todayKey, addDays, EPOCH } from '../../site/js/daily.js';

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
const e = entryFor(today, schedule);
const filler = vocab.words.filter((w) => w !== e.word && !e.banned.includes(w)).slice(100, 110);
const topWith = (word, at) => { const t = filler.slice(0, 5); if (at) t[at - 1] = word; return t; };
const clean = 'something you might find around the house';

const a = (await call('/api/session', {})).data;
const b = (await call('/api/session', {})).data;
check('sessions are issued', !!a?.playerId && !!a?.token && a.playerId !== b.playerId);

let r = await call('/api/attempt', { ...a, token: 'nope', day: today, attempt: 0, text: clean, top: topWith(e.word, 0), name: 'Ann' });
check('a bad token is refused', r.status === 401 && r.data.error === 'bad_session');

r = await call('/api/attempt', { ...a, day: addDays(today, 1), attempt: 0, text: clean, top: topWith(e.word, 0), name: 'Ann' });
check('a future day is refused', r.status === 400);

r = await call('/api/attempt', { ...a, day: today, attempt: 0, text: `it is a ${e.word}`, top: topWith(e.word, 1), name: 'Ann' });
check('using the secret word is refused', r.status === 400 && r.data.error === 'banned', JSON.stringify(r.data));

r = await call('/api/attempt', { ...a, day: today, attempt: 0, text: `a ${e.banned[0]} thing`, top: topWith(e.word, 1), name: 'Ann' });
check('using a banned word is refused', r.status === 400 && r.data.error === 'banned');

r = await call('/api/attempt', { ...a, day: today, attempt: 0, text: Array(26).fill('word').join(' '), top: topWith(e.word, 1), name: 'Ann' });
check('26 words are refused', r.status === 400 && r.data.error === 'bad_text');

r = await call('/api/attempt', { ...a, day: today, attempt: 0, text: clean, top: ['notaword', ...filler.slice(0, 4)], name: 'Ann' });
check('guesses must be vocabulary words', r.status === 400 && r.data.error === 'bad_top');

r = await call('/api/attempt', { ...a, day: today, attempt: 1, text: clean, top: topWith(e.word, 0), name: 'Ann' });
check('attempts come in order', r.status === 409 && r.data.error === 'out_of_order');

r = await call('/api/attempt', { ...a, day: today, attempt: 0, text: clean, top: topWith(e.word, 3), name: 'Ann' });
check('attempt 1: close (#3), no points', r.status === 200 && r.data.rank === 3 && r.data.points === 0 && !r.data.finished, JSON.stringify(r.data));

r = await call('/api/attempt', { ...a, day: today, attempt: 0, text: clean, top: topWith(e.word, 1), name: 'Ann' });
check('the same attempt twice is refused', r.status === 409 && r.data.error === 'already');

r = await call('/api/attempt', { ...a, day: today, attempt: 1, text: 'useful at home', top: topWith(e.word, 1), name: 'Ann' });
check('attempt 2 with 3 words: guessed, 75 points', r.status === 200 && r.data.solved && r.data.points === 75 && r.data.finished, JSON.stringify(r.data));

r = await call('/api/attempt', { ...a, day: today, attempt: 2, text: clean, top: topWith(e.word, 1), name: 'Ann' });
check('nothing after a correct guess', r.status === 409 && r.data.error === 'finished');

for (let i = 0; i < 3; i++) r = await call('/api/attempt', { ...b, day: today, attempt: i, text: clean, top: topWith(e.word, 0), name: 'Bob' });
check('3 misses finish the day with 0', r.status === 200 && r.data.finished && r.data.points === 0);

r = await call(`/api/leaderboard?day=${today}&playerId=${b.playerId}`);
const top = r.data?.top ?? [];
check('leaderboard: Ann first with 75, Bob 0', top[0]?.name === 'Ann' && top[0].score === 75 && top[0].solved && top[0].words === 3
  && top.find((x) => x.name === 'Bob')?.score === 0 && top.find((x) => x.name === 'Bob')?.you === true, JSON.stringify(top));
check('leaderboard: ranks per attempt', JSON.stringify(top[0]?.ranks) === '[3,1]');
check('leaderboard: player count', r.data.players === 2);

if (addDays(today, -1) >= EPOCH) {
  const y = addDays(today, -1), ye = entryFor(y, schedule);
  const late = (await call('/api/attempt', { ...a, day: y, attempt: 0, text: clean, top: topWith(ye.word, 1), name: 'Ann' })).data;
  check('a past day goes on the late board', late?.late === true);
}
r = await call(`/api/days?from=${EPOCH}&to=${today}`);
check('days summary', r.data?.days?.[today]?.players === 2 && r.data.days[today].top === 75, JSON.stringify(r.data));

console.log(failures ? `${failures} FAILED` : 'all passed');
process.exit(failures ? 1 : 0);
