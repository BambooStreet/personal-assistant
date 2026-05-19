CREATE TABLE IF NOT EXISTS notifications_sent (
    event_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (event_id, kind)
);
