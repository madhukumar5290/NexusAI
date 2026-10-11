"use strict";

const dns = require("node:dns").promises;
const providers = require("../providers");
const registry = require("./registry");

const DEFAULT_CACHE_MS = 30000;
const DEFAULT_TIMEOUT_MS = 4000;

let cachedSnapshot = null;
let cachedAt = 0;
let refreshInFlight = null;

function withTimeout(promise, timeoutMs, provider) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error(
                    `Provider health check timed out after ${timeoutMs} ms.`
                );
                error.provider = provider;
                reject(error);
            }, timeoutMs);
        })
    ]).finally(() => clearTimeout(timer));
}

function setProviderModels(
    providerName,
    modelNames,
    available,
    reason,
    configured = providers.isConfigured(providerName)
) {
    const names = new Set(modelNames.map(String));
    for (const model of registry.listModels({ provider: providerName })) {
        const discovered = names.has(model.model);
        const metadata = {
            ...model.metadata,
            runtimeStatus: available && discovered ? "available" : "unavailable"
        };
        if (reason) metadata.runtimeReason = reason;
        else delete metadata.runtimeReason;
        registry.registerModel({
            ...model,
            configured,
            available: available && discovered,
            metadata
        });
    }
}

async function refresh(options = {}) {
    const now = Date.now();
    const cacheMs = Number.isFinite(options.cacheMs)
        ? Math.max(0, options.cacheMs)
        : DEFAULT_CACHE_MS;

    if (!options.force && cachedSnapshot && now - cachedAt < cacheMs) {
        return cachedSnapshot;
    }
    if (refreshInFlight) return refreshInFlight;

    const checkProvider = options.checkProvider || providers.checkProvider;
    const timeoutMs = Number.isFinite(options.timeoutMs)
        ? Math.max(1, options.timeoutMs)
        : DEFAULT_TIMEOUT_MS;

    refreshInFlight = (async () => {
        const definitions = options.providerDefinitions || providers.describeProviders();
        const states = await Promise.all(definitions.map(async definition => {
            if (!definition.configured) {
                setProviderModels(
                    definition.name,
                    [],
                    false,
                    "not configured",
                    false
                );
                return {
                    name: definition.name,
                    configured: false,
                    local: definition.local,
                    ok: false,
                    status: "not_configured",
                    reason: "No provider credentials are configured.",
                    models: [],
                    quota: "unknown"
                };
            }

            try {
                const result = await withTimeout(
                    Promise.resolve().then(() => checkProvider(definition.name)),
                    timeoutMs,
                    definition.name
                );
                const modelNames = Array.isArray(result.models)
                    ? result.models.map(item =>
                        typeof item === "string" ? item : item?.model || item?.name
                    ).filter(Boolean)
                    : [];
                const ok = result.ok === true;
                if (ok && modelNames.length) {
                    registry.registerDiscoveredModels(
                        definition.name,
                        modelNames
                    );
                }
                setProviderModels(
                    definition.name,
                    modelNames,
                    ok,
                    ok ? null : result.reason || "Provider is unavailable.",
                    true
                );
                return {
                    name: definition.name,
                    configured: true,
                    local: definition.local,
                    ok,
                    status: ok ? "available" : "unavailable",
                    reason: ok ? null : result.reason || "Provider is unavailable.",
                    models: modelNames,
                    quota: "unknown"
                };
            } catch (error) {
                const reason = error.message || "Provider is unavailable.";
                setProviderModels(
                    definition.name,
                    [],
                    false,
                    reason,
                    true
                );
                return {
                    name: definition.name,
                    configured: true,
                    local: definition.local,
                    ok: false,
                    status: "unavailable",
                    reason,
                    models: [],
                    quota: "unknown"
                };
            }
        }));
        const hardware = registry.detectHardware();
        let internet = "unknown";
        try {
            await dns.lookup("one.one.one.one");
            internet = "available";
        } catch {
            const cloudOk = states.some(state => state.configured && !state.local && state.ok);
            internet = cloudOk ? "available" : "unavailable";
        }
        cachedSnapshot = {
            checkedAt: new Date().toISOString(),
            internet,
            quota: "unknown",
            hardware: {
                totalMemoryGB: hardware.memoryGB,
                availableMemoryGB: hardware.availableMemoryGB,
                gpu: hardware.gpu,
                hasGpu: hardware.hasGpu
            },
            providers: states
        };
        cachedAt = Date.now();
        return cachedSnapshot;
    })();

    try {
        return await refreshInFlight;
    } finally {
        refreshInFlight = null;
    }
}

function reset() {
    cachedSnapshot = null;
    cachedAt = 0;
    refreshInFlight = null;
}

module.exports = { refresh, reset };
