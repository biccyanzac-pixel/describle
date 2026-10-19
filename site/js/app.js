// Describle UI: today's word and banned words -> up to 3 descriptions -> the AI's top 5 and the word's place each time
// -> score, share, leaderboard. Any day can be played again ("Play again"): more goes at today go on the replay board,
// goes at a past day on the played-later board. The AI (MiniLM on ONNX Runtime Web) loads in the background on page open.
import * as api from './api.js';
import { EPOCH, addDays, dayNumber, entryFor, msUntilNextUtcDay, todayKey, weekday } from './daily.js';
import { isVariant, makeBanCheck } from './ban.js';
import { clearModelCaches, loadEmbedder } from './embed.js';
import { MAX_ATTEMPTS, MAX_WORDS, MAX_SCORE, attemptPoints, dayResult, rulesFor, shareText, squareFor, wordCount } from './scoring.js';
import * as store from './storage.js';
import { loadVocab, loadVocabMeta } from './vocab.js';

const $ = (id) => document.getElementById(id);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LEVELS = ['Sunday special', 'easiest', 'easy', 'medium', 'harder', 'hard', 'hardest'];
const POS = { n: 'a noun', v: 'a verb', a: 'an adjective' };
const RELOAD_FLAG = 'describle:reloaded-after-load-error';
const RULE_NOTES = {
  1: 'or any form of them (plurals, tenses, words built on them). Describe it in up to 25 words: an AI in your browser guesses. 3 tries a day; fewer words and fewer tries score more.',
  2: 'or any form of them (plurals, tenses, words built on them). Describe it in up to 25 words: an AI in your browser guesses. You get 3 tries and all 3 count: each scores by where the AI puts the word (#1 = 100, #2 = 70 … down to #100) and how few words you use, and your score is the average.',
};

let schedule = null;   // site/data/schedule-v1.json
let meta = null;       // site/data/vocab-v1.json (words, irregular forms)
let ai = null;         // { embedder, vocab } once loaded
// board: 'day' (the first go, on the day), 'replay' (more goes on the day) or 'late' (a past day, played later).
let mode = { day: todayKey(), board: 'day' };
let boardView = 'day'; // which of the day's boards the leaderboard card shows
let busy = false;
// Motion (jacob.gg docs/motion-system.md): only what's new animates, never a re-render or a reload.
let freshRow = -1;     // index of the attempt just made: its row enters and its bars grow
let justDone = false;  // the guess that just finished the day: the result reveals and the score settles
const motion = () => window.JGG?.motion;
const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const scrollTo = (n, block) => {
  if (!n) return;
  const m = motion();
  if (m?.scroll) m.scroll(n, { block });
  else n.scrollIntoView({ block, behavior: calm() ? 'auto' : 'smooth' });
};

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) n.append(c);
  return n;
}
const show = (id, on = true) => { $(id).hidden = !on; };
const pad = (n) => String(n).padStart(2, '0');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const entry = () => entryFor(mode.day, schedule);
const attempts = () => store.attempts(mode.day, mode.board);
const result = () => dayResult(attempts(), mode.day);
const rules = () => rulesFor(mode.day);
const isToday = () => mode.day === todayKey();
const vocabSize = () => (meta?.words.length ?? 15000).toLocaleString('en-GB');

// --- loading the AI -----------------------------------------------------------------------------------

