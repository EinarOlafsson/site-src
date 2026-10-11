"""Fetch the four-plate example screen tables (spaCR example-data release) with spaCR's own SHA-256-validated fetcher."""
import sys
sys.path.insert(0, "/mnt/wd4tb/spacr-worktrees/claude-n687-v4")
from spacr.example_data import fetch
got = fetch(download=True)
print(got.note())
