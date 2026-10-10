"""Convert a model2vec static-embedding model (minishlab/potion-*) into the files the browser bench loads:
an int8 embedding table with one float32 scale per row, plus the tokenizer.

    .venv/Scripts/python bench/prep_static.py [repo]   ->  site/models/<name>/{emb.i8.bin, scale.f32.bin, tokenizer.json, meta.json}
"""
import json
import pathlib
import shutil
import sys

import numpy as np
from huggingface_hub import hf_hub_download, list_repo_files
from safetensors.numpy import load_file

repo = sys.argv[1] if len(sys.argv) > 1 else "minishlab/potion-base-8M"
print(list_repo_files(repo))
tensors = load_file(hf_hub_download(repo, "model.safetensors", cache_dir="models/hf"))
for k, v in tensors.items():
    print(k, v.shape, v.dtype)
config = json.loads(pathlib.Path(hf_hub_download(repo, "config.json", cache_dir="models/hf")).read_text())
print(config)

emb = tensors["embeddings"].astype(np.float32)
if "weights" in tensors:  # newer model2vec files keep per-token weights separately
    emb = emb * tensors["weights"].astype(np.float32)[:, None]
scale = np.abs(emb).max(axis=1) / 127.0
scale[scale == 0] = 1.0
q = np.clip(np.round(emb / scale[:, None]), -127, 127).astype(np.int8)

# How much does int8 change things? Cosine between each original and dequantised row.
deq = q.astype(np.float32) * scale[:, None]
cos = (emb * deq).sum(1) / (np.linalg.norm(emb, axis=1) * np.linalg.norm(deq, axis=1) + 1e-12)
print(f"int8 row cosine: min {cos.min():.4f}, mean {cos.mean():.5f}")

out = pathlib.Path("site/models") / repo.split("/")[1]
out.mkdir(parents=True, exist_ok=True)
q.tofile(out / "emb.i8.bin")
scale.astype(np.float32).tofile(out / "scale.f32.bin")
shutil.copy(hf_hub_download(repo, "tokenizer.json", cache_dir="models/hf"), out / "tokenizer.json")
(out / "meta.json").write_text(json.dumps({"repo": repo, "vocab": int(q.shape[0]), "dim": int(q.shape[1]),
                                           "normalize": bool(config.get("normalize", True))}))
print("wrote", out, sorted(p.name for p in out.iterdir()))
