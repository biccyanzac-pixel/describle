# Describle: notes for coding agents

Start with README.md, then docs/ (model.md first).

Critical rules:
- Phased build. STOP for the owner's review after each phase (1 model bench, 2 vocabulary + vectors + ban check, 3 schedule + validation, 4 UI + scoring + share + leaderboard). Current status is at the top of README.md.
- iPhone budget: model download < 30 MB, whole tab < ~200 MB. Check `site/bench/` numbers before adding anything big to the page.
- Never change a past day once live. The day is the UTC date; `EPOCH` (puzzle #1) is set at launch and never changed after.
- Free project: ask the owner before adding any paid service or restrictive-licence dependency. Credit WordNet (WordNet 3.0 licence) and the model's licence on the site.
- Commit as `biccyanzac-pixel <285977456+biccyanzac-pixel@users.noreply.github.com>` (repo-local config). Deploy the site with `git subtree split --prefix site -b gh-pages && git push -f origin gh-pages`, like the other games.
- Local ports: site 8082, worker 8812 (8787/8797/8798/8799/8811 belong to the other games). Don't touch other games' workers or databases.
- `site/js/score.wasm.js` is generated: edit `tools/score.wat`, then `node tools/build-wasm.mjs`.
- PowerShell 5.1 strips quotes from inline `python -c` args; put Python in a file.