async function loadAI() {
  const bytes = { model: [0, 24e6], vocab: [0, 9.6e6] };
  const progress = () => {
    const loaded = bytes.model[0] + bytes.vocab[0], total = bytes.model[1] + bytes.vocab[1];
    $('loading-bar').style.transform = `scaleX(${Math.min(1, loaded / total).toFixed(3)})`;
    $('loading-text').textContent = `Loading the AI… ${Math.round(loaded / 1e6)} of ${Math.round(total / 1e6)} MB`;
  };
  try {
    const [embedder, vocab] = await Promise.all([
      loadEmbedder('minilm-l6', { onProgress: ({ loaded, total }) => { bytes.model = [loaded, Math.max(total, 1)]; progress(); } }),
      loadVocab({ meta, onProgress: ({ loaded, total }) => { bytes.vocab = [loaded, Math.max(total, 1)]; progress(); } }),
    ]);
    $('loading-text').textContent = 'Warming up…';
    await embedder.embed('warm up');
    ai = { embedder, vocab };
    try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
    dropLoading();
    renderPlay();
  } catch (e) {
    console.error(e);
    // A broken cache or a memory hiccup (iPhone) usually clears with a fresh download: clear and reload once.
    let reloaded = false;
    try { reloaded = sessionStorage.getItem(RELOAD_FLAG) === '1'; } catch { /* ignore */ }
    await clearModelCaches();
    if (!reloaded) {
      try { sessionStorage.setItem(RELOAD_FLAG, '1'); } catch { /* ignore */ }
      location.reload();
      return;
    }
    show('loading', false);
    $('load-error-text').textContent = `Couldn't load the AI${e?.stage ? ` (${e.stage})` : ''}: ${e?.message || e}. `;
    show('load-error', true);
  }
}

/** Loading -> play: the loading panel fades out while the form takes its place (one 220 ms swap). The form stays
 * usable throughout; if the player is already typing, nothing blinks: the panel just goes. */
function dropLoading() {
  const ld = $('loading'), form = $('play-form'), m = motion();
  if (m?.swap && !form.hidden && !$('text').value && document.activeElement !== $('text')) m.swap(ld, form);
  else ld.hidden = true;
}

// --- rendering ------------------------------------------------------------------------------------

function goLabel() {
  if (mode.board === 'day') return '';
  const n = store.runs(mode.day, mode.board).length || 1;
  return mode.board === 'late' ? ` · ${mode.day} (played later${n > 1 ? `, go ${n}` : ''})` : ` · replay${n > 1 ? ` ${n}` : ''}`;
}

function render() {
  const e = entry();
  if (!e) { $('secret').textContent = '…'; return; }
  const { day } = mode;
  $('daynum').textContent = `Describle #${e.number}${goLabel()}`;
  if (window.JGG) $('level').replaceChildren(JGG.levelChip(day));
  else $('level').textContent = `${WEEKDAYS[weekday(day)]} · ${LEVELS[weekday(day)]}`;
  $('secret').textContent = e.word;
  $('pos-note').textContent = `${POS[e.pos] ?? ''}${weekday(day) === 0 ? ' · Sunday special: an action or a quality' : ''}`;
  $('banned').replaceChildren(...e.banned.map((b) => el('li', { class: 'chip banned-chip', text: b })));
  $('rule-note').textContent = RULE_NOTES[rules()];
  renderHistory();
  renderPlay();
  renderDone();
  renderBoard();
}

function bars(top, target, grow) {
  const max = Math.max(...top.map((t) => t.score), 0.01);
  return el('ol', { class: `guess-bars${grow ? ' grow' : ''}` }, ...top.map((t, i) => {
    const hit = isVariant(t.word, target, meta.irregular);
    return el('li', { class: `guess-bar${hit ? ' hit' : ''}` },
      el('span', { class: 'guess-rank', text: `${i + 1}` }),
      el('span', { class: 'guess-word', text: t.word }),
      el('span', { class: 'bar-track' }, el('span', { class: `bar-fill${hit ? ' good' : ''}`, style: `width:${Math.max(4, (100 * Math.max(0, t.score)) / max).toFixed(0)}%;--i:${i}` })),
      el('span', { class: 'guess-score', text: Math.round(100 * Math.max(0, t.score)) }));
  }));
}

/** Where the word came, e.g. "#37 of 15,000" (attempts saved before places existed have none). */
const placeText = (a) => (a.place ? `#${a.place.toLocaleString('en-GB')} of ${vocabSize()}` : '');

