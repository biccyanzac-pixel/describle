# Vocabulary, vectors and the ban check (Phase 2)

Status: **waiting for your review.** Phase 3 (schedule) hasn't started.

## What ships
| File | Size | What |
|---|---|---|
| `site/data/vectors-v1.bin` | 9.2 MB (barely compresses) | 25,024 int8 vectors: up to 2 senses for each of 15,000 words |
| `site/data/vocab-v1.json` | 322 KB (~110 KB gzipped) | words, senses per word, sense usage counts, word frequency, guess settings, irregular forms, credits |

First visit is now about **23.7 MB model + 2.7 MB runtime + 9.3 MB vocabulary ≈ 36 MB**, then cached; Phase 1 estimated 45 MB. On an iPhone (iOS 17.7) a guess took **28 ms**: embedding 25 ms, scoring 3 ms against the real vocabulary.

The vectors are computed by the game's own `site/js/embed.js` in headless Chrome, so they're exactly what a phone computes. WebKit reproduces them with cosine 1.000000 on all 301 clues (`bench/parity.mjs`, docs/model.md "Parity").

## The vocabulary (`pipeline/vocab.py`)
These are the 15,000 most frequent English words (wordfreq) that pass every filter:

| Filter | Removed | Examples |
|---|---|---|
| fewer than 3 letters, or not a–z | – | |
| NLTK stopword | 112 | the, have, will |
| no noun/verb/adjective sense in WordNet whose lemma is exactly the lowercase word | 20,757 | would, also (adverbs), dogs (an inflection), london (only a proper noun) |
| on the blocklist (LDNOOBW, CC BY 4.0, plus `data/blocklist-extra.txt`) | 126 | swearwords, sexual terms, slurs |
| WordNet labels its main sense, or every sense, offensive (usage domain, or a gloss like "offensive term for") | 26 | nazi, crap, wop; also taco, oath and curse, whose first WordNet sense is a slur or a swearword |

Offensive senses of words that are kept are dropped too, so they never reach a vector. `data/vocab_rejected.json` lists every removed word. Add a word to `data/blocklist-extra.txt` to remove it.

Each word keeps up to 6 senses, **most used first**. Usage is WordNet's SemCor tag count. This matters because WordNet lists every noun sense before any verb or adjective sense, so its own order put "straight" (a poker hand) before "straight" (no bends).

## How a description becomes a guess (`site/js/guess.js`)
```
score(word) = max over the word's 2 most used senses k of
                  cos(description, sense_k) · 0.97^k + 0.02 · ln(1 + usage count_k)
              + 0.04 · (zipf frequency of the word − 4)
```
- **What each sense vector embeds** is its definition followed by its synonyms, e.g. "a lightweight handheld collapsible canopy (parasol, sunshade)". That beat the plain definition and "category: definition" (2–3 more right first time on dev).
- **Usage bias:** +0.02 · ln(1 + count). A sense used 100 times gets +0.09, a never-tagged one +0. This stops rare senses winning: eye→hip, nose→behind ("buttocks"), spoon→server.
- **Frequency prior:** +0.04 per zipf point. A word as common as "dog" (zipf 5.2) gets +0.05 over a zipf-4 word. Without it, top-1 on dev drops from 61 to 52.
- **The word itself isn't embedded:** with sense counts in place it added nothing on any setting, and leaving it out saves 15k vectors (5.8 MB).
- **Correct guess:** the top word is the target or a variant of it (same stem or an inflection, the same rule as the ban check). "emptiness" counts for "empty".

### Mentioned words (added at launch)
The AI never guesses a word the description itself uses, in any form or with the same stem (`vocab.guess(q, k, { mentioned: text })`). Nobody describes a mouse as "the animal that catches mice", and without this rule such descriptions pulled the guess to the mentioned word ("…catches mice…" → mouse).

Measured with `node pipeline/try.mjs --file …` (right first time, before → after):

| Clue set | Before | After |
|---|---|---|
| dev | 60% | 64% |
| test | 40% | 43% |
| test-2 | 33% | 38% |
| the first 56 scheduled words, 2 descriptions each | 25% | 31% |

It doesn't change the vectors. The tuner's numbers above are without it.

**Banned words make the game harder than these numbers.** The clue sets were written without looking at each day's banned words, which are by design the most natural words to use. Real play is closer to the playtests in docs/schedule.md, where about half of all words passed.

### How the weights were chosen (`pipeline/tune.mjs`)
- **Clue sets:** I wrote 301 clues by hand in three sets, each clue in a player's voice and none containing its target (`data/clues-*.json`).
- **Grid:** 576 settings, chosen **only on the dev set**. Each line below is the best dev result (right first / in top 5, of 101) with that one setting fixed:
  - text: plus 61/79, hyper ("category: definition") 56/77, definition only 55/75
  - senses per word: 2 → 61/79, 3 → 61/77, 6 → 60/77
  - usage bias: 0 → 55/78, 0.02 → 61/79
  - frequency prior: 0 → 52/78, 0.04 → 61/79
  - vocabulary size, from a wider run on the earlier vectors: 10k 59/78, 12k 59/77, 15k 58/78, 20k 59/78. All within noise, so I kept the spec's 15k.

