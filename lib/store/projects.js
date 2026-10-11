const fs = require("fs");
const path = require("path");

const config = require("../config");
const { db } = require("./db");

/*
=========================================================
PROJECTS
=========================================================
A project is a named, project-scoped workspace
on disk. Every chat that works on files gets
its own project, so two conversations can
never overwrite each other's work.
=========================================================
*/

function slugify(value) {
    const base = String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);

    return base || "project";
}

function uniqueSlug(desired) {
    const base = slugify(desired);

    let candidate = base;
    let counter = 2;

    const exists = db.prepare(
        "SELECT 1 FROM projects WHERE slug = ?"
    );

    while (exists.get(candidate)) {
        candidate = `${base}-${counter}`;
        counter += 1;
    }

    return candidate;
}

function rowToProject(row) {
    if (!row) {
        return null;
    }

    return {
        id: row.id,
        chatId: row.chat_id,
        name: row.name,
        slug: row.slug,
        root: row.root,
        description: row.description,
        entry: row.entry,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

/*
=========================================================
CREATE
=========================================================
=========================================================
*/

function createProject({
    chatId = null,
    name = "Untitled Project",
    description = "",
    entry = "index.html"
} = {}) {
    const slug = uniqueSlug(name);

    const root = path.join(config.WORKSPACES_DIR, slug);

    fs.mkdirSync(root, { recursive: true });

    const result = db
        .prepare(
            `INSERT INTO projects
                (chat_id, name, slug, root, description, entry)
             VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
            chatId,
            String(name).trim() || "Untitled Project",
            slug,
            root,
            description,
            entry
        );

    return getProject(result.lastInsertRowid);
}

/*
=========================================================
READ
=========================================================
=========================================================
*/

function getProject(id) {
    return rowToProject(
        db.prepare("SELECT * FROM projects WHERE id = ?").get(id)
    );
}

function getProjectBySlug(slug) {
    return rowToProject(
        db
            .prepare("SELECT * FROM projects WHERE slug = ?")
            .get(slug)
    );
}

function getProjectByChat(chatId) {
    if (!chatId) {
        return null;
    }

    return rowToProject(
        db
            .prepare(
                `SELECT * FROM projects
                 WHERE chat_id = ?
                 ORDER BY id DESC
                 LIMIT 1`
            )
            .get(chatId)
    );
}

function listProjects() {
    return db
        .prepare(
            `SELECT * FROM projects
             WHERE status != 'archived'
             ORDER BY updated_at DESC, id DESC`
        )
        .all()
        .map(rowToProject);
}

/*
=========================================================
UPDATE
=========================================================
=========================================================
*/

function updateProject(id, patch = {}) {
    const current = getProject(id);

    if (!current) {
        return null;
    }

    db.prepare(
        `UPDATE projects
         SET name = ?,
             description = ?,
             entry = ?,
             status = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
    ).run(
        patch.name != null ? patch.name : current.name,

        patch.description != null
            ? patch.description
            : current.description,

        patch.entry != null ? patch.entry : current.entry,

        patch.status != null ? patch.status : current.status,

        id
    );

    return getProject(id);
}

function touchProject(id) {
    db.prepare(
        `UPDATE projects
         SET updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
    ).run(id);
}

function linkChat(projectId, chatId) {
    db.prepare(
        `UPDATE projects
         SET chat_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
    ).run(chatId, projectId);

    return getProject(projectId);
}

/*
=========================================================
ENSURE
=========================================================
Returns the chat's project, creating it on
first use. This is what the agent calls before
touching any file.
=========================================================
*/

function ensureProjectForChat(chatId, name) {
    const existing = getProjectByChat(chatId);

    if (existing) {
        return existing;
    }

    return createProject({
        chatId,
        name: name || `Project ${chatId || ""}`.trim()
    });
}

/*
=========================================================
DELETE
=========================================================
Removes the row and, optionally, the files.
=========================================================
*/

function deleteProject(id, { removeFiles = false } = {}) {
    const project = getProject(id);

    if (!project) {
        return false;
    }

    db.prepare("DELETE FROM artifacts WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM file_changes WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM project_events WHERE project_id = ?").run(id);
    db.prepare("DELETE FROM projects WHERE id = ?").run(id);

    if (
        removeFiles &&
        project.root !== config.WORKSPACES_DIR &&
        !path
            .relative(config.WORKSPACES_DIR, project.root)
            .startsWith("..") &&
        !path.isAbsolute(
            path.relative(config.WORKSPACES_DIR, project.root)
        )
    ) {
        fs.rmSync(project.root, {
            recursive: true,
            force: true
        });
    }

    return true;
}

module.exports = {
    slugify,
    createProject,
    getProject,
    getProjectBySlug,
    getProjectByChat,
    listProjects,
    updateProject,
    touchProject,
    linkChat,
    ensureProjectForChat,
    deleteProject
};
