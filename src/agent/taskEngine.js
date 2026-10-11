/*
Nexus AI — Task Engine (Stage 2)

Every substantial agent action becomes a tracked,
persistent task per the master spec (section 11):

    Task
    ├── ID
    ├── Goal
    ├── Status
    ├── Plan (steps)
    ├── Activity log
    ├── Artifacts touched
    ├── Verification
   ── Final result

Statuses:
    queued, planning, running, waiting,
    verifying, repairing, completed,
    failed, cancelled

Uses the shared SQLite connection so tasks survive
restarts and UI navigation.
*/

const { db } = require("../../lib/store/db");

const TASK_STATUSES = Object.freeze([
    "queued", "planning", "running", "waiting", "verifying",
    "repairing", "completed", "failed", "cancelled"
]);

const CANCELLABLE_TASK_STATUSES = new Set([
    "queued", "planning", "waiting"
]);

/*
--------------------------------------------------
SCHEMA
--------------------------------------------------
*/
db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        plan_json TEXT DEFAULT '[]',
        steps_done INTEGER NOT NULL DEFAULT 0,
        steps_total INTEGER NOT NULL DEFAULT 0,
        result TEXT DEFAULT '',
        error TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'done',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (task_id)
        REFERENCES tasks(id)
        ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_task_activity_task
    ON task_activity(task_id, id);
`);

/*
--------------------------------------------------
MAPPERS
--------------------------------------------------
*/

function mapTask(row) {
    if (!row) {
        return null;
    }

    let plan = [];

    try {
        plan =
            JSON.parse(row.plan_json || "[]");
    } catch {
        plan = [];
    }

    return {
        id: row.id,

        chatId: row.chat_id,

        goal: row.goal,

        status: row.status,

        plan,

        stepsDone: row.steps_done,

        stepsTotal: row.steps_total,

        result: row.result,

        error: row.error,

        createdAt: row.created_at,

        updatedAt: row.updated_at
    };
}

function mapActivity(row) {
    return {
        id: row.id,

        taskId: row.task_id,

        message: row.message,

        status: row.status,

        createdAt: row.created_at
    };
}

/*
--------------------------------------------------
CRUD
--------------------------------------------------
*/

function createTask({
    chatId = null,
    goal,
    plan = []
}) {
    const statement = db.prepare(`
        INSERT INTO tasks (chat_id, goal, plan_json, steps_total)
        VALUES (?, ?, ?, ?)
    `);

    const result = statement.run(
        chatId,

        String(goal || ""),

        JSON.stringify(plan || []),

        (plan || []).length
    );

    return getTask(
        result.lastInsertRowid
    );
}

function getTask(id) {
    return mapTask(
        db.prepare(
            "SELECT * FROM tasks WHERE id = ?"
        ).get(id)
    );
}

function listTasks(limit = 50) {
    return db.prepare(
        "SELECT * FROM tasks ORDER BY id DESC LIMIT ?"
    )
        .all(limit)
        .map(mapTask);
}

function listTasksByChat(chatId, limit = 20) {
    return db.prepare(
        "SELECT * FROM tasks WHERE chat_id = ? ORDER BY id DESC LIMIT ?"
    )
        .all(chatId, limit)
        .map(mapTask);
}

function updateTask(id, fields = {}) {
    if (
        fields.status !== undefined &&
        !TASK_STATUSES.includes(fields.status)
    ) {
        throw new TypeError(
            `Invalid task status: ${fields.status}`
        );
    }

    const allowed = {
        status: fields.status,

        plan_json: fields.plan != null
            ? JSON.stringify(fields.plan)
            : undefined,

        steps_done: fields.stepsDone,

        steps_total: fields.stepsTotal,

        result: fields.result,

        error: fields.error
    };

    const assignments = [];
    const values = [];

    for (const [column, value] of Object.entries(
        allowed
    )) {
        if (value === undefined) {
            continue;
        }

        assignments.push(
            `${column} = ?`
        );

        values.push(value);
    }

    if (assignments.length) {
        assignments.push(
            "updated_at = CURRENT_TIMESTAMP"
        );

        db.prepare(
            `UPDATE tasks SET ${assignments.join(", ")} WHERE id = ?`
        ).run(...values, id);
    }

    return getTask(id);
}

function setStatus(id, status) {
    return updateTask(id, { status });
}

function cancelTask(id) {
    const task = getTask(id);

    if (!task) {
        return {
            ok: false,
            code: "NOT_FOUND",
            error: "Task not found."
        };
    }

    if (!CANCELLABLE_TASK_STATUSES.has(task.status)) {
        return {
            ok: false,
            code: "NOT_CANCELLABLE",
            error: `Task cannot be cancelled while ${task.status}.`,
            task
        };
    }

    const cancelled = setStatus(id, "cancelled");
    addActivity(id, "Cancelled before execution.", "cancelled");

    return {
        ok: true,
        task: cancelled
    };
}

function deleteTask(id) {
    db.prepare(
        "DELETE FROM tasks WHERE id = ?"
    ).run(id);

    return { success: true };
}

/*
--------------------------------------------------
ACTIVITY LOG
--------------------------------------------------
*/

function addActivity(taskId, message, status = "done") {
    const result = db.prepare(`
        INSERT INTO task_activity (task_id, message, status)
        VALUES (?, ?, ?)
    `).run(taskId, String(message), status);

    return {
        id: result.lastInsertRowid,

        taskId,

        message,

        status
    };
}

function getActivity(taskId) {
    return db.prepare(
        "SELECT * FROM task_activity WHERE task_id = ? ORDER BY id ASC"
    )
        .all(taskId)
        .map(mapActivity);
}

module.exports = {
    TASK_STATUSES,
    CANCELLABLE_TASK_STATUSES,
    createTask,
    getTask,
    listTasks,
    listTasksByChat,
    updateTask,
    setStatus,
    cancelTask,
    deleteTask,
    addActivity,
    getActivity
};
