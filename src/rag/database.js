const Database = require("better-sqlite3");
const config = require("../../lib/config");

const db = new Database(config.DATABASE_FILE);

/*
=========================================================
DATABASE SETUP
=========================================================
*/

db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL DEFAULT 'New Chat',
        pinned INTEGER NOT NULL DEFAULT 0,
        model TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

/*
=========================================================
MESSAGES TABLE
=========================================================
*/

db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (chat_id)
        REFERENCES chats(id)
        ON DELETE CASCADE
    )
`);

function ensureMessageMetadataColumn() {
    const columns = db.prepare(
        "PRAGMA table_info(chat_messages)"
    ).all();

    if (!columns.some(column => column.name === "metadata_json")) {
        db.exec(
            "ALTER TABLE chat_messages ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'"
        );
    }
}

ensureMessageMetadataColumn();


/*
=========================================================
INDEX
=========================================================
*/

db.exec(`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id
    ON chat_messages(chat_id)
`);


/*
=========================================================
CREATE CHAT
=========================================================
*/

function createChat(title = "New Chat", model = null) {

    const statement = db.prepare(`
        INSERT INTO chats (
            title,
            model
        )
        VALUES (?, ?)
    `);

    const result =
        statement.run(
            title,
            model
        );

    return getChat(result.lastInsertRowid);
}


/*
=========================================================
GET CHAT
=========================================================
*/

function getChat(id) {

    return db.prepare(`
        SELECT
            id,
            title,
            pinned,
            project_id,
            archived,
            model,
            created_at,
            updated_at
        FROM chats
        WHERE id = ?
    `).get(id);

}


/*
=========================================================
GET ALL CHATS
=========================================================
*/

/*
Schema upgrade: `archived` lets a conversation be hidden from the
sidebar without deleting it, the way ChatGPT archives chats.
SQLite cannot add a NOT NULL column without a default, so it is
added as a nullable integer and treated as 0 when absent.
*/
function ensureArchivedColumn() {
    const columns = db.prepare("PRAGMA table_info(chats)").all();
    const hasArchived = columns.some(column => column.name === "archived");

    if (!hasArchived) {
        db.exec(
            "ALTER TABLE chats ADD COLUMN archived INTEGER NOT NULL DEFAULT 0"
        );
    }
}

ensureArchivedColumn();

function ensureProjectColumn() {
    const columns = db.prepare("PRAGMA table_info(chats)").all();
    if (!columns.some(column => column.name === "project_id")) {
        db.exec("ALTER TABLE chats ADD COLUMN project_id INTEGER");
    }
}

ensureProjectColumn();

function getChats() {

    return db.prepare(`
        SELECT
            id,
            title,
            pinned,
            archived,
            project_id,
            model,
            created_at,
            updated_at
        FROM chats
        ORDER BY
            pinned DESC,
            updated_at DESC,
            id DESC
    `).all();

}

function setChatProject(chatId, projectId = null) {
    const result = db.prepare(`
        UPDATE chats
        SET project_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(projectId, chatId);

    return result.changes ? getChat(chatId) : null;
}

function getProjectChats(projectId) {
    return db.prepare(`
        SELECT id, title, pinned, archived, project_id, model, created_at, updated_at
        FROM chats
        WHERE project_id = ?
        ORDER BY updated_at DESC, id DESC
    `).all(projectId);
}

/*
Set the archived flag on one chat, or on every chat.
Passing chatId = null targets all rows.
*/
function setArchived(chatId, archived = true) {
    const flag = archived ? 1 : 0;

    if (chatId == null) {
        const result = db
            .prepare("UPDATE chats SET archived = ?")
            .run(flag);
        return result.changes;
    }

    const result = db
        .prepare("UPDATE chats SET archived = ? WHERE id = ?")
        .run(flag, chatId);
    return result.changes;
}


/*
=========================================================
RENAME CHAT
=========================================================
*/

