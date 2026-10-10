// Print the memory limits a .wasm file declares (initial/maximum pages, shared), from its binary.
//   node bench/wasm-memory.mjs <file.wasm> ...
import fs from 'node:fs';

for (const file of process.argv.slice(2)) {
  const b = fs.readFileSync(file);
  let p = 8;
  const leb = () => { let r = 0, s = 0, x; do { x = b[p++]; r += (x & 0x7f) * 2 ** s; s += 7; } while (x & 0x80); return r; };
  const str = () => { const n = leb(); const v = b.toString('utf8', p, p + n); p += n; return v; };
  const limits = () => { const flags = b[p++]; const min = leb(); const max = flags & 1 ? leb() : null; return { min, max, shared: !!(flags & 2), memory64: !!(flags & 4) }; };
  const show = (how, l) => console.log(`${file}: ${how} initial ${l.min} pages (${(l.min * 65536 / 1048576).toFixed(0)} MB), maximum ${l.max === null ? 'none' : `${l.max} pages (${(l.max * 65536 / 1048576).toFixed(0)} MB)`}, shared ${l.shared}`);
  while (p < b.length) {
    const id = b[p++], size = leb(), end = p + size;
    if (id === 2) { // imports
      for (let n = leb(); n--;) {
        const mod = str(), name = str(), kind = b[p++];
        if (kind === 0) leb(); else if (kind === 1) { p++; limits(); } else if (kind === 2) show(`imports memory ${mod}.${name}:`, limits()); else if (kind === 3) { p += 2; } else if (kind === 4) { p++; leb(); }
      }
    } else if (id === 5) { for (let n = leb(); n--;) show('defines memory:', limits()); }
    p = end;
  }
}
