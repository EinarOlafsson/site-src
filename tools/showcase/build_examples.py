"""Write examples.json (showcase.json figure schema plus a run record) from the two run records."""
import json, re
from importlib.metadata import version
from pathlib import Path

ROOT = Path("/mnt/firecuda2/Claude/scratch/site-flipcards-examples")
w = json.load(open(ROOT / "work/wells_record.json"))
c = json.load(open(ROOT / "work/livecell_record.json"))
WELL_REPO = "https://huggingface.co/einarolafsson/toxoplasma-plaque-well-detector-yolo11-v4-geldoc"
CELL_REPO = "https://huggingface.co/einarolafsson/live-cell-segmentation-cpsam"
cx0, cy0, cx1, cy1 = w["crop_xyxy_native"]

wells = {
    "id": "wells",
    "title": "Plaque assay plate: wells found",
    "input_label": "Plate",
    "text": "Two panels of plaque-assay wells from a published figure. spaCR's default well detector boxes each well, "
            "so every well can be cropped and its plaques counted on its own. This figure was not used to train the detector.",
    "base": "wells-raw.webp",
    "alt": "Twelve round crystal-violet stained wells in four rows of three, with condition labels above and strain labels at the side",
    "width": w["size"][0],
    "height": w["size"][1],
    "classes": [{
        "name": "Wells",
        "color": "#FF00FF",
        "count": w["count"],
        "layer": "wells-boxes.webp",
        "model": {
            "display": "toxoplasma_well_detector_v3 (YOLO11n)",
            "url": WELL_REPO,
            "note": "The default well detector in spaCR. Model card: mAP50 0.994 on 73 validation images. "
                    f"{w['count']} of 12 wells found, no extra boxes",
        },
    }],
    "facts": [
        ["Input", "Crystal violet, colour (RGB)"],
        ["Image", "Cabral G, et al. Microbiol Spectrum 2024, Fig. 3 H and I", "https://doi.org/10.1128/spectrum.01229-24"],
        ["Licence", "CC BY 4.0 (cropped from the original figure)", "https://creativecommons.org/licenses/by/4.0/"],
        ["Size", f"{w['crop_px'][0]} × {w['crop_px'][1]} px crop, shown at {w['size'][1]} px"],
        ["Training data", "Figure 3 is not in the detector's training or validation list",
         f"{WELL_REPO}/blob/main/training/fields.csv"],
    ],
    "record": {
        "model_key": "toxoplasma_well_detector_v3",
        "weights_url": f"{WELL_REPO}/resolve/main/weights/yolo_welldetect_v4_geldoc.pt",
        "weights_sha256": w["sha256"],
        "zoo_sha256_match": True,
        "settings": w["settings"],
        "runtime_s": w["seconds"],
        "device": "CPU (CUDA_VISIBLE_DEVICES=''), 16 torch threads",
        "ultralytics": version("ultralytics"),
        "torch": version("torch"),
        "source_figure": "spectrum.01229-24.f003.jpg, PMC11448412 (Cabral G, Ren B, Bisio H, Otey D, Soldati-Favre D, "
                         "Brown KM. Orthologs of Plasmodium ICM1 are dispensable for Ca2+ mobilization in Toxoplasma "
                         "gondii. Microbiol Spectr 2024)",
        "source_figure_px": w["figure_native_px"],
        "crop_xyxy_px": w["crop_xyxy_native"],
        "crop": "panels H and I (KCl and zaprinast plaque assays), including their printed labels",
        "display_scale": round(w["scale"], 4),
        "boxes_xyxy_conf_crop_px": w["boxes_native"],
        "outline": "#FF00FF rectangle, 3 px at display size, transparent background, lossless WebP",
        "raw_webp_bytes": w["raw_webp_bytes"],
        "training_data_check": "training/fields.csv of the detector repo lists Fig. 2 of this article "
                               "(spectrum.01229-24.f002 p01 train, p03 val) but no panel of Fig. 3. Plaque crops "
                               "from Fig. 3 are in the plaque segmentation dataset, which is a different model.",
        "reference_check": "the 12 boxes were compared with the YOLO box labels stored for this figure in spaCR's "
                           "detector review set (curation/model_review_2026-10-08/detector/02_literature/held_out, "
                           "unpublished; whether they were hand-reviewed is not recorded): 12 of 12 matched, "
                           "IoU 0.957 to 0.978",
        "licence_check": "Europe PMC record for PMC11448412: licence cc by; article states CC BY 4.0",
    },
}

