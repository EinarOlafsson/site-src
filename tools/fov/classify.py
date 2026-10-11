"""Per-cell classifier score with spaCR's own ML (spacr.ml.ml_analysis, XGBoost).

Task: infected vs uninfected host cell, where "infected" means spaCR Measure linked at
least one vacuole object to the cell. The model sees only host features that exclude
the parasite pixels: nucleus features, cytoplasm intensity/texture (spaCR's cytoplasm
object already excludes nucleus and vacuole pixels) and the cell's outline shape.
Every column naming a pathogen, every whole-cell intensity column (the cell region
contains the parasites) and the cytoplasm shape columns (whose holes are the vacuoles)
are removed before training. The showcase field is never trained on: its rows are
labelled 'showcase' and only scored."""
import json
import os
import sqlite3
import numpy as np
import pandas as pd
from common import R

DB = f"{R}/work/measure/measurements/measurements.db"
SHOW = "plate2_P08_16_1"
OUT = f"{R}/work/classify"


def load_cells():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    cell = pd.read_sql("select * from cell", con)
    cyto = pd.read_sql("select * from cytoplasm", con)
    nuc = pd.read_sql("select * from nucleus", con)
    pat = pd.read_sql("select file_name, cell_id, object_label from pathogen", con)
    key = ["file_name", "object_label"]
    meta = ["plateID", "rowID", "columnID", "fieldID", "prcf", "file_name", "path_name"]
    cyto = cyto.drop(columns=[c for c in meta if c != "file_name"] + ["label_list_morphology", "label_list_intensity",
                                                                     "measurement_ndim", "measurement_units", "n_z",
                                                                     "voxel_size_z_um", "voxel_size_xy_um"], errors="ignore")
    df = cell.merge(cyto, on=key, how="left")
    nnum = nuc.drop(columns=[c for c in nuc.columns if c in meta and c != "file_name"] + ["object_label"]).select_dtypes(
        include=[np.number]).columns.tolist()
    nn = nuc.groupby(["file_name", "cell_id"])[[c for c in nnum if c != "cell_id"]].mean().reset_index()
    nn = nn.rename(columns={"cell_id": "object_label"})
    df = df.merge(nn, on=key, how="left")
    npv = pat.groupby(["file_name", "cell_id"]).size().rename("n_vacuoles").reset_index().rename(
        columns={"cell_id": "object_label"})
    df = df.merge(npv, on=key, how="left")
    df["n_vacuoles"] = df["n_vacuoles"].fillna(0).astype(int)
    df["prcfo"] = df["prcf"] + "_o" + df["object_label"].astype(int).astype(str)
    df = df.set_index("prcfo")
    return df


def allowed(col):
    if "pathogen" in col or "vacuole" in col:
        return False
    if col.startswith("nucleus_"):
        return True
    if col.startswith("cytoplasm_channel_"):
        return True
    if col.startswith("cell_") and "channel" not in col:
        shape = ("area", "axis_length", "eccentricity", "solidity", "extent", "perimeter",
                 "feret_diameter_max", "equivalent_diameter_area", "convex_area")
        return any(s in col for s in shape) and "euler" not in col
    return False


if __name__ == "__main__":
    from spacr.ml import ml_analysis
    os.makedirs(OUT, exist_ok=True)
    df = load_cells()
    df["infection"] = np.where(df.n_vacuoles > 0, "infected", "uninfected")
    df.loc[df.file_name == SHOW, "infection"] = "showcase"
    feats = [c for c in df.columns if allowed(c) and pd.api.types.is_numeric_dtype(df[c])]
    meta = ["plateID", "rowID", "columnID", "fieldID", "infection"]
    X = df[feats + meta].copy()
    settings = dict(channel_of_interest=None, location_column="infection", positive_control="infected",
                    negative_control="uninfected", model_type="xgboost", n_estimators=600, learning_rate=0.05,
                    reg_alpha=0.1, reg_lambda=1.0, test_size=0.2, split_by="field", n_repeats=5,
                    n_jobs=8, remove_low_variance_features=True, remove_highly_correlated_features=True,
                    cross_validation=False, verbose=False)
    out, figs = ml_analysis(X, **settings)
    scored, perm, imp, model, X_train, X_test, y_train, y_test, metrics, train_features = out
    scored = scored.join(df[["file_name", "object_label", "n_vacuoles"]])
    scored.to_csv(f"{OUT}/scored_cells.csv")
    from sklearn.metrics import roc_auc_score
    test = scored[scored.data_usage == "test"]
    pcol = "predictions" if "predictions" in scored.columns else None
    show = scored[scored.file_name == SHOW]
    pc = "prediction_probability_class_1"
    auc_test = roc_auc_score((test.infection == "infected").astype(int), test[pc])
    auc_show = roc_auc_score((show.n_vacuoles > 0).astype(int), show[pc])
    rec = {"function": "spacr.ml.ml_analysis", "settings": settings, "probability_column": pc,
           "n_features_offered": len(feats), "n_features_used": len(train_features),
           "train_cells": int((scored.data_usage == "train").sum()), "test_cells": int(len(test)),
           "fields_total": int(df.file_name.nunique()), "showcase_field": SHOW, "showcase_cells": int(len(show)),
           "auc_heldout_fields": round(float(auc_test), 3), "auc_showcase_field": round(float(auc_show), 3),
           "showcase_infected": int((show.n_vacuoles > 0).sum()),
           "top_features": imp.head(10).to_dict("records") if hasattr(imp, "head") else None,
           "metrics": metrics.to_dict("records") if hasattr(metrics, "to_dict") else None}
    json.dump(rec, open(f"{OUT}/classify.json", "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in rec.items() if k not in ("top_features", "metrics")}, indent=1, default=str))
    print(show[[pc, "n_vacuoles"]].sort_values(pc).to_string())
