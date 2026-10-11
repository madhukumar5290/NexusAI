"use strict";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function isConfigured() {
    return Boolean(
        process.env.RESEND_API_KEY &&
        process.env.NEXUS_EMAIL_FROM &&
        process.env.NEXUS_PUBLIC_URL
    );
}

function publicUrl(pathname, token) {
    const base = String(process.env.NEXUS_PUBLIC_URL || "").replace(/\/+$/, "");
    if (!base) throw new Error("NEXUS_PUBLIC_URL is required for account email.");
    if (process.env.NODE_ENV === "production" && !base.startsWith("https://")) {
        throw new Error("NEXUS_PUBLIC_URL must use HTTPS in production.");
    }
    return `${base}${pathname}?token=${encodeURIComponent(token)}`;
}

async function send({ to, subject, text }) {
    if (!isConfigured()) {
        throw new Error(
            "Account email is not configured. Set RESEND_API_KEY, NEXUS_EMAIL_FROM, and NEXUS_PUBLIC_URL."
        );
    }

    const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            from: process.env.NEXUS_EMAIL_FROM,
            to: [to],
            subject,
            text
        }),
        signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
        throw new Error(`Email delivery failed (HTTP ${response.status}).`);
    }
}

function sendVerification({ to, token }) {
    const link = publicUrl("/api/auth/verify-email", token);
    return send({
        to,
        subject: "Verify your Nexus account",
        text: `Verify your Nexus account within 30 minutes:\n\n${link}\n\nIf you did not create this account, you can ignore this email.`
    });
}

function sendPasswordReset({ to, token }) {
    const link = `${String(process.env.NEXUS_PUBLIC_URL || "").replace(/\/+$/, "")}/?reset_password=${encodeURIComponent(token)}`;
    if (!process.env.NEXUS_PUBLIC_URL) {
        throw new Error("NEXUS_PUBLIC_URL is required for account email.");
    }
    if (process.env.NODE_ENV === "production" &&
        !process.env.NEXUS_PUBLIC_URL.startsWith("https://")) {
        throw new Error("NEXUS_PUBLIC_URL must use HTTPS in production.");
    }
    return send({
        to,
        subject: "Reset your Nexus password",
        text: `Choose a new Nexus password within 30 minutes:\n\n${link}\n\nIf you did not request this, you can ignore this email.`
    });
}

module.exports = { isConfigured, sendVerification, sendPasswordReset };
