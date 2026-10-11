/*
Nexus AI — Tool Registry (Stage 2)

Unified registry per the master spec (section 13).
Each tool exposes:
    name, description, input schema,
    permissions, execution handler,
    verification handler.

The agent asks the registry for a tool; the registry
checks permissions before the handler runs and runs
the verifier afterwards. Handlers never run unchecked.
*/

const permissions = require("./permissions");
const approvalService = require("./approvalService");

const requireRiskApprovals =
    /^(1|true|yes|on)$/i.test(
        String(process.env.NEXUS_REQUIRE_APPROVALS || "")
    );

const registry = new Map();

function register(tool) {
    const required = [
        "name",
        "description",
        "handler"
    ];

    for (const field of required) {
        if (!tool[field]) {
            throw new Error(
                `Tool registration failed: "${field}" is required.`
            );
        }
    }

    registry.set(tool.name, {
        name: tool.name,

        description: tool.description || "",

        schema: tool.schema || {},

        permissions: tool.permissions || ["READ"],

        risky: Boolean(tool.risky),

        available:
            typeof tool.available === "function"
                ? tool.available
                : () => tool.available !== false,

        handler: tool.handler,

        verify: tool.verify || null
    });
}

function get(name) {
    return registry.get(name) || null;
}

function list() {
    return [...registry.values()].map(tool => ({
        name: tool.name,

        description: tool.description,

        schema: tool.schema,

        permissions: tool.permissions,

        risky: tool.risky,

        runnable:
            tool.available() && permissions.checkCapabilities(
                tool.permissions
            ).every(item => item.granted)
    }));
}

/*
Run a tool by name:
    permission check -> execute -> verify.
Returns { ok, result, verification }.
*/
async function run(name, input = {}) {
    const tool = registry.get(name);

    if (!tool) {
        return {
            ok: false,

            error: `Unknown tool: ${name}`
        };
    }

    if (!tool.available()) {
        return {
            ok: false,
            error: `Tool is unavailable: ${name}`,
            unavailable: true
        };
    }

    try {
        permissions.requireCapabilities(
            tool.permissions,
            tool.name
        );
    } catch (error) {
        return {
            ok: false,

            error: error.message,

            permissionDenied: true
        };
    }

    if (tool.risky && requireRiskApprovals) {
        const approval = approvalService.consumeApproval(
            input.approvalToken,
            tool.name,
            input
        );

        if (!approval.ok) {
            return {
                ok: false,
                error: approval.error,
                approvalRequired: true,
                tool: tool.name
            };
        }
    }

    try {
        const result =
            await tool.handler(input);

        let verification = {
            verified: true,

            note: "no verifier registered"
        };

        if (tool.verify) {
            verification =
                await tool.verify(input, result);
        }

        return {
            ok: true,

            result,

            verification
        };
    } catch (error) {
        return {
            ok: false,

            error: error.message,

            tool: tool.name
        };
    }
}

module.exports = {
    register,
    get,
    list,
    run
};
