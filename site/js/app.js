// Describle UI: today's word and banned words -> up to 3 descriptions -> the AI's top 5 each time -> score, share,
// leaderboard. Archive replays of past days. The AI (MiniLM on ONNX Runtime Web) loads in the background on page open.
import * as api from './api.js';
import { EPOCH, addDays, dayNumber, entryFor, msUntilNextUtcDay, todayKey, weekday } from './daily.js';
import { isVariant, makeBanCheck } from './ban.js';
import { clearModelCaches, loadEmbedder } from './embed.js';
import { MAX_ATTEMPTS, MAX_WORDS, MAX_SCORE, attemptSquare, dayResult, shareText, wordCount } from './scoring.js';
import * as store from './storage.js';
import { loadVocab, loadVocabMeta } from './vocab.js';

const $ = (id) => document.getElementById(id);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const LEVELS = ['Sunday special', 'easiest', 'easy', 'medium', 'harder', 'hard', 'hardest'];
const POS = { n: 'a noun', v: 'a verb', a: 'an adjective' };
const RELOAD_FLAG = 'describle:reloaded-after-load-error';

let schedule = null;   // site/data/schedule-v1.json
let meta = null;       // site/data/vocab-v1.json (words, irregular forms)
let ai = null;         // { embedder, vocab } once loaded
let mode = { day: todayKey(), late: false };
let busy = false;

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
const entry = () => entryFor(mode.day, schedule);
const attempts = () => store.attempts(mode.day, mode.late);

// --- loading the AI -----------------------------------------------------------------------------------

