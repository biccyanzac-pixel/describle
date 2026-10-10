# Describle: notes for coding agents

Start with README.md, then docs/ (model.md, vocab.md). House rules for all jacob.gg games: `../jacob.gg/PLAYBOOK.md`.

Critical rules:
- Phased build. STOP for the owner's review after each phase (1 model bench, 2 vocabulary + vectors + ban check, 3 schedule + validation, 4 UI + scoring + share + leaderboard). Current status is at the top of README.md.
- iPhone budget: model download < 30 MB, whole tab < ~200 MB. Check `site/bench/` numbers before adding anything big to the page.
- Never change a past or current day once live. That includes the vocabulary and vectors (`site/data/vocab-v*.json`, `vectors-v*.bin`): they decide what the model guesses. A rebuild gets a new `VOCAB_VERSION`, and old days keep the old files. `EPOCH` (puzzle #1) is set at launch and never changed.
- The model is pinned: `Xenova/all-MiniLM-L6-v2` at commit `751bff3…` (`site/js/embed.js`). The vectors were built with exactly that file.
- iPhone: the browser runs ONNX Runtime Web **1.18.0** (`site/vendor/ort/`), the last release with a single-threaded build. Every later ORT build uses shared WASM memory, which iOS Safari runs out of on repeat visits. Don't upgrade ORT or bring back Transformers.js in the browser without retesting on an iPhone (`site/bench/` → "Run phone test").
- Offline vectors are computed by the game's own `embed.js` in headless Chrome (`pipeline/browser-embed.mjs`), one text per call, so they match the phone exactly. Never embed in batches: the int8 model's activation scale depends on the whole batch. Check with `node bench/parity.mjs chrome|webkit`.
- `site/js/ban.js`, `guess.js`, `vocab.js` are shared by the game, the pipeline and the tests. Change them in one place.
- Tune only on `data/clues-dev.json`. `clues-test.json` and `clues-test2.json` are held out (see docs/vocab.md).
- Free project: ask the owner before adding any paid service or restrictive-licence dependency. Credit WordNet (WordNet 3.0 licence), LDNOOBW (CC BY 4.0) and the model's licence on the site.
- Commit as `biccyanzac-pixel <285977456+biccyanzac-pixel@users.noreply.github.com>` (repo-local config). Deploy the site with `git subtree split --prefix site -b gh-pages && git push -f origin gh-pages`.
- GitHub push protection flagged minified Transformers.js as a "Mistral API key" (false positive). It's no longer used in the browser; never bypass push protection.
- Local ports: site 8082, worker 8812.
- `site/js/score.wasm.js` is generated: edit `tools/score.wat`, then `node tools/build-wasm.mjs`.
- Words like "constructor" are vocabulary words: look words up with `Object.hasOwn` or a Map, never `obj[word] ?? x`.
- PowerShell 5.1: `Set-Content -Encoding utf8` writes a BOM (breaks JSON.parse); use the editor tools. Inline `python -c` loses quotes; use a file.

Pipeline: `.venv/Scripts/python -m pipeline.vocab --size 20000` → `node pipeline/embed.mjs` → `node pipeline/tune.mjs` → `node pipeline/build.mjs` → `node pipeline/reference-test.mjs`.
Tests: `npm test` (JS), `.venv/Scripts/python -m pytest` (Python).
