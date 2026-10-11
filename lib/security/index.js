"use strict";

/*
 * Nexus AI — Security core.
 *
 * Local-first auth primitives for the Nexus API:
 *   - API keys (hashed at rest, never stored in plaintext)
 *   - Users and roles (owner / admin / member / viewer)
 *   - Sessions (signed, expiring bearer tokens for the web UI)
 *   - Role-based permission checks against the tool capability model
 *   - Audit log of security-relevant actions
 *
 * Design notes
 * ------------
 * Nexus ships as a single-user local app by default. Authentication is
 * therefore OPT-IN: when no keys and no users exist and
 * NEXUS_REQUIRE_AUTH is not set, every request is treated as the local
 * "owner" so the app keeps working out of the box. The moment a user or
 * key is created — or auth is forced on via env — unauthenticated
 * requests are rejected. This mirrors how a local tool graduates into a
 * shared deployment without a rewrite.
 *
 * Nothing here ever stores a plaintext secret:
 *   - API keys are stored as sha256(key:pepper)
 *   - User passwords are stored as scrypt(password, salt) with a random salt
 *   - Session tokens are random 32-byte values, stored hashed
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const config = require("../config");

/*
=========================================================
STORAGE
=========================================================
Security state is kept in a small JSON document under the
data directory. It is deliberately separate from nexus.db
so that a future multi-user migration can move it without
touching chat data, and so a corrupt chat DB never locks
the operator out.
=========================================================
*/

const SECURITY_FILE = path.join(config.DATA_DIR, "security.json");

