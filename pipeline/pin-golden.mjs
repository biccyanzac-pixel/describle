// Pin the first days of the schedule as a test fixture (test/fixtures/schedule-golden.json), so a rebuild that
// changes them fails `npm test`. Run ONLY when the schedule is deliberately regenerated before launch; once live,
// never re-pin past days (append later days if you want more pinned).
//   node pipeline/pin-golden.mjs [days=28]
import fs from 'node:fs';
const n = Number(process.argv[2]) || 28;
const s = JSON.parse(fs.readFileSync('site/data/schedule-v1.json', 'utf8'));
const golden = { epoch: s.epoch, days: s.days.slice(0, n).map((d) => ({ word: d.word, banned: d.banned })) };
fs.mkdirSync('test/fixtures', { recursive: true });
fs.writeFileSync('test/fixtures/schedule-golden.json', JSON.stringify(golden, null, 1) + '\n');
console.log(`pinned ${n} days from ${s.epoch}: ${golden.days.slice(0, 7).map((d) => d.word).join(', ')}, …`);