function verdict(a, target) {
  const counts = a.top[0].word === target ? '' : ` ("${a.top[0].word}" counts)`;
  if (rules() === 2) {
    const pts = ` · ${plural(attemptPoints(a.place, a.words), 'pt')}`;
    if (a.place === 1) return { cls: 'good', text: `Got it!${counts}${pts}` };
    return { cls: a.place && a.place <= 100 ? 'ok' : 'bad', text: `${placeText(a)}${pts}` };
  }
  if (a.rank === 1) return { cls: 'good', text: `Got it!${counts}` };
  if (a.rank >= 2) return { cls: 'ok', text: `Close! It was #${a.rank}` };
  return { cls: 'bad', text: a.place ? `Not in the top 5 (${placeText(a)})` : 'Not in the top 5' };
}

function renderHistory() {
  const e = entry(), fresh = freshRow;
  freshRow = -1;
  $('history').replaceChildren(...attempts().map((a, i) => {
    const v = verdict(a, e.word);
    return el('li', { class: `attempt-row${i === fresh ? ' fresh' : ''}` },
      el('div', { class: 'attempt-head' },
        el('span', { class: 'attempt-label', text: `Attempt ${i + 1} · ${plural(a.words, 'word')}` }),
        el('span', { class: `attempt-verdict ${v.cls}`, text: v.text })),
      el('p', { class: 'attempt-answer', text: `“${a.text}”` }),
      bars(a.top, e.word, i === fresh));
  }));
}

function renderPlay() {
  const r = result();
  const finished = r.finished;
  show('play-form', !finished && !!entry());
  if (finished) return;
  const hint = !r.used ? (rules() === 2 ? ' · all 3 count' : '')
    : rules() === 2 && r.solved ? ' · got it: now try fewer words' : ' · try a different angle';
  $('attempt-label').textContent = `Attempt ${r.used + 1} of ${MAX_ATTEMPTS}${hint}`;
  const name = api.savedName();
  const needName = api.enabled() && !name;
  show('name-field', needName);
  if (api.enabled() && name) {
    if (window.JGG?.playingAs) JGG.playingAs({ mount: $('playing-as'), name, onChange: (n) => { api.saveName(n); } });
    else $('playing-as').textContent = `Playing as ${name}.`;
    show('playing-as', true);
  } else show('playing-as', false);
  updateCounter();
}

function updateCounter() {
  const text = $('text').value;
  const n = wordCount(text);
  $('counter').textContent = `${n} / ${MAX_WORDS} words`;
  $('counter').classList.toggle('near', n > MAX_WORDS);
  let problem = '';
  if (n > MAX_WORDS) problem = `That's ${n} words: the limit is ${MAX_WORDS}.`;
  else if (meta && entry() && n) {
    const hits = banCheck()(text).hits;
    if (hits.length) problem = banMessage(hits);
  }
  $('play-error').textContent = problem;
  show('play-error', !!problem);
  const ready = !!ai && !busy;
  $('guess').disabled = !ready || !!problem || n === 0;
  $('guess-label').textContent = !ai ? 'Loading the AI…' : busy ? 'Thinking…' : 'Guess';
}

const WHY = {
  exact: (h) => `"${h.token}" is ${h.word === entry().word ? 'the secret word' : 'banned'}`,
  form: (h) => `"${h.token}" is a form of "${h.word}"`,
  stem: (h) => `"${h.token}" shares a stem with "${h.word}"`,
  related: (h) => `"${h.token}" is built on "${h.word}"`,
  compound: (h) => `"${h.token}" is built on "${h.word}"`,
  spelled: (h) => `spelling out "${h.word}" doesn't count`,
};
function banMessage(hits) {
  return `Not allowed: ${hits.map((h) => (WHY[h.why] ?? WHY.exact)(h)).join('; ')}.`;
}

let checkCache = null;
function banCheck() {
  const e = entry();
  if (checkCache?.day !== mode.day) {
    checkCache = { day: mode.day, check: makeBanCheck({ banned: [e.word, ...e.banned], related: e.related, lexicon: new Set(meta.words), irregular: meta.irregular }) };
  }
  return checkCache.check;
}

