// The offline embedder. It runs the game's own embedding code in headless Chrome (pipeline/browser-embed.mjs), so
// the vectors shipped in site/data/ are exactly what a phone computes. Call close() when done.
//
// History: this used Transformers.js on onnxruntime-node 1.30. That differed from the browser's ORT Web 1.18 int8
// arithmetic (cosine down to 0.991 on short texts), and its batching changed vectors too (cosine down to 0.979):
// see docs/model.md, "Parity".
export { nodeEmbedder, MODEL, q8 } from './browser-embed.mjs';
