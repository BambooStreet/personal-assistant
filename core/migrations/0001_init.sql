CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_event_id TEXT UNIQUE,
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
    synced_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    notes TEXT,
    due_at TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    done INTEGER NOT NULL DEFAULT 0,
    done_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_todos_done ON todos(done);
CREATE INDEX IF NOT EXISTS idx_todos_due_at ON todos(due_at);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_call_id TEXT,
    tool_name TEXT,
    ts TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_ts ON messages(conversation_id, ts);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
    provider TEXT PRIMARY KEY,
    sync_token TEXT,
    last_full_sync_at TEXT,
    last_incremental_at TEXT
);

CREATE TABLE IF NOT EXISTS briefings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL,
    audio_path TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    provider TEXT NOT NULL,
    kind TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    audio_seconds REAL,
    chars INTEGER,
    cost_usd REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cost_ledger_ts ON cost_ledger(ts);
