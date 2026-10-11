// Merge new playtest descriptions into data/playtest.json (a word already there keeps its first descriptions:
// never rewrite a playtest until it passes).
//   node pipeline/playtest-add.mjs additions.json      ({ word: ["description", ...] })
import fs from 'node:fs';
const add = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const tests = fs.existsSync('data/playtest.json') ? JSON.parse(fs.readFileSync('data/playtest.json', 'utf8')) : {};
const results = fs.existsSync('data/playtest-results.json') ? JSON.parse(fs.readFileSync('data/playtest-results.json', 'utf8')) : {};
let n = 0;
for (const [w, ds] of Object.entries(add)) {
  if (!tests[w]) { tests[w] = ds; n++; }
  // Every earlier description broke the ban rules (so none counted): add valid ones alongside.
  else if (!results[w]) { tests[w].push(...ds); n++; }
  else console.log(`kept the existing playtest for "${w}"`);
}
fs.writeFileSync('data/playtest.json', JSON.stringify(tests, null, 1) + '\n');
console.log(`added ${n} words; ${Object.keys(tests).length} playtested in all`);
