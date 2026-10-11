"use strict";

/*
 * Nexus AI — Authentication & authorization HTTP routes.
 *
 * Mounted by src/server.js. Kept in its own module so the
 * (already large) server file does not grow further and so
 * the routes can be tested in isolation.
 */

const express = require("express");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const security = require("./index");
const { audit } = security;
const defaultMailer = require("./email");

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: "Too many login attempts. Try again later." }
});

const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many account creation attempts. Try again later." }
});

function clientIp(req) {
    return (
        req.headers["x-forwarded-for"] ||
        req.socket?.remoteAddress ||
        null
    );
}

function requestCookie(req, name) {
    const prefix = `${name}=`;
    const value = String(req.headers.cookie || "")
        .split(";")
        .map(item => item.trim())
        .find(item => item.startsWith(prefix));
    if (!value) return "";
    try {
        return decodeURIComponent(value.slice(prefix.length));
    } catch {
        return "";
    }
}

function googleRedirectUri(req) {
    return process.env.NEXUS_GOOGLE_REDIRECT_URI ||
        `${req.protocol}://${req.get("host")}/api/auth/google/callback`;
}

function googleError(res, code) {
    res.redirect(`/?auth_error=${encodeURIComponent(code)}`);
}

function secretMatches(supplied, expected) {
    const actual = Buffer.from(String(supplied || ""));
    const target = Buffer.from(String(expected || ""));
    return actual.length > 0 &&
        actual.length === target.length &&
        crypto.timingSafeEqual(actual, target);
}

function blockWhenMultipleUsers(res) {
    const status = security.singleUserModeStatus();
    if (status.allowed) return false;
    res.status(503).json({
        error: "Nexus is in single-user safety mode because multiple accounts exist while data isolation is unavailable.",
        code: "MULTI_USER_DATA_ISOLATION_UNAVAILABLE",
        activeUserCount: status.activeUserCount,
        hint: "Disable or remove extra accounts before signing in."
    });
    return true;
}

