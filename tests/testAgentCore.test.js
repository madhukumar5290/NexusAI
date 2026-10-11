const test = require("node:test");
const assert = require("assert");

/*
Stub workspaceTools and projectState BEFORE loading
agentCore, since require caches module instances.
*/

const calls = [];

let files = {}; // simulated workspace

const workspaceTools = {
    getWorkspaceTree: () => ({
        success: true,
        tree: []
    }),
    getWorkspaceRoot: () => "/fake/workspace",
    readFile: relativePath => {
        if (!(relativePath in files)) {
            throw new Error(`File does not exist: ${relativePath}`);
        }
        return {
            success: true,
            path: relativePath,
            content: files[relativePath]
        };
    },
    fileExists: relativePath => {
        calls.push("fileExists");
        return {
            success: true,
            path: relativePath,
            exists: relativePath in files
        };
    },
    createFile: (relativePath, content) => {
        calls.push(["createFile", relativePath]);
        files[relativePath] = content;
        return { success: true, path: relativePath };
    },
    updateFile: (relativePath, content) => {
        calls.push(["updateFile", relativePath]);
        if (!(relativePath in files)) {
            throw new Error(`File does not exist: ${relativePath}`);
        }
        files[relativePath] = content;
        return { success: true, path: relativePath };
    }
};

const projectState = {
    states: new Map(),
    savedIds: [],
    get(chatId) {
        return this.states.get(String(chatId)) || null;
    },
    save(chatId, project) {
        const id = String(chatId);
        this.savedIds.push(id);
        const saved = { ...project, chatId: id };
        this.states.set(id, saved);
        return saved;
    },
    merge(chatId, project) {
        return this.save(chatId, project);
    }
};
const chats = new Map();
const database = {
    getChat(chatId) {
        return chats.get(String(chatId)) || null;
    }
};

const workspaceToolsPath = require.resolve("../src/agent/workspaceTools");
const projectStatePath = require.resolve("../src/agent/projectState");
const databasePath = require.resolve("../src/rag/database");

require.cache[workspaceToolsPath] = {
    id: workspaceToolsPath,
    filename: workspaceToolsPath,
    loaded: true,
    exports: workspaceTools
};
require.cache[projectStatePath] = {
    id: projectStatePath,
    filename: projectStatePath,
    loaded: true,
    exports: projectState
};
require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: database
};

const agentCore = require("../src/agent/agentCore");

const CHAT_ID = "test-chat";

test("linked chats inherit project goals and update the parent project state", async () => {
    const project = {
        chatId: "42",
        name: "Garden plan",
        goal: "Plan a low-water garden",
        requirements: [],
        preferences: [],
        artifacts: [],
        status: "in_progress"
    };
    projectState.states.set("42", project);
    chats.set("99", { id: 99, project_id: 42 });
    projectState.savedIds.length = 0;

    const result = await agentCore.run({
        chatId: "99",
        userMessage: "Hello Jarwis",
        conversation: "",
        executeWorkspaceActions: false
    });

    assert.equal(result.project.chatId, "42");
    assert.equal(result.project.goal, "Plan a low-water garden");
    assert.deepEqual(projectState.savedIds, ["42"]);
    assert.equal(projectState.get("99"), null);
    chats.delete("99");
    projectState.states.delete("42");
});

test("executeWorkspace CREATE mode writes and verifies new files", async () => {
    files = {};

    const project = {
        name: "Test Project",
        goal: "test",
        requirements: [],
        preferences: [],
        artifacts: []
    };

    const plan = {
        files: [
            { path: "index.html", content: "<html></html>" },
            { path: "style.css", content: "body{}" }
        ]
    };

    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: true,
        json: async () => ({
            message: {
                content: JSON.stringify(plan)
            }
        })
    });

    try {
        const result = await agentCore.executeWorkspace(
            CHAT_ID,
            "create a site",
            "",
            project,
            "CREATE"
        );

        assert.equal(result.success, true);
        assert.deepEqual(result.changed, ["index.html", "style.css"]);
        assert.deepEqual(result.verified, ["index.html", "style.css"]);
        assert.equal(files["index.html"], "<html></html>");
        assert.equal(files["style.css"], "body{}");
    } finally {
        global.fetch = originalFetch;
    }
});

test("executeWorkspace MODIFY mode updates existing files", async () => {
    files = { "index.html": "<html>old</html>" };

    const project = { name: "Test Project", goal: "test" };

    const plan = {
        files: [{ path: "index.html", content: "<html>new</html>" }]
    };

    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: true,
        json: async () => ({
            message: { content: JSON.stringify(plan) }
        })
    });

    try {
        const result = await agentCore.executeWorkspace(
            CHAT_ID,
            "update the site",
            "",
            project,
            "MODIFY"
        );

        assert.equal(result.success, true);
        assert.equal(files["index.html"], "<html>new</html>");
        assert.ok(
            calls.some(
                c =>
                    Array.isArray(c) &&
                    c[0] === "updateFile" &&
                    c[1] === "index.html"
            )
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test("executeWorkspace rejects empty generated content", async () => {
    files = {};

    const project = { name: "Test Project" };

    const plan = {
        files: [{ path: "index.html", content: "" }]
    };

    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: true,
        json: async () => ({
            message: { content: JSON.stringify(plan) }
        })
    });

    try {
        await assert.rejects(
            () =>
                agentCore.executeWorkspace(
                    CHAT_ID,
                    "create a site",
                    "",
                    project,
                    "CREATE"
                ),
            /Generated file is empty/
        );
    } finally {
        global.fetch = originalFetch;
    }
});

test("executeWorkspace rejects unsafe paths", async () => {
    files = {};

    const project = { name: "Test Project" };

    const plan = {
        files: [{ path: "../escape.html", content: "x" }]
    };

    const originalFetch = global.fetch;
    global.fetch = async () => ({
        ok: true,
        json: async () => ({
            message: { content: JSON.stringify(plan) }
        })
    });

    try {
        await assert.rejects(
            () =>
                agentCore.executeWorkspace(
                    CHAT_ID,
                    "create a site",
                    "",
                    project,
                    "CREATE"
                ),
            /Unsafe file path/
        );
    } finally {
        global.fetch = originalFetch;
    }
});
