#!/usr/bin/env python3
"""Wake telemetry NDJSON 베이스라인 분석.

prod 앱의 측정 모드가 dump한 .ndjson 파일을 받아 통계를 출력한다.
스키마는 docs/DECISIONS.md D-012.

Usage:
    python scripts/measure_baseline.py <path-to-ndjson> [--expected-positives N]

본인 발화 세션은 --expected-positives <발화 횟수>를 줘야 TPR 계산이 의미 있음.
TV 세션은 expected_positives=0으로 간주, triggers/hr이 곧 FP/hr.

출력은 stdout에 Markdown — 그대로 results/TEMPLATE.md 머리에 붙여넣기.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_ndjson(path: Path) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    session: dict[str, Any] | None = None
    scores: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line_num, raw in enumerate(f, 1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                rec = json.loads(raw)
            except json.JSONDecodeError as e:
                print(f"warn: skipping malformed line {line_num}: {e}", file=sys.stderr)
                continue
            kind = rec.get("type")
            if kind == "session":
                if session is not None:
                    print("warn: multiple session records — using first", file=sys.stderr)
                else:
                    session = rec
            elif kind == "score":
                scores.append(rec)
    return session, scores


def percentile_table(values: list[float]) -> dict[str, float]:
    arr = np.asarray(values, dtype=np.float64)
    return {
        "mean": float(arr.mean()),
        "p50": float(np.percentile(arr, 50)),
        "p90": float(np.percentile(arr, 90)),
        "p95": float(np.percentile(arr, 95)),
        "p99": float(np.percentile(arr, 99)),
        "max": float(arr.max()),
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path", type=Path, help="path to .ndjson file")
    ap.add_argument(
        "--expected-positives",
        type=int,
        default=None,
        help="ground-truth wake utterance count (self session only)",
    )
    args = ap.parse_args()

    path: Path = args.path.resolve()
    if not path.exists():
        print(f"error: {path} not found", file=sys.stderr)
        return 1

    sha = sha256_file(path)
    session, scores = load_ndjson(path)

    if session is None:
        print("error: no session record (first line missing or malformed)", file=sys.stderr)
        return 2
    if not scores:
        print("error: no score records — measurement may not have run", file=sys.stderr)
        return 2

    labels: list[str] = list(session.get("model", {}).get("labels", []))
    threshold = session.get("model", {}).get("threshold")

    t_first = scores[0]["t_ms"]
    t_last = scores[-1]["t_ms"]
    duration_s = (t_last - t_first) / 1000.0
    duration_min = duration_s / 60.0
    n_frames = len(scores)
    fps = n_frames / duration_s if duration_s > 0 else float("nan")

    triggered = [s for s in scores if s.get("triggered")]
    triggered_count = len(triggered)

    # 어떤 wake label인지 — POSITIVE_LABEL은 prod 코드에서 "wake" 고정
    wake_label = "wake"
    has_wake = wake_label in labels

    per_label: dict[str, dict[str, float]] = {}
    for label in labels:
        vals = [s["scores"].get(label, 0.0) for s in scores]
        if vals:
            per_label[label] = percentile_table(vals)

    # threshold 초과 frame 수 (suppression 무시한 상한선)
    above_thr_count = 0
    if has_wake and threshold is not None:
        above_thr_count = sum(
            1 for s in scores if s["scores"].get(wake_label, 0.0) >= float(threshold)
        )

    # 출력 — Markdown 형식
    print(f"# Wake Baseline — {path.name}")
    print()
    print("```yaml")
    print(f"input_ndjson_sha256: {sha}")
    print(f"input_ndjson_session_id: {session.get('session_id')}")
    print(f"prod_commit_sha: {session.get('prod_commit_sha')}")
    print(f"started_at: {session.get('started_at')}")
    plat = session.get("platform", {})
    print(
        f"platform: os={plat.get('os')} arch={plat.get('arch')} electron={plat.get('electron')}"
    )
    print(f"model_backend: {session.get('model', {}).get('backend')}")
    print(f"labels: {labels}")
    print(f"threshold: {threshold}")
    print("```")
    print()

    print("## Coverage")
    print(f"- frames: **{n_frames}**")
    print(f"- duration: **{duration_min:.2f} min** ({duration_s:.1f} s)")
    print(f"- frame rate: {fps:.2f} fps")
    print()

    print("## Score percentiles (per label)")
    print()
    print("| label | mean | p50 | p90 | p95 | p99 | max |")
    print("|---|---|---|---|---|---|---|")
    for label, st in per_label.items():
        marker = " ⭐" if label == wake_label else ""
        print(
            f"| `{label}`{marker} | {st['mean']:.4f} | {st['p50']:.4f} | "
            f"{st['p90']:.4f} | {st['p95']:.4f} | {st['p99']:.4f} | {st['max']:.4f} |"
        )
    print()

    print("## Triggers")
    print(f"- triggered frames (prod의 threshold + suppression 통과): **{triggered_count}**")
    if has_wake and threshold is not None:
        print(
            f"- frames with `{wake_label}` ≥ {threshold} (suppression 무시 상한): "
            f"**{above_thr_count}**"
        )

    if duration_min > 0:
        per_hour = triggered_count / (duration_min / 60.0)
        print(f"- triggers / hour: **{per_hour:.2f}**")

    if args.expected_positives is not None:
        n = args.expected_positives
        if n > 0:
            tpr = triggered_count / n
            print(f"- expected positives (GT): {n}")
            print(f"- **TPR ≈ {tpr:.3f}** ({triggered_count}/{n})")
        else:
            print(f"- expected positives (GT): 0 → triggers/hour를 FP/hr로 해석")

    print()
    print("## Observations")
    print("<!-- 사람이 채워 넣을 부분: 환경 메모, 시간대별 특이점 -->")
    print()
    print("## Decisions / next steps")
    print("<!-- 결과 보고 어떻게 할지 — threshold 조정, 데이터 재학습, 모델 교체 등 -->")

    return 0


if __name__ == "__main__":
    sys.exit(main())