function readStore() {
    try {
        const raw = fs.readFileSync(SECURITY_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return {
            users: Array.isArray(parsed.users) ? parsed.users : [],
            keys: Array.isArray(parsed.keys) ? parsed.keys : [],
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
            preferences: parsed.preferences || {}
        };
    } catch {
        return { users: [], keys: [], sessions: [], preferences: {} };
    }
}

function writeStore(store) {
    fs.mkdirSync(path.dirname(SECURITY_FILE), { recursive: true });
    const tmp = `${SECURITY_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), "utf8");
    fs.renameSync(tmp, SECURITY_FILE);
}

/*
=========================================================
ROLES + PERMISSIONS
=========================================================
Roles map onto the tool capability model used by
src/agent/permissions.js. A role is a set of capabilities
it is allowed to exercise. The "owner" role is the local
operator and holds everything.
=========================================================
*/

const ROLES = Object.freeze({
    owner: {
        label: "Owner",
        capabilities: [
            "READ", "WRITE", "DELETE", "EXECUTE", "NETWORK",
            "BROWSER", "GIT", "GITHUB", "PUBLISH", "SEND",
            "DATABASE", "ADMIN"
        ]
    },
    admin: {
        label: "Admin",
        capabilities: [
            "READ", "WRITE", "DELETE", "EXECUTE", "NETWORK",
            "BROWSER", "GIT", "GITHUB", "PUBLISH", "SEND",
            "DATABASE", "ADMIN"
        ]
    },
    member: {
        label: "Member",
        capabilities: [
            "READ", "WRITE", "NETWORK", "BROWSER", "GIT", "DATABASE"
        ]
    },
    viewer: {
        label: "Viewer",
        capabilities: ["READ"]
    }
});

function roleCapabilities(role) {
    const entry = ROLES[role];
    return entry ? [...entry.capabilities] : [];
}

/*
=========================================================
HASHING
=========================================================
*/

function pepper() {
    return process.env.NEXUS_SECURITY_PEPPER || "nexus-local-pepper";
}

function sha256(value) {
    return crypto
        .createHash("sha256")
        .update(String(value) + pepper(), "utf8")
        .digest("hex");
}

function hashPassword(password, salt) {
    const useSalt = salt || crypto.randomBytes(16).toString("hex");
    const derived = crypto
        .scryptSync(String(password), useSalt, 64)
        .toString("hex");
    return { salt: useSalt, hash: derived };
}

function verifyPassword(password, salt, expected) {
    const { hash } = hashPassword(password, salt);
    const a = Buffer.from(hash, "hex");
    const b = Buffer.from(String(expected || ""), "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

function randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString("base64url");
}

/*
=========================================================
USERS
=========================================================
*/

function listUsers() {
    return readStore().users.map(user => ({
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt,
        disabled: Boolean(user.disabled)
    }));
}

function findUser(username) {
    const name = String(username || "").trim().toLowerCase();
    return readStore().users.find(
        user => user.username.toLowerCase() === name
    ) || null;
}

function createUser({ username, password, role = "member", emailVerified = true }) {
    const name = String(username || "").trim();
    if (!name) throw new Error("A username is required.");
    if (!ROLES[role]) throw new Error(`Unknown role: ${role}`);
    if (findUser(name)) throw new Error(`User "${name}" already exists.`);

    const store = readStore();
    const { salt, hash } = hashPassword(password || randomToken(12));
    const user = {
        id: `usr_${randomToken(9)}`,
        username: name,
        role,
        salt,
        hash,
        createdAt: new Date().toISOString(),
        disabled: false,
        emailVerified: Boolean(emailVerified)
    };
    store.users.push(user);
    writeStore(store);
    audit({
        action: "user.create",
        actor: "system",
        target: user.username,
        detail: { role }
    });
    return { id: user.id, username: user.username, role: user.role };
}

function issueAccountToken(username, type, ttlMs = 30 * 60 * 1000) {
    if (!["emailVerification", "passwordReset"].includes(type)) {
        throw new TypeError("Invalid account token type.");
    }
    const store = readStore();
    const user = store.users.find(entry =>
        entry.username.toLowerCase() === String(username || "").trim().toLowerCase() ||
        entry.googleEmail?.toLowerCase() === String(username || "").trim().toLowerCase()
    );
    if (!user || user.disabled) return null;

    const token = randomToken(32);
    user[`${type}Hash`] = sha256(token);
    user[`${type}ExpiresAt`] = Date.now() + ttlMs;
    writeStore(store);
    return token;
}

function consumeAccountToken(token, type) {
    if (!["emailVerification", "passwordReset"].includes(type)) {
        throw new TypeError("Invalid account token type.");
    }
    const value = String(token || "").trim();
    if (!value) return null;
    const store = readStore();
    const expectedHash = sha256(value);
    const user = store.users.find(entry => {
        const storedHash = String(entry[`${type}Hash`] || "");
        if (!/^[a-f0-9]{64}$/i.test(storedHash)) return false;
        return crypto.timingSafeEqual(
            Buffer.from(storedHash, "hex"),
            Buffer.from(expectedHash, "hex")
        );
    });
    if (
        !user ||
        user.disabled ||
        !Number.isFinite(user[`${type}ExpiresAt`]) ||
        user[`${type}ExpiresAt`] <= Date.now()
    ) return null;

    delete user[`${type}Hash`];
    delete user[`${type}ExpiresAt`];
    if (type === "emailVerification") user.emailVerified = true;
    writeStore(store);
    return { id: user.id, username: user.username, role: user.role };
}

function clearAccountToken(username, type) {
    if (!["emailVerification", "passwordReset"].includes(type)) {
        throw new TypeError("Invalid account token type.");
    }
    const store = readStore();
    const user = store.users.find(entry =>
        entry.username.toLowerCase() === String(username || "").trim().toLowerCase() ||
        entry.googleEmail?.toLowerCase() === String(username || "").trim().toLowerCase()
    );
    if (!user) return false;
    delete user[`${type}Hash`];
    delete user[`${type}ExpiresAt`];
    writeStore(store);
    return true;
}

function setPasswordWithToken(token, password) {
    const user = consumeAccountToken(token, "passwordReset");
    if (!user) return null;
    const store = readStore();
    const account = store.users.find(entry => entry.id === user.id);
    if (!account) return null;
    const { salt, hash } = hashPassword(password);
    account.salt = salt;
    account.hash = hash;
    store.sessions = store.sessions.filter(
        session => session.user !== account.username
    );
    writeStore(store);
    audit({
        action: "auth.password.reset",
        actor: account.username,
        target: "password"
    });
    return { id: account.id, username: account.username, role: account.role };
}

function setUserRole(username, role) {
    if (!ROLES[role]) throw new Error(`Unknown role: ${role}`);
    const store = readStore();
    const user = store.users.find(
        u => u.username.toLowerCase() === String(username).trim().toLowerCase()
    );
    if (!user) throw new Error(`User "${username}" not found.`);
    user.role = role;
    writeStore(store);
    audit({ action: "user.role", actor: "system", target: user.username, detail: { role } });
    return { id: user.id, username: user.username, role: user.role };
}

function deleteUser(username) {
    const store = readStore();
    const before = store.users.length;
    store.users = store.users.filter(
        u => u.username.toLowerCase() !== String(username).trim().toLowerCase()
    );
    if (store.users.length === before) return false;
    writeStore(store);
    audit({ action: "user.delete", actor: "system", target: username });
    return true;
}

function authenticate(username, password) {
    const user = findUser(username);
    if (!user || user.disabled) return null;
    if (user.emailVerified === false) return null;
    if (!verifyPassword(password, user.salt, user.hash)) return null;
    return { id: user.id, username: user.username, role: user.role };
}

function googleLoginEnabled() {
    return Boolean(
        process.env.GOOGLE_OAUTH_CLIENT_ID &&
        process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
        (process.env.NEXUS_GOOGLE_ADMIN_EMAIL ||
            process.env.NEXUS_GOOGLE_ALLOWED_EMAILS)
    );
}

function signupEnabled() {
    return false;
}

function signupInviteAvailable() {
    return false;
}

function signupInviteRequired() {
    return false;
}

function singleUserModeStatus() {
    const activeUsers = listUsers().filter(user => !user.disabled);
    return {
        allowed: activeUsers.length <= 1,
        activeUserCount: activeUsers.length
    };
}

function recoveryOwnerUsername(activeUsers = listUsers().filter(user => !user.disabled)) {
    const configuredUsername = String(
        process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME || ""
    ).trim().toLowerCase();
    if (configuredUsername) {
        const configuredOwner = activeUsers.find(user =>
            user.username.toLowerCase() === configuredUsername &&
            user.role === "owner"
        );
        if (configuredOwner) return configuredOwner.username;
    }

    const owners = activeUsers.filter(user => user.role === "owner");
    return owners.length === 1 ? owners[0].username : null;
}

function authenticateGoogleUser(profile) {
    const sub = String(profile?.sub || "").trim();
    const email = String(profile?.email || "").trim().toLowerCase();
    const emailVerified = profile?.email_verified === true;
    if (!sub || !email || !emailVerified) return null;

    const adminEmail = String(
        process.env.NEXUS_GOOGLE_ADMIN_EMAIL || ""
    ).trim().toLowerCase();
    const allowedEmails = new Set(
        String(process.env.NEXUS_GOOGLE_ALLOWED_EMAILS || "")
            .split(",")
            .map(value => value.trim().toLowerCase())
            .filter(Boolean)
    );
    if (adminEmail) allowedEmails.add(adminEmail);
    if (!allowedEmails.has(email)) return null;

    const store = readStore();
    let user = store.users.find(
        entry => entry.googleSub === sub || entry.googleEmail === email
    );

    if (!user) {
        user = store.users.find(
            entry => entry.username.toLowerCase() === email
        );
    }

    if (!user && email === adminEmail) {
        const bootstrapUsername = String(
            process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME || ""
        ).trim().toLowerCase();
        user = store.users.find(
            entry => entry.username.toLowerCase() === bootstrapUsername
        );
    }

    if (!user || user.disabled) return null;
    if (user?.googleSub && user.googleSub !== sub) return null;
    user.googleEmail = email;
    user.googleSub = sub;
    user.emailVerified = true;
    if (email === adminEmail) user.role = "owner";

    writeStore(store);
    return {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.googleEmail
    };
}

/*
=========================================================
API KEYS
=========================================================
Keys look like  nx_<prefix>_<secret>. Only the sha256 of the
full key is stored, so a leaked security.json cannot be
replayed against the API.
=========================================================
*/

function createApiKey({ label = "default", role = "owner", owner = "local" } = {}) {
    if (!ROLES[role]) throw new Error(`Unknown role: ${role}`);
    const prefix = randomToken(6);
    const secret = randomToken(24);
    const key = `nx_${prefix}_${secret}`;

    const store = readStore();
    store.keys.push({
        id: `key_${randomToken(8)}`,
        label: String(label || "default"),
        role,
        owner,
        prefix,
        hash: sha256(key),
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        revoked: false
    });
    writeStore(store);
    audit({ action: "apikey.create", actor: owner, target: label, detail: { role } });

    /* The plaintext key is returned exactly once. */
    return { key, label, role };
}

function listApiKeys() {
    return readStore().keys
        .filter(k => !k.revoked)
        .map(k => ({
            id: k.id,
            label: k.label,
            role: k.role,
            owner: k.owner,
            prefix: k.prefix,
            createdAt: k.createdAt,
            lastUsedAt: k.lastUsedAt
        }));
}

function revokeApiKey(idOrLabel) {
    const store = readStore();
    const needle = String(idOrLabel);
    let changed = false;
    store.keys.forEach(key => {
        if (key.id === needle || key.label === needle) {
            key.revoked = true;
            changed = true;
        }
    });
    if (changed) {
        writeStore(store);
        audit({ action: "apikey.revoke", actor: "system", target: needle });
    }
    return changed;
}

function verifyApiKey(presented) {
    const value = String(presented || "").trim();
    if (!value.startsWith("nx_")) return null;
    const store = readStore();
    const hash = sha256(value);
    const match = store.keys.find(
        key => !key.revoked && key.hash === hash
    );
    if (!match) return null;

    match.lastUsedAt = new Date().toISOString();
    writeStore(store);

    return {
        kind: "apikey",
        id: match.id,
        username: match.owner,
        role: match.role,
        label: match.label
    };
}

/*
=========================================================
SESSIONS
=========================================================
Short-lived bearer tokens for the web UI. Stored hashed,
same as API keys.
=========================================================
*/

const SESSION_TTL_MS = Number(process.env.NEXUS_SESSION_TTL_MS) || 1000 * 60 * 60 * 12;

function createSession(user) {
    const token = randomToken(32);
    const store = readStore();
    store.sessions.push({
        id: `ses_${randomToken(8)}`,
        hash: sha256(token),
        user: user.username,
        role: user.role,
        createdAt: Date.now(),
        expiresAt: Date.now() + SESSION_TTL_MS
    });
    /* Prune expired sessions on every write. */
    store.sessions = store.sessions.filter(s => s.expiresAt > Date.now());
    writeStore(store);
    return { token, expiresAt: Date.now() + SESSION_TTL_MS };
}

function verifySession(token) {
    const value = String(token || "").trim();
    if (!value) return null;
    const store = readStore();
    const hash = sha256(value);
    const session = store.sessions.find(s => s.hash === hash);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) return null;
    return {
        kind: "session",
        username: session.user,
        role: session.role
    };
}

function destroySession(token) {
    const store = readStore();
    const hash = sha256(String(token || "").trim());
    const before = store.sessions.length;
    store.sessions = store.sessions.filter(s => s.hash !== hash);
    writeStore(store);
    return store.sessions.length !== before;
}

/*
=========================================================
AUDIT LOG
=========================================================
Append-only JSONL. Kept on disk rather than in memory so
it survives restarts and can be shipped to a SIEM.
=========================================================
*/

const AUDIT_FILE = path.join(config.DATA_DIR, "audit.log");
const AUDIT_MAX_BYTES = Number(process.env.NEXUS_AUDIT_MAX_BYTES) || 5 * 1024 * 1024;

function audit(entry) {
    const record = {
        at: new Date().toISOString(),
        action: String(entry.action || "unknown"),
        actor: String(entry.actor || "anonymous"),
        target: entry.target == null ? null : String(entry.target),
        detail: entry.detail || {},
        ip: entry.ip || null
    };

    try {
        fs.mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });

        /* Simple rotation: when the log grows past the cap, move it aside. */
        try {
            const stat = fs.statSync(AUDIT_FILE);
            if (stat.size > AUDIT_MAX_BYTES) {
                fs.renameSync(AUDIT_FILE, `${AUDIT_FILE}.1`);
            }
        } catch {
            /* no existing log yet */
        }

        fs.appendFileSync(AUDIT_FILE, JSON.stringify(record) + "\n", "utf8");
    } catch {
        /* Audit must never break a request. */
    }

    return record;
}

function readAuditLog(limit = 200) {
    try {
        const raw = fs.readFileSync(AUDIT_FILE, "utf8");
        const lines = raw.split(/\r?\n/).filter(Boolean);
        return lines
            .slice(-Math.max(1, Number(limit) || 200))
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch {
                    return { at: null, action: "unparsed", raw: line };
                }
            })
            .reverse();
    } catch {
        return [];
    }
}

/*
=========================================================
AUTH STATE / MIDDLEWARE
=========================================================
*/

function isAuthRequired() {
    if (config.envBool("NEXUS_REQUIRE_AUTH", false)) return true;
    const store = readStore();
    return store.keys.some(k => !k.revoked) || store.users.length > 0;
}

/*
Nexus is local-first: the browser talks to the server over the
loopback interface. Requiring a credential there would lock the
operator out of their own UI the moment they created a key for an
external client — which is exactly what a key is for.

So a request that arrives from 127.0.0.1 / ::1 is trusted as the
local owner, and auth still guards every other origin. Set
NEXUS_STRICT_LOOPBACK_AUTH=true to require credentials even on
loopback (for a shared or proxied deployment).
*/
function isLoopback(req) {
    const address =
        req?.socket?.remoteAddress ||
        req?.connection?.remoteAddress ||
        "";

    return (
        address === "127.0.0.1" ||
        address === "::1" ||
        address === "::ffff:127.0.0.1" ||
        address === "localhost"
    );
}

function trustsLoopback() {
    return !config.envBool("NEXUS_STRICT_LOOPBACK_AUTH", false);
}

/* The identity assumed when auth is off (local single-user mode). */
const LOCAL_OWNER = Object.freeze({
    kind: "local",
    username: "local",
    role: "owner"
});

function extractCredential(req) {
    const header = String(req.headers?.authorization || "");
    if (header.toLowerCase().startsWith("bearer ")) {
        return header.slice(7).trim();
    }
    const keyHeader = req.headers?.["x-nexus-key"];
    if (keyHeader) return String(keyHeader).trim();

    const cookie = String(req.headers?.cookie || "");
    const sessionCookie = cookie
        .split(";")
        .map(value => value.trim())
        .find(value => value.startsWith("nexus_session="));
    if (sessionCookie) {
        try {
            return decodeURIComponent(sessionCookie.slice("nexus_session=".length));
        } catch {
            return null;
        }
    }
    return null;
}

/*
Resolve the caller's identity from the request, or null when
unauthenticated. Tries API keys first, then sessions.
*/
function resolveIdentity(req) {
    const credential = extractCredential(req);
    if (credential) {
        const verified = verifyApiKey(credential) || verifySession(credential);
        if (verified) return verified;
        /* A presented-but-invalid credential is never the owner. */
        return null;
    }

    if (!isAuthRequired()) return { ...LOCAL_OWNER };

    /* Local browser on loopback keeps working after keys exist. */
    if (trustsLoopback() && isLoopback(req)) {
        return { ...LOCAL_OWNER, kind: "loopback" };
    }

    return null;
}

/*
Express middleware. Attaches req.nexusUser when authenticated.
When auth is required and no valid credential is present,
responds 401 and stops the chain.
*/
function middleware() {
    return function nexusAuth(req, res, next) {
        const singleUserStatus = singleUserModeStatus();
        const accountRecoveryRequest =
            (req.method === "GET" && req.path === "/auth/users") ||
            (req.method === "DELETE" && /^\/auth\/users\/[^/]+$/.test(req.path)) ||
            (req.method === "POST" && req.path === "/auth/login");

        if (
            !singleUserStatus.allowed &&
            !accountRecoveryRequest &&
            req.path !== "/auth/status" &&
            req.path !== "/auth/methods" &&
            req.path !== "/health" &&
            req.path !== "/ready"
        ) {
            return res.status(503).json({
                error: "Nexus is in single-user safety mode because multiple accounts exist while data isolation is unavailable.",
                code: "MULTI_USER_DATA_ISOLATION_UNAVAILABLE",
                activeUserCount: singleUserStatus.activeUserCount,
                hint: "Disable or remove extra accounts before using chats, projects, memory, or workspace data."
            });
        }

        if (
            (req.method === "POST" && req.path === "/auth/login") ||
            (req.method === "POST" && req.path === "/auth/register") ||
            (req.method === "POST" && (
                req.path === "/auth/verify-email/resend" ||
                req.path === "/auth/password-reset/request" ||
                req.path === "/auth/password-reset"
            )) ||
            (req.method === "GET" &&
                (req.path === "/auth/methods" ||
                    req.path === "/auth/google" ||
                    req.path === "/auth/google/callback" ||
                    req.path === "/auth/verify-email")) ||
            (req.method === "GET" &&
                (req.path === "/health" || req.path === "/ready"))
        ) {
            return next();
        }

        const identity = resolveIdentity(req);
        if (identity) {
            req.nexusUser = identity;
            return next();
        }
        return res.status(401).json({
            error: "Authentication required.",
            hint: "Send an API key as 'Authorization: Bearer nx_...' or 'X-Nexus-Key'."
        });
    };
}

/*
Require a specific capability. Assumes middleware() ran first
(so req.nexusUser may be the local owner when auth is off).
*/
function requireCapability(capability) {
    return function nexusCapability(req, res, next) {
        const user = req.nexusUser || resolveIdentity(req) || LOCAL_OWNER;
        req.nexusUser = user;
        const caps = roleCapabilities(user.role);
        if (!caps.includes(capability)) {
            audit({
                action: "authz.denied",
                actor: user.username,
                target: capability,
                detail: { role: user.role, path: req.originalUrl }
            });
            return res.status(403).json({
                error: "Forbidden.",
                required: capability,
                role: user.role
            });
        }
        return next();
    };
}

/*
=========================================================
BOOTSTRAP
=========================================================
Local installs keep the implicit loopback owner. For a fresh
production install, deployment credentials create the first
owner once; public signup is never enabled.
=========================================================
*/

function ensureBootstrap() {
    const store = readStore();

    if (
        process.env.NODE_ENV === "production" &&
        config.envBool("NEXUS_REQUIRE_AUTH", false) &&
        String(process.env.NEXUS_SECURITY_PEPPER || "").length < 32
    ) {
        throw new Error(
            "Production auth requires NEXUS_SECURITY_PEPPER with at least 32 characters."
        );
    }

    if (!store.preferences.bootstrapAt) {
        store.preferences.bootstrapAt = new Date().toISOString();
        writeStore(store);
    }

    const username = String(
        process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME || ""
    ).trim();
    const password = String(
        process.env.NEXUS_BOOTSTRAP_ADMIN_PASSWORD || ""
    );

    if (Boolean(username) !== Boolean(password)) {
        throw new Error(
            "Set both NEXUS_BOOTSTRAP_ADMIN_USERNAME and " +
            "NEXUS_BOOTSTRAP_ADMIN_PASSWORD to provision the initial admin."
        );
    }

    if (!store.users.length && username) {
        if (password.length < 16) {
            throw new Error(
                "NEXUS_BOOTSTRAP_ADMIN_PASSWORD must contain at least 16 characters."
            );
        }
        createUser({ username, password, role: "owner" });
    }

    if (process.env.NODE_ENV === "production" && config.envBool("NEXUS_REQUIRE_AUTH", false)) {
        const current = readStore();
        if (!current.users.some(user => !user.disabled)) {
            throw new Error(
                "Production auth requires an enabled admin user. " +
                "Set the bootstrap admin environment variables on first launch."
            );
        }
    }
}

ensureBootstrap();

module.exports = {
    ROLES,
    roleCapabilities,
    LOCAL_OWNER,

    listUsers,
    findUser,
    createUser,
    issueAccountToken,
    consumeAccountToken,
    clearAccountToken,
    setPasswordWithToken,
    setUserRole,
    deleteUser,
    authenticate,
    googleLoginEnabled,
    signupEnabled,
    signupInviteAvailable,
    signupInviteRequired,
    singleUserModeStatus,
    recoveryOwnerUsername,
    authenticateGoogleUser,

    createApiKey,
    listApiKeys,
    revokeApiKey,
    verifyApiKey,

    createSession,
    verifySession,
    destroySession,

    audit,
    readAuditLog,
    ensureBootstrap,

    isAuthRequired,
    isLoopback,
    trustsLoopback,
    resolveIdentity,
    middleware,
    requireCapability,

    /* exported for tests */
    _internal: { sha256, hashPassword, verifyPassword, readStore, writeStore, SECURITY_FILE, AUDIT_FILE }
};