**Results** (right first / in the top 5):

| | dev (tuned on) | test (held out) | test-2 (held out, never seen) |
|---|---|---|---|
| untuned (definitions, 3 senses, nothing else) | 35 / 71 | 29 / 57 | 24 / 42 |
| **chosen** | 61 / 79 | **40 / 75** | **33 / 64** |

- **Be honest about dev:** dev is optimistic, because it's the best of 576 tries on 101 clues.
- **test** was scored once before the sense-count settings existed. Its misses (eye→hip, …) prompted them, so it's only nearly held out.
- **test-2** was written after that and has never been used to choose anything. It's been scored at each pipeline fix (batching, engine parity), and the same setting won on dev every time. Its scores moved only by ±1 (32/64, 32/65, 33/64).
- **The fair estimate for one first attempt is about 1 in 3 right first time and 2 in 3 in the top 5.** With 3 attempts and the top-5 feedback, players will do much better.
- Most test-2 misses are near-synonyms that show as "close!": cake→cookie, artist→painter, beautiful→excellent, soft→gentle, ocean→sea, funny→laughter.
- A few are real gaps: crab→paw, fork→cooker and bank→refuge. Phase 3's validation drops targets the model can't find.

### The spec's quality test (`pipeline/reference-test.mjs`)
- **Setup:** 200 common nouns (seed 41). Each description is the word's own first WordNet definition with the day's banned words and the target's forms removed, cut to 25 words.
- **As spec'd: 80% right first time, 91% in the top 5.** This is optimistic, because that very definition is in the index.
- **With that definition hidden:** 4% / 14%. This is too harsh, since with 2 senses per word hiding the first usually leaves an unrelated meaning.
- **The hand-written held-out sets above are the fair measure.** Phase 3 reuses this test to validate every scheduled target.

## The ban check (`site/js/ban.js`)
A description is refused if any word is, for the target or any of the 5 banned words:

| Rule | Example (word → refused) |
|---|---|
| the word itself, any case, accents, possessive | ball → "Ball's" |
| a regular inflection | ball → balls, stop → stopped/stopping, happy → happier, knife → knives |
| an irregular form (WordNet's exception lists, 1,459 words) | mouse → mice, run → ran, tooth → teeth, good → best |
| the same Porter stem | connect → connection, empty → emptiness |
| a compound that's in the vocabulary **and** close in meaning (precomputed, word-vector cosine ≥ 0.55) | king → kingdom, sun → sunny/sunlight, fire → fireplace |
| a compound that's **not** in the vocabulary: the word plus a known word, prefix or suffix | ball → footballs, snow → snowmen, happy → unhappily |
| spelled out | ball → "b a l l", "B-A-L-L", "b.a.l.l.s" |

Look-alikes stay allowed: season (son), early/year/heart (ear), category (cat), party (art), carpet (car), ballet/balloon (ball). The game shows which word was refused and why.

**Banned words** (`pipeline/ban-words.mjs`): the 5 vocabulary words closest in meaning to the target. A word's meaning here is its word vector averaged with its first 3 sense vectors. Rare words (zipf < 3.3) are skipped, as are variants of the target or of a word already chosen. Examples:
- father → sire, dad, daddy, grandfather, parent
- bone → skeletal, skeleton, marrow, ivory, skull
- archives → museum, library, registrar, annals, memorabilia

## Tests
- `npm test`: 23 tests covering the ban check (forms, irregulars, stems, compounds, spelling, look-alikes, words like "constructor"), the guess rule, SIMD against JS, the shipped files, and a check that **the browser code path reproduces the tuner's numbers exactly on all three clue sets**.
- `.venv/Scripts/python -m pytest`: 4 tests on the vocabulary filters.

## Rebuild
```
.venv/Scripts/python -m pipeline.vocab --size 20000   # data/vocab.json, irregular.json, vocab_rejected.json
node pipeline/embed.mjs                               # data/cache/*.i8, in headless Chrome (~25 min; skipped when unchanged)
node pipeline/tune.mjs --n 15000                      # data/tune.json
node pipeline/build.mjs                               # site/data/vocab-v1.json + vectors-v1.bin
node pipeline/reference-test.mjs                      # data/reference-test.json
```
Once the game is live, never rebuild `v1`. Bump `VOCAB_VERSION` and keep the old files, because the vectors decide what the model guesses on past days.

## Credits and licences
- **Definitions:** WordNet 3.0 © Princeton University, under the WordNet 3.0 licence (permissive; the notice must be kept). The site will credit it.
- **Blocklist:** LDNOOBW (CC BY 4.0).
- **Word frequencies:** wordfreq (the code is MIT, its data CC BY-SA 4.0). `vocab-v1.json` contains numbers derived from it, so that file is shared under CC BY-SA 4.0 too, and the credits page will say so. Same approach as Factle's Wikipedia data.
- **Libraries:** the Porter stemmer is `stemmer` by wooorm (MIT), and the model is all-MiniLM-L6-v2 (Apache-2.0).
