const crypto = require("crypto");

const approvals = new Map();

const DEFAULT_TTL_MS = 5 * 60 * 1000;

function requestApproval({
    tool,
    summary = "",
    input = {},
    ttlMs = DEFAULT_TTL_MS
} = {}) {
    if (!tool) {
        throw new Error("Approval tool name is required.");
    }

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = Date.now() + Math.max(1000, Number(ttlMs));

    approvals.set(token, {
        token,
        tool: String(tool),
        summary: String(summary),
        inputHash: hashInput(input),
        expiresAt,
        used: false,
        createdAt: Date.now()
    });

    return {
        token,
        tool: String(tool),
        summary: String(summary),
        expiresAt
    };
}

function consumeApproval(token, tool, input = {}) {
    const record = approvals.get(String(token || ""));

    if (!record) {
        return {
            ok: false,
            error: "Approval token is missing or invalid."
        };
    }

    if (record.used) {
        return {
            ok: false,
            error: "Approval token has already been used."
        };
    }

    if (record.expiresAt <= Date.now()) {
        approvals.delete(record.token);

        return {
            ok: false,
            error: "Approval token has expired."
        };
    }

    if (record.tool !== String(tool)) {
        return {
            ok: false,
            error: "Approval token is for a different tool."
        };
    }

    if (record.inputHash !== hashInput(input)) {
        return {
            ok: false,
            error: "Approval token does not match this operation."
        };
    }

    record.used = true;
    approvals.delete(record.token);

    return {
        ok: true,
        approval: record
    };
}

function hashInput(input) {
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(sortValue(input)))
        .digest("hex");
}

function sortValue(value) {
    if (Array.isArray(value)) {
        return value.map(sortValue);
    }

    if (!value || typeof value !== "object") {
        return value;
    }

    return Object.keys(value)
        .filter(key => key !== "approvalToken")
        .sort()
        .reduce((result, key) => {
            result[key] = sortValue(value[key]);
            return result;
        }, {});
}

function listPending() {
    const now = Date.now();

    return [...approvals.values()]
        .filter(item => !item.used && item.expiresAt > now)
        .map(item => ({
            tool: item.tool,
            summary: item.summary,
            expiresAt: item.expiresAt,
            createdAt: item.createdAt
        }));
}

module.exports = {
    requestApproval,
    consumeApproval,
    listPending,
    hashInput
};
