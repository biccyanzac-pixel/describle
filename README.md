# Describle

A daily word game: describe the secret word without using it (or 5 banned words), and a small language model in your browser tries to guess it. Fewer words and fewer attempts score more. Everyone gets the same word each UTC day.

**Status:** Phase 2 (vocabulary, vectors, ban check) done, waiting for the owner's review. See `docs/vocab.md` (Phase 2) and `docs/model.md` (Phase 1).
Bench (runs on a phone): https://biccyanzac-pixel.github.io/describle/bench/

## Layout
```
site/        the static game (GitHub Pages, gh-pages branch = site/). site/bench/ = the model bench
site/js/     embed.js (text -> vector), vocab.js (load + score the vocabulary), guess.js (the guess rule),
             ban.js (the ban check), score.wasm.js (SIMD scoring, generated)
site/data/   vocab-v1.json + vectors-v1.bin (built by pipeline/build.mjs; never change a live version)
site/vendor/ ONNX Runtime Web (WASM-only build), @huggingface/tokenizers, stemmer
pipeline/    vocab.py -> embed.mjs -> tune.mjs -> build.mjs; ban-words.mjs (banned words), reference-test.mjs
data/        vocabulary (vocab.json), clue sets for tuning/testing, blocklists, tuning results
bench/       Phase 1 model comparison
tools/       serve.mjs (local server, port 8082), score.wat + build-wasm.mjs
worker/      (Phase 4) leaderboard: Cloudflare Worker + D1, like the other jacob.gg games
```

## Develop
```
npm install
python -m venv .venv && .venv/Scripts/pip install nltk wordfreq numpy safetensors huggingface_hub pytest
# then, from a .py file (PowerShell 5.1 mangles inline quotes): nltk.download('wordnet'); nltk.download('stopwords')
npm test                                    # JS: ban check, guess rule, shipped files (loads the model, ~1 min)
.venv/Scripts/python -m pytest              # Python: vocabulary filters
node tools/serve.mjs                        # http://localhost:8082/bench/
```
Rebuilding the vocabulary: see `docs/vocab.md`.

## Deploy
Site: `git subtree split --prefix site -b gh-pages && git push -f origin gh-pages`.

## Credits and licences
- **WordNet 3.0** © Princeton University (WordNet 3.0 licence).
- **LDNOOBW blocklist** (CC BY 4.0).
- **wordfreq** data (CC BY-SA 4.0). `site/data/vocab-v*.json` derives from it and is CC BY-SA 4.0.
- **all-MiniLM-L6-v2** (Apache-2.0).
- **Transformers.js** (Apache-2.0), **ONNX Runtime Web** (MIT), **@huggingface/tokenizers** (Apache-2.0), **stemmer** (MIT).
- Game code: no licence chosen yet.
