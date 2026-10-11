"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const originalEnvironment = {
    dataDir: process.env.NEXUS_DATA_DIR,
    requireAuth: process.env.NEXUS_REQUIRE_AUTH,
    allowSignup: process.env.NEXUS_ALLOW_SIGNUP,
    inviteCode: process.env.NEXUS_SIGNUP_INVITE_CODE,
    requireEmailVerification: process.env.NEXUS_REQUIRE_EMAIL_VERIFICATION,
    bootstrapUsername: process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME,
    bootstrapPassword: process.env.NEXUS_BOOTSTRAP_ADMIN_PASSWORD
};
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-auth-routes-"));
process.env.NEXUS_DATA_DIR = tempDir;
process.env.NEXUS_REQUIRE_AUTH = "true";
process.env.NEXUS_ALLOW_SIGNUP = "true";
process.env.NEXUS_SIGNUP_INVITE_CODE = "optional-invite-code-123456";
delete process.env.NEXUS_BOOTSTRAP_ADMIN_USERNAME;
delete process.env.NEXUS_BOOTSTRAP_ADMIN_PASSWORD;

const security = require("../lib/security");
const verificationEmails = [];
const resetEmails = [];
const securityRoutes = require("../lib/security/routes");
const app = express();
app.use(express.json());
app.use("/api", security.middleware());
app.use("/api", securityRoutes.routes({
    mailer: {
        isConfigured: () => true,
        sendVerification: async message => verificationEmails.push(message),
        sendPasswordReset: async message => resetEmails.push(message)
    }
}));

let server;
let baseUrl;

test.before(async () => {
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
    if (server?.listening) {
        await new Promise((resolve, reject) => server.close(error =>
            error ? reject(error) : resolve()
        ));
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries({
        NEXUS_DATA_DIR: originalEnvironment.dataDir,
        NEXUS_REQUIRE_AUTH: originalEnvironment.requireAuth,
        NEXUS_ALLOW_SIGNUP: originalEnvironment.allowSignup,
        NEXUS_SIGNUP_INVITE_CODE: originalEnvironment.inviteCode,
        NEXUS_REQUIRE_EMAIL_VERIFICATION: originalEnvironment.requireEmailVerification,
        NEXUS_BOOTSTRAP_ADMIN_USERNAME: originalEnvironment.bootstrapUsername,
        NEXUS_BOOTSTRAP_ADMIN_PASSWORD: originalEnvironment.bootstrapPassword
    })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

test("reports that signup is disabled for the shared-data deployment", async () => {
    const response = await fetch(`${baseUrl}/api/auth/methods`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
        google: false,
        signup: false,
        inviteAvailable: false,
        inviteRequired: false,
        singleUserOnly: true,
        emailVerificationRequired: false,
        accountEmailConfigured: true
    });
});

test("requires email verification before login and allows a single-use reset link", async t => {
    const previousVerificationSetting = process.env.NEXUS_REQUIRE_EMAIL_VERIFICATION;
    t.after(() => {
        if (previousVerificationSetting === undefined) {
            delete process.env.NEXUS_REQUIRE_EMAIL_VERIFICATION;
        } else {
            process.env.NEXUS_REQUIRE_EMAIL_VERIFICATION = previousVerificationSetting;
        }
    });
    process.env.NEXUS_REQUIRE_EMAIL_VERIFICATION = "true";
    security.createUser({
        username: "verified@example.com",
        password: "another long secure password",
        emailVerified: false
    });
    const resend = await fetch(`${baseUrl}/api/auth/verify-email/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "verified@example.com" })
    });
    assert.equal(resend.status, 200);
    assert.equal(verificationEmails.length, 1);
    assert.equal(verificationEmails[0].to, "verified@example.com");

    const deniedLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "verified@example.com",
            password: "another long secure password"
        })
    });
    assert.equal(deniedLogin.status, 401);

    const verified = await fetch(
        `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(verificationEmails[0].token)}`,
        { redirect: "manual" }
    );
    assert.equal(verified.status, 302);
    assert.match(verified.headers.get("location"), /email_verified=1/);

    const resetRequest = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "verified@example.com" })
    });
    assert.equal(resetRequest.status, 200);
    assert.equal(resetEmails.length, 1);

    const reset = await fetch(`${baseUrl}/api/auth/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            token: resetEmails[0].token,
            password: "replacement secure password 456"
        })
    });
    assert.equal(reset.status, 200);
    assert.equal(security.authenticate(
        "verified@example.com",
        "replacement secure password 456"
    ).username, "verified@example.com");
    assert.equal(security.authenticate(
        "verified@example.com",
        "another long secure password"
    ), null);

    const reused = await fetch(`${baseUrl}/api/auth/password-reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            token: resetEmails[0].token,
            password: "third secure password 789"
        })
    });
    assert.equal(reused.status, 400);
});

test("signup stays disabled even when the operator sets open-signup and invite flags", async () => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "Person@Example.com",
            password: "long secure password 123"
        })
    });
    const result = await response.json();

    assert.equal(response.status, 403);
    assert.match(result.error, /disabled/);
});

test("signup is disabled regardless of identifier or invitation input", async () => {
    const invalidEmail = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "not-an-email", password: "long secure password 123" })
    });
    assert.equal(invalidEmail.status, 403);
    assert.match((await invalidEmail.json()).error, /disabled/);

    const invalidInvite = await fetch(`${baseUrl}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "another@example.com",
            password: "long secure password 123",
            inviteCode: "incorrect-code"
        })
    });
    assert.equal(invalidInvite.status, 403);
    assert.match((await invalidInvite.json()).error, /disabled/);
});

test("multiple active accounts cannot access shared data and the owner can recover", async () => {
    security.createUser({
        username: "recovery-owner@example.com",
        password: "recovery owner password",
        role: "owner"
    });
    security.createUser({
        username: "extra-user@example.com",
        password: "extra user password",
        role: "member"
    });

    const blockedLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "extra-user@example.com",
            password: "extra user password"
        })
    });
    assert.equal(blockedLogin.status, 503);
    assert.equal(
        (await blockedLogin.json()).code,
        "MULTI_USER_DATA_ISOLATION_UNAVAILABLE"
    );

    const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "recovery-owner@example.com",
            password: "recovery owner password"
        })
    });
    assert.equal(ownerLogin.status, 200);
    const { token } = await ownerLogin.json();
    const headers = { Authorization: `Bearer ${token}` };

    const blockedData = await fetch(`${baseUrl}/api/chats`, { headers });
    assert.equal(blockedData.status, 503);

    for (const username of ["extra-user@example.com", "verified@example.com"]) {
        const removed = await fetch(
            `${baseUrl}/api/auth/users/${encodeURIComponent(username)}`,
            { method: "DELETE", headers }
        );
        assert.equal(removed.status, 200);
    }

    assert.equal(security.singleUserModeStatus().allowed, true);
    const recoveredDataAccess = await fetch(`${baseUrl}/api/chats`, { headers });
    assert.equal(recoveredDataAccess.status, 404);
});

test("sign out invalidates the current browser session", async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            username: "recovery-owner@example.com",
            password: "recovery owner password"
        })
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers
    });
    assert.equal(logout.status, 200);
    assert.equal((await logout.json()).removed, true);

    assert.equal(security.resolveIdentity({
        headers,
        ip: "203.0.113.10",
        socket: { remoteAddress: "203.0.113.10" }
    }), null);
});