function renderDone() {
  const list = attempts();
  const r = result();
  const reveal = justDone;
  justDone = false;
  show('done', r.finished);
  if (!r.finished) return;
  const e = entry();
  const { day, board } = mode;
  $('score-caption').textContent = board === 'late' ? `Your replay of ${day}` : board === 'replay' ? "Your replay of today's word" : "Today's score";
  // Just finished: the score counts up (any tap skips it) and the result reveals; share, play again, the rating and
  // the board are there at once. A reload or re-render shows the final value with no motion.
  const m = motion();
  if (reveal) $('score').textContent = '0';
  if (m?.settle) m.settle($('score'), r.score, { from: reveal ? 0 : r.score, format: (v) => String(Math.round(v * 10) / 10) });
  else $('score').textContent = r.score;
  $('score').className = `score${r.score > 0 ? ' good' : ' bad'}`;
  if (r.rules === 2) {
    const best = r.best?.points > 0 ? ` · best: #${r.best.place} in ${plural(r.best.words, 'word')}` : '';
    $('out-of').textContent = `out of ${MAX_SCORE} · the average of your 3 attempts${best}`;
  } else {
    $('out-of').textContent = r.solved ? `out of ${MAX_SCORE} · guessed on attempt ${r.attempt} in ${plural(r.words, 'word')}` : `out of ${MAX_SCORE} · not guessed`;
  }
  $('squares').textContent = list.slice(0, r.used).map((a) => squareFor(a, day)).join(' ');
  $('reveal-word').textContent = e.word;
  $('reveal-pos').textContent = POS[e.pos] ?? '';
  $('reveal-def').textContent = e.def;
  $('reveal-banned').textContent = e.banned.join(', ');
  show('share-done', false);
  $('again-note').textContent = board === 'late' ? 'It goes on the "played later" board.'
    : `It goes on today's replay board; your first go stays on the main one.`;
  if (board !== 'late' && window.JGG?.rate) window.JGG.rate({ game: 'describle', day, mount: $('rate') });
  else $('rate').replaceChildren();
  if (reveal) m?.reveal?.([$('score'), $('squares'), $('done').querySelector('.reveal')]);
}

// --- playing --------------------------------------------------------------------------------------

async function guess() {
  const e = entry();
  const text = $('text').value.replace(/\s+/g, ' ').trim();
  const words = wordCount(text);
  if (!ai || busy || !words || words > MAX_WORDS) return;
  const hits = banCheck()(text).hits;
  if (hits.length) { updateCounter(); return; }
  if (api.enabled()) {
    const name = (api.savedName() || $('name').value).replace(/\s+/g, ' ').trim();
    if (!name) { $('play-error').textContent = 'Enter a name for the leaderboard first.'; show('play-error', true); $('name').focus(); return; }
    if (!api.savedName()) api.saveName(name.slice(0, 20));
  }
  busy = true;
  $('guess').classList.add('busy');
  updateCounter();
  try {
    const q = await ai.embedder.embed(text);
    // The AI never guesses a word the description itself uses (docs/vocab.md, "Mentioned words").
    const g = ai.vocab.guess(q, 5, { mentioned: text });
    const top = g.top.map((t) => ({ word: t.word, score: +t.score.toFixed(4) }));
    const rank = top.findIndex((t) => isVariant(t.word, e.word, meta.irregular)) + 1;
    const place = ai.vocab.place(g.scores, e.word) || null;
    const index = attempts().length;
    freshRow = index;
    store.addAttempt(mode.day, mode.board, { text, words, rank, place, top });
    submit(index, text, top, place);
    $('text').value = '';
  } catch (err) {
    console.error(err);
    $('play-error').textContent = `Something went wrong: ${err?.message || err}`;
    show('play-error', true);
  } finally {
    busy = false;
    $('guess').classList.remove('busy');
  }
  $('daynum').textContent = `Describle #${e.number}${goLabel()}`;
  justDone = freshRow >= 0 && result().finished;
  renderHistory();
  renderPlay();
  renderDone();
  const rows = $('history').children;
  if (result().finished) scrollTo($('done'), 'start');
  else scrollTo(rows[rows.length - 1], 'nearest');
}

