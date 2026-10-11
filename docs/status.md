# Describle: status and how to pick up

**Read this first**, then `CLAUDE.md` (rules), then the docs for the part you're changing. House rules shared by all jacob.gg games: `../jacob.gg/PLAYBOOK.md` (the `daily-games` skill points there).

Last updated: 11 Oct 2026 (end of Phase 3).

## Where it stands
| Phase | State | Doc |
|---|---|---|
| 1. Model benchmark (desktop + iPhone) | done, approved | `docs/model.md` |
| 2. Vocabulary, vectors, ban check | done, approved | `docs/vocab.md` |
| 3. Schedule + validation | **done, waiting for the owner's review** | `docs/schedule.md` |
| 4. Game UI, scoring, share, leaderboard, hub card | not started | (spec below) |

- **Repo:** https://github.com/biccyanzac-pixel/describle. `site/` is deployed to `gh-pages` → https://biccyanzac-pixel.github.io/describle/.
- **Live so far:** only the model bench at `/bench/`, whose "Run phone test" button is the iPhone check. There's no game page yet.

## What's decided (don't relitigate without the owner)
- **Model:** all-MiniLM-L6-v2 int8, pinned to commit `751bff3…`.
  - In the browser it runs **directly on ONNX Runtime Web 1.18.0's single-threaded build**, not Transformers.js. Later ORT builds need shared WASM memory, which crashed the owner's iPhone on repeat visits.
  - The model comes from the Hugging Face Hub, with an automatic fallback to the copy in `site/models/` (Safari's tracking protection can block the Hub). Confirmed working on the owner's iPhone (iOS 17.7): 3 visits, about 27 ms per guess.
- **Vocabulary:** 15,000 words (the spec's size; 10k scored the same). The guess rule and weights are in `docs/vocab.md`.
- **Offline vectors are computed in headless Chrome by the game's own `embed.js`,** one text per call, so they match the phone exactly. Never batch: the int8 model's activation scale depends on the whole batch.
- **Weekday curve:** Monday easiest → Saturday hardest, with Sunday's special being a verb or adjective. The owner agreed.
- **Over-banning by stem** (e.g. "general" refused for "generous") is accepted.
- **Free, no accounts, no analytics.** Ask the owner before anything paid.

## Phase 4: what's left (from the owner's spec and the playbook)
1. **Game page** `site/index.html` + `site/js/app.js`:
   - **Shared kit:** load `https://biccyanzac-pixel.github.io/jacob.gg/kit/jgg.css` and `jgg.js` first, use the masthead, `JGG.levelChip(day)` on the intro and `JGG.rate(...)` on results. Copy components from `../perceptle/site/css/style.css` or `../factle`. Must work at 360 px wide, in dark and light.
   - **Loading:** the loading state shows progress, so the page never hangs. The model and vocabulary download in parallel (`loadEmbedder`, `loadVocab`).
   - **Attempts:** 3 per day, at most 25 words each. Each attempt runs the ban check (`makeBanCheck` with the day's `banned` and `related`, the vocabulary's `lexicon` and `irregular`). The game shows which word was refused and why (`hit.why`).
   - **Guess:** `vocab.guess(vector)` gives the top 5 with score bars. It's correct if `isVariant(top1, target)`. "Close!" with its rank if the target is in the top 5 but not first.
   - **Reveal:** the top 5, the target's definition (`entry.def`) and the banned words.
   - **Scoring:** the spec says 100 for a first-attempt correct guess, minus points per word over 5 and per extra attempt. The exact formula is to be chosen and documented, and shared with the worker in `site/js/daily.js` or a `scoring.js`.
   - **Share:** "✍️ Describle #41 — guessed in 7 words, attempt 1", plus an emoji grid and a link.
   - **Streaks** in localStorage, wrapped in try/catch.
   - **Archive** of past days (on the "played later" board) and a "come back tomorrow" countdown.
   - **Credits:** WordNet 3.0 licence, LDNOOBW (CC BY 4.0), wordfreq data (CC BY-SA 4.0: `vocab-v1.json` is CC BY-SA), the model (Apache-2.0), ORT (MIT), stemmer (MIT), tokenizers (Apache-2.0).
2. **Robustness:** if loading the model fails (`err.stage`), call `clearModelCaches()` and reload once (use a sessionStorage flag so it can't loop). Show the error and a retry button after that.
3. **Leaderboard:** `worker/`, copied from `../factle/worker` or `../perceptle/worker`.
   - D1 database `describle-leaderboard`, worker `describle-leaderboard.jacob-gg-leaderboard-worker.workers.dev`, local port 8812.
   - Ask for a name once, then auto-submit every finished game.
   - The server recomputes the score from the raw submission (`daily.js` plus scoring), and rows are insert-only.
   - Late or archive plays go on the separate `is_late` board.
4. **Hub:** follow the playbook checklist: `games.json`, a card in `index.html`, the D1 binding in `worker/wrangler.toml`, the query in `worker/src/sources.js`, and `NAMES` in `kit/jgg.js` (already has `describle`). Then redeploy the hub worker, and update the playbook's port and kit tables.
5. **Launch day:** set `EPOCH` to it, then `node pipeline/schedule.mjs --epoch <date>` (the same words, re-dated), then `node pipeline/pin-golden.mjs`. Never change it after.
6. **Tests to add:**
   - unit tests for scoring and share encoding;
   - worker API end-to-end;
   - a headless-Chrome UI end-to-end at 360 px and desktop;
   - the iPhone memory test: 20 consecutive guesses with no crash. The bench already does this; repeat it on the game page.

## How to run things
```
npm install                                  # JS deps (Playwright uses the installed Chrome)
python -m venv .venv && .venv/Scripts/pip install nltk wordfreq numpy safetensors huggingface_hub pytest
npm test                                     # 37 tests (~1 min: one starts headless Chrome)
.venv/Scripts/python -m pytest               # vocabulary filters
node tools/serve.mjs                         # http://localhost:8082/  (bench at /bench/)
node bench/phone-flow.mjs webkit             # the phone test's 3 visits; BASE=<live url>, SIMULATE_IOS=1, BLOCK_HUB=1
node bench/parity.mjs webkit                 # browser vectors == shipped vectors (must be 1.000000)
```
Full data rebuild, in order (each step caches; about 30 min from scratch):
```
.venv/Scripts/python -m pipeline.vocab --size 20000   # data/vocab.json, irregular.json
.venv/Scripts/python -m pipeline.pos                  # data/pos.json, names.json (Brown corpus usage)
node pipeline/embed.mjs                               # data/cache/*.i8 (headless Chrome)
node pipeline/tune.mjs --n 15000                      # data/tune.json
node pipeline/build.mjs                               # site/data/vocab-v1.json, vectors-v1.bin
node pipeline/targets.mjs && node pipeline/validate.mjs
node pipeline/schedule.mjs [--keep-until <today>]     # site/data/schedule-v1.json
.venv/Scripts/python pipeline/check-schedule-words.py # safety gate: must say 0 unresolved
```
Deploy the site: `git subtree split --prefix site -b gh-pages && git push -f origin gh-pages`.

## Gotchas found the hard way
- **iPhone:** see `docs/model.md` "iPhone". Retest any ORT, model or loading change with the bench's "Run phone test" on a real iPhone. Desktop WebKit didn't reproduce those failures.
- **Words like "constructor"** are vocabulary words. Use `Object.hasOwn` or a Map, never `obj[word]`.
- **PowerShell 5.1:** `Set-Content -Encoding utf8` adds a BOM, and reading UTF-8 files with Get-Content garbles "…". Use the editor tools or Node to write files. Cutting a command's output with `| Select -First n` kills the command early, so its later output files never get written.
- **Commits:** pass messages with `git commit -F <file>`.
- **Secret scanning:** GitHub's push protection flagged minified Transformers.js as an API key (a false positive). Don't vendor it, and never bypass push protection.
