---
date: YYYY-MM-DD
session_type: tv | self | other
prod_commit_sha: <session record의 prod_commit_sha 그대로>
input_ndjson_sha256: <sha256 of the .ndjson file — measure_baseline.py가 출력>
input_ndjson_session_id: <uuid — session record의 session_id>
duration_min: <number>
expected_positives: <self면 발화 횟수 정수, tv면 0, other면 null>
notes: "<환경/콘텐츠/볼륨/거리 등 1-2줄>"
---

# <짧은 제목 — e.g. "speech-commands baseline (TV 30분)">

> `measure_baseline.py` 출력을 그대로 붙여넣고, 아래 사람 섹션을 채운다.

## 측정 조건

- 환경:
- 마이크 거리:
- 콘텐츠 (TV 세션이면 채널/제목, self면 발화 변이 메모):

## 측정 결과

<!-- measure_baseline.py가 찍은 ## Coverage / ## Score percentiles / ## Triggers를 여기에 -->

## Observations

- <시간대별 특이점, score spike 시점 등>
- <예상보다 좋은 점 / 나쁜 점>

## Decisions / next steps

- <threshold 조정 / 재학습 / 모델 교체 / 화자 검증 추가 / 다음 측정 시나리오>
