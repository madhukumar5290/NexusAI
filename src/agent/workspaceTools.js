const fs = require("fs");
const path = require("path");

function getWorkspaceRoot() {
    // Allow runtime override (used by tests and future per-project workspaces).
    const override = process.env.NEXUS_WORKSPACE;

    if (override && override.trim() !== "") {
        return path.resolve(override.trim());
    }

    return path.resolve(
        path.join(__dirname, "..", "..", "workspace")
    );
}

function ensureWorkspace() {
    const root = getWorkspaceRoot();

    if (!fs.existsSync(root)) {
        fs.mkdirSync(root, {
            recursive: true
        });
    }
}

function isWithinDirectory(directory, target) {
    const relative = path.relative(directory, target);
    return relative === "" ||
        (
            relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative)
        );
}

function resolveWorkspacePath(relativePath = "") {
    ensureWorkspace();

    if (typeof relativePath !== "string") {
        throw new Error("Path must be a string.");
    }

    const cleanedPath = relativePath
        .replace(/\0/g, "")
        .replace(/^[/\\]+/, "");

    const fullPath = path.resolve(
        getWorkspaceRoot(),
        cleanedPath
    );

    const lexicalRoot = getWorkspaceRoot();
    if (!isWithinDirectory(lexicalRoot, fullPath)) {
        throw new Error(
            "Access denied: path is outside the Nexus workspace."
        );
    }

    const realRoot = fs.realpathSync(lexicalRoot);
    let existingAncestor = fullPath;
    while (true) {
        try {
            fs.lstatSync(existingAncestor);
            break;
        } catch (error) {
            if (error.code !== "ENOENT" && error.code !== "ENOTDIR") {
                throw error;
            }
            const parent = path.dirname(existingAncestor);
            if (parent === existingAncestor) throw error;
            existingAncestor = parent;
        }
    }

    let realAncestor;
    try {
        realAncestor = fs.realpathSync(existingAncestor);
    } catch (error) {
        throw new Error(
            `Access denied: workspace path has an unresolved symbolic link (${error.message}).`
        );
    }
    const resolvedTarget = path.resolve(
        realAncestor,
        path.relative(existingAncestor, fullPath)
    );
    if (!isWithinDirectory(realRoot, resolvedTarget)) {
        throw new Error(
            "Access denied: path resolves outside the Nexus workspace."
        );
    }

    return fullPath;
}

function createFolder(relativePath) {
    const fullPath = resolveWorkspacePath(relativePath);

    fs.mkdirSync(fullPath, {
        recursive: true
    });

    return {
        success: true,
        path: relativePath,
        fullPath
    };
}

function createFile(relativePath, content = "") {
    const fullPath = resolveWorkspacePath(relativePath);

    const directory = path.dirname(fullPath);

    fs.mkdirSync(directory, {
        recursive: true
    });

    const value = Buffer.isBuffer(content)
        ? content
        : String(content);

    fs.writeFileSync(fullPath, value);

    return {
        success: true,
        path: relativePath,
        fullPath,
        size: Buffer.isBuffer(value)
            ? value.length
            : Buffer.byteLength(value, "utf8")
    };
}

function requireFile(fullPath, relativePath) {
    if (!fs.existsSync(fullPath)) {
        throw new Error(
            `File does not exist: ${relativePath}`
        );
    }

    const stats = fs.statSync(fullPath);

    if (!stats.isFile()) {
        throw new Error(
            `Path is not a file: ${relativePath}`
        );
    }

    return stats;
}

function requireDirectory(fullPath, relativePath, label) {
    const missingLabel = label || "Folder";

    if (!fs.existsSync(fullPath)) {
        throw new Error(
            `${missingLabel} does not exist: ${relativePath}`
        );
    }

    const stats = fs.statSync(fullPath);

    if (!stats.isDirectory()) {
        throw new Error(
            `Path is not a folder: ${relativePath}`
        );
    }

    return stats;
}

function readFile(relativePath) {
    const fullPath = resolveWorkspacePath(relativePath);

    requireFile(fullPath, relativePath);

    return {
        success: true,
        path: relativePath,
        content: fs.readFileSync(
            fullPath,
            "utf8"
        )
    };
}

function updateFile(relativePath, content) {
    const fullPath = resolveWorkspacePath(relativePath);

    requireFile(fullPath, relativePath);

    fs.writeFileSync(
        fullPath,
        String(content),
        "utf8"
    );

    return {
        success: true,
        path: relativePath,
        fullPath,
        size: Buffer.byteLength(String(content), "utf8")
    };
}

function deleteFile(relativePath) {
    const fullPath = resolveWorkspacePath(relativePath);

    requireFile(fullPath, relativePath);

    fs.unlinkSync(fullPath);

    return {
        success: true,
        path: relativePath
    };
}

function deleteFolder(relativePath) {
    const fullPath = resolveWorkspacePath(relativePath);

    if (!fs.existsSync(fullPath)) {
        throw new Error(
            `Folder does not exist: ${relativePath}`
        );
    }

    if (fullPath === getWorkspaceRoot()) {
        throw new Error(
            "The Nexus workspace root cannot be deleted."
        );
    }

    requireDirectory(fullPath, relativePath, "Folder");

    fs.rmSync(fullPath, {
        recursive: true,
        force: true
    });

    return {
        success: true,
        path: relativePath
    };
}

function listFiles(relativePath = "") {
    const fullPath = resolveWorkspacePath(relativePath);

    requireDirectory(fullPath, relativePath);

    const entries = fs.readdirSync(
        fullPath,
        {
            withFileTypes: true
        }
    );

    return {
        success: true,
        path: relativePath,
        entries: entries.map(entry => ({
            name: entry.name,
            type: entry.isDirectory()
                ? "folder"
                : "file"
        }))
    };
}

function fileExists(relativePath) {
    const fullPath = resolveWorkspacePath(relativePath);

    return {
        success: true,
        path: relativePath,
        exists: fs.existsSync(fullPath)
    };
}

function getWorkspaceTree(relativePath = "") {
    const fullPath = resolveWorkspacePath(relativePath);

    requireDirectory(fullPath, relativePath);

    function walk(directory, relativeDirectory = "") {
        const entries = fs.readdirSync(
            directory,
            {
                withFileTypes: true
            }
        );

        return entries.map(entry => {
            const entryPath = path.join(
                directory,
                entry.name
            );
            const relativePath = path.posix.join(
                relativeDirectory.replace(/\\/g, "/"),
                entry.name
            );

            if (entry.isDirectory()) {
                return {
                    name: entry.name,
                    path: relativePath,
                    type: "folder",
                    children: walk(entryPath, relativePath)
                };
            }

            return {
                name: entry.name,
                path: relativePath,
                type: "file"
            };
        });
    }

    return {
        success: true,
        path: relativePath,
        tree: walk(fullPath, relativePath)
    };
}

module.exports = {
    ensureWorkspace,
    resolveWorkspacePath,
    createFolder,
    createFile,
    readFile,
    updateFile,
    deleteFile,
    deleteFolder,
    listFiles,
    fileExists,
    getWorkspaceRoot,
    getWorkspaceTree
};