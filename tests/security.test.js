"use strict";

/*
 * Tests for the Nexus security layer: users, API keys, sessions,
 * role-based authorization, and the audit log.
 *
 * The module persists to data/security.json, so these tests use a
 * throwaway data directory via NEXUS_DATA_DIR to avoid touching a
 * real operator's keys.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

/* Isolate the security store before requiring the module. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-sec-"));
process.env.NEXUS_DATA_DIR = TMP;

const security = require("../lib/security");

test.after(() => {
    try {
        fs.rmSync(TMP, { recursive: true, force: true });
    } catch {
        /* best effort */
    }
});

test("exposes the four documented roles", () => {
    assert.deepEqual(
        Object.keys(security.ROLES).sort(),
        ["admin", "member", "owner", "viewer"]
    );
});

test("owner holds every capability and viewer holds only READ", () => {
    const owner = security.roleCapabilities("owner");
    assert.ok(owner.includes("ADMIN"));
    assert.ok(owner.includes("EXECUTE"));

    assert.deepEqual(security.roleCapabilities("viewer"), ["READ"]);
});

test("an unknown role resolves to no capabilities rather than throwing", () => {
    assert.deepEqual(security.roleCapabilities("does-not-exist"), []);
});

test("account creation stays disabled even when signup environment flags are set", () => {
    const previousAllow = process.env.NEXUS_ALLOW_SIGNUP;
    const previousInvite = process.env.NEXUS_SIGNUP_INVITE_CODE;
    delete process.env.NEXUS_ALLOW_SIGNUP;
    delete process.env.NEXUS_SIGNUP_INVITE_CODE;

    try {
        assert.equal(security.signupEnabled(), false);
        assert.equal(security.signupInviteAvailable(), false);
        process.env.NEXUS_SIGNUP_INVITE_CODE = "a-secure-invite-code-123";
        assert.equal(security.signupEnabled(), false);
        assert.equal(security.signupInviteAvailable(), false);
        assert.equal(security.signupInviteRequired(), false);
        process.env.NEXUS_ALLOW_SIGNUP = "true";
        assert.equal(security.signupEnabled(), false);
    } finally {
        if (previousAllow === undefined) delete process.env.NEXUS_ALLOW_SIGNUP;
        else process.env.NEXUS_ALLOW_SIGNUP = previousAllow;
        if (previousInvite === undefined) delete process.env.NEXUS_SIGNUP_INVITE_CODE;
        else process.env.NEXUS_SIGNUP_INVITE_CODE = previousInvite;
    }
});

test("first-run bootstrap creates an owner from deployment credentials", () => {
    const previousUsername = process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME;
    const previousPassword = process.env.NEXUS_BOOTSTRAP_ADMIN_PASSWORD;
    process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME = "bootstrap-owner";
    process.env.NEXUS_BOOTSTRAP_ADMIN_PASSWORD = "a long bootstrap password";

    try {
        security.ensureBootstrap();
        assert.equal(
            security.authenticate(
                "bootstrap-owner",
                "a long bootstrap password"
            ).role,
            "owner"
        );
    } finally {
        if (previousUsername === undefined) {
            delete process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME;
        } else {
            process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME = previousUsername;
        }
        if (previousPassword === undefined) {
            delete process.env.NEXUS_BOOTSTRAP_ADMIN_PASSWORD;
        } else {
            process.env.NEXUS_BOOTSTRAP_ADMIN_PASSWORD = previousPassword;
        }
    }
});

