-- 이동시간/출발 알림(D-018 v1). 지오코딩=Kakao, 경로=ODsay(대중교통).
-- place_alias만 테넌트 스코프(user_id), 캐시 둘은 전역(좌표·경로는 유저 무관 → 적중률↑).
-- 전부 CREATE TABLE IF NOT EXISTS — 0008식 테이블 재생성 위험 없음.

-- 모호 장소 별칭("집","회사","학교"+커스텀). query=지오코딩에 보낼 실제 텍스트.
-- lat/lng가 채워져 있으면 알림 시점에 Kakao 호출을 건너뛴다(사전 지오코딩).
CREATE TABLE IF NOT EXISTS place_alias (
    user_id    INTEGER NOT NULL DEFAULT 1,
    alias      TEXT    NOT NULL,
    query      TEXT    NOT NULL,
    lat        REAL,
    lng        REAL,
    created_at TEXT    NOT NULL,
    PRIMARY KEY (user_id, alias)
);

-- 지오코딩 캐시(전역). query는 trim+공백정규화한 원문, 좌표는 소수 5자리 라운딩 저장.
CREATE TABLE IF NOT EXISTS geocode_cache (
    query     TEXT NOT NULL PRIMARY KEY,
    lat       REAL NOT NULL,
    lng       REAL NOT NULL,
    provider  TEXT NOT NULL,
    cached_at TEXT NOT NULL
);

-- 경로 캐시(전역). cache_key = from좌표|to좌표|출발버킷(로컬 30분)|mode.
-- duration_s=총 소요(도보·환승 포함), transfers=환승 횟수, summary_json=ODsay 경로 요약 원문.
CREATE TABLE IF NOT EXISTS route_cache (
    cache_key    TEXT    NOT NULL PRIMARY KEY,
    duration_s   INTEGER NOT NULL,
    transfers    INTEGER NOT NULL,
    summary_json TEXT    NOT NULL,
    cached_at    TEXT    NOT NULL
);
