# Describle: notes for coding agents

**Start with docs/status.md** (where things stand, what's decided, what's next, how to run everything). Then the doc for the part you're changing: docs/model.md (model + iPhone), docs/vocab.md (vocabulary, guess rule, ban check), docs/schedule.md (daily words). House rules for all jacob.gg games: `../jacob.gg/PLAYBOOK.md`.

Critical rules:
- Phased build. STOP for the owner's review after each phase (1 model bench, 2 vocabulary + vectors + ban check, 3 schedule + validation, 4 UI + scoring + share + leaderboard).
- Never change a past or current day once live. That covers the schedule (`node pipeline/schedule.mjs --keep-until <today>`), `EPOCH` in `site/js/daily.js` (set at launch, then never changed), and the vocabulary/vectors (`site/data/vocab-v*.json`, `vectors-v*.bin`): they decide what the model guesses. A rebuild gets a new `VOCAB_VERSION` and old days keep the old files.
- iPhone: the browser runs ONNX Runtime Web **1.18.0** (`site/vendor/ort/`), the last release with a single-threaded build. Every later ORT build needs shared WASM memory, which iOS Safari runs out of on repeat visits. Don't upgrade ORT or bring back Transformers.js in the browser without retesting on a real iPhone (`/bench/` → "Run phone test").
- The model is pinned: `Xenova/all-MiniLM-L6-v2` at commit `751bff3…`, from the HF Hub with an automatic fallback to `site/models/` (same files).
- Offline vectors are computed by the game's own `embed.js` in headless Chrome (`pipeline/browser-embed.mjs`), one text per call, so they match the phone exactly. Never embed in batches. Check with `node bench/parity.mjs webkit` (must be 1.000000).
- `site/js/ban.js`, `guess.js`, `vocab.js`, `daily.js` are shared by the game, the pipeline and the tests. Change them in one place.
- Tune only on `data/clues-dev.json`; `clues-test*.json` are held out.
- Daily words: curate with `data/target-exclude.txt` (never a target or banned word) and `data/checked-ok.txt` (flagged but fine). `pipeline/check-schedule-words.py` must report 0 unresolved before deploying a schedule; read the new words `schedule.mjs` prints.
- Free project: ask the owner before adding any paid service or restrictive-licence dependency. Credit WordNet, LDNOOBW (CC BY 4.0), wordfreq data (CC BY-SA 4.0) and the model's licence on the site.
- Commit as `biccyanzac-pixel <285977456+biccyanzac-pixel@users.noreply.github.com>` (repo-local), with `git commit -F <file>`. Deploy the site with `git subtree split --prefix site -b gh-pages && git push -f origin gh-pages`.
- GitHub push protection flagged minified Transformers.js as an API key (false positive): never vendor it, never bypass push protection.
- Local ports: site 8082, worker 8812.
- `site/js/score.wasm.js` is generated: edit `tools/score.wat`, then `node tools/build-wasm.mjs`.
- Words like "constructor" are vocabulary words: use `Object.hasOwn` or a Map, never `obj[word] ?? x`.
- PowerShell 5.1: `Set-Content -Encoding utf8` writes a BOM and Get-Content garbles UTF-8: use the editor tools or Node. `| Select -First n` kills a command early.

Tests: `npm test` (JS, ~1 min), `.venv/Scripts/python -m pytest` (Python).
