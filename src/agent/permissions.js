/*
Nexus AI — Permission System (Stage 2)

Capabilities per the Nexus master spec (section 37).
Each tool declares the capabilities it requires;
every tool execution checks them before running.
Higher-risk operations should additionally require
explicit user authorization (confirm flag).
*/

const CAPABILITIES = Object.freeze([
    "READ",
    "WRITE",
    "DELETE",
    "EXECUTE",
    "NETWORK",
    "BROWSER",
    "GIT",
    "GITHUB",
    "PUBLISH",
    "SEND",
    "DATABASE"
]);

/*
Default grants for the local single-user runtime.
Destructive/external capabilities stay disabled
until explicitly enabled via config or UI.
*/
const DEFAULT_GRANTED = new Set([
    "READ",
    "WRITE",
    "NETWORK"
]);

const granted = new Set(DEFAULT_GRANTED);

function grant(capability) {
    if (!CAPABILITIES.includes(capability)) {
        throw new Error(
            `Unknown capability: ${capability}`
        );
    }

    granted.add(capability);
}

function revoke(capability) {
    granted.delete(capability);
}

function isGranted(capability) {
    return granted.has(capability);
}

function getGranted() {
    return [...granted];
}

/*
Check a list of required capabilities.
Throws when a required capability is not granted.
*/
function requireCapabilities(required, toolName) {
    const missing = (required || []).filter(
        capability => !granted.has(capability)
    );

    if (missing.length) {
        throw new Error(
            `Permission denied: tool "${toolName}" requires ${missing.join(", ")}.`
        );
    }

    return true;
}

/*
Non-throwing check, useful for the registry
exposing which tools are currently runnable.
*/
function checkCapabilities(required) {
    return (required || []).map(capability => ({
        capability,
        granted: granted.has(capability)
    }));
}

module.exports = {
    CAPABILITIES,
    grant,
    revoke,
    isGranted,
    getGranted,
    requireCapabilities,
    checkCapabilities
};
