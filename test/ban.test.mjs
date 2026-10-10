// Ban check: the target, the 5 banned words and their variants, stems, compounds and spelled-out forms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tokenize, forms, isVariant, makeBanCheck, relatedContaining } from '../site/js/ban.js';

const irregular = JSON.parse(fs.readFileSync(new URL('../data/irregular.json', import.meta.url)));
const lexicon = new Set(JSON.parse(fs.readFileSync(new URL('../data/vocab.json', import.meta.url))).map((e) => e.w));

const hitsOf = (banned, text, related) => makeBanCheck({ banned, related, lexicon, irregular })(text).hits;
const why = (banned, text, related) => hitsOf(banned, text, related).map((h) => `${h.token}:${h.word}:${h.why}`);
const ok = (banned, text, related) => makeBanCheck({ banned, related, lexicon, irregular })(text).ok;

test('tokenize: case, accents, possessives, apostrophes, punctuation', () => {
  assert.deepEqual(tokenize("The BALL's café, don’t-stop!"), ['the', 'ball', 'cafe', 'dont', 'stop']);
  assert.deepEqual(tokenize('  '), []);
});

test('the target itself, in any case or punctuation', () => {
  assert.deepEqual(why(['ball'], 'a round Ball!'), ['ball:ball:exact']);
  assert.deepEqual(why(['ball'], "the ball's bounce"), ['ball:ball:exact']);
});

test('regular inflections: plurals, tenses, comparatives', () => {
  assert.deepEqual(why(['ball'], 'kick some balls'), ['balls:ball:form']);
  assert.deepEqual(why(['box'], 'two boxes'), ['boxes:box:form']);
  assert.deepEqual(why(['try'], 'she tried'), ['tried:try:form']);
  assert.deepEqual(why(['stop'], 'it stopped and kept stopping'), ['stopped:stop:form', 'stopping:stop:form']);
  assert.deepEqual(why(['happy'], 'happier than ever'), ['happier:happy:form']);
  assert.deepEqual(why(['make'], 'making things'), ['making:make:form']);
  assert.deepEqual(why(['knife'], 'sharp knives'), ['knives:knife:form']);
  assert.deepEqual(why(['run'], 'the runner'), ['runner:run:form']);
});

test('irregular forms from WordNet', () => {
  assert.deepEqual(why(['mouse'], 'three blind mice'), ['mice:mouse:form']);
  assert.deepEqual(why(['run'], 'he ran away'), ['ran:run:form']);
  assert.deepEqual(why(['tooth'], 'brush your teeth'), ['teeth:tooth:form']);
  assert.deepEqual(why(['good'], 'the best of all'), ['best:good:form']);
});

test('same stem', () => {
  assert.deepEqual(why(['connect'], 'a loose connection'), ['connection:connect:stem']);
  assert.deepEqual(why(['generous'], 'giving generously'), ['generously:generous:stem']);
});

test('spelled out letter by letter', () => {
  assert.deepEqual(why(['ball'], 'it is a b a l l'), ['ball:ball:spelled']);
  assert.deepEqual(why(['ball'], 'B-A-L-L'), ['ball:ball:spelled']);
  assert.deepEqual(why(['ball'], 'b.a.l.l.s'), ['balls:ball:spelled']);
  assert.ok(ok(['ball'], 'a b c'));  // other single letters are fine
});

test('compounds that are not vocabulary words', () => {
  assert.deepEqual(why(['ball'], 'footballs'), ['footballs:ball:compound']);
  assert.deepEqual(why(['snow'], 'building snowmen'), ['snowmen:snow:compound']);
  assert.deepEqual(why(['happy'], 'smiling unhappily'), ['unhappily:happy:compound']);
  assert.deepEqual(why(['king'], 'kingly'), ['kingly:king:compound']);
});

test('vocabulary words that contain the word are banned only when on the related list', () => {
  assert.ok(ok(['ball'], 'like football'));
  assert.deepEqual(why(['ball'], 'like football', { ball: ['football'] }), ['football:ball:related']);
  assert.deepEqual(why(['king'], 'a kingdom', { king: ['kingdom'] }), ['kingdom:king:related']);
  // "sunny" is a vocabulary word: a suffix rule would also ban "early" (ear) and "ready" (read), so it goes on the list.
  assert.ok(ok(['sun'], 'a sunny day'));
  assert.deepEqual(why(['sun'], 'a sunny day', { sun: ['sunny'] }), ['sunny:sun:related']);
  assert.ok(ok(['ear'], 'early'));
  assert.ok(ok(['read'], 'ready'));
});

test('innocent words that merely contain the letters are allowed', () => {
  assert.ok(ok(['son'], 'every season'));
  assert.ok(ok(['ear'], 'early this year I learned it by heart'));
  assert.ok(ok(['cat'], 'a category in education'));
  assert.ok(ok(['art'], 'start the party, smart'));
  assert.ok(ok(['car'], 'a carpet and a scarf'));
  assert.ok(ok(['ant'], 'a giant plant wanted'));
  assert.ok(ok(['ball'], 'a ballet balloon'));
});

test('every banned word is checked, one hit per offending token', () => {
  const banned = ['umbrella', 'rain', 'parasol', 'canopy', 'shelter', 'wet'];
  assert.deepEqual(why(banned, 'keeps the rain off when it is raining, so you stay dry'), ['rain:rain:exact', 'raining:rain:form']);
  assert.deepEqual(why(banned, 'a collapsible shelter for wet weather'), ['shelter:shelter:exact', 'wet:wet:exact']);
  assert.ok(ok(banned, 'you hold it over your head when water falls from the sky'));
});

test('words that are also JavaScript property names', () => {
  for (const w of ['constructor', 'valueof', 'tostring', 'prototype']) {
    assert.ok(forms(w, irregular).has(w));
    assert.ok(isVariant(w, w, irregular));
  }
  assert.deepEqual(why(['constructor'], 'a constructor'), ['constructor:constructor:exact']);
  assert.ok(ok(['ball'], 'constructor prototype hasownproperty'));
});

test('forms() includes the word and its regular inflections', () => {
  const f = forms('city');
  for (const x of ['city', 'cities', 'citied']) assert.ok(f.has(x), x);
  assert.ok(forms('leaf').has('leaves'));
  assert.ok(forms('potato').has('potatoes'));
});

test('isVariant', () => {
  assert.ok(isVariant('mice', 'mouse', irregular));
  assert.ok(isVariant('running', 'run', irregular));
  assert.ok(isVariant('emptiness', 'empty', irregular));  // same Porter stem ("empti"): counts, as the spec asks
  assert.ok(isVariant('connection', 'connect', irregular));
  assert.ok(!isVariant('season', 'son', irregular));
});

test('relatedContaining keeps compounds that are close in meaning', () => {
  const sims = { 'football|ball': 0.62, 'ballet|ball': 0.2, 'kingdom|king': 0.58, 'kingfisher|king': 0.3 };
  const sim = (a, b) => sims[`${a}|${b}`] ?? 0;
  assert.deepEqual(relatedContaining('ball', ['ball', 'balls', 'ballet', 'football'], sim), ['football']);
  assert.deepEqual(relatedContaining('king', ['kingdom', 'kingfisher', 'sing'], sim), ['kingdom']);
});