function submit(attempt, text, top, place) {
  if (!api.enabled()) return;
  const { day, board } = mode;
  api.submitAttempt({ day, board, attempt, text, top: top.map((t) => t.word), place, name: api.savedName() })
    .then(() => { boardView = board; renderBoard(); })
    .catch((e) => { $('board-note').textContent = `Couldn't save to the leaderboard: ${e.message}`; show('board-note', true); });
}

/** Another go at the same day: today's go on the replay board, a past day's on the played-later board. */
function playAgain() {
  const board = mode.board === 'late' ? 'late' : 'replay';
  const last = store.attempts(mode.day, board);
  if (last.length && dayResult(last, mode.day).finished) store.newRun(mode.day, board);
  mode = { day: mode.day, board };
  boardView = board;
  render();
  scrollTo($('card'), 'start');
  $('text').focus({ preventScroll: true });
}

function solvedOn(d) { return dayResult(store.attempts(d, 'day'), d).solved; }

async function share() {
  const e = entry();
  const text = shareText({ number: e.number, attempts: attempts(), late: mode.board !== 'day', day: mode.day,
    streak: mode.board !== 'day' ? 0 : store.streak(todayKey(), addDays, solvedOn) });
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    show('share-done', true);
  } catch {
    prompt('Copy your result:', text);
  }
}

// --- leaderboard ----------------------------------------------------------------------------------

/** The two boards a day has: [main, other]. */
const dayBoards = () => (isToday() ? [['day', 'Today'], ['replay', 'Replays']] : [['day', 'On the day'], ['late', 'Played later']]);

function boardTitle(view) {
  if (isToday()) return view === 'replay' ? "Today's replays (not first goes)" : "Today's leaderboard";
  return view === 'late' ? `Played later: ${mode.day}` : `On the day: ${mode.day}`;
}

function rowSub(r) {
  const two = rulesFor(mode.day) === 2;
  const squares = r.ranks.map((x) => squareFor(two ? { place: x } : { rank: x }, mode.day)).join('');
  const what = two ? (r.ranks.length ? ` · ${r.ranks.map((p) => `#${p}`).join(' ')}` : '') + (r.finished ? '' : ' · playing')
    : r.solved ? ` · ${plural(r.words, 'word')}` : r.finished ? ' · not guessed' : ' · playing';
  return `${squares}${what}${r.runs > 1 ? ` · best of ${r.runs}` : ''}`;
}

let boardSeq = 0;
async function renderBoard() {
  if (!api.enabled()) { show('board', false); return; }
  const boards = dayBoards();
  if (!boards.some(([b]) => b === boardView)) boardView = boards[0][0];
  const view = boardView, seq = ++boardSeq;
  show('board', true);
  $('board-title').textContent = boardTitle(view);
  $('board-tabs').replaceChildren(...boards.map(([b, label]) => el('button', {
    type: 'button', class: `board-tab${b === view ? ' on' : ''}`, 'aria-pressed': String(b === view), text: label,
    onclick: () => { boardView = b; renderBoard(); },
  })));
  let b;
  try { b = await api.board(mode.day, view); }
  catch (e) { if (seq === boardSeq) { $('board-note').textContent = `Leaderboard unavailable: ${e.message}`; show('board-note', true); } return; }
  if (seq !== boardSeq) return; // a newer render is on its way
  show('board-note', false);
  $('players').textContent = b.players ? plural(b.players, 'player') : '';
  const rows = [...b.top];
  if (b.you) rows.push(null, b.you);
  $('rows').replaceChildren(...rows.map((r) => r === null ? el('li', { class: 'row-gap', text: '···' })
    : el('li', { class: `row${r.you ? ' me' : ''}` },
      el('span', { class: 'row-rank', text: `${r.rank}` }),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name', text: r.name }),
        el('div', { class: 'row-sub' }, el('span', { class: 'row-emoji', text: rowSub(r) }))),
      el('span', { class: 'row-score', text: `${r.score}` }))));
  $('board-empty').textContent = view === 'day' ? (isToday() ? 'Nobody has played yet today. Be the first.' : 'Nobody played on the day.')
    : view === 'replay' ? 'No replays yet: finish your go, then "Play again".' : 'Nobody has played this day later yet.';
  show('board-empty', !b.top.length);
}

