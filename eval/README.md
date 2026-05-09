# eval/

Wake word(향후 화자 검증 등) 모델 평가/실험 코드. **프로덕션 코드와 분리.**
스키마/컨벤션 단일 출처: [`docs/DECISIONS.md` D-012](../docs/DECISIONS.md).

## 왜 분리

- 언어가 다름: prod=TS+Rust+Electron, eval=Python(numpy/onnx/torch 생태계)
- 의존성이 사용자 PC에 깔리면 안 됨 (eval은 개발자 PC만)
- 데이터(녹음, 합성, 모델 산출물)가 GB 단위로 불어남
- 실험 코드는 일회성. prod git history 더럽힐 이유 없음

## 격리 보장

- `eval/`은 npm workspaces 멤버 아님 (root `package.json`의 `workspaces` 배열에 없음)
- electron-builder `files` 배열이 explicit이라 인스톨러에 안 섞임
- prod 코드가 `eval/`을 import하지 않음 — **양방향 import 금지**

## 인터페이스 (prod ↔ eval)

단방향, 두 경로뿐:

1. **prod → eval**: prod의 측정 모드가 NDJSON을 `userData/debug/wake-scores-<sessionId>.ndjson`에 dump. 사용자가 그 파일을 `eval/data/recordings/`로 카피
2. **eval → prod**: eval에서 학습된 ONNX 모델을 사람이 직접 `apps/renderer/public/models/`로 카피 (자동 배포 X — 잘못된 모델 자동 적용 방지)

## 셋업

[uv](https://docs.astral.sh/uv/)를 권장:

```bash
cd eval
uv sync
```

또는 표준 venv:

```bash
cd eval
python -m venv .venv
.venv\Scripts\activate     # Windows
# source .venv/bin/activate  # Mac/Linux
pip install -e .
```

## 디렉토리

```
eval/
├── data/                # gitignored. 측정/녹음/합성 데이터
│   ├── recordings/      # prod 측정 NDJSON 카피본
│   ├── ambient/         # 환경 noise 캡처 (수집한다면)
│   └── synth/           # TTS 합성 wake samples (생성한다면)
├── models/              # gitignored. 학습된 분류기/임베딩 산출물
├── results/             # ★ git에 들어감. 분석 보고서 (Markdown)
│   └── TEMPLATE.md      # 보고서 frontmatter 템플릿
└── scripts/
    └── measure_baseline.py   # NDJSON → 통계 리포트
```

`data/`와 `models/`는 `.gitignore`로 통째로 제외. `.gitkeep`만 커밋해서 디렉토리 구조 유지.

## 워크플로 — 베이스라인 측정

1. prod 앱에서 측정 모드 ON (설정 → "Wake 측정 모드 (개발자)"). 절차는 docs/DECISIONS.md D-012 + 본문서 외 채팅 기록 참조.
2. NDJSON을 `eval/data/recordings/`로 카피
3. 분석:
   ```bash
   uv run python scripts/measure_baseline.py data/recordings/wake-scores-<uuid>.ndjson
   # 본인 발화 세션은 GT 카운트 명시:
   uv run python scripts/measure_baseline.py data/recordings/wake-scores-<uuid>.ndjson --expected-positives 100
   ```
4. 출력의 frontmatter (`input_ndjson_sha256`, `input_ndjson_session_id`, `prod_commit_sha`)를 `results/TEMPLATE.md`에 채워서 `results/<YYYY-MM-DD>-<topic>.md`로 저장
5. 사람의 관찰/결정을 `## Observations`, `## Decisions / next steps` 섹션에 추가

## 보고서 컨벤션

`results/<date>-<topic>.md` 의 frontmatter는 항상 입력 NDJSON sha256과 session_id를 박는다.
이게 없으면 결과 재현 추적 불가능. `TEMPLATE.md` 참조.
