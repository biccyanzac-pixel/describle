"""How each vocabulary word is actually used, from the Brown corpus (1M words, every word tagged with its part of
speech; via NLTK, used offline only). Lets the schedule skip words that are mostly a name ("john"), a function word
("must", "despite") or another part of speech than their WordNet sense ("well").

    .venv/Scripts/python -m pipeline.pos   ->  data/pos.json  {word: {"n": count, "noun": .., "proper": .., "verb": .., "adj": .., "other": ..}}
"""
import json
import pathlib
from collections import Counter, defaultdict

import nltk
from nltk.corpus import brown

nltk.download("brown", quiet=True)


def group(tag):
    t = tag.split("-")[0].split("+")[0].rstrip("$*")
    if t.startswith("NP"):
        return "proper"
    if t.startswith("NN") or t == "NR":
        return "noun"
    if t.startswith("VB") or t in ("BE", "BED", "BEDZ", "BEG", "BEM", "BEN", "BER", "BEZ", "DO", "DOD", "DOZ", "HV", "HVD", "HVG", "HVN", "HVZ"):
        return "verb"
    if t.startswith("JJ"):
        return "adj"
    return "other"


vocab = {e["w"] for e in json.loads(pathlib.Path("data/vocab.json").read_text(encoding="utf-8"))}
counts = defaultdict(Counter)
for word, tag in brown.tagged_words():
    w = word.lower()
    if w in vocab:
        counts[w][group(tag)] += 1
out = {w: {"n": sum(c.values()), **c} for w, c in counts.items()}
pathlib.Path("data/pos.json").write_text(json.dumps(out), encoding="utf-8")

# First names that are also vocabulary words (NLTK names corpus), for pipeline/targets.mjs.
nltk.download("names", quiet=True)
from nltk.corpus import names  # noqa: E402

first = {n.lower() for n in names.words()} & vocab
pathlib.Path("data/names.json").write_text(json.dumps(sorted(first)), encoding="utf-8")
print(f"{len(first)} vocabulary words are also first names, e.g. {sorted(first)[:15]}")
print(f"{len(out)} of {len(vocab)} vocabulary words seen in Brown")
for w in ("john", "tom", "well", "must", "despite", "one", "rose", "hope", "dog", "run", "happy", "glass"):
    print(w, out.get(w))
