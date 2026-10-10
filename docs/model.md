# Model choice (Phase 1)

**Recommendation: `all-MiniLM-L6-v2`, int8 (Xenova's ONNX export, Apache-2.0), run by Transformers.js 4.3.1 on a lean ONNX Runtime setup (WASM-only build, one thread, served from our own site), with vocabulary scoring done by a small WASM SIMD kernel.**

Status: **waiting for your review.** Nothing in Phase 2 has started. **iPhone numbers are still missing.** See "What's not measured yet" below.

## Candidates

| Name here | Model | Kind | Model download | Licence |
|---|---|---|---|---|
| minilm-l6 | Xenova/all-MiniLM-L6-v2, int8 | 6-layer transformer, 384-d | 23.0 MB | Apache-2.0 |
| minilm-l3 | Xenova/paraphrase-MiniLM-L3-v2, int8 | 3-layer transformer, 384-d | 17.4 MB | Apache-2.0 |
| potion-8m | minishlab/potion-base-8M, int8 (converted by `bench/prep_static.py`) | static token table, 256-d, no transformer | 7.9 MB | MIT |
| arctic-xs | Snowflake/snowflake-arctic-embed-xs, int8 | 6-layer transformer, 384-d | 23.0 MB | Apache-2.0 |

arctic-xs has the same architecture and size as minilm-l6, so I only ran it in the quality test; its speed and memory match minilm-l6. bge-small-en-v1.5 and gte-small are 34 MB at int8, which is over the 30 MB budget, so they were excluded.

## Quality: can it turn a clue into the word?

`bench/quality.mjs`: I wrote 101 player-style clues (`site/bench/clues.json`, e.g. "you hold it over your head when it rains" → umbrella). None contains its target. They were scored against 15,000 common words (wordfreq ∩ WordNet, up to 3 WordNet definitions each, 46.5k vectors, int8 like the shipped file). Each word's score is the best of its definition scores and a weighted score for the word itself.

| Model | top-1 | top-5 | best weighting |
|---|---|---|---|
| **minilm-l6** | **42 / 101** | **71 / 101** | max(def, 0.8·word); defs only gives 41 / 72 |
| arctic-xs (with its query prefix) | 37 / 101 | 62 / 101 | defs only; 21 / 48 without the prefix |
| potion-8m | 31 / 101 | 52 / 101 | max(def, 0.8·word) |
| minilm-l3 | 26 / 101 | 59 / 101 | defs only |

- With 101 clues, ±5 is noise for top-1 (standard error ≈ 4.9 points at 40 %). minilm-l6 still leads on every weighting, and its top-5 lead is large.
- **The word's own vector matters little. The definitions do the work:** word-only gives 16 / 62 for minilm-l6, and adding the word at full weight *hurts* (38 / 69). Phase 2 will tune the weight on a bigger set, starting from 0.8.
- **minilm-l6's misses are mostly near-synonyms:** fog→mist, earthquake→quake, empty→emptiness, angry→fury, airport→airfield, kettle→tea, penguin→duck. Phase 2 can fix many of these by merging morphological variants (empty/emptiness), adding a small frequency prior and adding synonyms/hypernyms to the definition text. A few come from thin WordNet glosses: umbrella ("a lightweight handheld collapsible canopy") ranks #123, elephant #165.
- potion's misses are much wilder (penguin→aircraft, swim→crippled, fog→dense), which would make the game feel random.

## Speed and memory (desktop)

`site/bench/` (open it on any device), driven by `bench/run-browser.mjs` (Playwright). Laptop: Windows 11, 8 cores, one WASM thread, 46,500-row vocabulary matrix. A "guess" means embedding the description, scoring all rows and taking the top 5. Each figure is the median of 20 consecutive guesses, all in one page.

| | Chrome: load cold / warm | Chrome: embed / guess | Chrome: memory (total / WASM) | WebKit: load cold | WebKit: embed / guess |
|---|---|---|---|---|---|
| **minilm-l6, lean** | 5.2 s / 1.2 s | 26 ms / 32 ms | 116 MB / 94 MB | 10.6 s | 29–34 ms / 38–47 ms |
| minilm-l3, lean | 5.4 s / 1.1 s | 14 ms / 20 ms | 93 MB / 72 MB | 7.9 s | 17 ms / 26 ms |
| potion-8m | 1.3 s / 0.15 s | 0.3 ms / 5 ms | 23 MB / 12 MB | 1.3 s | 0.3 ms / 8 ms |
| minilm-l6, default runtime | 9.9 s / 2.3 s | 26–31 ms / 33–41 ms | 129 MB / 96 MB | 13.3 s | 34–38 ms / 43–48 ms |

- Total memory is Chrome's `measureUserAgentSpecificMemory` (the bench server sends COOP/COEP so Chrome allows it). WASM memory counts every WebAssembly memory the page creates, so it works on Safari too. Both include the 17.9 MB vocabulary matrix (12 MB at 256-d).
- The first description after load takes 130–220 ms (one-off warm-up), and the bench does this before the first guess.
- WebKit "warm" loads aren't shown because Playwright's WebKit on Windows drops Cache API entries on reload (`bench/webkit-cache-check.mjs`). Real Safari keeps them, but the iPhone run needs to confirm it.

### Two findings that change the build
1. **Lean runtime.** By default Transformers.js 4.3 fetches ONNX Runtime's 25.6 MB "asyncify" WASM (6.4 MB gzipped) from jsDelivr. Its `web` build, with an import map pointing at ORT's WASM-only bundle and the plain 13.6 MB WASM (**3.5 MB gzipped**, served by GitHub Pages from `site/vendor/`), loads twice as fast warm (1.2 s vs 2.3 s) and uses 13 MB less memory. Same results. (Transformers.js's own ~120 KB of JS is loaded from jsDelivr, pinned to 4.3.1: GitHub's push protection mistakes some of its minified class names for a Mistral API key, so it can't be committed.)
2. **Scoring needs SIMD.** Scoring 46.5k int8 vectors in plain JS took ~100 ms per guess in Chrome, 4× the embedding itself, and would be several hundred ms on a phone. `tools/score.wat` (230 bytes of WASM, `i32x4.dot_i16x8_s`) does it in **6 ms in Chrome and 10 ms in WebKit**, with results identical to 7e-5 (`bench/score-check.mjs`). Safari has supported WASM SIMD since 16.4, and there's a plain-JS fallback for older browsers.

## Download budget for the recommended setup
| What | Bytes on the wire (first visit) |
|---|---|
| model_quantized.onnx + tokenizer/config | 23.7 MB (under the 30 MB model budget) |
| ORT WASM (gzip) + Transformers.js + ORT JS | 3.5 + 0.15 MB |
| vocabulary vectors (Phase 2 estimate: 46.5k × 384 int8, barely compressible) | ~18 MB |
| **Total** | **~45 MB first visit, then ~0.5 MB a day** (cached) |

**The vocabulary file is the next biggest download.** Phase 2 should cut it: 2 definitions per word instead of 3, dropping word vectors whose weight earns nothing, and possibly 15k → 12k words. Each of these shrinks memory too. At 20 Mbit/s mobile, 45 MB is ~18 s, so the loading screen must show progress (spec'd) and let the player read the rules meanwhile.

## What's not measured yet: iPhone
I can't run Safari on an iPhone from here, and this laptop's Wi-Fi is set to "Public", so the firewall blocks a phone from reaching the local server (I didn't change firewall settings). The bench page is phone-ready: tap a model, it runs 20 guesses, results stay on the page, and "Copy all results" puts them on the clipboard. It needs to be reachable over HTTPS (the Cache API only works on secure origins). Options:
1. **Push the repo and publish `site/` to GitHub Pages now** (`biccyanzac-pixel.github.io/describle/bench/`), as Phase 4 will anyway. The bench page has no game content.
2. Allow the local server through the firewall on a private network and use `http://192.168.1.166:8082/bench/`. Over plain http the Cache API is off, so only cold loads can be measured.

On the iPhone run, watch for: (a) any reload or "A problem repeatedly occurred" (Safari's out-of-memory kill) during the 20 guesses; (b) a warm load well under the cold one (Cache API works); (c) guess time. Expect ~2–4× the desktop figures, i.e. ~100–150 ms, which would be fine.

If minilm-l6 can't hold memory on older iPhones, the fallback is potion-8m (23 MB total memory, instant). It's weaker but playable, and both kinds are already behind the same `loadEmbedder()` interface in `site/js/embed.js`.

## Hosting the model (decision for you)
- **Hugging Face Hub (default):** free CDN, no GitHub Pages bandwidth used. It depends on HF staying up and the repo not changing. We'd pin a commit, and Transformers.js supports `revision`.
- **Self-host in `site/models/`:** fully under our control, but each new player costs 24 MB of GitHub Pages' soft 100 GB/month, about 4,000 first-time players a month.

I'd use HF pinned to a commit, with self-hosting as a one-line fallback.

## Reproduce
```
node tools/serve.mjs                                 # http://localhost:8082/bench/
node bench/run-browser.mjs chrome webkit             # -> bench/results/desktop-*.json
.venv/Scripts/python bench/probe_vocab.py            # -> bench/data/probe_vocab.json
.venv/Scripts/python bench/prep_static.py            # potion int8 files -> site/models/potion-base-8M/
node bench/quality.mjs                               # -> bench/results/quality.json (~10 min/model)
node bench/score-check.mjs                           # SIMD vs JS scoring
```
Versions: @huggingface/transformers 4.3.1, onnxruntime-web 1.31.0-dev.20260914 (the version Transformers.js pins), @huggingface/tokenizers 0.2.0, Chrome 155 (headless), Playwright WebKit (1.64.0 build), Node 24.19. WordNet 3.0 via NLTK.
