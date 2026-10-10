"""Fetch the zoo weights into the HF cache and verify sha256 against spacr.model_zoo."""
import json, sys
from huggingface_hub import hf_hub_download
from spacr import model_zoo as mz

KEYS = ["nuclei_from_cellmask_v1", "toxoplasma_from_cellmask_v1",
        "cell_from_hoechst_v1", "toxoplasma_from_hoechst_v1", "toxoplasma_plaque_v3"]
CARD_EXTRA = {"toxoplasma_from_cellmask_v1": ["training/run_config.json", "evaluation/report.json"],
              "toxoplasma_from_hoechst_v1": ["training/run_config.json", "evaluation/report.json"],
              "nuclei_from_cellmask_v1": ["training/report.json"],
              "cell_from_hoechst_v1": ["training/report.json"],
              "toxoplasma_plaque_v3": ["training/run_config.json", "training/publication_config.json", "spacr_catalogue_entry.json"]}
RAW = {d["key"]: d for d in mz.BUNDLED_REMOTE_MODELS}
out = {}
for key in KEYS:
    e = mz.resolve(key)
    repo = RAW[key]["repo_id"]
    filename = e.uri.split("/resolve/main/")[1].split("?")[0]
    files = {}
    for f in ["README.md"] + CARD_EXTRA.get(key, []):
        files[f] = hf_hub_download(repo, f, repo_type="model")
    w = hf_hub_download(repo, filename, repo_type="model")
    sha = mz.sha256_file(w)
    ok = sha == e.sha256.lower()
    print(key, filename, w, sha[:12], "OK" if ok else "MISMATCH", flush=True)
    out[key] = {"weights": w, "repo_file": filename, "sha256": sha, "zoo_sha256": e.sha256, "match": ok, "files": files}
json.dump(out, open(sys.argv[1], "w"), indent=1)
