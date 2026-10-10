# Model choice (Phase 1)

**Decision: `all-MiniLM-L6-v2`, int8 (Xenova's ONNX export, Apache-2.0, pinned to commit `751bff3…`), run in the browser directly on ONNX Runtime Web 1.18's single-threaded build, with @huggingface/tokenizers, and vocabulary scoring done by a small WASM SIMD kernel.**

> **Updated after the iPhone tests (10 Oct 2026):** the setup first recommended here (Transformers.js 4.3 on a current ONNX Runtime) loaded once on an iPhone, then ran out of memory on most later visits. See "iPhone" below. The comparison tables are from the original desktop runs. The model choice stands; only the runtime changed.

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

## iPhone (owner's iPhone, iOS 17.7 Safari, 10 Oct 2026)
The bench was published at https://biccyanzac-pixel.github.io/describle/bench/. Its "Run phone test" button does 3 visits with the real vocabulary and saves every result, failures included, for "Copy all results".

**What happened, in order:**
1. **Transformers.js + ORT 1.31 failed at once:** `no available backend found. ERR: [wasm] RangeError: Out of memory`. Every ORT Web build since 1.19 is multi-threaded only, and declares *shared* WASM memory with a 4 GB maximum (`node bench/wasm-memory.mjs <file.wasm>`). A shared memory can't move, so the browser reserves the whole maximum up front, and iOS won't reserve 4 GB.
2. **Capping that maximum at 512 MB** (wrapping `WebAssembly.Memory`) **loaded once:** 4.4 s, 28–42 ms per guess.
   - On a repeat visit it failed differently, with "Importing a module script failed" and then "Load failed". Transformers.js re-imports ORT's loader from the Cache API as a `blob:` module, so I turned that off (`useWasmCache = false`).
   - After that, visits 1 and 2 worked and visit 3 ran out of memory again. That was a reload 2 s later.
3. **Capping at 256 MB:** every visit ran out of memory, even the first. iOS appears to keep shared memory reserved after a page goes away, until Safari itself restarts.
4. **Fix:** stop using shared memory at all. ORT Web **1.18.0** is the last release with a single-threaded build (`ort-wasm-simd.wasm`), which uses ordinary memory. GitHub Pages can't enable WASM threads anyway, so we never used more than one. That meant dropping Transformers.js in the browser, which needs a current ORT. `site/js/embed.js` now does what its pipeline did: tokenize (`@huggingface/tokenizers`), run the session, mean-pool over the tokens, normalise. That's ~60 lines.
   - **Side benefits:** ORT's WASM is 2.7 MB gzipped instead of 3.5 MB. There's no jsDelivr, no import map, and no Mistral-key false positive.

**Parity: the offline vectors must be exactly what a phone computes.** `bench/parity.mjs chrome|webkit` embeds all 301 clues on the site and compares them with the offline pipeline. It also refuses any shared memory, as a strict stand-in for iOS, and the page loads fine. Two real differences turned up:
1. **Batching.** The int8 model quantises activations with a scale taken over the *whole input tensor*. A text embedded in a padded batch of 64 came out slightly different from the same text alone: cosine down to 0.979, enough to flip a few guesses. The game embeds one description alone, so everything is now embedded one text per call (`createOnnxEmbedder` in `site/js/embed.js`).
2. **Engine version.** Token ids matched Transformers.js on all 301 clues. But onnxruntime-node 1.30 (offline) and ORT Web 1.18 (browser) round the int8 arithmetic differently: cosine down to 0.991 on short texts like "feeling very cross and furious". ORT's browser build can't run in plain Node (its file-loading code is stripped out), so **the offline vectors are now computed by the game's own `embed.js` in headless Chrome** (`pipeline/browser-embed.mjs`: 6 Chrome instances in parallel, model files served from a local copy). Chrome and WebKit gave identical vectors to each other.

The vectors were rebuilt this way and the weights re-tuned (docs/vocab.md).

**Confirmed on the iPhone** (iOS 17.7, after closing Safari):

| Visit | Load | Per guess | Model |
|---|---|---|---|
| 1, first | 6.3 s | 27 ms | downloaded from the Hub |
| 2 | 1.4 s | 27 ms | from the Cache API, 0 Hub requests |
| 3 | 1.3 s | 26 ms | from the Cache API, 0 Hub requests |

WASM memory was 88 MB, all ordinary, with no errors.

## Hosting the model (decided)
The owner chose the Hugging Face Hub, pinned to a commit: free, and it doesn't use GitHub Pages bandwidth. The browser fetches `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff3…/onnx/model_quantized.onnx` (and the tokenizer files), then keeps them in the Cache API (`describle-models-v1`).

**Fallback (added 10 Oct 2026):** `site/models/all-MiniLM-L6-v2/` holds the same three files (SHA-256 `afdb6f1a…`, identical to the Hub's). They're used automatically if any Hub download fails.
- **Why now:** on the iPhone, Safari once offered "Reduce Protections", which it does when its tracking protection blocks something on a page. Earlier runs had also failed with "Load failed", which is exactly the error WebKit gives when the Hub is blocked.
- **Checks:** `BLOCK_HUB=1 node bench/phone-flow.mjs webkit` (all visits load from the mirror) and `BLOCK_HUB=1 node bench/parity.mjs webkit` (identical vectors).
- **Cost:** the mirror costs GitHub Pages bandwidth only for players whose Hub download fails.

## Reproduce
```
node tools/serve.mjs                                 # http://localhost:8082/bench/
node bench/run-browser.mjs chrome webkit             # -> bench/results/desktop-*.json
.venv/Scripts/python bench/probe_vocab.py            # -> bench/data/probe_vocab.json
.venv/Scripts/python bench/prep_static.py            # potion int8 files -> site/models/potion-base-8M/
node bench/quality.mjs                               # -> bench/results/quality.json (~10 min/model)
node bench/score-check.mjs                           # SIMD vs JS scoring
```
iPhone and parity checks: `bench/phone-flow.mjs [webkit|chrome]` (the phone test's 3 visits in a persistent profile; `SIMULATE_IOS=1` refuses large shared memories), `bench/parity.mjs [chrome|webkit]`, `bench/parity-node.mjs`.

Versions:
- **In the browser (now):** onnxruntime-web 1.18.0, @huggingface/tokenizers 0.2.0.
- **Offline:** @huggingface/transformers 4.3.1 on onnxruntime-node 1.30.
- **The desktop tables above** were measured with Transformers.js 4.3.1 on onnxruntime-web 1.31.0-dev in the browser.
- **Tools:** Chrome 155 (headless), Playwright WebKit (1.64.0 build), Node 24.19, WordNet 3.0 via NLTK.