function renameChat(id, title) {

    db.prepare(`
        UPDATE chats
        SET
            title = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        title,
        id
    );

    return getChat(id);
}


/*
=========================================================
PIN / UNPIN CHAT
=========================================================
*/

function setChatPinned(id, pinned) {

    db.prepare(`
        UPDATE chats
        SET
            pinned = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(
        pinned ? 1 : 0,
        id
    );

    return getChat(id);
}


/*
=========================================================
DELETE CHAT
=========================================================
*/

function deleteChat(id) {

    db.prepare(`
        DELETE FROM chats
        WHERE id = ?
    `).run(id);

}

function branchChat(chatId, messageId, title) {
    const source = getChat(chatId);
    const point = db.prepare(`SELECT id FROM chat_messages WHERE id = ? AND chat_id = ?`).get(messageId, chatId);
    if (!source || !point) return null;
    const create = db.transaction(() => {
        const branched = createChat(
            String(title || `${source.title} (branch)`).trim().slice(0, 120) || "New branch",
            source.model
        );
        const messages = db.prepare(`
            SELECT role, content, metadata_json FROM chat_messages
            WHERE chat_id = ? AND id <= ? ORDER BY id ASC
        `).all(chatId, messageId);
        const insert = db.prepare(`
            INSERT INTO chat_messages (chat_id, role, content, metadata_json)
            VALUES (?, ?, ?, ?)
        `);
        for (const message of messages) {
            insert.run(branched.id, message.role, message.content, message.metadata_json || "{}");
        }
        return getChat(branched.id);
    });
    return create();
}


/*
=========================================================
SAVE MESSAGE
=========================================================
*/

function saveMessage(
    chatId,
    role,
    content,
    metadata = {}
) {

    const statement = db.prepare(`
        INSERT INTO chat_messages (
            chat_id,
            role,
            content,
            metadata_json
        )
        VALUES (?, ?, ?, ?)
    `);

    const result =
        statement.run(
            chatId,
            role,
            content,
            JSON.stringify(metadata || {})
        );


    /*
       Update chat timestamp.
    */

    db.prepare(`
        UPDATE chats
        SET
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(chatId);


    return result.lastInsertRowid;
}


/*
=========================================================
DELETE MESSAGE
=========================================================
*/

function deleteMessage(messageId) {

    db.prepare(`
        DELETE FROM chat_messages
        WHERE id = ?
    `).run(messageId);

}


/*
=========================================================
DELETE MESSAGES AFTER A MESSAGE
=========================================================
*/

function deleteMessagesAfter(
    chatId,
    messageId
) {

    db.prepare(`
        DELETE FROM chat_messages
        WHERE chat_id = ?
        AND id > ?
    `).run(
        chatId,
        messageId
    );


    /*
       Keep the chat timestamp updated.
    */

    db.prepare(`
        UPDATE chats
        SET
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
    `).run(chatId);

}


/*
=========================================================
GET CHAT MESSAGES
=========================================================
*/

function getChatMessages(chatId) {

    return db.prepare(`
        SELECT
            id,
            role,
            content,
            metadata_json,
            created_at
        FROM chat_messages
        WHERE chat_id = ?
        ORDER BY id ASC
    `).all(chatId).map(parseMessageMetadata);

}


/*
=========================================================
GET RECENT CHAT MESSAGES
=========================================================
*/

function getRecentChatMessages(
    chatId,
    limit = 10
) {

    return db.prepare(`
        SELECT
            id,
            role,
            content,
            metadata_json,
            created_at
        FROM chat_messages
        WHERE chat_id = ?
        ORDER BY id DESC
        LIMIT ?
    `).all(
        chatId,
        limit
    ).reverse().map(parseMessageMetadata);

}

function parseMessageMetadata(message) {
    let metadata = {};

    try {
        metadata = JSON.parse(message.metadata_json || "{}");
    } catch {
        metadata = {};
    }

    return {
        ...message,
        metadata
    };

}


/*
=========================================================
DELETE ALL CHAT DATA
=========================================================
*/

function clearAllChats() {

    db.prepare(`
        DELETE FROM chats
    `).run();

}


/*
=========================================================
BACKWARD COMPATIBILITY
=========================================================
*/

function getConversation() {

    /*
       Return messages from the most recently
       updated chat.

       This keeps existing code from immediately
       breaking while we migrate server.js.
    */

    const chat =
        db.prepare(`
            SELECT id
            FROM chats
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        `).get();


    if (!chat) {

        return [];

    }


    return getChatMessages(
        chat.id
    ).map(message => ({

        role:
            message.role,

        content:
            message.content

    }));

}


function clearConversation() {

    clearAllChats();

}


/*
=========================================================
EXPORTS
=========================================================
*/

module.exports = {

    createChat,
    getChat,
    getChats,
    setChatProject,
    getProjectChats,

    renameChat,
    setChatPinned,
    deleteChat,
    branchChat,

    saveMessage,

    deleteMessage,
    deleteMessagesAfter,

    getChatMessages,
    getRecentChatMessages,

    clearAllChats,
    setArchived,

    /*
       Existing functions kept temporarily
       so server.js does not immediately break.
    */

    getConversation,
    clearConversation

};
