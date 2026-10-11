const Database = require("better-sqlite3");
const config = require("../../lib/config");

const db = new Database(config.DATABASE_FILE);

db.exec(`
    CREATE TABLE IF NOT EXISTS document_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_name TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

function saveChunk(documentName, chunkIndex, content, embedding) {
    const statement = db.prepare(`
        INSERT INTO document_chunks
        (document_name, chunk_index, content, embedding)
        VALUES (?, ?, ?, ?)
    `);

    statement.run(
        documentName,
        chunkIndex,
        content,
        JSON.stringify(embedding)
    );
}

function getAllChunks() {
    return db.prepare(`
        SELECT id, document_name, chunk_index, content, embedding
        FROM document_chunks
        ORDER BY id ASC
    `).all();
}

function clearDocument(documentName) {
    db.prepare(`
        DELETE FROM document_chunks
        WHERE document_name = ?
    `).run(documentName);
}

function replaceDocument(documentName, chunks) {
    const remove = db.prepare(`
        DELETE FROM document_chunks
        WHERE document_name = ?
    `);
    const insert = db.prepare(`
        INSERT INTO document_chunks
        (document_name, chunk_index, content, embedding)
        VALUES (?, ?, ?, ?)
    `);
    const replace = db.transaction(entries => {
        remove.run(documentName);
        entries.forEach((entry, index) => {
            insert.run(
                documentName,
                index,
                entry.content,
                JSON.stringify(entry.embedding)
            );
        });
    });

    replace(chunks);
}

function listDocuments() {
    return db.prepare(`
        SELECT
            document_name AS name,
            COUNT(*) AS chunks,
            MAX(created_at) AS updatedAt
        FROM document_chunks
        GROUP BY document_name
        ORDER BY updatedAt DESC, document_name ASC
    `).all();
}

module.exports = {
    saveChunk,
    getAllChunks,
    clearDocument,
    replaceDocument,
    close: () => db.close(),
    listDocuments
};