cells = {
    "id": "livecell",
    "title": "Unstained cells: live-cell segmentation",
    "input_label": "DIC",
    "text": "One DIC image of unstained CHO cells from a public benchmark. Each cell is segmented by spaCR's "
            "live-cell model from the transmitted-light image alone, with no stain. This field was held out "
            "from training.",
    "base": "livecell-raw.webp",
    "alt": "Greyscale DIC image of round, scattered CHO cells on a flat grey background",
    "width": c["size"][0],
    "height": c["size"][1],
    "classes": [{
        "name": "Cells",
        "color": "#FF00FF",
        "count": c["count"],
        "layer": "livecell-cells.webp",
        "model": {
            "display": "live-cell-v1 (Cellpose-SAM, phase, brightfield, DIC)",
            "url": CELL_REPO,
            "note": "Model card: test F1 0.960 against 0.885 for stock Cellpose-SAM on datasets stock never saw; "
                    "0.913 against 0.872 on the 12 test fields of this dataset. "
                    f"{c['reference_count']} cells in the reference mask; F1 {c['f1_at_iou_0_5']:.3f} at IoU 0.5 on this field",
        },
    }],
    "facts": [
        ["Input", "DIC (differential interference contrast), greyscale"],
        ["Image", "BBBC030 (Koos K, et al. Sci Rep 2016), field cho07, test split", "https://bbbc.broadinstitute.org/BBBC030"],
        ["Licence", "CC BY 3.0 (Peter Horvath and Krisztián Koós)", "https://creativecommons.org/licenses/by/3.0/"],
        ["Size", f"{c['shape'][1]} × {c['shape'][0]} px, shown at {c['size'][0]} px"],
        ["Training data", "Field held out; other BBBC030 fields were in training",
         f"{CELL_REPO}/blob/main/training/splits.csv"],
    ],
    "record": {
        "model": "live-cell-v1",
        "weights_url": CELL_REPO,
        "weights_sha256": c["sha256"],
        "zoo_sha256_match": True,
        "settings": dict(c["settings"], channels="single greyscale channel (2-D)",
                         input_dtype="float32 of the uint8 values; cellpose percentile normalisation"),
        "runtime_s": c["seconds"],
        "device": "CPU, fp32 (use_bfloat16=False, gpu=False), 16 torch threads",
        "cellpose": version("cellpose"),
        "torch": version("torch"),
        "source": "einarolafsson/live-cell-segmentation-dataset images/bbbc030_dic/bbbc030_dic__cho07.tif "
                  "(BBBC030v1 image cho07.png; the three PNG channels are identical, channel 0 used)",
        "source_dataset_url": "https://huggingface.co/datasets/einarolafsson/live-cell-segmentation-dataset",
        "citation": "Koos K, et al. DIC image reconstruction on large cell scans. "
                    "Sci Rep 6, 30420 (2016); image set BBBC030v1 of the Broad Bioimage Benchmark Collection "
                    "(Ljosa V, Sokolnicki KL, Carpenter AE. Nat Methods 9, 637 (2012))",
        "native_px": [c["shape"][1], c["shape"][0]],
        "display_scale": round(c["scale"], 4),
        "crop": "none; the whole 1376 × 1032 field was run",
        "split": "test (acquisition-grouped split; group cho07 is test only)",
        "outline": "#FF00FF inner boundaries computed on the label image resized with nearest neighbour, "
                   "thickened to 2 px (render.py outline_layer)",
        "raw_stretch": "1st-99.8th percentile, greyscale",
        "raw_webp_bytes": c["raw_webp_bytes"],
        "reference_check": dict(reference="dataset mask masks/bbbc030_dic/bbbc030_dic__cho07.tif",
                                reference_count=c["reference_count"], predicted=c["count"], tp=c["tp"], fp=c["fp"],
                                fn=c["fn"], f1_at_iou_0_5=c["f1_at_iou_0_5"],
                                note="single-field sanity check, not a benchmark. The model card's per-field test "
                                     "score for this field is F1 0.947 with 20 predictions, from the GPU evaluation; "
                                     "this CPU fp32 run gives 21"),
        "licence_check": "bbbc.broadinstitute.org/BBBC030: 'The BBBC030v1 image set are licensed under a Creative "
                         "Commons Attribution 3.0 Unported License by Peter Horvath and Krisztián Koós'",
    },
}

doc = {"generated": "2026-10-12", "note": "CPU only; weights from the public Hugging Face repos, sha256 checked against spaCR's model zoo",
       "figures": [wells, cells]}
txt = json.dumps(doc, indent=1, ensure_ascii=False)
for bad in ["cellposetime", "thumbscrew", "haemocytometer", "live_cell_v1", "fine-tun", "incucyte", "livecell-style", "timepose"]:
    assert bad not in txt.lower(), bad
(ROOT / "examples.json").write_text(txt + "\n")
print(txt)
