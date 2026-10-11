"use strict";

/*
 * Integration definitions intentionally contain metadata only.  Credentials
 * and transport clients belong to the application using this registry and are
 * never accepted or retained here.
 */

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|credential|private[-_]?key|authorization|cookie)/i;
const connectors = new Map();
const states = new Map();

const BUILT_INS = [
    ["mcp", "Model Context Protocol", "MCP servers and tools", ["tools", "resources"]],
    ["github", "GitHub", "Repositories, issues, and pull requests", ["repositories", "issues", "pull_requests"]],
    ["google-drive", "Google Drive", "Files and folders from Google Drive", ["files", "folders", "search"]],
    ["onedrive", "OneDrive", "Files and folders from Microsoft OneDrive", ["files", "folders", "search"]],
    ["database", "Database", "SQL and document databases", ["query", "metadata"]],
    ["rest", "Generic REST", "HTTP APIs described by a REST contract", ["http", "json"]],
    ["email", "Email", "Mailboxes and message delivery", ["messages", "send"]],
    ["calendar", "Calendar", "Calendars and events", ["events", "scheduling"]],
    ["storage", "Storage", "Object and file storage", ["files", "objects"]],
    ["browser", "Browser", "Browser navigation and page metadata", ["navigation", "pages"]]
].map(([id, name, description, capabilities]) => ({
    id, name, description, capabilities, metadata: { category: id }, builtin: true
}));

function copy(value) {
    return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function safeMetadata(value) {
    if (value == null) return {};
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("metadata must be an object");
    }
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
        if (SECRET_KEY.test(key)) continue;
        if (item && typeof item === "object" && !Array.isArray(item)) {
            clean[key] = safeMetadata(item);
        } else if (Array.isArray(item)) {
            clean[key] = item.map(entry => (
                entry && typeof entry === "object" && !Array.isArray(entry)
                    ? safeMetadata(entry) : entry
            ));
        } else if (typeof item !== "function") {
            clean[key] = item;
        }
    }
    return clean;
}

function strings(value, field) {
    if (value == null) return [];
    if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
    const result = value.map(item => String(item).trim());
    if (result.some(item => !item)) throw new TypeError(`${field} must contain non-empty strings`);
    return [...new Set(result)];
}

function normalize(input, prior) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("connector manifest must be an object");
    }
    const source = { ...(prior || {}), ...input };
    const id = String(source.id || source.name || "").trim().toLowerCase();
    if (!ID_PATTERN.test(id)) throw new TypeError("connector id is invalid");
    const name = String(source.name || id).trim();
    if (!name) throw new TypeError("connector name must not be empty");
    return {
        id,
        name,
        description: String(source.description || "").trim(),
        version: source.version == null ? "1.0.0" : String(source.version),
        capabilities: strings(source.capabilities, "capabilities"),
        adapterAvailable: source.adapterAvailable === true,
        config: source.config && typeof source.config === "object" && !Array.isArray(source.config)
            ? copy(source.config) : {},
        metadata: safeMetadata(source.metadata),
        builtin: Boolean(source.builtin)
    };
}

function publicState(state) {
    return copy(state || {
        id: null, status: "disconnected", connectedAt: null,
        disconnectedAt: null, lastHealthAt: null, error: null, metadata: {}
    });
}

function publicManifest(manifest) {
    return copy(manifest);
}

function register(manifest) {
    const connector = normalize(manifest);
    if (connectors.has(connector.id)) throw new Error(`Connector already registered: ${connector.id}`);
    connectors.set(connector.id, connector);
    states.set(connector.id, {
        id: connector.id, status: "disconnected", connectedAt: null,
        disconnectedAt: null, lastHealthAt: null, error: null, metadata: {}
    });
    return publicManifest(connector);
}

function get(id) {
    const connector = connectors.get(String(id || "").trim().toLowerCase());
    return connector ? publicManifest(connector) : null;
}

function list(options) {
    const opts = options || {};
    return [...connectors.values()]
        .filter(item => opts.builtin == null || item.builtin === Boolean(opts.builtin))
        .map(publicManifest);
}

function state(id) {
    const key = String(id || "").trim().toLowerCase();
    return connectors.has(key) ? publicState(states.get(key)) : null;
}

function setConnectionState(id, status, metadata) {
    const key = String(id || "").trim().toLowerCase();
    if (!connectors.has(key)) return null;
    const allowed = new Set(["connected", "connecting", "disconnected", "error"]);
    if (!allowed.has(status)) throw new TypeError("invalid connection status");
    const current = states.get(key);
    const now = new Date().toISOString();
    current.status = status;
    current.error = status === "error" ? (metadata && metadata.error ? String(metadata.error) : "Connection error") : null;
    current.metadata = safeMetadata(metadata && metadata.metadata);
    if (status === "connected") current.connectedAt = current.connectedAt || now;
    if (status === "disconnected") current.disconnectedAt = now;
    return publicState(current);
}

function connect(id, metadata) {
    return setConnectionState(id, "connected", { metadata });
}

function disconnect(id) {
    return setConnectionState(id, "disconnected");
}

function unregister(id) {
    const key = String(id || "").trim().toLowerCase();
    const connector = connectors.get(key);
    if (!connector || connector.builtin) return false;
    connectors.delete(key);
    states.delete(key);
    return true;
}

function health(id) {
    const current = state(id);
    if (!current) return null;
    current.lastHealthAt = new Date().toISOString();
    states.get(String(id).trim().toLowerCase()).lastHealthAt = current.lastHealthAt;
    return {
        id: current.id,
        healthy: current.status === "connected",
        status: current.status,
        checkedAt: current.lastHealthAt,
        error: current.error
    };
}

function reset() {
    connectors.clear();
    states.clear();
    BUILT_INS.forEach(item => register(item));
}

reset();

module.exports = {
    BUILT_INS: Object.freeze(BUILT_INS.map(copy)),
    register, registerConnector: register,
    list, listConnectors: list,
    get, getConnector: get,
    state, getState: state, getConnectionState: state, connectionState: state,
    setConnectionState, connect, disconnect, health,
    healthCheck: health, checkHealth: health, unregister, remove: unregister,
    reset
};
