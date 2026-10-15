"""Regenerate the parity fixtures for tools/mask-core.test.mjs and
tools/mask-package.test.mjs from the REAL Python implementations
(cellpose 4.2.1.1, scikit-image, ultralytics, spaCR).

Regenerate (from the site repository root, CPU only):

    CUDA_VISIBLE_DEVICES='' PYTHONPATH=/path/to/spacr \
        python tools/fixtures/mask/make_fixtures.py

Verify a ZIP produced by the JavaScript packager (the package test writes
one when MASK_JS_ZIP_OUT is set):

    MASK_JS_ZIP_OUT=/tmp/js-zips node --test tools/mask-package.test.mjs
    PYTHONPATH=/path/to/spacr python tools/fixtures/mask/make_fixtures.py \
        --verify-js-zip /tmp/js-zips

Inputs that JavaScript must reproduce bit-for-bit are built from integer
formulas (hash_u32 below, mirrored in tools/fixtures/mask/helpers.mjs) or stored as
small .npy(.gz) files. Every expected output comes from the Python libraries.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import shutil
import sys
import tempfile
import types
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent


def hash_u32(n, seed):
    """Deterministic uint32 stream, mirrored exactly in JavaScript."""
    i = np.arange(n, dtype=np.uint64)
    x = (i * np.uint64(2654435761) + np.uint64(seed * 40503)) & np.uint64(0xFFFFFFFF)
    x ^= x >> np.uint64(15)
    x = (x * np.uint64(2246822519)) & np.uint64(0xFFFFFFFF)
    x ^= x >> np.uint64(13)
    return x.astype(np.uint32)


def unit_f32(n, seed):
    return (hash_u32(n, seed).astype(np.float64) / 4294967296.0).astype(np.float32)


def save(name, array, gz=False):
    path = HERE / (name + (".npy.gz" if gz else ".npy"))
    buffer = io.BytesIO()
    np.save(buffer, np.ascontiguousarray(array), allow_pickle=False)
    data = buffer.getvalue()
    if gz:
        data = gzip.compress(data, mtime=0)
    path.write_bytes(data)
    return path.name


def ellipse_labels(H, W, specs):
    yy, xx = np.mgrid[0:H, 0:W]
    labels = np.zeros((H, W), np.int32)
    for k, (cy, cx, ry, rx, angle) in enumerate(specs, start=1):
        c, s = np.cos(angle), np.sin(angle)
        u = ((yy - cy) * c + (xx - cx) * s) / ry
        v = (-(yy - cy) * s + (xx - cx) * c) / rx
        labels[(u * u + v * v) <= 1.0] = k
    return labels


def dynamics_case(name, labels, seed, *, rotate=(), hole=None, small=None):
    import torch
    from cellpose import dynamics
    H, W = labels.shape
    mu, _ = dynamics.masks_to_flows_gpu(labels.astype(np.int32), device=torch.device("cpu"))
    dP = mu * 5.0
    for label in rotate:
        sel = labels == label
        dy, dx = dP[0][sel].copy(), dP[1][sel].copy()
        dP[0][sel], dP[1][sel] = dx, -dy
    noise = unit_f32(2 * H * W, seed).reshape(2, H, W).astype(np.float64) - 0.5
    dPq = np.round((dP + 0.6 * noise) * 256).astype(np.int16)
    fg = labels > 0
    if hole is not None:
        cy, cx, r = hole
        yy, xx = np.mgrid[0:H, 0:W]
        fg = fg & (((yy - cy) ** 2 + (xx - cx) ** 2) > r * r)
    if small is not None:
        y0, x0, y1, x1 = small
        fg[y0:y1, x0:x1] = True
    cnoise = unit_f32(H * W, seed + 1).reshape(H, W).astype(np.float64) - 0.5
    cpq = np.round((np.where(fg, 4.0, -4.0) + 2.0 * cnoise) * 256).astype(np.int16)
    dP32 = dPq.astype(np.float32) / np.float32(256)
    cp32 = cpq.astype(np.float32) / np.float32(256)
    ref = dynamics.compute_masks(dP32, cp32, niter=200, cellprob_threshold=0.0,
                                 flow_threshold=0.4, min_size=15, device=torch.device("cpu"))
    ref_noflow = dynamics.compute_masks(dP32, cp32, niter=200, cellprob_threshold=0.0,
                                        flow_threshold=0.0, min_size=-1, device=torch.device("cpu"))
    return {
        "name": name, "H": H, "W": W,
        "dP_q256": save(f"dyn_{name}_dP_q256", dPq, gz=True),
        "cellprob_q256": save(f"dyn_{name}_cellprob_q256", cpq, gz=True),
        "masks": save(f"dyn_{name}_masks", ref.astype(np.uint32), gz=True),
        "masks_noflow_nomin": save(f"dyn_{name}_masks_noflow", ref_noflow.astype(np.uint32), gz=True),
        "labels": int(ref.max()), "labels_noflow": int(ref_noflow.max()),
    }


def dynamics_fixtures():
    cases = []
    a = ellipse_labels(96, 112, [
        (24, 25, 14, 10, 0.3), (30, 47, 12, 13, 1.0), (60, 30, 16, 11, -0.4),
        (66, 62, 13, 18, 0.2), (28, 86, 15, 12, 0.7), (76, 94, 12, 9, 1.4),
        (48, 70, 9, 8, 0.0)])
    cases.append(dynamics_case("touching", a, 11, hole=(60, 30, 3)))
    b = ellipse_labels(64, 80, [(20, 20, 12, 10, 0.2), (40, 52, 13, 14, 0.9), (48, 18, 8, 9, 0.0)])
    cases.append(dynamics_case("flowbad", b, 23, rotate=(2,), small=(5, 60, 8, 64)))
    c = np.zeros((32, 40), np.int32)
    cases.append(dynamics_case("empty", c, 31))
    return cases


class FakeNet:
    """A torch module standing in for Cellpose-SAM: finite differences of
    channel 0 within each tile give the flows, an affine map the cell score."""

    def __init__(self):
        import torch
        self.device = torch.device("cpu")
        self.dtype = torch.float32

    def eval(self):
        return self

    def __call__(self, x):
        import torch
        x0 = x[:, 0]
        y = torch.zeros((x.shape[0], 3, x.shape[2], x.shape[3]), dtype=torch.float32)
        y[:, 0, 1:-1, :] = (x0[:, 2:, :] - x0[:, :-2, :]) * 40.0
        y[:, 1, :, 1:-1] = (x0[:, :, 2:] - x0[:, :, :-2]) * 40.0
        score = (x0 - 0.25) * 8.0
        if x.shape[1] > 1:
            score = score + x[:, 1] * 0.25
        if x.shape[1] > 2:
            score = score - x[:, 2] * 0.5
        y[:, 2] = score
        return y, torch.zeros((x.shape[0], 256), dtype=torch.float32)


def blob_image(H, W, seed, n=14):
    """uint16 paraboloid blobs from integers only (mirrored in JavaScript)."""
    h = hash_u32(4 * n, seed).astype(np.int64)
    img = np.zeros((H, W), np.int64)
    yy, xx = np.mgrid[0:H, 0:W]
    for k in range(n):
        cy = int(h[4 * k] % (H - 20)) + 10
        cx = int(h[4 * k + 1] % (W - 20)) + 10
        r = int(h[4 * k + 2] % 9) + 8
        a = int(h[4 * k + 3] % 40) + 20
        val = (r * r - (yy - cy) ** 2 - (xx - cx) ** 2) * a
        img = np.maximum(img, val)
    noise = hash_u32(H * W, seed + 5).astype(np.int64).reshape(H, W) % 50
    return (img + noise + 100).astype(np.uint16)


def tiling_fixtures():
    from cellpose import core
    out = []
    for name, (C, H, W, seed) in {"c3_300x410": (3, 300, 410, 7), "c1_260x270": (1, 260, 270, 8),
                                  "c2_100x140": (2, 100, 140, 9)}.items():
        img = unit_f32(C * H * W, seed).reshape(C, H, W)
        yf, _ = core.run_net(FakeNet(), img.transpose(1, 2, 0)[None], bsize=256, batch_size=8, tile_overlap=0.1)
        yf = yf[0]
        out.append({"name": name, "C": C, "H": H, "W": W, "seed": seed,
                    "sub": save(f"tile_{name}_sub9", yf[::9, ::9].transpose(2, 0, 1).astype(np.float32), gz=True),
                    "sums": [float(yf[..., k].astype(np.float64).sum()) for k in range(3)],
                    "absmax": [float(np.abs(yf[..., k]).max()) for k in range(3)]})
    return out


def eval_fixtures():
    import torch
    from cellpose import models
    model = object.__new__(models.CellposeModel)
    model.net = FakeNet()
    model.backbone = "sam_vitl"
    model.device = torch.device("cpu")
    H, W = 230, 270
    img = blob_image(H, W, 3)
    import hashlib
    image_sha = hashlib.sha256(np.ascontiguousarray(img).tobytes()).hexdigest()
    cases = []
    for name, kwargs in {"plain": {}, "diam45": {"diameter": 45.0},
                         "diam20_noresample": {"diameter": 20.0, "resample": False}}.items():
        masks, flows, _ = model.eval(img, **kwargs)
        dP, cellprob = flows[1], flows[2]
        cases.append({"name": name, "kwargs": kwargs,
                      "masks": save(f"eval_{name}_masks", masks.astype(np.uint32), gz=True),
                      "labels": int(masks.max()), "flow_shape": list(cellprob.shape),
                      "dP_sums": [float(dP[k].astype(np.float64).sum()) for k in range(2)],
                      "cellprob_sum": float(cellprob.astype(np.float64).sum()),
                      "cellprob_sub": save(f"eval_{name}_cellprob_sub7", cellprob[::7, ::7].astype(np.float32), gz=True)})
    return {"H": H, "W": W, "seed": 3, "image_sha256": image_sha, "cases": cases}


def transform_fixtures():
    import cv2
    from cellpose import transforms
    out = {}
    x = (unit_f32(40 * 50, 41).reshape(40, 50) * 1000 - 200).astype(np.float32)
    out["normalize99"] = {"seed": 41, "H": 40, "W": 50, "scale": 1000, "offset": -200,
                          "expected": save("norm99_expected", transforms.normalize99(x, 1, 99), gz=True),
                          "expected_5_95": save("norm99_5_95_expected", transforms.normalize99(x, 5, 95), gz=True)}
    img3 = unit_f32(37 * 53 * 3, 42).reshape(37, 53, 3).astype(np.float32)
    img3[..., 2] = 0.5
    out["normalize_img"] = save("normimg_expected", transforms.normalize_img(img3.copy(), axis=-1).transpose(2, 0, 1), gz=True)
    rs = {}
    for (nh, nw) in [(50, 71), (18, 26), (37, 53), (61, 83), (12, 19)]:
        r = transforms.resize_image(img3, nh, nw)
        rs[f"{nh}x{nw}"] = save(f"resize_{nh}x{nw}", r.transpose(2, 0, 1).astype(np.float32), gz=True)
    even = unit_f32(40 * 50, 43).reshape(40, 50).astype(np.float32)
    rs["area_20x25"] = save("resize_area_20x25", cv2.resize(even, (25, 20), interpolation=cv2.INTER_LINEAR), gz=True)
    out["resize"] = rs
    labels = (hash_u32(29 * 31, 44) % 7).reshape(29, 31).astype(np.uint16)
    out["nearest"] = {"src": save("nearest_src", labels, gz=True),
                      "up": save("nearest_up_61x47", transforms.resize_image(labels, 61, 47, no_channels=True, interpolation=cv2.INTER_NEAREST).astype(np.uint32), gz=True),
                      "down": save("nearest_down_13x11", transforms.resize_image(labels, 13, 11, no_channels=True, interpolation=cv2.INTER_NEAREST).astype(np.uint32), gz=True)}
    return out


def spacr_normalize_fixtures():
    from spacr.io import _normalize_img_batch
    cases = []
    u16 = (hash_u32(40 * 50, 51) % 3000).reshape(40, 50).astype(np.uint16)
    f32 = (unit_f32(40 * 50, 52).reshape(40, 50) * 900).astype(np.float32)
    f32[f32 < 50] = 0
    variants = [
        ("u16_plain", u16, {"background": 100, "Signal_to_noise": 10, "remove_background": False, "lower_percentile": 2}),
        ("u16_rmbg", u16, {"background": 400, "Signal_to_noise": 5, "remove_background": True, "lower_percentile": 1}),
        ("u16_fallback", u16, {"background": 1000, "Signal_to_noise": 10, "remove_background": False, "lower_percentile": 2}),
        ("f32_plain", f32, {"background": 50, "Signal_to_noise": 3, "remove_background": True, "lower_percentile": 2}),
        ("f32_fallback", f32, {"background": 100, "Signal_to_noise": 100, "remove_background": False, "lower_percentile": 2.5}),
    ]
    save("spnorm_u16_input", u16, gz=True)
    save("spnorm_f32_input", f32, gz=True)
    for name, data, settings in variants:
        batch = data[None, ..., None].copy()
        result = _normalize_img_batch(batch, [0], np.float32, dict(settings))[0, ..., 0]
        cases.append({"name": name, "input": "spnorm_u16_input.npy.gz" if data.dtype == np.uint16 else "spnorm_f32_input.npy.gz",
                      "settings": settings, "expected": save(f"spnorm_{name}", result.astype(np.float32), gz=True)})
    return cases


def package_inputs():
    H, W = 12, 15
    yx = (hash_u32(H * W, 61) % 4000).reshape(H, W).astype(np.uint16)
    cyx = (hash_u32(3 * H * W, 62) % 256).reshape(3, H, W).astype(np.uint8)
    f32 = (unit_f32(H * W, 63).reshape(H, W) * 3.7).astype(np.float32)
    masks = np.zeros((H, W), np.uint32)
    masks[1:5, 1:6] = 1
    masks[6:11, 2:9] = 2
    masks[2:9, 10:14] = 5
    masks[0, 14] = 7
    flows = (unit_f32(2 * H * W, 64).reshape(2, H, W) - 0.5).astype(np.float32)
    cellprob = ((unit_f32(H * W, 65).reshape(H, W) - 0.5) * 12).astype(np.float32)
    return H, W, yx, cyx, f32, masks, flows, cellprob


MODEL = {"id": "toxoplasma_pv_v3", "version": "3.0.0", "weights_sha256": "ab" * 32}
SETTINGS = {"diameter": 30, "flow_threshold": 0.4, "cellprob_threshold": 0.0, "nested": {"b": [1, 2.5, "x"], "a": True}}


def package_fixtures(scratch):
    from tools.web_mask_generator import results as results_module
    H, W, yx, cyx, f32, masks, flows, cellprob = package_inputs()
    save("pkg_yx_u16", yx)
    save("pkg_cyx_u8", cyx)
    save("pkg_yx_f32", f32)
    save("pkg_masks", masks)
    save("pkg_flows", flows)
    save("pkg_cellprob", cellprob)
    upload = scratch / "upload image.tif"
    upload.write_bytes(b"II*\x00uploaded-bytes")
    out = {"H": H, "W": W, "cases": []}
    for name, image, axes in (("yx_u16", yx, "YX"), ("cyx_u8", cyx, "CYX"), ("yx_f32", f32, "YX")):
        dest = scratch / f"{name}.zip"
        results_module.build_result_zip(dest, input_file=upload, image=image, masks=masks, image_axes=axes,
                                        model_id=MODEL["id"], model_version=MODEL["version"],
                                        weights_sha256=MODEL["weights_sha256"], settings=SETTINGS,
                                        flows=flows, cell_probability=cellprob, probability_kind="logits")
        with zipfile.ZipFile(dest) as archive:
            names = archive.namelist()
            csv = archive.read("objects.csv").decode("utf-8")
            manifest = json.loads(archive.read("manifest.json"))
            readme = archive.read("README.txt").decode("utf-8")
            (HERE / f"pkg_{name}_objects.csv").write_text(csv, encoding="utf-8", newline="")
            (HERE / "pkg_flows_expected.npy").write_bytes(archive.read("flows.npy"))
            (HERE / "pkg_cellprob_expected.npy").write_bytes(archive.read("cell_probability.npy"))
        out["cases"].append({"name": name, "axes": axes, "names": names, "manifest": manifest})
    out["readme"] = readme
    empty = scratch / "empty.zip"
    results_module.build_result_zip(empty, input_file=upload, image=yx, masks=np.zeros_like(masks), image_axes="YX",
                                    model_id=MODEL["id"], model_version=MODEL["version"],
                                    weights_sha256=MODEL["weights_sha256"], settings={},
                                    unavailable={"flows": "none", "cell_probability": "none"})
    with zipfile.ZipFile(empty) as archive:
        (HERE / "pkg_empty_objects.csv").write_bytes(archive.read("objects.csv"))
        out["empty_manifest"] = json.loads(archive.read("manifest.json"))
        out["empty_names"] = archive.namelist()
    return out


def csv_format_fixture(scratch):
    import pandas as pd
    from spacr.tabular import write_table
    values = [0.0, -0.0, 1.0, 12.5, 0.1, 1 / 3, 1e-5, 0.0001, 1e16, 1.5e16, 123456789012345.67, 1e22, 2.5e-7,
              -3.75, 5e-324, 1.7976931348623157e308, float("nan"), 100.0, 0.30000000000000004]
    f32 = np.array([0.1, 1 / 3, 12.5, 1e-5, 3.4e38, 0.0, 7.0, float("nan"), 0.00012345], np.float32)
    frame = pd.DataFrame({"label": np.arange(len(values), dtype=np.uint32), "value": values,
                          "f32": np.resize(f32, len(values)), "text": ["a", "b,c", 'q"t', "", "x\ny"] + ["z"] * (len(values) - 5),
                          "flag": [True, False] * (len(values) // 2) + [True]})
    path = scratch / "fmt.csv"
    write_table(frame, path)
    (HERE / "csv_format_expected.csv").write_bytes(path.read_bytes())
    return {"values": [None if v != v else v for v in values], "f32": [None if v != v else float(v) for v in np.resize(f32, len(values))],
            "text": frame["text"].tolist(), "flag": frame["flag"].tolist()}


class _Box:
    def __init__(self, row):
        import torch
        self.xyxy = torch.tensor(row[None, :4])
        self.conf = torch.tensor(row[4:5])


def yolo_fixtures():
    import torch
    import cv2
    from ultralytics.utils import nms, ops
    from ultralytics.data.augment import LetterBox
    import spacr.plaque as plaque
    cases = []
    for name, nc, N, (H, W), (h1, w1) in (("wells_1c", 1, 600, (1000, 1500), (448, 640)),
                                          ("two_class", 2, 400, (480, 600), (512, 640))):
        u = unit_f32(N * (4 + nc), 71 + nc).reshape(4 + nc, N).astype(np.float64)
        pred = np.zeros((4 + nc, N), np.float32)
        centres = [(80, 90), (80, 300), (250, 95), (250, 310), (400, 500), (120, 560)]
        for i in range(N):
            cy, cx = centres[i % len(centres)]
            pred[0, i] = cx + (u[0, i] - 0.5) * 30
            pred[1, i] = cy + (u[1, i] - 0.5) * 30
            side = 70 + u[2, i] * 30
            pred[2, i] = side * (1.0 if i % 13 else 1.8)
            pred[3, i] = side + (u[3, i] - 0.5) * 12
            for c in range(nc):
                pred[4 + c, i] = u[4 + c, i] ** 3
        save(f"yolo_{name}_pred", pred)
        out = nms.non_max_suppression(torch.from_numpy(pred[None].copy()), conf_thres=0.25, iou_thres=0.7,
                                      agnostic=False, max_det=300)[0]
        boxes = out.clone()
        boxes[:, :4] = ops.scale_boxes((h1, w1), boxes[:, :4], (H, W))
        detections = boxes.numpy().astype(np.float64)
        fake_results = [types.SimpleNamespace(boxes=[_Box(row) for row in boxes.numpy()])]
        fake_model = types.SimpleNamespace(predict=lambda **kwargs: fake_results)
        original = plaque._load_detector
        plaque._load_detector = lambda weights: fake_model
        try:
            wells = plaque.detect_wells(np.zeros((H, W, 3), np.uint8), "fake.pt", min_axis_ratio=0.7)
        finally:
            plaque._load_detector = original
        cases.append({"name": name, "nc": nc, "N": N, "H": H, "W": W, "inputHeight": h1, "inputWidth": w1,
                      "pred": f"yolo_{name}_pred.npy", "detections": detections.tolist(),
                      "wells": [w.as_dict() for w in wells]})
    lb = []
    for (H, W, C, size) in ((30, 42, 3, 64), (37, 53, 1, 64), (1000, 700, 3, 640), (480, 600, 3, 640), (333, 1000, 3, 640)):
        img = (hash_u32(H * W * C, 81 + H) % 256).astype(np.uint8).reshape(H, W, C)
        auto = LetterBox(new_shape=(size, size), auto=True, stride=32)(image=img if C == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR))
        square = LetterBox(new_shape=(size, size), auto=False)(image=img if C == 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR))
        lb.append({"H": H, "W": W, "C": C, "size": size, "seed": 81 + H,
                   "auto_sha256": hashlib.sha256(np.ascontiguousarray(auto).tobytes()).hexdigest(), "auto_shape": list(auto.shape),
                   "square_sha256": hashlib.sha256(np.ascontiguousarray(square).tobytes()).hexdigest(), "square_shape": list(square.shape),
                   "auto_sum": int(auto.astype(np.int64).sum()), "square_sum": int(square.astype(np.int64).sum())})
    return {"cases": cases, "letterbox": lb}


def detection_package_fixture(scratch):
    from spacr.plaque import Well
    from tools.web_mask_generator import detector
    H, W, yx, cyx, *_ = package_inputs()
    upload = scratch / "plate.png"
    upload.write_bytes(b"\x89PNG-fake-bytes")
    wells = [Well(1, 2, 9, 10, 0.8999999761581421), Well(3, 0, 14, 11, 0.5)]
    dest = scratch / "det.zip"
    detector.build_well_result_zip(dest, input_file=upload, image=cyx, image_axes="CYX", wells=wells,
                                   model_id="toxoplasma_well_detector_v2", model_version="2",
                                   weights_sha256="cd" * 32, settings={"confidence": 0.25, "imgsz": 640, "min_axis_ratio": 0.7})
    with zipfile.ZipFile(dest) as archive:
        (HERE / "det_objects.csv").write_bytes(archive.read("objects.csv"))
        (HERE / "det_boxes.json").write_bytes(archive.read("boxes.json"))
        (HERE / "det_README.txt").write_bytes(archive.read("README.txt"))
        manifest = json.loads(archive.read("manifest.json"))
        names = archive.namelist()
    return {"wells": [w.as_dict() for w in wells], "manifest": manifest, "names": names}


def verify_js_zips(directory):
    import hashlib
    import tifffile
    H, W, yx, cyx, f32, masks, flows, cellprob = package_inputs()
    images = {"yx_u16": yx, "cyx_u8": cyx, "yx_f32": f32}
    expected = json.loads((HERE / "fixtures.json").read_text())
    report = []
    for case in expected["package"]["cases"]:
        path = Path(directory) / f"{case['name']}.zip"
        with zipfile.ZipFile(path) as archive:
            assert archive.testzip() is None, path
            names = sorted(archive.namelist())
            assert names == sorted(case["names"]), (names, case["names"])
            manifest = json.loads(archive.read("manifest.json"))
            assert set(manifest) == set(case["manifest"]) | {"backend"}, set(manifest) ^ set(case["manifest"])
            for key in ("schema_version", "model", "settings", "image_axes", "shape_yx", "object_count",
                        "measurements", "outputs", "unavailable"):
                assert manifest[key] == case["manifest"][key], key
            assert set(manifest["files"]) == set(case["manifest"]["files"])
            for file_name, info in manifest["files"].items():
                data = archive.read(file_name)
                assert hashlib.sha256(data).hexdigest() == info["sha256"] and len(data) == info["bytes"], file_name
            image = tifffile.imread(io.BytesIO(archive.read("image.tif")))
            assert image.dtype == images[case["name"]].dtype and np.array_equal(image, images[case["name"]]), case["name"]
            mask = tifffile.imread(io.BytesIO(archive.read("mask.tif")))
            assert mask.dtype == np.uint32 and np.array_equal(mask, masks)
            with tifffile.TiffFile(io.BytesIO(archive.read("image.tif"))) as tif:
                assert tif.series[0].axes == case["axes"], tif.series[0].axes
            assert np.array_equal(np.load(io.BytesIO(archive.read("flows.npy")), allow_pickle=False), flows)
            assert np.array_equal(np.load(io.BytesIO(archive.read("cell_probability.npy")), allow_pickle=False), cellprob)
            assert archive.read("objects.csv") == (HERE / f"pkg_{case['name']}_objects.csv").read_bytes()
            methods = sorted({info.compress_type for info in archive.infolist()})
        report.append(f"{path.name}: OK ({len(names)} entries, methods {methods})")
    det = Path(directory) / "detection.zip"
    if det.exists():
        with zipfile.ZipFile(det) as archive:
            assert archive.testzip() is None
            assert sorted(archive.namelist()) == sorted(expected["detection_package"]["names"])
            assert archive.read("objects.csv") == (HERE / "det_objects.csv").read_bytes()
            assert archive.read("boxes.json") == (HERE / "det_boxes.json").read_bytes()
            image = tifffile.imread(io.BytesIO(archive.read("image.tif")))
            assert np.array_equal(image, cyx)
            manifest = json.loads(archive.read("manifest.json"))
            assert set(manifest) == set(expected["detection_package"]["manifest"]) | {"backend"}
        report.append("detection.zip: OK")
    print("\n".join(report))


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--verify-js-zip", metavar="DIR")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    if args.verify_js_zip:
        verify_js_zips(args.verify_js_zip)
        return
    for old in HERE.glob("*.npy*"):
        old.unlink()
    with tempfile.TemporaryDirectory(prefix="mask-fixtures-") as temporary:
        scratch = Path(temporary)
        fixtures = {
            "dynamics": dynamics_fixtures(),
            "tiling": tiling_fixtures(),
            "eval": eval_fixtures(),
            "transforms": transform_fixtures(),
            "spacr_normalize": spacr_normalize_fixtures(),
            "package": package_fixtures(scratch),
            "csv_format": csv_format_fixture(scratch),
            "yolo": yolo_fixtures(),
            "detection_package": detection_package_fixture(scratch),
            "spacr_version": __import__("spacr").__version__,
        }
    (HERE / "fixtures.json").write_text(json.dumps(fixtures, separators=(",", ":")) + "\n")
    total = sum(p.stat().st_size for p in HERE.iterdir() if p.is_file())
    print(f"fixtures written to {HERE.relative_to(root)} ({total / 1024:.1f} KiB)")


if __name__ == "__main__":
    sys.exit(main())
