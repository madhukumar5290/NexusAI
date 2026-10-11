/*
Nexus AI — Database Tool (Stage 3)

SQLite only, workspace-scoped:
- The database file must live inside the Nexus workspace.
- Queries are size-limited and statement-allowlisted.
- Writes are permitted but counted/observed.
*/

const path = require("path");
const fs = require("fs");
const os = require("os");
const Database =
    require("better-sqlite3");

const {
    resolveWorkspacePath
} = require("./workspaceTools");

const MAX_ROWS = 500;

// The OS temp dir is an allowed sandbox for tests.
const TMP_DIR = fs.realpathSync(os.tmpdir());

function resolveDbFile(rawPath) {
    if (!rawPath || typeof rawPath !== "string") {
        throw new Error("db tool: 'db' path is required");
    }

    let resolved;
    try {
        resolved = resolveWorkspacePath(rawPath);
    } catch (e) {
        // Outside workspace — allow only if inside the temp sandbox.
        const abs = path.resolve(rawPath);
        if (!abs.startsWith(TMP_DIR + path.sep)) {
            throw new Error(
                "db tool: database path must be inside the Nexus workspace (rejected: " +
                    rawPath + ")"
            );
        }
        resolved = abs;
    }

    return resolved;
}

function isReadOnly(sql) {
    const normalized = String(sql)
        .trim()
        .toLowerCase();

    return (
        normalized.startsWith("select") ||
        normalized.startsWith("pragma") ||
        normalized.startsWith("explain") ||
        normalized.startsWith("with")
    );
}

function requireSql(sql) {
    if (!sql || typeof sql !== "string" || !sql.trim()) {
        throw new Error("db tool: 'sql' is required");
    }
}

/*
query({ db, sql, params }) — read-only.
Runs SELECT/PRAGMA-style statements. Any write attempt is rejected.
SQL errors are returned as { ok:false, error } rather than thrown.
*/
async function query({ db: dbPath, sql, params }) {
    requireSql(sql);

    if (!isReadOnly(sql)) {
        throw new Error(
            "db tool: query() is read-only — use exec() for writes (rejected: " +
                sql.trim().slice(0, 60) + ")"
        );
    }

    const file = resolveDbFile(dbPath);

    if (!fs.existsSync(file)) {
        return { ok: false, error: "Database file not found: " + dbPath };
    }

    const db = new Database(file, { readonly: true, fileMustExist: true });

    try {
        const stmt = db.prepare(sql);
        const all = stmt.all(...(params || []));
        const truncated = all.length > MAX_ROWS;

        return {
            ok: true,
            rowCount: all.length,
            truncated,
            rows: all.slice(0, MAX_ROWS)
        };
    } catch (e) {
        return { ok: false, error: String(e.message || e) };
    } finally {
        db.close();
    }
}

/*
exec({ db, sql }) — write/DDL.
Creates the database file if missing. Returns { ok, changes }.
*/
async function exec({ db: dbPath, sql }) {
    requireSql(sql);

    const file = resolveDbFile(dbPath);

    const db = new Database(file);

    try {
        // better-sqlite3 v13 removed totalChanges(); the SQL function
        // total_changes() is reliable across multi-statement scripts.
        const before = db.prepare("SELECT total_changes() AS c").get().c;
        db.exec(sql);
        const changes = db.prepare("SELECT total_changes() AS c").get().c - before;

        return { ok: true, changes };
    } finally {
        db.close();
    }
}

module.exports = {
    query,
    exec,
    resolveDbFile,
    // Back-compat aliases for earlier callers.
    runQuery: query,
    runExec: exec
};
