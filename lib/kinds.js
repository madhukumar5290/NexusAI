const path = require("path");

/*
=========================================================
FILE KINDS
=========================================================
Single source of truth for classifying a file
by extension. Used by the artifact store, the
preview server, and syntax selection in the UI.
=========================================================
*/

const KIND_BY_EXTENSION = {
    ".html": "html",
    ".htm": "html",

    ".css": "css",

    ".js": "js",
    ".mjs": "js",
    ".cjs": "js",
    ".jsx": "jsx",
    ".ts": "ts",
    ".tsx": "tsx",

    ".json": "json",
    ".jsonc": "json",

    ".md": "markdown",
    ".markdown": "markdown",

    ".svg": "image",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".gif": "image",
    ".webp": "image",
    ".ico": "image",

    ".txt": "text",
    ".log": "text",
    ".env": "text",

    ".yml": "yaml",
    ".yaml": "yaml",

    ".xml": "xml",

    ".py": "python",
    ".rb": "ruby",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".cs": "csharp",
    ".php": "php",
    ".sql": "sql",
    ".sh": "shell",
    ".ps1": "shell",

    ".csv": "csv"
};

const PREVIEWABLE = new Set(["html"]);

const TEXTUAL = new Set([
    "html",
    "css",
    "js",
    "jsx",
    "ts",
    "tsx",
    "json",
    "markdown",
    "text",
    "yaml",
    "xml",
    "python",
    "ruby",
    "go",
    "rust",
    "java",
    "csharp",
    "php",
    "sql",
    "shell",
    "csv",
    "image"
]);

function kindOf(filePath) {
    const extension = path
        .extname(String(filePath || ""))
        .toLowerCase();

    return KIND_BY_EXTENSION[extension] || "other";
}

function isPreviewable(filePath) {
    return PREVIEWABLE.has(kindOf(filePath));
}

function isTextual(filePath) {
    return TEXTUAL.has(kindOf(filePath));
}

/*
Language hint for the code editor, mapped
from the kind.
*/

function languageOf(filePath) {
    const kind = kindOf(filePath);

    if (kind === "js" || kind === "jsx") {
        return "javascript";
    }

    if (kind === "ts" || kind === "tsx") {
        return "typescript";
    }

    return kind;
}

module.exports = {
    kindOf,
    isPreviewable,
    isTextual,
    languageOf,
    PREVIEWABLE
};
