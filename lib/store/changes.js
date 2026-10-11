const { db } = require("./db");

/*
=========================================================
FILE CHANGES
=========================================================
Every write the agent performs records what
changed and by how much, so the Changes panel
shows real history rather than a claim.

Additions and deletions are counted from the
diff itself, not guessed.
=========================================================
*/

const ACTION = {
    create: "create",
    update: "update",
    delete: "delete"
};

function rowToChange(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        projectId: row.project_id,
        path: row.path,
        action: row.action,
        diff: row.diff,
        additions: row.additions,
        deletions: row.deletions,
        createdAt: row.created_at
    };
}

/*
Count only real content lines, ignoring the
+++ / --- file headers every unified diff
contains.
*/

function countLines(diff, marker) {
    if (!diff) {
        return 0;
    }

    let count = 0;

    for (const line of String(diff).split("\n")) {
        if (!line.startsWith(marker)) {
            continue;
        }

        if (line.startsWith(marker.repeat(3))) {
            continue;
        }

        count += 1;
    }

    return count;
}

function recordChange({
    projectId,
    path,
    action = ACTION.update,
    diff = ""
} = {}) {
    const result = db
        .prepare(
            `INSERT INTO file_changes
                (project_id, path, action, diff, additions, deletions)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
            projectId,
            path,
            action,
            String(diff || "").slice(0, 60000),
            countLines(diff, "+"),
            countLines(diff, "-")
        );

    return rowToChange(
        db
            .prepare("SELECT * FROM file_changes WHERE id = ?")
            .get(result.lastInsertRowid)
    );
}

function listChanges(projectId, limit = 60) {
    if (!projectId) {
        return [];
    }

    return db
        .prepare(
            `SELECT * FROM file_changes
             WHERE project_id = ?
             ORDER BY id DESC
             LIMIT ?`
        )
        .all(projectId, limit)
        .map(rowToChange);
}

function clearChanges(projectId) {
    db.prepare(
        "DELETE FROM file_changes WHERE project_id = ?"
    ).run(projectId);
}

module.exports = {
    ACTION,
    recordChange,
    listChanges,
    clearChanges,
    countLines
};
