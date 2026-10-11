const fs = require("fs");
const path = require("path");

const config = require("../../lib/config");

const DATA_DIR = config.DATA_DIR;
const STATE_FILE = path.join(DATA_DIR, "project-state.json");

function ensureStore() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(STATE_FILE)) {
        fs.writeFileSync(
            STATE_FILE,
            JSON.stringify({}, null, 2),
            "utf8"
        );
    }
}

function loadAll() {
    ensureStore();

    try {
        const raw = fs.readFileSync(STATE_FILE, "utf8");
        const data = JSON.parse(raw);

        return data && typeof data === "object"
            ? data
            : {};
    } catch {
        return {};
    }
}

function saveAll(data) {
    ensureStore();

    const tempFile = `${STATE_FILE}.tmp`;

    fs.writeFileSync(
        tempFile,
        JSON.stringify(data, null, 2),
        "utf8"
    );

    fs.renameSync(tempFile, STATE_FILE);
}

function cleanArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return [
        ...new Set(
            value
                .map(item => String(item || "").trim())
                .filter(Boolean)
        )
    ];
}

function get(chatId) {
    if (!chatId) {
        return null;
    }

    const all = loadAll();

    return all[String(chatId)] || null;
}

function save(chatId, state) {
    if (!chatId) {
        return null;
    }

    const all = loadAll();
    const id = String(chatId);

    const normalized = {
        chatId: id,

        name: String(
            state.name || "Untitled Project"
        ),

        goal: String(
            state.goal || ""
        ),

        requirements: cleanArray(
            state.requirements
        ),

        preferences: cleanArray(
            state.preferences
        ),

        artifacts: cleanArray(
            state.artifacts
        ),

        status: String(
            state.status || "in_progress"
        ),

        createdAt:
            state.createdAt ||
            new Date().toISOString(),

        updatedAt:
            new Date().toISOString()
    };

    all[id] = normalized;

    saveAll(all);

    return normalized;
}

function merge(chatId, patch) {
    const current =
        get(chatId) ||
        {
            chatId: String(chatId),
            name: "",
            goal: "",
            requirements: [],
            preferences: [],
            artifacts: [],
            status: "in_progress",
            createdAt: new Date().toISOString()
        };

    const next = {
        ...current,
        ...patch,

        requirements: cleanArray([
            ...(current.requirements || []),
            ...(patch.requirements || [])
        ]),

        preferences: cleanArray([
            ...(current.preferences || []),
            ...(patch.preferences || [])
        ]),

        artifacts: cleanArray([
            ...(current.artifacts || []),
            ...(patch.artifacts || [])
        ])
    };

    return save(chatId, next);
}

function clear(chatId) {
    if (!chatId) {
        return;
    }

    const all = loadAll();

    delete all[String(chatId)];

    saveAll(all);
}

function getAll() {
    return loadAll();
}

module.exports = {
    ensureStore,
    get,
    save,
    merge,
    clear,
    getAll
};