test("Google sign-in only admits verified, explicitly allowed emails", () => {
    const previous = {
        clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
        adminEmail: process.env.NEXUS_GOOGLE_ADMIN_EMAIL,
        allowedEmails: process.env.NEXUS_GOOGLE_ALLOWED_EMAILS,
        bootstrapUsername: process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME
    };
    process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client-id";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "google-client-secret";
    process.env.NEXUS_GOOGLE_ADMIN_EMAIL = "owner@example.com";
    process.env.NEXUS_GOOGLE_ALLOWED_EMAILS = "member@example.com";
    process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME = "google-bootstrap-owner";

    try {
        const owner = security.createUser({
            username: "google-bootstrap-owner",
            password: "bootstrap password for google test",
            role: "owner"
        });
        const linkedOwner = security.authenticateGoogleUser({
            sub: "google-owner-subject",
            email: "OWNER@example.com",
            email_verified: true
        });
        assert.equal(linkedOwner.id, owner.id);
        assert.equal(linkedOwner.role, "owner");

        const memberAccount = security.createUser({
            username: "member@example.com",
            password: "pre-provisioned member password",
            role: "member"
        });
        const member = security.authenticateGoogleUser({
            sub: "google-member-subject",
            email: "member@example.com",
            email_verified: true
        });
        assert.equal(member.id, memberAccount.id);
        assert.equal(member.role, "member");
        assert.equal(security.authenticateGoogleUser({
            sub: "unprovisioned-member",
            email: "allowed-but-not-created@example.com",
            email_verified: true
        }), null);
        process.env.NEXUS_GOOGLE_ADMIN_EMAIL = "owner@example.com";
        assert.equal(
            security.authenticateGoogleUser({
                sub: "unknown-subject",
                email: "outsider@example.com",
                email_verified: true
            }),
            null
        );
        assert.equal(
            security.authenticateGoogleUser({
                sub: "unverified-subject",
                email: "member@example.com",
                email_verified: false
            }),
            null
        );
        assert.equal(security.googleLoginEnabled(), true);
    } finally {
        for (const [key, value] of Object.entries({
            GOOGLE_OAUTH_CLIENT_ID: previous.clientId,
            GOOGLE_OAUTH_CLIENT_SECRET: previous.clientSecret,
            NEXUS_GOOGLE_ADMIN_EMAIL: previous.adminEmail,
            NEXUS_GOOGLE_ALLOWED_EMAILS: previous.allowedEmails,
            NEXUS_BOOTSTRAP_ADMIN_USERNAME: previous.bootstrapUsername
        })) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});

test("shared application data is blocked when more than one account is active", () => {
    const previousStore = security._internal.readStore();
    try {
        security._internal.writeStore({
            ...previousStore,
            users: [{
                id: "single-user",
                username: "owner@example.com",
                role: "owner",
                disabled: false
            }]
        });
        assert.deepEqual(security.singleUserModeStatus(), {
            allowed: true,
            activeUserCount: 1
        });

        security._internal.writeStore({
            ...security._internal.readStore(),
            users: [
                {
                    id: "first-user",
                    username: "owner@example.com",
                    role: "owner",
                    disabled: false
                },
                {
                    id: "second-user",
                    username: "member@example.com",
                    role: "member",
                    disabled: false
                }
            ]
        });
        assert.deepEqual(security.singleUserModeStatus(), {
            allowed: false,
            activeUserCount: 2
        });
    } finally {
        security._internal.writeStore(previousStore);
    }
});

test("createUser hashes the password and never stores it in plaintext", () => {
    const user = security.createUser({
        username: "alice",
        password: "correct horse battery staple",
        role: "member"
    });

    assert.equal(user.username, "alice");
    assert.equal(user.role, "member");

    const raw = fs.readFileSync(security._internal.SECURITY_FILE, "utf8");
    assert.ok(!raw.includes("correct horse battery staple"), "plaintext password leaked");
});

test("authenticate accepts the right password and rejects the wrong one", () => {
    security.createUser({ username: "bob", password: "s3cret", role: "viewer" });

    assert.equal(security.authenticate("bob", "s3cret").role, "viewer");
    assert.equal(security.authenticate("bob", "wrong"), null);
    assert.equal(security.authenticate("nobody", "s3cret"), null);
});

test("duplicate usernames are rejected", () => {
    security.createUser({ username: "carol", password: "pw", role: "member" });
    assert.throws(
        () => security.createUser({ username: "carol", password: "pw" }),
        /already exists/
    );
});

test("API keys are returned once and stored only as a hash", () => {
    const created = security.createApiKey({ label: "test-key", role: "member" });

    assert.match(created.key, /^nx_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);

    const raw = fs.readFileSync(security._internal.SECURITY_FILE, "utf8");
    assert.ok(!raw.includes(created.key), "plaintext API key leaked");

    const verified = security.verifyApiKey(created.key);
    assert.equal(verified.role, "member");
    assert.equal(verified.label, "test-key");
});

test("a malformed or unknown API key does not verify", () => {
    assert.equal(security.verifyApiKey("not-a-key"), null);
    assert.equal(security.verifyApiKey("nx_aaaa_bb"), null);
    assert.equal(security.verifyApiKey(""), null);
});

test("revoking an API key stops it verifying", () => {
    const created = security.createApiKey({ label: "to-revoke", role: "viewer" });
    assert.ok(security.verifyApiKey(created.key));

    assert.equal(security.revokeApiKey("to-revoke"), true);
    assert.equal(security.verifyApiKey(created.key), null);
});

test("sessions verify while live and stop verifying after logout", () => {
    const session = security.createSession({ username: "dave", role: "admin" });

    const identity = security.verifySession(session.token);
    assert.equal(identity.username, "dave");
    assert.equal(identity.role, "admin");

    assert.equal(security.destroySession(session.token), true);
    assert.equal(security.verifySession(session.token), null);
});

test("audit log records entries and reads them back newest-first", () => {
    security.audit({ action: "test.first", actor: "unit" });
    security.audit({ action: "test.second", actor: "unit" });

    const entries = security.readAuditLog(10);
    assert.ok(entries.length >= 2);
    assert.equal(entries[0].action, "test.second");
    assert.equal(entries[0].actor, "unit");
});

test("auth is required once a key exists, and resolveIdentity honours a valid key", () => {
    assert.equal(security.isAuthRequired(), true);

    const created = security.createApiKey({ label: "identity-key", role: "owner" });
    const req = { headers: { authorization: `Bearer ${created.key}` } };

    const identity = security.resolveIdentity(req);
    assert.equal(identity.role, "owner");
    assert.equal(identity.kind, "apikey");
});

test("resolveIdentity returns null for a missing credential when auth is required", () => {
    assert.equal(security.resolveIdentity({ headers: {} }), null);
});

test("capability middleware denies a role that lacks the capability", () => {
    security.createApiKey({ label: "viewer-key", role: "viewer" });
    const key = security.createApiKey({ label: "viewer-key-2", role: "viewer" });

    const middleware = security.requireCapability("EXECUTE");
    const req = {
        headers: { authorization: `Bearer ${key.key}` },
        originalUrl: "/api/terminal"
    };
    const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };

    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, "denied request must not call next");
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.required, "EXECUTE");
});

