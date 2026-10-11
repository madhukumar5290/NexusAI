/*
=========================================================
NEXUS AI - SUBSYSTEM SMOKE TEST
=========================================================
Run with:  node scripts/check.js

Verifies that every module loads, that each
provider is either reachable or cleanly
reported as unconfigured, and that a real
streaming completion works end to end.

Exit code 0 = all critical checks passed.
=========================================================
*/

const config = require("../lib/config");
const providers = require("../lib/providers");
const { collect } = require("../lib/providers/base");

const results = [];

function record(name, ok, detail = "") {
    results.push({ name, ok, detail });

    const mark = ok ? "PASS" : "FAIL";

    console.log(
        `[${mark}] ${name}${detail ? ` - ${detail}` : ""}`
    );
}

function section(title) {
    console.log(`\n=== ${title} ===`);
}

/*
=========================================================
1. MODULE LOADING
=========================================================
*/

section("Modules");

const modules = [
    "config",
    "providers",
    "providers/base",
    "providers/ollama",
    "providers/openai",
    "providers/anthropic",
    "providers/google"
];

for (const name of modules) {
    try {
        require(`../lib/${name}`);

        record(`load ${name}`, true);
    } catch (error) {
        record(`load ${name}`, false, error.message);
    }
}

/*
=========================================================
2. PROVIDER REGISTRY
=========================================================
*/

section("Registry");

try {
    const described = providers.describeProviders();

    record(
        "describeProviders",
        described.length === Object.keys(config.PROVIDERS).length,
        described.map(p => p.name).join(", ")
    );

    for (const provider of described) {
        console.log(
            `       ${provider.name.padEnd(12)} ` +
                `configured=${provider.configured} ` +
                `local=${provider.local}`
        );
    }
} catch (error) {
    record("describeProviders", false, error.message);
}

try {
    const roles = providers.describeRoles();

    record(
        "describeRoles",
        roles.length > 0,
        roles
            .map(r => `${r.role}=${r.provider}/${r.model}`)
            .join(" ")
    );
} catch (error) {
    record("describeRoles", false, error.message);
}

/*
An unknown provider must raise, not silently
fall back to a different backend.
*/

try {
    providers.getProvider("nope");

    record("reject unknown provider", false, "did not throw");
} catch {
    record("reject unknown provider", true);
}

/*
=========================================================
3. REACHABILITY
=========================================================
*/

section("Reachability");

async function checkReachability() {
    for (const provider of providers.describeProviders()) {
        if (!provider.configured) {
            record(
                `${provider.name} reachable`,
                true,
                "skipped (not configured)"
            );

            continue;
        }

        const health = await providers.checkProvider(
            provider.name
        );

        record(
            `${provider.name} reachable`,
            health.ok,
            health.ok
                ? `${health.models.length} models`
                : health.reason
        );
    }
}

/*
=========================================================
4. LIVE COMPLETION
=========================================================
Only runs when a usable model exists.
=========================================================
*/

async function checkCompletion() {
    section("Live completion");

    const role = providers.resolveRole("chat");

    const models = await providers.listModels(
        role.provider
    );

    if (!models.length) {
        record(
            "chat completion",
            true,
            `skipped (no models on ${role.provider})`
        );

        return;
    }

    const model = models.includes(role.model)
        ? role.model
        : models[0];

    console.log(`       using ${role.provider}/${model}`);

    try {
        const started = Date.now();

        const result = await collect(
            providers.chat({
                provider: role.provider,
                model,

                system:
                    "Reply with exactly the word: pong",

                messages: [
                    {
                        role: "user",
                        content: "ping"
                    }
                ],

                stream: true,
                temperature: 0
            })
        );

        const elapsed = Date.now() - started;

        const ok = result.text.trim().length > 0;

        record(
            "chat completion",
            ok,
            `${elapsed}ms, text=${JSON.stringify(
                result.text.trim().slice(0, 60)
            )}`
        );
    } catch (error) {
        record("chat completion", false, error.message);
    }
}

/*
Tool calling is the capability the whole
agent loop depends on, so it is checked
separately and reported honestly.
*/

async function checkToolCalling() {
    section("Tool calling");

    const role = providers.resolveRole("chat");
    const models = await providers.listModels(role.provider);

    if (!models.length) {
        record(
            "tool call",
            true,
            "skipped (no models)"
        );

        return;
    }

    const model = models.includes(role.model)
        ? role.model
        : models[0];

    try {
        const result = await collect(
            providers.chat({
                provider: role.provider,
                model,

                system:
                    "Use the provided tool when asked. " +
                    "Do not answer in prose.",

                messages: [
                    {
                        role: "user",

                        content:
                            "What is the weather in Paris? " +
                            "Use the get_weather tool."
                    }
                ],

                tools: [
                    {
                        name: "get_weather",

                        description:
                            "Get the current weather for a city",

                        parameters: {
                            type: "object",

                            properties: {
                                city: {
                                    type: "string",
                                    description:
                                        "City name"
                                }
                            },

                            required: ["city"]
                        }
                    }
                ],

                stream: true,
                temperature: 0
            })
        );

        const called =
            result.toolCalls.length > 0 &&
            result.toolCalls[0].name === "get_weather";

        record(
            `tool call (${role.provider}/${model})`,
            called,
            called
                ? `args=${JSON.stringify(
                      result.toolCalls[0].arguments
                  )}`
                : "model did not emit a tool call"
        );
    } catch (error) {
        record("tool call", false, error.message);
    }
}

/*
=========================================================
RUN
=========================================================
*/

async function main() {
    await checkReachability();
    await checkCompletion();
    await checkToolCalling();

    const failed = results.filter(r => !r.ok);

    console.log(
        `\n${results.length - failed.length}/${results.length} checks passed`
    );

    if (failed.length) {
        console.log("\nFailures:");

        for (const item of failed) {
            console.log(`  - ${item.name}: ${item.detail}`);
        }

        process.exitCode = 1;
    }
}

main().catch(error => {
    console.error("\nSmoke test crashed:", error);

    process.exitCode = 1;
});
