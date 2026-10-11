# Describle

A daily word game: describe the secret word without using it (or 5 banned words), and a small language model in your browser tries to guess it. Fewer words and fewer attempts score more. Everyone gets the same word each UTC day.

**Play:** https://biccyanzac-pixel.github.io/describle/ (live since 11 Oct 2026; also on the [jacob.gg](https://biccyanzac-pixel.github.io/jacob.gg/) hub).
**Start with `docs/status.md`** (what's built, what's decided, regular upkeep, how to run everything).

## Layout
```
site/          the static game (GitHub Pages, gh-pages branch = site/). site/bench/ = the model bench
site/js/       embed.js (text -> vector: ORT Web 1.18 + tokenizer), vocab.js (load + score the vocabulary),
               guess.js (the guess rule), ban.js (the ban check), daily.js (date -> puzzle, weekday curve),
               score.wasm.js (SIMD scoring, generated)
site/data/     vocab-v1.json + vectors-v1.bin (the vocabulary), schedule-v1.json (a word for every day)
site/models/   a copy of the pinned model, used if the Hugging Face Hub fails
site/vendor/   ONNX Runtime Web 1.18 (single-threaded), @huggingface/tokenizers, stemmer
pipeline/      vocab.py, pos.py -> embed.mjs -> tune.mjs -> build.mjs -> targets.mjs -> validate.mjs -> schedule.mjs
               (+ check-schedule-words.py safety gate, ban-words.mjs, browser-embed.mjs, reference-test.mjs)
data/          vocabulary, clue sets, blocklists, curation lists (target-exclude.txt, checked-ok.txt), results
bench/         model comparison, iPhone flow and parity checks
tools/         serve.mjs (local server, port 8082), score.wat + build-wasm.mjs
docs/          status.md (start here), model.md, vocab.md, schedule.md
worker/        leaderboard: Cloudflare Worker + D1 (describle-leaderboard), like the other jacob.gg games
```

## Develop
```
npm install
python -m venv .venv && .venv/Scripts/pip install nltk wordfreq numpy safetensors huggingface_hub pytest
# then, from a .py file (PowerShell 5.1 mangles inline quotes): nltk.download('wordnet'); nltk.download('stopwords')
npm test                                    # JS: 37 tests (~1 min; one runs headless Chrome)
.venv/Scripts/python -m pytest              # Python: vocabulary filters
node tools/serve.mjs                        # http://localhost:8082/bench/
```
Rebuilding the data and maintaining the schedule: `docs/status.md`, `docs/schedule.md`.

## Deploy
- Site: `git subtree split --prefix site -b gh-pages && git push -f origin gh-pages`.
- Worker: `cd worker && npx wrangler deploy` (it bundles `site/js/{daily,ban,scoring}.js` and `site/data/{schedule,vocab}-v1.json`: redeploy when they change).

## Credits and licences
- **WordNet 3.0** © Princeton University (WordNet 3.0 licence).
- **LDNOOBW blocklist** (CC BY 4.0).
- **wordfreq** data (CC BY-SA 4.0). `site/data/vocab-v*.json` derives from it and is CC BY-SA 4.0.
- **all-MiniLM-L6-v2** (Apache-2.0).
- **ONNX Runtime Web** (MIT), **@huggingface/tokenizers** (Apache-2.0), **stemmer** (MIT). Transformers.js (Apache-2.0) is used offline only.
- The Brown corpus (via NLTK) is used offline only, to filter candidate words; nothing from it ships.
- Game code: no licence chosen yet.