test("capability middleware allows a role that holds the capability", () => {
    const key = security.createApiKey({ label: "admin-key", role: "admin" });

    const middleware = security.requireCapability("EXECUTE");
    const req = { headers: { authorization: `Bearer ${key.key}` }, originalUrl: "/x" };
    const res = {
        status() { throw new Error("should not be called"); },
        json() { throw new Error("should not be called"); }
    };

    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
});
/* ------------------------------------------------------------------
   LOOPBACK TRUST
   ------------------------------------------------------------------
   A local-first app must not lock the operator out of their own UI
   when they create a key for an external client. These tests pin that
   behaviour so it cannot regress.
   ------------------------------------------------------------------ */

test("a loopback request stays the owner after a key is created", () => {
    /* A key already exists from the tests above. */
    assert.equal(security.isAuthRequired(), true);

    const req = {
        headers: {},
        socket: { remoteAddress: "127.0.0.1" }
    };

    const identity = security.resolveIdentity(req);
    assert.ok(identity, "loopback must still resolve");
    assert.equal(identity.role, "owner");
    assert.equal(identity.kind, "loopback");
});

test("a non-loopback request without a credential is rejected", () => {
    const req = {
        headers: {},
        socket: { remoteAddress: "203.0.113.9" }
    };

    assert.equal(security.resolveIdentity(req), null);
});

test("a valid key still authenticates from a remote address", () => {
    const created = security.createApiKey({ label: "remote-key", role: "member" });

    const req = {
        headers: { authorization: `Bearer ${created.key}` },
        socket: { remoteAddress: "203.0.113.9" }
    };

    const identity = security.resolveIdentity(req);
    assert.equal(identity.kind, "apikey");
    assert.equal(identity.role, "member");
});

test("an HttpOnly session cookie authenticates a remote browser session", () => {
    const user = security.createUser({
        username: "cookie-user",
        password: "a sufficiently long password",
        role: "member"
    });
    const session = security.createSession(user);

    const identity = security.resolveIdentity({
        headers: {
            cookie: `other=value; nexus_session=${encodeURIComponent(session.token)}`
        },
        socket: { remoteAddress: "203.0.113.20" }
    });

    assert.equal(identity.username, "cookie-user");
    assert.equal(identity.role, "member");
    assert.equal(identity.kind, "session");
});

test("an invalid credential is never treated as the owner", () => {
    const req = {
        headers: { authorization: "Bearer nx_fake_key_value" },
        socket: { remoteAddress: "127.0.0.1" }
    };

    assert.equal(security.resolveIdentity(req), null);
});

test("isLoopback recognises the documented local addresses", () => {
    for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]) {
        assert.equal(
            security.isLoopback({ socket: { remoteAddress: address } }),
            true,
            address + " should be loopback"
        );
    }

    assert.equal(
        security.isLoopback({ socket: { remoteAddress: "10.0.0.5" } }),
        false
    );
});