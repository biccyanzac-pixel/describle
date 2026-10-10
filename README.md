# Describle

A daily word game: describe the secret word without using it (or 5 banned words), and a small language model in your browser tries to guess it. Fewer words and fewer attempts score more. Everyone gets the same word each UTC day.

**Status:** Phase 1 (model benchmark) done, waiting for the owner's review. See `docs/model.md`.

## Layout
```
site/        the static game (GitHub Pages). site/bench/ = the Phase 1 model bench (also runs on a phone)
site/js/     embed.js (text -> vector, both model kinds), score.wasm.js (SIMD scoring, generated)
site/vendor/ ONNX Runtime Web (WASM-only build), @huggingface/tokenizers
bench/       Phase 1: run-browser.mjs (desktop browsers), quality.mjs (clue -> word accuracy), results/
tools/       serve.mjs (local server, port 8082), score.wat + build-wasm.mjs
pipeline/    (Phase 2) vocabulary + vector file builder
worker/      (Phase 4) leaderboard: Cloudflare Worker + D1, like the other jacob.gg games
```

## Develop
```
npm install
python -m venv .venv && .venv/Scripts/pip install nltk wordfreq numpy safetensors huggingface_hub pytest
.venv/Scripts/python -c "import nltk; nltk.download('wordnet')"      # (from a .py file under PowerShell 5.1)
node tools/serve.mjs                       # http://localhost:8082/bench/
node bench/run-browser.mjs chrome webkit   # desktop bench -> bench/results/desktop.json
.venv/Scripts/python bench/probe_vocab.py && node bench/quality.mjs   # quality probe -> bench/results/quality.json
```

## Credits and licences
WordNet 3.0, Princeton University (WordNet 3.0 licence). Transformers.js and ONNX Runtime Web (Apache-2.0 / MIT). Model licences are listed in `docs/model.md`.
