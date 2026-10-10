// Minimal static server for local testing: node tools/serve.mjs [port]  ->  http://localhost:8082/
// Sends COOP/COEP so Chrome allows performance.measureUserAgentSpecificMemory() (bench only; GitHub Pages can't
// send these, which is why the bench pins ONNX to one thread either way).
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.bin': 'application/octet-stream', '.onnx': 'application/octet-stream' };
export function serve(port = 8082, { isolate = true } = {}) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
      const headers = { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Content-Length': fs.statSync(p).size };
      if (isolate) Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
      res.writeHead(200, headers);
      fs.createReadStream(p).pipe(res);
    });
    srv.listen(port, '0.0.0.0', () => resolve(srv));
  });
}
if (process.argv[1]?.endsWith('serve.mjs')) {
  const port = Number(process.argv[2]) || 8082;
  serve(port, { isolate: !process.argv.includes('--no-isolate') }).then(() => console.log(`Describle on http://localhost:${port}/`));
}
