const { db } = require("./db");

/*
=========================================================
AGENT ACTIVITY EVENTS
=========================================================
Every meaningful step the agent takes is
recorded here: understanding, planning, each
tool call, each file write, verification, and
failures.

This is what makes Nexus auditable rather than
a black box - the UI renders exactly what
happened, in order.
=========================================================
*/

const EVENT_TYPES = {
    understand: "understand",
    project: "project",
    plan: "plan",
    tool: "tool",
    file: "file",
    verify: "verify",
    preview: "preview",
    error: "error",
    done: "done"
};

const STATUS = {
    running: "running",
    done: "done",
    error: "error"
};

function rowToEvent(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        projectId: row.project_id,
        chatId: row.chat_id,
        type: row.type,
        title: row.title,
        detail: row.detail,
        status: row.status,
        createdAt: row.created_at
    };
}

/*
=========================================================
WRITE
=========================================================
Returns the inserted event so callers can
stream it straight to the client.
=========================================================
*/

function logEvent({
    projectId = null,
    chatId = null,
    type = EVENT_TYPES.tool,
    title = "",
    detail = "",
    status = STATUS.done
} = {}) {
    const result = db
        .prepare(
            `INSERT INTO project_events
                (project_id, chat_id, type, title, detail, status)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
            projectId,
            chatId,
            type,
            String(title).slice(0, 300),
            String(detail || "").slice(0, 4000),
            status
        );

    return rowToEvent(
        db
            .prepare("SELECT * FROM project_events WHERE id = ?")
            .get(result.lastInsertRowid)
    );
}

/*
Update a running event when the step finishes,
so a single long-lived line in the UI can move
from "running" to "done" instead of appending
duplicates.
*/

function finishEvent(id, patch = {}) {
    const current = db
        .prepare("SELECT * FROM project_events WHERE id = ?")
        .get(id);

    if (!current) {
        return null;
    }

    db.prepare(
        `UPDATE project_events
         SET title = ?,
             detail = ?,
             status = ?
         WHERE id = ?`
    ).run(
        patch.title != null ? patch.title : current.title,

        patch.detail != null ? patch.detail : current.detail,

        patch.status != null ? patch.status : "done",

        id
    );

    return rowToEvent(
        db.prepare("SELECT * FROM project_events WHERE id = ?").get(id)
    );
}

/*
A convenience wrapper: open a running event,
run the work, then close it as done or error.

errors are recorded and re-thrown so the
caller's control flow is unchanged.
*/

async function trackEvent(meta, work) {
    const event = logEvent({
        ...meta,
        status: STATUS.running
    });

    try {
        const result = await work();

        finishEvent(event.id, {
            status: STATUS.done,

            detail:
                typeof result === "string"
                    ? result
                    : meta.detail || ""
        });

        return result;
    } catch (error) {
        finishEvent(event.id, {
            status: STATUS.error,
            detail: error.message
        });

        throw error;
    }
}

/*
=========================================================
READ
=========================================================
=========================================================
*/

function listEvents(projectId, limit = 80) {
    if (!projectId) {
        return [];
    }

    return db
        .prepare(
            `SELECT * FROM project_events
             WHERE project_id = ?
             ORDER BY id DESC
             LIMIT ?`
        )
        .all(projectId, limit)
        .reverse()
        .map(rowToEvent);
}

function listEventsForChat(chatId, limit = 80) {
    if (!chatId) {
        return [];
    }

    return db
        .prepare(
            `SELECT * FROM project_events
             WHERE chat_id = ?
             ORDER BY id DESC
             LIMIT ?`
        )
        .all(chatId, limit)
        .reverse()
        .map(rowToEvent);
}

function clearEvents(projectId) {
    db.prepare(
        "DELETE FROM project_events WHERE project_id = ?"
    ).run(projectId);
}

module.exports = {
    EVENT_TYPES,
    STATUS,
    logEvent,
    finishEvent,
    trackEvent,
    listEvents,
    listEventsForChat,
    clearEvents
};