function routes({ mailer = defaultMailer } = {}) {
    const router = express.Router();
    const recoveryLimiter = rateLimit({
        windowMs: 60 * 60 * 1000,
        limit: 5,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many account recovery attempts. Try again later." }
    });

    /*
    Public: report the current auth posture so the UI knows
    whether to show a login screen.
    */
    router.get("/auth/status", (req, res) => {
        const identity = security.resolveIdentity(req);
        res.json({
            authRequired: security.isAuthRequired(),
            authenticated: Boolean(identity),
            user: identity
                ? { username: identity.username, role: identity.role, kind: identity.kind }
                : null,
            userCount: security.listUsers().length,
            singleUserMode: security.singleUserModeStatus(),
            keyCount: security.listApiKeys().length,
            /* Explain why a browser may still work while keys exist. */
            loopbackTrusted:
                security.trustsLoopback() && security.isLoopback(req)
        });
    });

    router.get("/auth/methods", (req, res) => {
        res.json({
            google: security.googleLoginEnabled(),
            signup: security.signupEnabled(),
            inviteAvailable: security.signupInviteAvailable(),
            inviteRequired: security.signupInviteRequired(),
            singleUserOnly: true,
            emailVerificationRequired: process.env.NEXUS_REQUIRE_EMAIL_VERIFICATION === "true",
            accountEmailConfigured: mailer.isConfigured()
        });
    });

    router.post("/auth/register", registrationLimiter, async (req, res) => {
        if (!security.signupEnabled()) {
            return res.status(403).json({ error: "Account creation is disabled for this Nexus instance." });
        }

        const inviteCode = String(req.body?.inviteCode || "");
        if (
            security.signupInviteAvailable() &&
            (security.signupInviteRequired() || inviteCode) &&
            !secretMatches(inviteCode, process.env.NEXUS_SIGNUP_INVITE_CODE)
        ) {
            audit({ action: "auth.register.denied", target: "invite", ip: clientIp(req) });
            return res.status(403).json({ error: "The invitation code is invalid." });
        }

        const username = String(req.body?.username || "").trim().toLowerCase();
        const password = String(req.body?.password || "");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username) || username.length > 254) {
            return res.status(400).json({
                error: "Enter a valid email address."
            });
        }
        if (password.length < 12 || password.length > 1024) {
            return res.status(400).json({ error: "Password must be between 12 and 1024 characters." });
        }

        const verificationRequired =
            process.env.NEXUS_REQUIRE_EMAIL_VERIFICATION === "true";
        if (verificationRequired && !mailer.isConfigured()) {
            return res.status(503).json({
                error: "Email verification is required but account email is not configured."
            });
        }

        try {
            const user = security.createUser({
                username,
                password,
                role: "member",
                emailVerified: !verificationRequired
            });
            if (verificationRequired) {
                const token = security.issueAccountToken(username, "emailVerification");
                try {
                    await mailer.sendVerification({ to: username, token });
                } catch (error) {
                    security.clearAccountToken(username, "emailVerification");
                    console.error("Verification email delivery failed:", error.message);
                    return res.status(502).json({
                        error: "Account created, but verification email could not be delivered. Request another verification email or contact the instance owner."
                    });
                }
                audit({
                    action: "auth.register.pending_verification",
                    actor: username,
                    target: "member",
                    ip: clientIp(req)
                });
                return res.status(202).json({
                    verificationRequired: true,
                    message: "Check your email for a verification link."
                });
            }

            const session = security.createSession(user);
            res.cookie("nexus_session", session.token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                path: "/api",
                expires: new Date(session.expiresAt)
            });
            audit({
                action: "auth.register",
                actor: user.username,
                target: "member",
                ip: clientIp(req)
            });
            return res.status(201).json({
                user: { username: user.username, role: user.role },
                expiresAt: session.expiresAt
            });
        } catch (error) {
            const duplicate = /already exists/i.test(error.message);
            return res.status(duplicate ? 409 : 400).json({ error: error.message });
        }
    });

    router.post("/auth/verify-email/resend", recoveryLimiter, async (req, res) => {
        if (!mailer.isConfigured()) {
            return res.status(503).json({
                error: "Account email is not configured for this Nexus instance."
            });
        }
        const username = String(req.body?.username || "").trim().toLowerCase();
        const user = security.findUser(username);
        if (user && user.emailVerified === false && !user.disabled) {
            const token = security.issueAccountToken(username, "emailVerification");
            try {
                await mailer.sendVerification({ to: username, token });
            } catch (error) {
                security.clearAccountToken(username, "emailVerification");
                console.error("Verification email delivery failed:", error.message);
                return res.status(502).json({
                    error: "Verification email could not be delivered. Please try again later."
                });
            }
        }
        res.json({ message: "If the account needs verification, a link will be sent shortly." });
    });

    router.get("/auth/verify-email", (req, res) => {
        const user = security.consumeAccountToken(req.query.token, "emailVerification");
        if (!user) {
            return res.redirect("/?auth_error=email_verification_invalid");
        }
        audit({
            action: "auth.email.verified",
            actor: user.username,
            target: "email",
            ip: clientIp(req)
        });
        return res.redirect("/?email_verified=1");
    });

    router.post("/auth/password-reset/request", recoveryLimiter, async (req, res) => {
        if (!mailer.isConfigured()) {
            return res.status(503).json({
                error: "Password recovery email is not configured for this Nexus instance."
            });
        }
        const username = String(req.body?.username || "").trim().toLowerCase();
        const user = security.findUser(username);
        if (user && user.emailVerified !== false && !user.disabled) {
            const recipient = user.googleEmail || user.username;
            if (recipient.includes("@")) {
                const token = security.issueAccountToken(username, "passwordReset");
                try {
                    await mailer.sendPasswordReset({ to: recipient, token });
                } catch (error) {
                    security.clearAccountToken(username, "passwordReset");
                    console.error("Password recovery email delivery failed:", error.message);
                    return res.status(502).json({
                        error: "Password recovery email could not be delivered. Please try again later."
                    });
                }
            }
        }
        res.json({ message: "If the account is eligible, a password reset link will be sent shortly." });
    });

    router.post("/auth/password-reset", recoveryLimiter, (req, res) => {
        const password = String(req.body?.password || "");
        if (password.length < 12 || password.length > 1024) {
            return res.status(400).json({
                error: "Password must be between 12 and 1024 characters."
            });
        }
        const user = security.setPasswordWithToken(req.body?.token, password);
        if (!user) {
            return res.status(400).json({
                error: "The password reset link is invalid or expired. Request a new one."
            });
        }
        res.json({ ok: true, message: "Password updated. You can now sign in." });
    });

    /*
    Public: login with username + password, returns a session token.
    */
    router.post("/auth/login", loginLimiter, (req, res) => {
        const username = String(req.body?.username || "").trim();
        const password = String(req.body?.password || "");

        if (!security.singleUserModeStatus().allowed) {
            const recoveryOwner = security.recoveryOwnerUsername();
            if (
                !recoveryOwner ||
                username.toLowerCase() !== recoveryOwner.toLowerCase()
            ) {
                blockWhenMultipleUsers(res);
                return;
            }
        }

        if (!username || !password) {
            return res.status(400).json({ error: "Username and password are required." });
        }

        const user = security.authenticate(username, password);
        if (!user) {
            audit({
                action: "auth.login.failed",
                actor: username,
                target: "session",
                ip: clientIp(req)
            });
            return res.status(401).json({ error: "Invalid credentials." });
        }

        const session = security.createSession(user);
        res.cookie("nexus_session", session.token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/api",
            expires: new Date(session.expiresAt)
        });
        audit({
            action: "auth.login",
            actor: user.username,
            target: "session",
            detail: { role: user.role },
            ip: clientIp(req)
        });

        res.json({
            token: session.token,
            expiresAt: session.expiresAt,
            user: { username: user.username, role: user.role }
        });
    });

    router.get("/auth/google", (req, res) => {
        if (!security.singleUserModeStatus().allowed) {
            return googleError(res, "multi_user_data_isolation_unavailable");
        }

        if (!security.googleLoginEnabled()) {
            return res.status(503).json({
                error: "Google sign-in is not configured for this Nexus instance."
            });
        }

        const state = crypto.randomBytes(32).toString("base64url");
        res.cookie("nexus_google_state", state, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/api/auth/google",
            maxAge: 10 * 60 * 1000
        });

        const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authorization.search = new URLSearchParams({
            client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
            redirect_uri: googleRedirectUri(req),
            response_type: "code",
            scope: "openid email profile",
            state,
            prompt: "select_account"
        }).toString();
        res.redirect(authorization.toString());
    });

    router.get("/auth/google/callback", async (req, res) => {
        if (!security.singleUserModeStatus().allowed) {
            return googleError(res, "multi_user_data_isolation_unavailable");
        }

        const expectedState = requestCookie(req, "nexus_google_state");
        const suppliedState = String(req.query.state || "");
        res.clearCookie("nexus_google_state", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/api/auth/google"
        });

        if (
            !security.googleLoginEnabled() ||
            !expectedState ||
            !suppliedState ||
            expectedState.length !== suppliedState.length ||
            !crypto.timingSafeEqual(
                Buffer.from(expectedState),
                Buffer.from(suppliedState)
            )
        ) {
            audit({
                action: "auth.google.failed",
                target: "state",
                ip: clientIp(req)
            });
            return googleError(res, "google_state_invalid");
        }

        if (req.query.error || typeof req.query.code !== "string") {
            audit({
                action: "auth.google.failed",
                target: "provider",
                ip: clientIp(req)
            });
            return googleError(res, "google_signin_cancelled");
        }

        try {
            const tokenResponse = await fetch(
                "https://oauth2.googleapis.com/token",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        code: req.query.code,
                        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
                        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
                        redirect_uri: googleRedirectUri(req),
                        grant_type: "authorization_code"
                    }),
                    signal: AbortSignal.timeout(10000)
                }
            );

            if (!tokenResponse.ok) {
                throw new Error(`Google token exchange failed (${tokenResponse.status}).`);
            }

            const tokens = await tokenResponse.json();
            if (typeof tokens.access_token !== "string" || !tokens.access_token) {
                throw new Error("Google token response did not include an access token.");
            }

            const profileResponse = await fetch(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                {
                    headers: { Authorization: `Bearer ${tokens.access_token}` },
                    signal: AbortSignal.timeout(10000)
                }
            );
            if (!profileResponse.ok) {
                throw new Error(`Google profile lookup failed (${profileResponse.status}).`);
            }

            const user = security.authenticateGoogleUser(
                await profileResponse.json()
            );
            if (!user) {
                audit({
                    action: "auth.google.denied",
                    target: "allowlist",
                    ip: clientIp(req)
                });
                return googleError(res, "google_account_not_allowed");
            }

            const session = security.createSession(user);
            res.cookie("nexus_session", session.token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "strict",
                path: "/api",
                expires: new Date(session.expiresAt)
            });
            audit({
                action: "auth.google",
                actor: user.username,
                target: user.email,
                detail: { role: user.role },
                ip: clientIp(req)
            });
            return res.redirect("/");
        } catch (error) {
            console.error("Google sign-in failed:", error.message);
            audit({
                action: "auth.google.failed",
                target: "oauth_exchange",
                ip: clientIp(req)
            });
            return googleError(res, "google_signin_failed");
        }
    });

    /*
    Authenticated: logout (invalidate the presented session).
    */
    router.post("/auth/logout", (req, res) => {
        const header = String(req.headers.authorization || "");
        const token = header.toLowerCase().startsWith("bearer ")
            ? header.slice(7).trim()
            : String(req.headers.cookie || "")
                .split(";")
                .map(value => value.trim())
                .find(value => value.startsWith("nexus_session="))
                ?.slice("nexus_session=".length) || null;
        const removed = token ? security.destroySession(token) : false;
        res.clearCookie("nexus_session", {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            path: "/api"
        });
        audit({ action: "auth.logout", actor: req.nexusUser?.username || "anonymous", ip: clientIp(req) });
        res.json({ ok: true, removed });
    });

    /*
    Admin-only: user management.
    */
    router.get("/auth/users", security.requireCapability("ADMIN"), (req, res) => {
        if (
            !security.singleUserModeStatus().allowed &&
            req.nexusUser?.username?.toLowerCase() !==
                security.recoveryOwnerUsername()?.toLowerCase()
        ) {
            return res.status(403).json({
                error: "Only the designated recovery owner may review accounts while single-user safety mode is active."
            });
        }
        res.json({ users: security.listUsers(), roles: Object.keys(security.ROLES) });
    });

    router.post("/auth/users", security.requireCapability("ADMIN"), (_req, res) => {
        res.status(403).json({
            error: "Creating additional accounts is disabled until per-user data isolation is implemented."
        });
    });

    router.patch("/auth/users/:username", security.requireCapability("ADMIN"), (req, res) => {
        try {
            const user = security.setUserRole(req.params.username, req.body?.role);
            res.json({ user });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    router.delete("/auth/users/:username", security.requireCapability("ADMIN"), (req, res) => {
        if (!security.singleUserModeStatus().allowed) {
            const recoveryOwner = security.recoveryOwnerUsername();
            if (
                !recoveryOwner ||
                req.nexusUser?.username?.toLowerCase() !== recoveryOwner.toLowerCase() ||
                req.params.username.toLowerCase() === recoveryOwner.toLowerCase()
            ) {
                return res.status(403).json({
                    error: "Only the designated recovery owner may remove extra accounts, and that owner cannot remove itself."
                });
            }
        }
        const removed = security.deleteUser(req.params.username);
        if (!removed) return res.status(404).json({ error: "User not found." });
        res.json({ ok: true });
    });

    /*
    Admin-only: API key management. The plaintext key is shown once.
    */
    router.get("/auth/keys", security.requireCapability("ADMIN"), (req, res) => {
        res.json({ keys: security.listApiKeys() });
    });

    router.post("/auth/keys", security.requireCapability("ADMIN"), (req, res) => {
        try {
            const created = security.createApiKey({
                label: req.body?.label || "default",
                role: req.body?.role || "owner",
                owner: req.nexusUser?.username || "local"
            });
            res.status(201).json({
                key: created.key,
                label: created.label,
                role: created.role,
                warning: "Store this key now. It cannot be retrieved again."
            });
        } catch (error) {
            res.status(400).json({ error: error.message });
        }
    });

    router.delete("/auth/keys/:id", security.requireCapability("ADMIN"), (req, res) => {
        const revoked = security.revokeApiKey(req.params.id);
        if (!revoked) return res.status(404).json({ error: "Key not found." });
        res.json({ ok: true });
    });

    /*
    Admin-only: audit log.
    */
    router.get("/auth/audit", security.requireCapability("ADMIN"), (req, res) => {
        const limit = Number(req.query.limit) || 200;
        res.json({ entries: security.readAuditLog(limit) });
    });

    /*
    Report the caller's effective capabilities (drives UI affordances).
    */
    router.get("/auth/permissions", (req, res) => {
        const user = req.nexusUser || security.resolveIdentity(req) || security.LOCAL_OWNER;
        res.json({
            user: { username: user.username, role: user.role, kind: user.kind },
            capabilities: security.roleCapabilities(user.role),
            roles: security.ROLES
        });
    });

    return router;
}

module.exports = { routes };
