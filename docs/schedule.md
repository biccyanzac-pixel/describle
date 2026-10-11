# The daily schedule (Phase 3)

Status: **live since 11 Oct 2026** (puzzle #1 = launch day, `EPOCH` in `site/js/daily.js`).

## What ships
`site/data/schedule-v1.json` (166 KB) holds one entry per UTC day from `EPOCH` (**Sunday 11 Oct 2026**, launch day) for **105 weeks (735 days, to 14 Oct 2028)**. Each entry has:
- **`word`, `pos`, `pool` and `def`:** the target, its part of speech, the weekday pool it came from, and its main WordNet definition, shown on the reveal.
- **`banned`:** the 5 banned words.
- **`related`:** close compounds for the ban check (e.g. kingdom for king).

`site/js/daily.js` turns a date into an entry (`entryFor`). Past the end, the schedule repeats from the start on the same weekdays, so the game never runs out. Regenerate future days well before then.

It's the same for everyone and changes at 00:00 UTC. It's public in the repo, which is the same trust model as Factle and Yogle.

## The weekday curve
Following the jacob.gg house rule (Monday easiest, rising to Saturday; Sunday a special), each weekday draws from its own pool:

| Day | Pool | What | Pool size | The first six scheduled |
|---|---|---|---|---|
| Mon | concrete-easy | a common physical thing | 287 | cat, cricket, curry, concrete, bowl, shoulder |
| Tue | concrete-medium | a less common physical thing | 263 | bulb, hip, polymer, livestock, peanut, laptop |
| Wed | social | a person, place, group, time, event or something people say | 598 | journalism, knot, keeper, presidency, hospitality, theorem |
| Thu | concrete-hard | a rarer physical thing | 288 | cargo, zinc, bracelet, rainfall, tin, driveway |
| Fri | abstract-easy | an idea, feeling or quality (noun) | 322 | analogy, award, opinion, security, height, game |
| Sat | abstract-hard | a harder abstract noun | 342 | greed, volleyball, exodus, talent, fatigue, coma |
| Sun | action-quality | a verb or adjective ("describe an action or a quality") | 754 | earn, download, practical, aware, consult, fail |

The tiers are WordNet's categories, so a few words land in surprising ones (WordNet files "volleyball" under acts, "knot" under groups). Difficulty still rises through the week on average.

Each pool needs 105 words, so there's plenty of room to curate.

**How the tiers are set:** the tier comes from the WordNet category of the word's main sense:
- **concrete:** artifact, animal, food, plant, object, body, substance, phenomenon.
- **social:** person, location, group, time, event, communication.
- **abstract:** act, attribute, state, feeling, cognition and similar.
- **action-quality:** verbs and adjectives.

**How difficulty is set within a tier:** half word frequency (common = easier), half the validation margin (how far the model's answer beat the runner-up; wide = easier). The concrete tier is split into easiest, middle and hardest thirds for Monday, Tuesday and Thursday. Abstract is split into halves for Friday and Saturday. Monday, Tuesday, Wednesday, Friday and Sunday also require the reference description to give the target as the model's **top** guess, not just top 5.

## Candidates (`pipeline/targets.mjs`)
A target must be in the game's 15k vocabulary and pass all of these:

| Rule | Removed | Examples |
|---|---|---|
| common: zipf ≥ 3.6 | 7,250 | rarer words |
| mostly used as its main sense's part of speech (Brown corpus, NLTK; when it has 5+ uses) | 1,631 | must, despite, well, said |
| an inflection of another vocabulary word | ~490 | years, humans, smaller, best |
| a first name, unless Brown shows it's mostly an ordinary word | ~100 | josh, brent, troy |
| too generic: WordNet depth < 4 | ~25 | object, people |
| a dull nominalisation (abstract tier: -tion/-ment/-ance… whose main sense is an act, process or relation) | ~140 | procurement, validation |
| sensitive main or second sense (sex, drugs, killing, slurs…) | ~70 | |
| `data/target-exclude.txt` (curated, below) | ~520 | |

**Banned words:** the 5 vocabulary words closest in meaning to the target. Words in `target-exclude.txt` are skipped, as are rare words and variants of the target or of each other (docs/vocab.md).

## Validation (the spec's offline check, `pipeline/validate.mjs`)
- **Method:** each candidate is described by its own main WordNet definition, with everything that day's ban check refuses removed, and cut to 25 words. That's embedded exactly as the game does (headless Chrome running `site/js/embed.js`) and guessed. A target passes if it's in the model's top 5. Failures are dropped.

**Pass rate (final build, 4,340 candidates):**

| Tier | Top 5 (pass) | Right first time |
|---|---|---|
| concrete | 862 / 901 (95.7%) | 770 (85.5%) |
| social | 985 / 1,105 (89.1%) | 760 (68.8%) |
| abstract | 684 / 786 (87.0%) | 533 (67.8%) |
| action-quality | 1,347 / 1,548 (87.0%) | 1,031 (66.6%) |
| **all** | **3,878 / 4,340 (89.4%)** | 3,094 (71.3%) |

- **Why things fail:** mostly the banned words gut the definition. For *case* it leaves "an of something", for *police* "the force of and". Those words would be miserable puzzles anyway.
- **Caveat:** this check is lenient, since the definition it starts from is itself in the vector file (docs/vocab.md). Its job is to catch targets the ban rules make impossible. The difficulty split and the curation do the rest.

## Playtests: can a player get it? (`pipeline/playtest.mjs`, added at launch)
The validation above is lenient, and real descriptions showed it. Many scheduled words weren't gettable with natural descriptions that obey the banned words (the launch-day word "earn": "get money in return for your work" → #31).

So every word gets **playtested** before it goes live:
- **The check:** someone writes 2 descriptions the way a player would, respecting the ban rules. The tool rejects any that break them. The word **passes if one of them puts it in the AI's top 3**. Descriptions are written once, never tuned until they pass.
- **Failed words are dropped** by `schedule.mjs` (`data/playtest.json` → `data/playtest-results.json`).
- **Enforced:** `npm test` fails if any of the next 2 weeks lacks a passing playtest.
- **At launch:** 148 words were playtested, and **72 passed (49%)**, so the next 8 weeks (56 days) are all playtested words. Verbs and adjectives (the Sunday pool) pass least often, about 25%.

**Keep 8 weeks ahead playtested** (about once a month):
```
node pipeline/playtest.mjs --todo 8          # the next 8 weeks' words without a playtest, with their banned words
# write 2 descriptions each, as a player would, into a JSON file { word: [d1, d2] }, then:
node pipeline/playtest-add.mjs that-file.json && node pipeline/playtest.mjs
node pipeline/schedule.mjs --keep-until <today>   # failed words drop out; repeat --todo until it says 0
.venv/Scripts/python pipeline/check-schedule-words.py && npm test
```
`node pipeline/try.mjs <word> "description" …` tries descriptions against any word without recording them.

## Curation (by reading every word)
- **What I did:** I read every scheduled word with its banned words, over several rounds. Anything vague, misleading or awkward went into **`data/target-exclude.txt`**, grouped by reason. That came to about 520 words. The groups:
  - **vague:** level, system, thing, way, process, factor
  - **main WordNet sense isn't what people think of:** essay = "attempt", gravity = "solemnity", jar = "a jolt", bot = "a larva"
  - **names:** josh, chad
  - **religion and politics**
  - **sensitive:** words and banned words
- **The same file stops a word being shown as a banned word,** e.g. "sperm" for egg, "lingerie" for teddy.

**Safety gate: `pipeline/check-schedule-words.py`.** It scans every word the schedule shows (3,613 targets and banned words) and fails on any suspect:
- a word on the blocklist;
- any sense WordNet labels offensive, since a slur can hide behind an innocent main sense, as with "retard" in idiot's banned list;
- a sensitive main or second sense.

Each suspect is either excluded or listed in **`data/checked-ok.txt`** with the reason (e.g. "queen: a female monarch, rare slur sense"). Current result: **0 unresolved**.

## Determinism and "never change a past day"
- **Same output every run:** the schedule is a pure function of the data files, so the same inputs always give the same schedule.
- **Stable pool order:** each pool is ordered by a hash of each word with a fixed seed (`describle-v1`), not shuffled. So excluding a word only brings in one new word, though later days of that weekday move up a week. Changing the epoch only shifts dates, and the curated set of words stays.
- **No repeats in 735 days:** no word twice, no variants (dog/dogs), and no spelling twins (aluminum/aluminium; each is the other's banned word).
- **Golden days:** `test/fixtures/schedule-golden.json` pins the first 28 days, and `npm test` fails if a rebuild changes them.

## Launch day
`EPOCH` is 2026-10-11, launch day, so puzzle #1 was "download". It was set by re-dating the curated schedule (`--epoch`; the same words) and re-pinning the golden days. **Never change it now.** Days up to today are frozen with `--keep-until <today>`.

## Maintaining it (after launch)
- **Remove a word from future days:** add it to `data/target-exclude.txt`, then run:
  ```
  node pipeline/targets.mjs && node pipeline/validate.mjs
  node pipeline/schedule.mjs --keep-until <today>     # days up to today are copied unchanged
  .venv/Scripts/python pipeline/check-schedule-words.py
  npm test
  ```
- **Read what changed:** `schedule.mjs` prints the words that are new versus the previous file and writes `data/schedule-changes.txt`. Read them before deploying. `data/schedule-review.txt` lists every word by weekday.
- **Extending past October 2028:** raise `WEEKS` in `pipeline/schedule.mjs` and rerun with `--keep-until <today>`. Pools have about 3× the words needed, so it can go years further.
- **Changing the vocabulary or vectors:** bump `VOCAB_VERSION` and keep the old files for past days. Validation and the schedule depend on them.

## Tests
- **`test/daily.test.mjs`:** UTC day keys across time zones, puzzle numbers across DST and leap days, the countdown, the weekday curve, date → entry, and wrapping past the end.
- **`test/schedule.test.mjs`:** length and epoch, weekday pools, no repeats/variants/twins, every target validated and not excluded, 5 proper banned words per day, each day's ban check refusing its words, and the golden days.
