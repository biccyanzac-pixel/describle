"""Phase 1 probe vocabulary: the ~15k most frequent English words that WordNet knows as a noun, verb or adjective,
with up to 3 WordNet definitions each. Only used to compare models (bench/quality.mjs); Phase 2 builds the real one.

    .venv/Scripts/python bench/probe_vocab.py  ->  bench/data/probe_vocab.json
"""
import json
import pathlib
import re

from nltk.corpus import wordnet as wn
from wordfreq import top_n_list

SIZE = 15000
DEFS_PER_WORD = 3
POS = {"n", "v", "a", "s"}

out = []
for w in top_n_list("en", 60000):
    if len(out) >= SIZE:
        break
    if not re.fullmatch(r"[a-z]{3,}", w):
        continue
    # Only synsets where this exact word is a lemma (not just a morphy() base form), most common sense first.
    syns = [s for s in wn.synsets(w) if s.pos() in POS and any(l.name().lower() == w for l in s.lemmas())]
    if not syns:
        continue
    out.append({"w": w, "defs": [s.definition() for s in syns[:DEFS_PER_WORD]]})

clues = json.loads(pathlib.Path("site/bench/clues.json").read_text(encoding="utf-8"))["clues"]
have = {e["w"] for e in out}
missing = [t for t, _ in clues if t not in have]
print(f"{len(out)} words, {sum(len(e['defs']) for e in out)} definitions; clue targets missing: {missing}")
pathlib.Path("bench/data").mkdir(exist_ok=True)
pathlib.Path("bench/data/probe_vocab.json").write_text(json.dumps(out), encoding="utf-8")
