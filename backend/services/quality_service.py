"""Document image quality scoring.

Five sub-metrics, all on 0–100 (higher = better), combined into a composite score.
The metrics are picked specifically for *historical document* scans:

- sharpness    : Laplacian variance — penalises blur, motion, defocus.
- contrast     : pixel std-dev — penalises low-contrast scans (faded ink, sun-bleached).
- noise        : flat-region high-frequency content — penalises grain / paper texture.
- brightness   : luminance distance from mid-gray — penalises over/under-exposure.
- skew         : median text-line angle from horizontal — penalises tilted scans.

Each metric is normalised against pragmatic thresholds tuned for archival scans;
they aren't psychophysical — they're meant to give a useful before/after delta.
"""
from pathlib import Path

import numpy as np
import cv2


def _read_grayscale(image_path: str) -> np.ndarray:
    if not image_path or not Path(image_path).is_file():
        raise FileNotFoundError(image_path)
    img = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        # Fall back to PIL for formats OpenCV can't read directly
        from PIL import Image as PILImage
        pil = PILImage.open(image_path).convert("L")
        img = np.array(pil)
    return img


def _sharpness(gray: np.ndarray) -> tuple[float, float]:
    raw = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    # Empirical: blurry < 50, decent 100-300, sharp > 500
    norm = float(np.clip(raw / 5.0, 0, 100))
    return norm, raw


def _contrast(gray: np.ndarray) -> tuple[float, float]:
    raw = float(gray.std())
    norm = float(np.clip(raw / 0.8, 0, 100))
    return norm, raw


def _noise(gray: np.ndarray) -> tuple[float, float]:
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    diff = cv2.absdiff(gray, blurred)
    edges = cv2.Canny(gray, 50, 150)
    edge_mask = cv2.dilate(edges, np.ones((3, 3), np.uint8))
    flat = diff[edge_mask == 0]
    raw = float(flat.mean()) if flat.size else 0.0
    # 0–5 = clean, 10+ = noisy
    norm = float(np.clip(100 - raw * 5, 0, 100))
    return norm, raw


def _brightness(gray: np.ndarray) -> tuple[float, float]:
    raw = float(gray.mean())
    deviation = abs(raw - 128)
    norm = float(np.clip(100 - deviation * 1.5, 0, 100))
    return norm, raw


def _skew(gray: np.ndarray) -> tuple[float, float]:
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, 100, minLineLength=100, maxLineGap=10)
    if lines is None:
        return 70.0, 0.0
    angles = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        if x2 == x1:
            continue
        ang = float(np.degrees(np.arctan2(y2 - y1, x2 - x1)))
        if ang > 45:
            ang -= 90
        elif ang < -45:
            ang += 90
        if abs(ang) < 15:
            angles.append(ang)
    if not angles:
        return 70.0, 0.0
    median = float(np.median(angles))
    norm = float(np.clip(100 - abs(median) * 10, 0, 100))
    return norm, median


def score_image(image_path: str) -> dict:
    """Compute the composite quality score for a single image."""
    gray = _read_grayscale(image_path)

    sharp_n, sharp_raw = _sharpness(gray)
    cont_n, cont_raw = _contrast(gray)
    noise_n, noise_raw = _noise(gray)
    bright_n, bright_raw = _brightness(gray)
    skew_n, skew_raw = _skew(gray)

    composite = round(
        sharp_n * 0.30 + cont_n * 0.25 + noise_n * 0.20 + bright_n * 0.15 + skew_n * 0.10,
        1,
    )

    def grade(score: float) -> str:
        if score >= 85: return "excellent"
        if score >= 70: return "good"
        if score >= 55: return "fair"
        if score >= 40: return "poor"
        return "very poor"

    return {
        "composite": composite,
        "grade": grade(composite),
        "metrics": {
            "sharpness":  round(sharp_n, 1),
            "contrast":   round(cont_n, 1),
            "noise":      round(noise_n, 1),
            "brightness": round(bright_n, 1),
            "skew":       round(skew_n, 1),
        },
        "raw": {
            "laplacian_variance": round(sharp_raw, 2),
            "std_dev":            round(cont_raw, 2),
            "noise_level":        round(noise_raw, 3),
            "mean_luminance":     round(bright_raw, 2),
            "median_skew_deg":    round(skew_raw, 3),
        },
        "image_size": [int(gray.shape[1]), int(gray.shape[0])],
    }


def score_delta(before: dict, after: dict) -> dict:
    """Compute the improvement delta between two scores."""
    delta = round(after.get("composite", 0) - before.get("composite", 0), 1)
    sub_deltas = {}
    for key in ("sharpness", "contrast", "noise", "brightness", "skew"):
        b = before.get("metrics", {}).get(key, 0)
        a = after.get("metrics", {}).get(key, 0)
        sub_deltas[key] = round(a - b, 1)
    verdict = "improved" if delta > 1 else "unchanged" if abs(delta) <= 1 else "degraded"
    return {"composite_delta": delta, "metric_deltas": sub_deltas, "verdict": verdict}
