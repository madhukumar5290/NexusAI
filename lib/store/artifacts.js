const { db } = require("./db");
const kinds = require("../kinds");

/*
=========================================================
ARTIFACTS
=========================================================
An index of every file a project owns, with
its kind and size. Rebuilt from disk on
rescan, so the database can never drift far
from the truth.
=========================================================
*/

function rowToArtifact(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        projectId: row.project_id,
        path: row.path,
        kind: row.kind,
        size: row.size,
        isEntry: Boolean(row.is_entry),
        updatedAt: row.updated_at
    };
}

function upsertArtifact({
    projectId,
    path,
    size = 0,
    isEntry = false
} = {}) {
    db.prepare(
        `INSERT INTO artifacts
            (project_id, path, kind, size, is_entry)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, path)
         DO UPDATE SET
            kind = excluded.kind,
            size = excluded.size,
            is_entry = excluded.is_entry,
            updated_at = CURRENT_TIMESTAMP`
    ).run(
        projectId,
        path,
        kinds.kindOf(path),
        size,
        isEntry ? 1 : 0
    );

    return rowToArtifact(
        db
            .prepare(
                `SELECT * FROM artifacts
                 WHERE project_id = ? AND path = ?`
            )
            .get(projectId, path)
    );
}

function listArtifacts(projectId) {
    if (!projectId) {
        return [];
    }

    return db
        .prepare(
            `SELECT * FROM artifacts
             WHERE project_id = ?
             ORDER BY path ASC`
        )
        .all(projectId)
        .map(rowToArtifact);
}

/*
Full resync from a list of { path, size }.
Rows whose files no longer exist are removed.
*/

function syncArtifacts(projectId, files, entry) {
    const seen = new Set();

    const write = db.prepare(
        `INSERT INTO artifacts
            (project_id, path, kind, size, is_entry)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(project_id, path)
         DO UPDATE SET
            kind = excluded.kind,
            size = excluded.size,
            is_entry = excluded.is_entry,
            updated_at = CURRENT_TIMESTAMP`
    );

    const remove = db.prepare(
        `DELETE FROM artifacts
         WHERE project_id = ? AND path = ?`
    );

    const transaction = db.transaction(rows => {
        for (const file of rows) {
            seen.add(file.path);

            write.run(
                projectId,
                file.path,
                kinds.kindOf(file.path),
                file.size || 0,
                file.path === entry ? 1 : 0
            );
        }

        const existing = db
            .prepare(
                `SELECT path FROM artifacts
                 WHERE project_id = ?`
            )
            .all(projectId);

        for (const row of existing) {
            if (!seen.has(row.path)) {
                remove.run(projectId, row.path);
            }
        }
    });

    transaction(files);

    return listArtifacts(projectId);
}

function deleteArtifact(projectId, path) {
    db.prepare(
        `DELETE FROM artifacts
         WHERE project_id = ? AND path = ?`
    ).run(projectId, path);
}

function clearArtifacts(projectId) {
    db.prepare(
        "DELETE FROM artifacts WHERE project_id = ?"
    ).run(projectId);
}

module.exports = {
    upsertArtifact,
    listArtifacts,
    syncArtifacts,
    deleteArtifact,
    clearArtifacts
};
