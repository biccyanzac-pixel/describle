// Node-side embedder with exactly the game's model (same repo, commit and int8 weights as the browser).
import { pipeline, env } from '@huggingface/transformers';
import { MODELS } from '../site/js/embed.js';

env.cacheDir = 'models/tjs';
export const MODEL = MODELS['minilm-l6'];

export async function nodeEmbedder() {
  const ex = await pipeline('feature-extraction', MODEL.repo, { dtype: MODEL.dtype, revision: MODEL.revision });
  const dim = MODEL.dim;
  async function batch(texts) {
    const out = await ex(texts, { pooling: MODEL.pooling, normalize: true });
    return texts.map((_, i) => Float32Array.from(out.data.subarray(i * dim, (i + 1) * dim)));
  }
  /** Embed many texts into an int8 matrix (unit vector * 127 per row), batching texts of similar length. */
  async function matrix(texts, { log = () => {} } = {}) {
    const mat = new Int8Array(texts.length * dim);
    const order = texts.map((_, i) => i).sort((a, b) => texts[a].length - texts[b].length);
    const t0 = Date.now();
    for (let i = 0; i < texts.length; i += 64) {
      const ids = order.slice(i, i + 64);
      const vs = await batch(ids.map((k) => texts[k]));
      vs.forEach((v, k) => mat.set(q8(v), ids[k] * dim));
      if (i % 12800 === 0) log(`${i}/${texts.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    return mat;
  }
  return { dim, revision: MODEL.revision, batch, matrix };
}

export const q8 = (v) => Int8Array.from(v, (x) => Math.max(-127, Math.min(127, Math.round(x * 127))));
