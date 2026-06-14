-- 멀티테넌트 저장소(D-013). 공유 Core + 전 테이블 user_id.
-- 기존 데이터는 모두 user_id=1('local')로 백필. SQLite는 PK/UNIQUE 변경이 불가하므로
-- 복합키가 필요한 테이블(settings/sync_state/briefings/events)은 재생성한다.
-- 선언된 FK가 없어 재생성 시 제약 충돌 없음.

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
INSERT OR IGNORE INTO users (id, handle, created_at)
    VALUES (1, 'local', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ── 단순 칸 추가 (NOT NULL DEFAULT 1 로 기존 행 백필) ───────────────────────────
ALTER TABLE todos ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE messages ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE memories ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE cost_ledger ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_user_conv_ts ON messages(user_id, conversation_id, ts);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
CREATE INDEX IF NOT EXISTS idx_cost_ledger_user_ts ON cost_ledger(user_id, ts);

-- ── 복합키 전환: settings (key → user_id,key) ────────────────────────────────
CREATE TABLE settings_new (
    user_id INTEGER NOT NULL DEFAULT 1,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, key)
);
INSERT INTO settings_new (user_id, key, value, updated_at)
    SELECT 1, key, value, updated_at FROM settings;
DROP TABLE settings;
ALTER TABLE settings_new RENAME TO settings;

-- ── 복합키 전환: sync_state (provider → user_id,provider) ─────────────────────
CREATE TABLE sync_state_new (
    user_id INTEGER NOT NULL DEFAULT 1,
    provider TEXT NOT NULL,
    sync_token TEXT,
    last_full_sync_at TEXT,
    last_incremental_at TEXT,
    PRIMARY KEY (user_id, provider)
);
INSERT INTO sync_state_new (user_id, provider, sync_token, last_full_sync_at, last_incremental_at)
    SELECT 1, provider, sync_token, last_full_sync_at, last_incremental_at FROM sync_state;
DROP TABLE sync_state;
ALTER TABLE sync_state_new RENAME TO sync_state;

-- ── 복합키 전환: briefings (UNIQUE date → UNIQUE user_id,date) ────────────────
CREATE TABLE briefings_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    date TEXT NOT NULL,
    summary TEXT NOT NULL,
    audio_path TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, date)
);
INSERT INTO briefings_new (id, user_id, date, summary, audio_path, created_at)
    SELECT id, 1, date, summary, audio_path, created_at FROM briefings;
DROP TABLE briefings;
ALTER TABLE briefings_new RENAME TO briefings;

-- ── 복합키 전환: events (UNIQUE google_event_id → UNIQUE user_id,google_event_id) ─
CREATE TABLE events_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL DEFAULT 1,
    google_event_id TEXT,
    calendar_id TEXT NOT NULL DEFAULT 'primary',
    summary TEXT NOT NULL,
    description TEXT,
    location TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    all_day INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'confirmed',
    etag TEXT,
    updated_at TEXT NOT NULL,
    synced_at TEXT NOT NULL,
    UNIQUE (user_id, google_event_id)
);
INSERT INTO events_new (id, user_id, google_event_id, calendar_id, summary, description, location, start_at, end_at, all_day, status, etag, updated_at, synced_at)
    SELECT id, 1, google_event_id, calendar_id, summary, description, location, start_at, end_at, all_day, status, etag, updated_at, synced_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX IF NOT EXISTS idx_events_user_start_at ON events(user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);
