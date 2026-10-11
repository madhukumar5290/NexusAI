const fs = require("fs");
const Database = require("better-sqlite3");

const config = require("../config");

/*
=========================================================
SHARED DATABASE
=========================================================
One connection for the whole process.

The original code opened nexus.db twice
(database.js and memory.js) using the relative
path "nexus.db", which resolved against
process.cwd() and could therefore point at a
different file depending on how the server was
started. Everything now goes through this
module using an absolute path.
=========================================================
*/

fs.mkdirSync(config.DATA_DIR, {
    recursive: true
});

const db = new Database(config.DATABASE_FILE);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

/*
=========================================================
SCHEMA
=========================================================
CREATE TABLE IF NOT EXISTS throughout, so an
existing nexus.db keeps working untouched.
=========================================================
*/

function migrate() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS chats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT 'New Chat',
            pinned INTEGER NOT NULL DEFAULT 0,
            model TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY (chat_id)
            REFERENCES chats(id)
            ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id
        ON chat_messages(chat_id);

        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT UNIQUE NOT NULL,
            value TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id INTEGER,
            name TEXT NOT NULL DEFAULT 'Untitled Project',
            slug TEXT UNIQUE NOT NULL,
            root TEXT NOT NULL,
            description TEXT DEFAULT '',
            entry TEXT DEFAULT 'index.html',
            status TEXT NOT NULL DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS project_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            chat_id INTEGER,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            detail TEXT DEFAULT '',
            status TEXT NOT NULL DEFAULT 'done',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_project_events_project
        ON project_events(project_id, id DESC);

        CREATE TABLE IF NOT EXISTS artifacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            path TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'other',
            size INTEGER NOT NULL DEFAULT 0,
            is_entry INTEGER NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

            UNIQUE (project_id, path)
        );

        CREATE TABLE IF NOT EXISTS file_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            path TEXT NOT NULL,
            action TEXT NOT NULL,
            diff TEXT DEFAULT '',
            additions INTEGER NOT NULL DEFAULT 0,
            deletions INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_file_changes_project
        ON file_changes(project_id, id DESC);

        CREATE TABLE IF NOT EXISTS model_observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            task TEXT NOT NULL DEFAULT 'chat',
            status TEXT NOT NULL,
            latency_ms INTEGER,
            input_tokens INTEGER,
            output_tokens INTEGER,
            estimated_cost_usd REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_model_observations_lookup
        ON model_observations(provider, model, created_at DESC);
    `);
}

migrate();

function checkpoint() {
    try {
        db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
        /* non-fatal */
    }
}

module.exports = {
    db,
    migrate,
    checkpoint,
    file: config.DATABASE_FILE
};
