# Describle: status and how to pick up

**Read this first**, then `CLAUDE.md` (rules), then the docs for the part you're changing. House rules shared by all jacob.gg games: `../jacob.gg/PLAYBOOK.md` (the `daily-games` skill points there).

Last updated: 18 Oct 2026 (replays, places, rules 2 from 20 Oct).

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
- **Place:** every attempt also shows where the word came among all 15,000 words ("#37 of 15,000", `vocab.place`).
- **Scoring depends on the puzzle day** (`rulesFor` in `scoring.js`), so past days never change:
  - **Rules 1, puzzles before `V2_FROM` (20 Oct 2026):** 3 attempts, the day ends at the first #1. Score for the winning attempt = 100 − 25 per earlier attempt − 3 per word over 5, never below 10; 0 if not guessed. Share text: "✍️ Describle #1 — guessed in 9 words, attempt 1 (88/100)".
  - **Rules 2, from `V2_FROM`** (owner, 18 Oct): all 3 attempts are always played, even after a #1. Each scores by place (#1 100, #2 70, #3 55, #4 45, #5 40, #6–10 25, #11–25 15, #26–100 5) less 2.5% per word over 5; the day's score is the average of the 3, to one decimal. Share text: "✍️ Describle #12 — 62.7/100, best #1 in 4 words".
  - Squares: 🟩 #1, 🟨 #2–5, 🟧 #6–100 (rules 2 only), ⬛ below. 🔥 streak = days with a #1 on the first go.
- **After a game:** a results screen with the reveal (definition, banned words), **Play again**, the jacob.gg rating box and a countdown.
- **Leaderboards, three per day** (`is_late` in the database): the first go on the day (0), more goes on the day, "replays" (2), and goes after the day, "played later" (1). Replays and played-later take any number of goes; a player's best go is their row, shown as "best of N". The board card has tabs for the day's two boards. Name once, then every attempt is submitted automatically.
- **Robustness:** if the AI fails to load, the page clears the model cache and reloads once, then shows the error with a retry button. The model comes from the Hugging Face Hub, falling back to `site/models/`.
- **What the worker checks** (`worker/src/index.js`): the day, the board, the attempt order within each go, the 1–25 word limit, the day's ban rules, that the top 5 are vocabulary words and that the place agrees with them. It works out the rank and the score itself.
  - **Trusted from the browser:** the top 5 and the place. A Worker can't run the model, so this is the playbook's "consistency check" model, like Yogle and Pointle.
  - **Schema changes** go in `worker/migrations/` (run on the live database before deploying the worker that needs them); `schema.sql` is the full current shape for fresh databases. `0002_replays.sql` added runs and places.
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
- **Practice mode** on random past words. It must stay off the leaderboard (replays and the archive cover most of it).
- **More playtesters:** ask friends to write descriptions for `data/playtest.json` (it's plain JSON).

## How to run things
```
npm install && (cd worker && npm install)
python -m venv .venv && .venv/Scripts/pip install nltk wordfreq numpy safetensors huggingface_hub pytest
npm test                                     # 48 tests (~1 min: some start headless Chrome)
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
