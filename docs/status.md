# Describle: status and how to pick up

**Read this first**, then `CLAUDE.md` (rules), then the docs for the part you're changing. House rules shared by all jacob.gg games: `../jacob.gg/PLAYBOOK.md` (the `daily-games` skill points there).

Last updated: 11 Oct 2026 (launch day).

## Where it stands: live
- **Play:** https://biccyanzac-pixel.github.io/describle/ (also on the jacob.gg hub). Puzzle #1 was Sunday 11 Oct 2026.
- **Leaderboard:** worker `describle-leaderboard` + D1 `describle-leaderboard` → https://describle-leaderboard.jacob-gg-leaderboard-worker.workers.dev. The hub counts plays from its `totals` table.
- **Repo:** https://github.com/biccyanzac-pixel/describle (`site/` → `gh-pages`).
- **Model check for any device:** `/bench/` ("Run phone test").

| Part | Doc |
|---|---|
| Model, runtime, iPhone, parity | `docs/model.md` |
| Vocabulary, guess rule, ban check, "mentioned words" | `docs/vocab.md` |
| Daily words: tiers, validation, playtests, curation | `docs/schedule.md` |
| Game rules, scoring, leaderboard (below) | this file, `site/js/scoring.js`, `worker/src/index.js` |

## The game (as built)
- **The puzzle:** the player sees the day's word and its 5 banned words. They describe the word in at most 25 words, and the ban check refuses the word, banned words and their forms live (`site/js/ban.js`).
- **The guess:** the AI in the browser embeds the description (`embed.js`) and shows its top 5 with bars (`vocab.guess`). It never guesses a word the description itself used. The player wins if the top guess is the word or a form of it; "Close! #n" if it's in the top 5.
- **Attempts:** 3 a day. Score for the winning attempt = 100 − 25 per earlier attempt − 3 per word over 5, never below 10; 0 if not guessed (`scoring.js`). The share text looks like "✍️ Describle #1 — guessed in 9 words, attempt 1 (88/100)" with 🟩🟨⬛ squares and a 🔥 streak.
- **After a game:** a results screen with the reveal (definition, banned words), the jacob.gg rating box and a countdown.
- **Leaderboard:** today's board, plus an archive of past days played on a separate "played later" board. Name once, then every attempt is submitted automatically.
- **Robustness:** if the AI fails to load, the page clears the model cache and reloads once, then shows the error with a retry button. The model comes from the Hugging Face Hub, falling back to `site/models/`.
- **What the worker checks** (`worker/src/index.js`): the day, the attempt order, the 1–25 word limit, the day's ban rules and that the top 5 are vocabulary words. It works out the rank and the score itself.
  - **Trusted from the browser:** the top 5. A Worker can't run the model, so this is the playbook's "consistency check" model, like Yogle and Pointle.
  - **Never stored:** the description text.

## What needs doing regularly
- **Playtest upcoming words, about monthly.** `npm test` fails when the next 2 weeks aren't playtested. The steps are in `docs/schedule.md`, "Playtests".
- **Curate as needed:** `data/target-exclude.txt`, then `node pipeline/schedule.mjs --keep-until <today>`. Read the new words it prints, run the safety gate (`pipeline/check-schedule-words.py`) and redeploy the site.
- **The schedule runs to Oct 2028:** extend it before then (`docs/schedule.md`).

## What's decided (don't relitigate without the owner)
- **Model:** all-MiniLM-L6-v2 int8 at commit `751bff3…`, run on **ONNX Runtime Web 1.18 single-threaded**. Later ORT builds crashed the owner's iPhone on repeat visits. It's confirmed working on iOS 17.7: 3 visits, about 27 ms per guess.
- **Vectors are made by the game's own `embed.js` in headless Chrome,** one text per call (exact parity with phones).
- **Vocabulary:** 15k words.
- **Weekday curve:** Monday easiest → Saturday hardest; Sunday is a verb or adjective.
- **Stems:** over-banning by stem is accepted.
- **Free:** no accounts, no analytics. Ask the owner before anything paid.

## Ideas not done
- **Show the top 5 for a failed day's correct word:** e.g. "Your closest attempt had it at #4".
- **Practice mode** on random past words. It must stay off the leaderboard.
- **More playtesters:** ask friends to write descriptions for `data/playtest.json` (it's plain JSON).

## How to run things
```
npm install && (cd worker && npm install)
python -m venv .venv && .venv/Scripts/pip install nltk wordfreq numpy safetensors huggingface_hub pytest
npm test                                     # 43 tests (~1 min: some start headless Chrome)
.venv/Scripts/python -m pytest               # vocabulary filters
node tools/serve.mjs                         # http://localhost:8082/  (?api=http://127.0.0.1:8812 for a local worker, ?hub=off)
cd worker && npm run db:init:local && npm run dev:local     # local worker on 8812; then: npm test (API e2e)
node tools/e2e-ui.mjs                        # plays today in headless Chrome, phone + desktop, against the local worker
node bench/phone-flow.mjs webkit             # the phone test's 3 visits; BASE=<live url>, SIMULATE_IOS=1, BLOCK_HUB=1
node bench/parity.mjs webkit                 # browser vectors == shipped vectors (must be 1.000000)
node pipeline/try.mjs <word> "a description" # what the AI guesses
node tools/live-check.mjs chrome|webkit      # the live game loads, AI and leaderboard work (doesn't play)
```
**Deploying:**
- **Site:** `git subtree split --prefix site -b gh-pages && git push -f origin gh-pages`.
- **Worker:** `cd worker && npx wrangler deploy`. Redeploy whenever `site/js/{daily,ban,scoring}.js` or `site/data/{schedule,vocab}-v1.json` change, because the worker bundles them.

The full data rebuild order is in `docs/vocab.md` and `docs/schedule.md`.

## Gotchas found the hard way
- **iPhone:** see `docs/model.md`, "iPhone". Retest any ORT, model or loading change with the bench's "Run phone test" on a real iPhone. Desktop WebKit didn't reproduce those failures.
- **Banned words are the natural words:** clue sets written without looking at them overstate accuracy.
- **Words like "constructor"** are vocabulary words. Use `Object.hasOwn` or a Map, never `obj[word]`.
- **PowerShell 5.1:** `Set-Content -Encoding utf8` adds a BOM, and Get-Content garbles UTF-8: write files with the editor tools or Node. `| Select -First n` kills a command early. Pass commit messages with `git commit -F <file>`.
- **Secret scanning:** GitHub's push protection flagged minified Transformers.js as an API key (a false positive). Don't vendor it, and never bypass push protection.
