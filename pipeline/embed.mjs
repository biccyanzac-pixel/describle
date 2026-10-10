// Embed the whole vocabulary (data/vocab.json) for tuning: the words themselves and every sense in three text
// styles. Cached in data/cache/ (int8), so tuning and the final build don't re-embed.
//   node pipeline/embed.mjs   ->  data/cache/{words,def,plus,hyper}.i8 + data/cache/rows.json
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { nodeEmbedder } from './node-embed.mjs';

export const STYLES = {
  def: (s) => s.def,
  plus: (s) => s.def + (s.syn.length ? ` (${s.syn.join(', ')})` : ''),
  hyper: (s) => (s.hyper.length ? `${s.hyper[0]}: ` : '') + s.def + (s.syn.length ? ` (${s.syn.join(', ')})` : ''),
};

const vocab = JSON.parse(fs.readFileSync('data/vocab.json', 'utf8'));
fs.mkdirSync('data/cache', { recursive: true });
// rows.json: for each sense row, which word it belongs to and its sense index (WordNet order).
const owner = [], senseIdx = [];
vocab.forEach((e, i) => e.senses.forEach((_, k) => { owner.push(i); senseIdx.push(k); }));
fs.writeFileSync('data/cache/rows.json', JSON.stringify({ words: vocab.length, owner, senseIdx }));

const E = await nodeEmbedder();
const jobs = [['words', vocab.map((e) => e.w)], ...Object.entries(STYLES).map(([name, f]) => [name, vocab.flatMap((e) => e.senses.map(f))])];
for (const [name, texts] of jobs) {
  const file = `data/cache/${name}.i8`, hashFile = `${file}.sha1`;
  // Re-embed only if the texts changed (a hash of all of them, in order, plus the model commit).
  const hash = createHash('sha1').update(E.revision + '\n' + texts.join('\n')).digest('hex');
  if (fs.existsSync(file) && fs.existsSync(hashFile) && fs.readFileSync(hashFile, 'utf8') === hash) { console.log(`${name}: cached`); continue; }
  const mat = await E.matrix(texts, { log: (m) => console.log(`  ${name}: ${m}`) });
  fs.writeFileSync(file, mat);
  fs.writeFileSync(hashFile, hash);
  console.log(`${name}: ${texts.length} rows`);
}