async function loadAI() {
  const bytes = { model: [0, 24e6], vocab: [0, 9.6e6] };
  const progress = () => {
    const loaded = bytes.model[0] + bytes.vocab[0], total = bytes.model[1] + bytes.vocab[1];
    $('loading-bar').style.width = `${Math.min(100, (100 * loaded) / total).toFixed(1)}%`;
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
    show('loading', false);
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

// --- rendering ------------------------------------------------------------------------------------

function render() {
  const e = entry();
  if (!e) { $('secret').textContent = '…'; return; }
  const { day, late } = mode;
  $('daynum').textContent = `Describle #${e.number}${late ? ` · ${day} (played later)` : ''}`;
  if (window.JGG) $('level').replaceChildren(JGG.levelChip(day));
  else $('level').textContent = `${WEEKDAYS[weekday(day)]} · ${LEVELS[weekday(day)]}`;
  $('secret').textContent = e.word;
  $('pos-note').textContent = `${POS[e.pos] ?? ''}${weekday(day) === 0 ? ' · Sunday special: an action or a quality' : ''}`;
  $('banned').replaceChildren(...e.banned.map((b) => el('li', { class: 'chip banned-chip', text: b })));
  renderHistory();
  renderPlay();
  renderDone();
  renderBoard();
}

function bars(top, target) {
  const max = Math.max(...top.map((t) => t.score), 0.01);
  return el('ol', { class: 'guess-bars' }, ...top.map((t, i) => {
    const hit = isVariant(t.word, target, meta.irregular);
    return el('li', { class: `guess-bar${hit ? ' hit' : ''}` },
      el('span', { class: 'guess-rank', text: `${i + 1}` }),
      el('span', { class: 'guess-word', text: t.word }),
      el('span', { class: 'bar-track' }, el('span', { class: `bar-fill${hit ? ' good' : ''}`, style: `width:${Math.max(4, (100 * Math.max(0, t.score)) / max).toFixed(0)}%` })),
      el('span', { class: 'guess-score', text: Math.round(100 * Math.max(0, t.score)) }));
  }));
}

function verdict(a, target) {
  if (a.rank === 1) {
    const exact = a.top[0].word === target;
    return { cls: 'good', text: exact ? 'Got it!' : `Got it! ("${a.top[0].word}" counts)` };
  }
  if (a.rank >= 2) return { cls: 'ok', text: `Close! It was #${a.rank}` };
  return { cls: 'bad', text: 'Not in the top 5' };
}

function renderHistory() {
  const e = entry();
  $('history').replaceChildren(...attempts().map((a, i) => {
    const v = verdict(a, e.word);
    return el('li', { class: 'attempt-row' },
      el('div', { class: 'attempt-head' },
        el('span', { class: 'attempt-label', text: `Attempt ${i + 1} · ${a.words} word${a.words === 1 ? '' : 's'}` }),
        el('span', { class: `attempt-verdict ${v.cls}`, text: v.text })),
      el('p', { class: 'attempt-answer', text: `“${a.text}”` }),
      bars(a.top, e.word));
  }));
}

function renderPlay() {
  const r = dayResult(attempts());
  const finished = r.finished;
  show('play-form', !finished && !!entry());
  if (finished) return;
  $('attempt-label').textContent = `Attempt ${r.used + 1} of ${MAX_ATTEMPTS}${r.used ? ' · try a different angle' : ''}`;
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
  const r = dayResult(list);
  show('done', r.finished);
  if (!r.finished) return;
  const e = entry();
  const { day, late } = mode;
  $('score-caption').textContent = late ? `Your replay of ${day}` : "Today's score";
  $('score').textContent = r.score;
  $('score').className = `score${r.solved ? ' good' : ' bad'}`;
  $('out-of').textContent = r.solved ? `out of ${MAX_SCORE} · guessed on attempt ${r.attempt} in ${r.words} word${r.words === 1 ? '' : 's'}` : `out of ${MAX_SCORE} · not guessed`;
  $('squares').textContent = list.slice(0, r.used).map((a) => attemptSquare(a.rank)).join(' ');
  $('reveal-word').textContent = e.word;
  $('reveal-pos').textContent = POS[e.pos] ?? '';
  $('reveal-def').textContent = e.def;
  $('reveal-banned').textContent = e.banned.join(', ');
  show('share-done', false);
  if (!late && window.JGG?.rate) window.JGG.rate({ game: 'describle', day, mount: $('rate') });
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
    const top = ai.vocab.guess(q, 5, { mentioned: text }).top.map((t) => ({ word: t.word, score: +t.score.toFixed(4) }));
    const rank = top.findIndex((t) => isVariant(t.word, e.word, meta.irregular)) + 1;
    const index = attempts().length;
    store.addAttempt(mode.day, mode.late, { text, words, rank, top });
    submit(index, text, top);
    $('text').value = '';
  } catch (err) {
    console.error(err);
    $('play-error').textContent = `Something went wrong: ${err?.message || err}`;
    show('play-error', true);
  } finally {
    busy = false;
    $('guess').classList.remove('busy');
  }
  renderHistory();
  renderPlay();
  renderDone();
  const rows = $('history').children;
  rows[rows.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (dayResult(attempts()).finished) $('done').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function submit(attempt, text, top) {
  if (!api.enabled()) return;
  const { day } = mode;
  api.submitAttempt({ day, attempt, text, top: top.map((t) => t.word), name: api.savedName() })
    .then(() => renderBoard())
    .catch((e) => { $('board-note').textContent = `Couldn't save to the leaderboard: ${e.message}`; show('board-note', true); });
}

function solvedOn(d) { return dayResult(store.attempts(d, false)).solved; }

async function share() {
  const e = entry();
  const text = shareText({ number: e.number, attempts: attempts(), late: mode.late,
    streak: mode.late ? 0 : store.streak(todayKey(), addDays, solvedOn) });
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    show('share-done', true);
  } catch {
    prompt('Copy your result:', text);
  }
}

// --- leaderboard ----------------------------------------------------------------------------------

async function renderBoard() {
  if (!api.enabled()) { show('board', false); return; }
  const { day, late } = mode;
  show('board', true);
  $('board-title').textContent = late ? `Played later: ${day}` : "Today's leaderboard";
  let b;
  try { b = await api.board(day, late); }
  catch (e) { $('board-note').textContent = `Leaderboard unavailable: ${e.message}`; show('board-note', true); return; }
  show('board-note', false);
  $('players').textContent = b.players ? `${b.players} player${b.players === 1 ? '' : 's'}` : '';
  const rows = [...b.top];
  if (b.you) rows.push(null, b.you);
  $('rows').replaceChildren(...rows.map((r) => r === null ? el('li', { class: 'row-gap', text: '···' })
    : el('li', { class: `row${r.you ? ' me' : ''}` },
      el('span', { class: 'row-rank', text: `${r.rank}` }),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-name', text: r.name }),
        el('div', { class: 'row-sub' },
          el('span', { class: 'row-emoji', text: r.ranks.map(attemptSquare).join('') }),
          r.solved ? ` · ${r.words} word${r.words === 1 ? '' : 's'}` : r.finished ? ' · not guessed' : ' · playing')),
      el('span', { class: 'row-score', text: `${r.score}` }))));
  show('board-empty', !b.top.length);
}

// --- archive --------------------------------------------------------------------------------------

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
    const onDay = dayResult(store.attempts(d, false)), later = dayResult(store.attempts(d, true));
    const mine = onDay.finished ? onDay.score : later.finished ? later.score : null;
    return el('li', {}, el('button', { class: 'archive-list-item', type: 'button', onclick: () => openArchive(d) },
      el('span', { class: 'archive-list-day', text: `Describle #${dayNumber(d)} · ${WEEKDAYS[weekday(d)]} ${d}` }),
      el('span', { class: 'archive-list-prompt', text: [
        s?.players ? `${s.players} played on the day, best ${s.top}` : 'Nobody played on the day',
        mine !== null ? `you: ${mine}` : null].filter(Boolean).join(' · ') })));
  }) : [el('li', { class: 'archive-list-empty', text: 'No past days yet: Describle started today.' })]));
  list.hidden = false;
}

function openArchive(d) {
  // Finished on the day: show that result. Otherwise it's a replay ("played later"), even if it was started then.
  mode = dayResult(store.attempts(d, false)).finished ? { day: d, late: false } : { day: d, late: true };
  $('archive-list').hidden = true;
  checkCache = null;
  render();
  $('card').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// --- boot -----------------------------------------------------------------------------------------

function tickCountdown() {
  const s = Math.floor(msUntilNextUtcDay() / 1000);
  $('countdown').textContent = `Next in ${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
  if (!mode.late && mode.day !== todayKey() && !busy && schedule) { mode = { day: todayKey(), late: false }; checkCache = null; render(); }
}

$('play-form').addEventListener('submit', (e) => { e.preventDefault(); guess(); });
$('text').addEventListener('input', updateCounter);
$('text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); guess(); } });
$('share').addEventListener('click', share);
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
