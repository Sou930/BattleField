#!/usr/bin/env python3
"""Re-encode WebP textures at a high quality and keep the result only when it
is both (a) smaller than the original and (b) visually indistinguishable from
it (SSIM above a strict threshold). Resolution is never reduced, so surface
detail / sharpness is preserved — we only squeeze out wasted bits from the
existing encode.

Usage:
    python scripts/optimize_textures.py            # dry-run report
    python scripts/optimize_textures.py --apply    # overwrite files in place
"""
import os
import sys
import io
import glob
import tempfile
import numpy as np
from PIL import Image

# Strict perceptual gate. SSIM of 1.0 == identical. We require >= this so the
# re-encode is visually indistinguishable. Files that cannot meet it at any
# tried quality are left untouched.
#
# NOTE: normal maps (`_nor_gl`) and roughness maps (`_rough`) encode geometric
# data in their channels, where even small perceptual deltas can shift lighting
# in ways a luminance-based SSIM does not capture. To stay strictly lossless in
# *appearance*, we only re-encode colour (diffuse) and alpha textures and leave
# the data maps byte-for-byte untouched.
SSIM_THRESHOLD = 0.995
# Substrings that mark a texture as a "data" map we must not touch.
DATA_MAP_MARKERS = ("_nor_", "_rough", "nor_gl", "roughness", "normal")
# Minimum saving (bytes) to bother rewriting a file.
MIN_SAVING_BYTES = 1024
# Quality ladder: try highest first; accept the smallest that passes SSIM.
QUALITIES = [92, 90, 88, 86, 84, 82, 80]

ASSET_GLOBS = [
    "src/assets/*.webp",
    "src/assets/new/*.webp",
]


def _to_gray(arr: np.ndarray) -> np.ndarray:
    if arr.ndim == 2:
        return arr.astype(np.float64)
    # luminance
    return (arr[..., :3] @ np.array([0.299, 0.587, 0.114])).astype(np.float64)


def ssim(a: np.ndarray, b: np.ndarray) -> float:
    """Global SSIM (single-window) — good enough as a gate for full images."""
    a = _to_gray(a)
    b = _to_gray(b)
    C1 = (0.01 * 255) ** 2
    C2 = (0.03 * 255) ** 2
    mu_a, mu_b = a.mean(), b.mean()
    va, vb = a.var(), b.var()
    cov = ((a - mu_a) * (b - mu_b)).mean()
    return ((2 * mu_a * mu_b + C1) * (2 * cov + C2)) / (
        (mu_a ** 2 + mu_b ** 2 + C1) * (va + vb + C2)
    )


def encode_webp(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality, method=6)
    return buf.getvalue()


def process(path: str, apply: bool) -> dict:
    orig_bytes = os.path.getsize(path)
    img = Image.open(path)
    has_alpha = img.mode in ("RGBA", "LA") or (
        img.mode == "P" and "transparency" in img.info
    )
    base = img.convert("RGBA" if has_alpha else "RGB")
    ref = np.asarray(base.convert("RGB"), dtype=np.float64)

    best = None
    for q in QUALITIES:
        data = encode_webp(base, q)
        if len(data) >= orig_bytes - MIN_SAVING_BYTES:
            # Not smaller enough at this quality; lower quality will be smaller,
            # keep trying.
            cand = Image.open(io.BytesIO(data)).convert("RGB")
            s = ssim(ref, np.asarray(cand, dtype=np.float64))
            # Even if not smaller, record for reporting of the highest q.
            if best is None:
                best = (q, len(data), s, data)
            continue
        cand = Image.open(io.BytesIO(data)).convert("RGB")
        s = ssim(ref, np.asarray(cand, dtype=np.float64))
        if s >= SSIM_THRESHOLD:
            best = (q, len(data), s, data)
            break
        else:
            # Quality too low perceptually; stop lowering further.
            best = (q, len(data), s, data)
            break

    if best is None:
        return {"path": path, "orig": orig_bytes, "status": "skip"}

    q, new_size, s, data = best
    saving = orig_bytes - new_size
    accept = saving >= MIN_SAVING_BYTES and s >= SSIM_THRESHOLD
    result = {
        "path": path,
        "orig": orig_bytes,
        "new": new_size,
        "q": q,
        "ssim": s,
        "saving": saving,
        "accept": accept,
    }
    if accept and apply:
        with open(path, "wb") as f:
            f.write(data)
        result["applied"] = True
    return result


def main():
    apply = "--apply" in sys.argv
    files = []
    for g in ASSET_GLOBS:
        files.extend(sorted(glob.glob(g)))

    total_orig = total_new = 0
    print(f"{'STATUS':<8}{'q':>4}{'SSIM':>8}{'orig':>10}{'new':>10}{'save':>9}  file")
    for path in files:
        base = os.path.basename(path).lower()
        if any(m in base for m in DATA_MAP_MARKERS):
            sz = os.path.getsize(path)
            print(f"{'DATA':<8}{'-':>4}{'-':>8}{sz:>10}{'-':>10}{'-':>9}  {path}")
            total_orig += sz
            total_new += sz
            continue
        r = process(path, apply)
        if r.get("status") == "skip":
            print(f"{'SKIP':<8}{'-':>4}{'-':>8}{r['orig']:>10}{'-':>10}{'-':>9}  {path}")
            total_orig += r["orig"]
            total_new += r["orig"]
            continue
        status = "ACCEPT" if r["accept"] else "keep"
        used_new = r["new"] if r["accept"] else r["orig"]
        total_orig += r["orig"]
        total_new += used_new
        print(
            f"{status:<8}{r['q']:>4}{r['ssim']:>8.4f}{r['orig']:>10}{r['new']:>10}{r['saving']:>9}  {path}"
        )
    print("-" * 70)
    print(
        f"TOTAL  orig={total_orig/1024:.1f}KB  new={total_new/1024:.1f}KB  "
        f"saving={(total_orig-total_new)/1024:.1f}KB "
        f"({100*(total_orig-total_new)/total_orig:.1f}%)  "
        f"{'(APPLIED)' if apply else '(dry-run)'}"
    )


if __name__ == "__main__":
    main()
