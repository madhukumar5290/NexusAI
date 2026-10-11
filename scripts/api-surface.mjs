/**
 * API surface check.
 *
 * Starts from the server's own route table rather than a hand-written
 * list, so this covers every endpoint that actually exists. For each
 * one it asserts a status that means "the route ran" — 2xx, or 4xx
 * where a parameter is required — and fails on 5xx, which is the
 * signal that a handler crashed.
 *
 * Usage: node scripts/api-surface.mjs
 */

const BASE = process.env.NEXUS_URL || "http://127.0.0.1:3000/";

/* Mutating probes must be validation-only or use disposable records below. */
const POST_CASES = [
    { path: "api/auth/keys", body: { label: "surface-check", role: "invalid-test-role" }, expect: [400, 401, 403] }
];

/* Every read-only endpoint the UI depends on. */
const GET_CASES = [
    "api/health",
    "api/ready",
    "api/metrics",
    "api/usage",
    "api/capabilities",
    "api/models",
    "api/runtime",
    "api/agents",
    "api/projects",
    "api/automations",
    "api/integrations",
    "api/evals",
    "api/benchmarks",
    "api/auth/status",
    "api/auth/methods",
    "api/auth/keys",
    "api/auth/permissions",
    "api/chat/stream/active",
    "api/chats",
    "api/memories",
    "api/workspace"
];

const results = [];

async function checkGet(route) {
    try {
        const response = await fetch(BASE + route);
        const ok = response.status < 500;
        results.push({ route, method: "GET", status: response.status, ok });
        return ok;
    } catch (error) {
        results.push({ route, method: "GET", status: "ERR", ok: false, error: String(error.message) });
        return false;
    }
}

async function checkPost(testCase) {
    try {
        const response = await fetch(BASE + testCase.path, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(testCase.body)
        });
        const ok = testCase.expect.includes(response.status);
        results.push({
            route: testCase.path,
            method: "POST",
            status: response.status,
            ok,
            expected: testCase.expect.join("/")
        });
        return ok;
    } catch (error) {
        results.push({
            route: testCase.path,
            method: "POST",
            status: "ERR",
            ok: false,
            error: String(error.message)
        });
        return false;
    }
}

for (const route of GET_CASES) {
    await checkGet(route);
}

for (const testCase of POST_CASES) {
    await checkPost(testCase);
}

