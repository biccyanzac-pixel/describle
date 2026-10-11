"""Gate: scan every word the schedule will show (targets and banned words) for anything offensive or sensitive
that the curation missed. Fails (exit 1) on any suspect not resolved in data/checked-ok.txt.

    .venv/Scripts/python pipeline/check-schedule-words.py

A word is a suspect if:
  - it's on the blocklists (data/blocklist-*.txt), or
  - WordNet labels ANY of its senses offensive (a slur can hide behind an innocent main sense: "retard"), or
  - one of its 2 most-used senses has a sensitive definition (sex, drugs, violence…). Rarer senses don't count:
    WordNet has a sexual sense for "love", "know", "light" and a torture sense for "wheel".
Resolve a suspect by excluding it (data/target-exclude.txt, then rebuild) or, if it's fine as shown, by listing
it in data/checked-ok.txt with the reason.
"""
import json
import pathlib
import re
import sys

from nltk.corpus import wordnet as wn

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))
from pipeline.vocab import blocklist, is_offensive  # noqa: E402

SENSITIVE = re.compile(r"\b(sex|sexual|sexually|genital|genitals|penis|vagina|erotic|suicide|murder|corpse|torture|slave|"
                       r"slavery|terrorist|genocide|abortion|prostitute|prostitution|narcotic|heroin|cocaine|rape|racial|"
                       r"racist|nazi|excrement|feces|urine|retarded)\b", re.I)


def words_in(path):
    p = pathlib.Path(path)
    if not p.exists():
        return set()
    return {l.split("#")[0].strip().lower() for l in p.read_text(encoding="utf-8").splitlines() if l.split("#")[0].strip()}


schedule = json.loads(pathlib.Path("site/data/schedule-v1.json").read_text(encoding="utf-8"))
vocab = {e["w"]: e for e in json.loads(pathlib.Path("data/vocab.json").read_text(encoding="utf-8"))}
block, ok = blocklist(), words_in("data/checked-ok.txt")
shown = {}
for i, d in enumerate(schedule["days"]):
    for w in [d["word"], *d["banned"]]:
        shown.setdefault(w, i)
suspects = []
for w, i in shown.items():
    why = []
    if w in block:
        why.append("blocklist")
    for s in wn.synsets(w):
        if any(l.name() == w for l in s.lemmas()) and is_offensive(s):
            why.append(f"offensive sense {s.name()}: {s.definition()[:50]}")
    for s in vocab.get(w, {}).get("senses", [])[:2]:
        if SENSITIVE.search(s["def"]):
            why.append(f"main sense: {s['def'][:60]}")
    if why and w not in ok:
        suspects.append((w, i, why))
for w, i, why in suspects:
    role = "TARGET" if schedule["days"][i]["word"] == w else f"banned for {schedule['days'][i]['word']}"
    print(f"{w} (day {i + 1}, {role}): {'; '.join(why)}")
print(f"{len(shown)} words shown in the schedule, {len(suspects)} unresolved suspects")
sys.exit(1 if suspects else 0)
