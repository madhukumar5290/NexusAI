const Database = require("better-sqlite3");
const config = require("../../lib/config");

const db = new Database(config.DATABASE_FILE);

db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

function saveMemory(key, value) {
    const statement = db.prepare(`
        INSERT INTO memories (key, value)
        VALUES (?, ?)
        ON CONFLICT(key)
        DO UPDATE SET
            value = excluded.value,
            updated_at = CURRENT_TIMESTAMP
    `);

    statement.run(key, value);
}

function getMemory(key) {
    const statement = db.prepare(`
        SELECT value
        FROM memories
        WHERE key = ?
    `);

    const result = statement.get(key);

    return result ? result.value : null;
}

function getAllMemories() {
    return db.prepare(`
        SELECT key, value
        FROM memories
        ORDER BY id ASC
    `).all();
}

function deleteMemory(key) {
    db.prepare(`
        DELETE FROM memories
        WHERE key = ?
    `).run(key);
}

function normalizeExistingMemories(normalizeMemoryKey) {

    const memories = getAllMemories();

    for (const item of memories) {

        const normalizedKey =
            normalizeMemoryKey(item.key);

        if (!normalizedKey) {
            continue;
        }

        if (normalizedKey === item.key) {
            continue;
        }

        const existing =
            getMemory(normalizedKey);

        if (!existing) {

            saveMemory(
                normalizedKey,
                item.value
            );

        }

        deleteMemory(item.key);
    }
}

function updateMemory(key, value) {

    const statement = db.prepare(`
        UPDATE memories
        SET value = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE key = ?
    `);

    statement.run(value, key);
}

module.exports = {
    saveMemory,
    getMemory,
    getAllMemories,
    deleteMemory,
    normalizeExistingMemories,
    updateMemory
};