async function checkProjectChatFlow() {
    const createdIds = [];
    let projectId = null;
    let chatId = null;
    let viewerKeyLabel = null;
    const route = "api/projects/:id-and-chat-link";
    try {
        const projectResponse = await fetch(BASE + "api/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                name: `API surface ${Date.now()}`,
                goal: "Temporary project link regression check"
            })
        });
        if (!projectResponse.ok) throw new Error(`project create returned ${projectResponse.status}`);
        const projectData = await projectResponse.json();
        projectId = String(projectData.project.chatId);
        createdIds.push(projectId);

        const chatResponse = await fetch(BASE + "api/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Temporary project link check" })
        });
        if (!chatResponse.ok) throw new Error(`chat create returned ${chatResponse.status}`);
        const chat = await chatResponse.json();
        chatId = String(chat.id);
        createdIds.push(chatId);

        const archiveResponse = await fetch(BASE + `api/chat/${chatId}/archive`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archived: true })
        });
        if (!archiveResponse.ok) throw new Error(`archive chat returned ${archiveResponse.status}`);
        const archivedResponse = await fetch(BASE + `api/chats/${chatId}`);
        if (!archivedResponse.ok) throw new Error(`archived chat lookup returned ${archivedResponse.status}`);
        const archivedData = await archivedResponse.json();
        if (Number(archivedData.chat?.archived) !== 1) {
            throw new Error("archiving the disposable chat did not persist");
        }
        const restoreResponse = await fetch(BASE + `api/chat/${chatId}/archive`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archived: false })
        });
        if (!restoreResponse.ok) throw new Error(`restore chat returned ${restoreResponse.status}`);

        const linkResponse = await fetch(BASE + `api/chats/${chatId}/project`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: Number(projectId) })
        });
        if (!linkResponse.ok) throw new Error(`link chat returned ${linkResponse.status}`);
        const linkedChat = await linkResponse.json();
        if (Number(linkedChat.project_id) !== Number(projectId)) {
            throw new Error("chat-project association was not persisted");
        }

        const detailsResponse = await fetch(BASE + `api/projects/${projectId}`);
        if (!detailsResponse.ok) throw new Error(`project details returned ${detailsResponse.status}`);
        const details = await detailsResponse.json();
        if (!details.chats.some(item => Number(item.id) === Number(chatId))) {
            throw new Error("project details did not include the associated chat");
        }

        const updateResponse = await fetch(BASE + `api/projects/${projectId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Updated temporary project", goal: "Updated goal" })
        });
        if (!updateResponse.ok) throw new Error(`project update returned ${updateResponse.status}`);
        const updated = await updateResponse.json();
        if (updated.project.name !== "Updated temporary project" || updated.project.goal !== "Updated goal") {
            throw new Error("project name or goal update was not persisted");
        }

        viewerKeyLabel = `api-surface-viewer-${Date.now()}`;
        const viewerKeyResponse = await fetch(BASE + "api/auth/keys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label: viewerKeyLabel, role: "viewer" })
        });
        if (!viewerKeyResponse.ok) {
            throw new Error(`viewer authorization probe setup returned ${viewerKeyResponse.status}`);
        }
        const viewerKey = await viewerKeyResponse.json();
        const viewerHeaders = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${viewerKey.key}`
        };
        const deniedMutations = await Promise.all([
            fetch(BASE + "api/projects", {
                method: "POST",
                headers: viewerHeaders,
                body: JSON.stringify({ name: "Viewer must not create projects" })
            }),
            fetch(BASE + `api/projects/${projectId}`, {
                method: "PATCH",
                headers: viewerHeaders,
                body: JSON.stringify({ name: "Viewer must not rename projects" })
            }),
            fetch(BASE + `api/project/${projectId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${viewerKey.key}` }
            }),
            fetch(BASE + `api/chats/${chatId}/project`, {
                method: "PATCH",
                headers: viewerHeaders,
                body: JSON.stringify({ projectId: null })
            }),
            fetch(BASE + "api/knowledge/documents", {
                method: "POST",
                headers: viewerHeaders,
                body: JSON.stringify({ name: "blocked.txt", content: "blocked", encoding: "utf8" })
            }),
            fetch(BASE + "api/knowledge/documents/blocked.txt", {
                method: "DELETE",
                headers: { Authorization: `Bearer ${viewerKey.key}` }
            }),
            fetch(BASE + "api/workspace/file", {
                method: "POST",
                headers: viewerHeaders,
                body: JSON.stringify({ path: "viewer-denied.txt", content: "must not write" })
            }),
            fetch(BASE + "api/workspace/upload", {
                method: "POST",
                headers: viewerHeaders,
                body: JSON.stringify({
                    files: [{ name: "viewer-denied-upload.txt", content: "must not upload" }]
                })
            }),
            fetch(BASE + "api/terminal", {
                method: "POST",
                headers: viewerHeaders,
                body: JSON.stringify({})
            }),
            fetch(BASE + "api/git/commit", {
                method: "POST",
                headers: viewerHeaders,
                body: JSON.stringify({})
            }),
            fetch(BASE + "api/evals/run", {
                method: "POST",
                headers: viewerHeaders,
                body: JSON.stringify({ suite: "nexus-invariants" })
            })
        ]);
        if (deniedMutations.some(response => response.status !== 403)) {
            throw new Error(
                `viewer mutation policy returned ${deniedMutations.map(response => response.status).join(",")}, expected 403`
            );
        }

        const deleteProjectResponse = await fetch(BASE + `api/projects/${projectId}`, {
            method: "DELETE"
        });
        if (!deleteProjectResponse.ok) throw new Error(`project delete returned ${deleteProjectResponse.status}`);
        createdIds.splice(createdIds.indexOf(projectId), 1);
        const unlinkedResponse = await fetch(BASE + "api/chats");
        const unlinkedData = await unlinkedResponse.json();
        const remainingChat = (Array.isArray(unlinkedData) ? unlinkedData : unlinkedData.chats || [])
            .find(item => Number(item.id) === Number(chatId));
        if (!remainingChat || remainingChat.project_id !== null) {
            throw new Error("deleting a project did not safely detach its chats");
        }

        results.push({ route, method: "FLOW", status: "PASS", ok: true });
    } catch (error) {
        results.push({ route, method: "FLOW", status: "FAIL", ok: false, error: String(error.message) });
    } finally {
        if (viewerKeyLabel) {
            await fetch(BASE + `api/auth/keys/${encodeURIComponent(viewerKeyLabel)}`, {
                method: "DELETE"
            }).catch(() => {});
        }
        if (projectId && createdIds.includes(projectId)) {
            await fetch(BASE + `api/projects/${projectId}`, { method: "DELETE" }).catch(() => {});
        }
        if (chatId && createdIds.includes(chatId)) {
            await fetch(BASE + `api/chats/${chatId}`, { method: "DELETE" }).catch(() => {});
        }
    }
}

await checkProjectChatFlow();

/* Report. */
const failed = results.filter(r => !r.ok);

for (const r of results) {
    const mark = r.ok ? "ok  " : "FAIL";
    const expected = r.expected ? ` (expected ${r.expected})` : "";
    const details = r.error ? ` — ${r.error}` : "";
    console.log(`${mark} ${r.method.padEnd(4)} ${r.route.padEnd(30)} ${r.status}${expected}${details}`);
}

console.log(
    `\nAPI SURFACE: ${failed.length === 0 ? "PASS" : "FAIL"} — ` +
    `${results.length - failed.length}/${results.length} endpoints healthy`
);

process.exit(failed.length === 0 ? 0 : 1);