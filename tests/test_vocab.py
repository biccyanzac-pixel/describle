"""Vocabulary filters (pipeline/vocab.py). Run: .venv/Scripts/python -m pytest"""
import json
import pathlib

import pytest
from nltk.corpus import wordnet as wn

from pipeline import vocab as V


def test_senses_need_the_exact_lowercase_lemma():
    assert V.senses_of("dog")
    assert not V.senses_of("dogs")       # an inflection, not a lemma
    assert not V.senses_of("london")     # only a proper noun ("London")
    assert V.senses_of("china")          # porcelain, lowercase lemma


def test_offensive_senses_are_detected_but_ordinary_ones_kept():
    assert V.is_offensive(wn.synset("nigger.n.01"))
    assert not V.is_offensive(wn.synset("attack.n.01"))     # "an offensive against an enemy" is fine
    assert not V.is_offensive(wn.synset("disgusting.s.01"))  # "highly offensive" describes, doesn't label


def test_irregular_forms_only_for_given_words():
    irr = V.irregular_forms({"mouse", "tooth", "run"})
    assert "mice" in irr["mouse"]
    assert "teeth" in irr["tooth"]
    assert "ran" in irr["run"]
    assert "geese" not in sum(irr.values(), [])


@pytest.fixture(scope="module")
def built():
    p = pathlib.Path("data/vocab.json")
    if not p.exists():
        pytest.skip("run python -m pipeline.vocab first")
    return json.loads(p.read_text(encoding="utf-8"))


def test_built_vocabulary(built):
    words = [e["w"] for e in built]
    assert len(words) == len(set(words))
    assert all(len(w) >= 3 and w.isalpha() and w.islower() for w in words)
    s = set(words)
    for w in ("umbrella", "elephant", "happy", "run", "kettle"):
        assert w in s, w
    for w in ("the", "have", "dogs", "london", "fuck", "nigger"):
        assert w not in s, w
    assert all(e["senses"] for e in built)
    assert [e["zipf"] for e in built] == sorted((e["zipf"] for e in built), reverse=True)