// --- archive --------------------------------------------------------------------------------------

/** Your best finished go at a day on a replay board, or null. */
function bestRun(d, board) {
  const scores = store.runs(d, board).map((r) => dayResult(r, d)).filter((r) => r.finished).map((r) => r.score);
  return scores.length ? Math.max(...scores) : null;
}

async function browseArchive() {
  const list = $('archive-list');
  if (!list.hidden) { list.hidden = true; return; }
  const items = [];
  for (let d = addDays(todayKey(), -1); d >= EPOCH; d = addDays(d, -1)) items.push(d);
  let summary = {};
  try { if (api.enabled() && items.length) summary = (await api.days(items[items.length - 1], items[0])).days || {}; }
  catch { /* the list works without counts */ }
  list.replaceChildren(...(items.length ? items.map((d) => {
    const s = summary[d];
    const onDay = dayResult(store.attempts(d, 'day'), d);
    const mine = onDay.finished ? onDay.score : bestRun(d, 'late');
    return el('li', {}, el('button', { class: 'archive-list-item', type: 'button', onclick: () => openArchive(d) },
      el('span', { class: 'archive-list-day', text: `Describle #${dayNumber(d)} · ${WEEKDAYS[weekday(d)]} ${d}` }),
      el('span', { class: 'archive-list-prompt', text: [
        s?.players ? `${s.players} played on the day, best ${s.top}` : 'Nobody played on the day',
        mine !== null ? `you: ${mine}` : null].filter(Boolean).join(' · ') })));
  }) : [el('li', { class: 'archive-list-empty', text: 'No past days yet: Describle started today.' })]));
  const m = motion();
  if (m?.enter) m.enter(list); else list.hidden = false;
}

function openArchive(d) {
  // Finished on the day: show that result ("Play again" for more). Otherwise it's a go on the played-later board.
  mode = dayResult(store.attempts(d, 'day'), d).finished ? { day: d, board: 'day' } : { day: d, board: 'late' };
  boardView = mode.board;
  $('archive-list').hidden = true;
  checkCache = null;
  render();
  scrollTo($('card'), 'start');
}

// --- boot -----------------------------------------------------------------------------------------

function tickCountdown() {
  const s = Math.floor(msUntilNextUtcDay() / 1000);
  $('countdown').textContent = `Next in ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  // A new UTC day: switch to it, unless this is a past day being played later (or a guess is being made).
  if (mode.board !== 'late' && mode.day !== todayKey() && !busy && schedule) {
    mode = { day: todayKey(), board: 'day' }; boardView = 'day'; checkCache = null; render();
  }
}

$('play-form').addEventListener('submit', (e) => { e.preventDefault(); guess(); });
$('text').addEventListener('input', updateCounter);
$('text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); guess(); } });
$('share').addEventListener('click', share);
$('again').addEventListener('click', playAgain);
$('archive-browse').addEventListener('click', browseArchive);
$('retry').addEventListener('click', async () => {
  await clearModelCaches();
  try { sessionStorage.removeItem(RELOAD_FLAG); } catch { /* ignore */ }
  location.reload();
});

(async function boot() {
  tickCountdown();
  setInterval(tickCountdown, 1000);
  try {
    [schedule, meta] = await Promise.all([
      fetch('data/schedule-v1.json').then((r) => { if (!r.ok) throw new Error(`schedule: HTTP ${r.status}`); return r.json(); }),
      loadVocabMeta(),
      api.loadConfig(),
    ]);
  } catch (e) {
    $('load-error-text').textContent = `Couldn't load today's puzzle: ${e.message}. `;
    show('load-error', true);
    show('loading', false);
    return;
  }
  const q = new URLSearchParams(location.search).get('day');
  if (q && q >= EPOCH && q < todayKey()) openArchive(q);
  else render();
  loadAI();
})();
