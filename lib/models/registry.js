"use strict";

/*
 * Provider-independent model metadata and selection.
 *
 * This module deliberately contains no transport code. Providers may register
 * models discovered from their own APIs, while the selector only deals with
 * capabilities, quality, and local hardware constraints.
 */

const os = require("os");
const config = require("../config");
const providers = require("../providers");

const INTELLIGENCE_PROFILES = Object.freeze({
    auto: { level: 0, label: "Automatic" },
    fast: { level: 1, label: "Fast" },
    balanced: { level: 2, label: "Balanced" },
    high: { level: 3, label: "High" },
    "very-high": { level: 4, label: "Very high" },
    maximum: { level: 5, label: "Maximum" },
    expert: { level: 6, label: "Expert" }
});

const TASK_CAPABILITIES = Object.freeze({
    chat: ["chat"],
    conversation: ["chat"],
    writing: ["chat"],
    writer: ["chat"],
    document: ["chat"],
    documents: ["chat"],
    presentations: ["chat"],
    translation: ["chat"],
    code: ["chat", "code"],
    coding: ["chat", "code"],
    "data-analyst": ["chat", "code"],
    database: ["chat", "code", "tools"],
    design: ["chat", "vision"],
    planner: ["chat", "reasoning"],
    planning: ["chat", "reasoning"],
    research: ["chat", "tools"],
    "security-review": ["chat", "code", "tools"],
    devops: ["chat", "code", "tools"],
    automation: ["chat", "tools"],
    productivity: ["chat"],
    legal: ["chat", "tools"],
    health: ["chat"],
    science: ["chat", "tools"],
    image: ["image"],
    vision: ["chat", "vision"],
    tool: ["chat", "tools"],
    tools: ["chat", "tools"],
    embedding: ["embedding"]
});

const models = new Map();

function text(value) {
    return value == null ? "" : String(value).trim();
}

function profileLevel(value) {
    const key = text(value).toLowerCase();
    return INTELLIGENCE_PROFILES[key]
        ? INTELLIGENCE_PROFILES[key].level
        : (Number.isFinite(Number(value)) ? Number(value) : 0);
}

function normalizeCapabilities(value) {
    if (Array.isArray(value)) {
        return [...new Set(value.map(text).map(v => v.toLowerCase()).filter(Boolean))];
    }
    return text(value).split(/[,\s]+/).map(v => v.toLowerCase()).filter(Boolean);
}

function keyFor(provider, model) {
    return `${text(provider).toLowerCase()}:${text(model)}`;
}

function normalizeModel(input, providerName) {
    const source = typeof input === "string" ? { model: input } : (input || {});
    const provider = text(source.provider || providerName || config.DEFAULT_PROVIDER).toLowerCase();
    const name = text(source.model || source.name);
    if (!name) throw new TypeError("A model name is required");
    const capabilities = normalizeCapabilities(source.capabilities || source.tasks);
    const local = source.local == null
        ? provider === "ollama" || provider === "local"
        : Boolean(source.local);
    return {
        provider,
        model: name,
        name,
        label: text(source.label || name),
        capabilities: capabilities.length ? capabilities : ["chat"],
        intelligence: text(source.intelligence || source.profile || "balanced").toLowerCase(),
        intelligenceLevel: profileLevel(source.intelligence || source.profile || "balanced"),
        contextWindow: Number.isFinite(Number(source.contextWindow))
            ? Number(source.contextWindow) : null,
        local,
        configured: source.configured == null ? providers.isConfigured(provider) : Boolean(source.configured),
        available: source.available == null ? true : Boolean(source.available),
        requirements: source.requirements || {},
        metadata: source.metadata || {}
    };
}

function registerModel(input, providerName) {
    let model = normalizeModel(input, providerName);
    const prior = models.get(keyFor(model.provider, model.model));
    if (prior) {
        model = {
            ...prior,
            ...model,
            capabilities: [...new Set(prior.capabilities.concat(model.capabilities))],
            intelligenceLevel: Math.max(prior.intelligenceLevel, model.intelligenceLevel)
        };
    }
    models.set(keyFor(model.provider, model.model), model);
    return { ...model, capabilities: [...model.capabilities] };
}

function discoveredCapabilities(provider, model) {
    const id = text(model).toLowerCase();
    if (/(embedding|embed(?:ding)?)(?:[-/:]|$)/.test(id)) return ["embedding"];
    if (/(image|dall-e|imagen|stable-diffusion|flux)/.test(id)) return ["image"];

    const capabilities = ["chat", "code"];
    const supportsToolCalls =
        (provider === "openai" && /(gpt-4|gpt-5|(^|[-/])o[134](?:[-/:]|$))/.test(id)) ||
        (provider === "anthropic" && /claude/.test(id)) ||
        (provider === "google" && /gemini/.test(id)) ||
        (provider === "openrouter" && /(gpt-4o|claude|gemini|llama-3|deepseek-chat|grok)/.test(id)) ||
        (provider === "groq" && /(llama-3|mixtral|qwen|deepseek)/.test(id)) ||
        (provider === "deepseek" && /deepseek-chat/.test(id)) ||
        (provider === "mistral" && /(mistral-large|codestral)/.test(id)) ||
        (provider === "xai" && /grok/.test(id)) ||
        (provider === "together" && /(llama-3|qwen|deepseek)/.test(id)) ||
        (provider === "ollama" && /(coder|codestral)/.test(id));
    if (supportsToolCalls) {
        capabilities.push("tools");
    }
    if (/(vision|llava|pixtral|gemini|gpt-4o|claude|grok|qwen-vl)/.test(id)) {
        capabilities.push("vision");
    }
    if (/(tool|function)/.test(id)) capabilities.push("tools");
    if (/(reason|thinking|deepseek-r1|(^|[-/])o[134](?:[-/:]|$))/.test(id)) {
        capabilities.push("reasoning");
    }
    return capabilities;
}

function estimateLocalMemory(model) {
    const id = text(model).toLowerCase();
    if (/(embedding|embed(?:ding)?)(?:[-/:]|$)/.test(id)) return 2;

    const match = id.match(/(?:^|[^0-9])(\d+(?:\.\d+)?)\s*b(?:[^a-z]|$)/i);
    if (!match) return 1024;

    return Math.round((Number(match[1]) * 0.7 + 0.35) * 10) / 10;
}

function registerDiscoveredModels(provider, modelNames, hardware = detectHardware()) {
    const name = text(provider).toLowerCase();
    if (!config.PROVIDERS[name]) throw new Error(`Unknown provider "${name}".`);
    if (!Array.isArray(modelNames)) throw new TypeError("Discovered models must be an array.");

    return modelNames
        .map(text)
        .filter(Boolean)
        .map(model => {
            const local = name === "ollama" || name === "local";
            const requirements = local
                ? { memoryGB: estimateLocalMemory(model) }
                : {};
            return registerModel({
                provider: name,
                model,
                capabilities: discoveredCapabilities(name, model),
                configured: providers.isConfigured(name),
                available: true,
                local,
                requirements,
                metadata: { discovered: true }
            });
        });
}

function unregisterModel(provider, model) {
    return models.delete(keyFor(provider, model));
}

function listModels(options) {
    const opts = options || {};
    let result = [...models.values()];
    if (opts.provider) result = result.filter(m => m.provider === text(opts.provider).toLowerCase());
    if (opts.local != null) result = result.filter(m => m.local === Boolean(opts.local));
    return result.map(m => ({ ...m, capabilities: [...m.capabilities] }));
}

function getModel(provider, model) {
    const found = models.get(keyFor(provider, model));
    return found ? { ...found, capabilities: [...found.capabilities] } : null;
}

function requiredCapabilities(task, explicit) {
    if (Array.isArray(explicit)) return normalizeCapabilities(explicit);
    if (explicit) return normalizeCapabilities(explicit);
    const name = text(task || "chat").toLowerCase();
    return TASK_CAPABILITIES[name] || normalizeCapabilities(name);
}

function supports(model, required) {
    return required.every(capability =>
        model.capabilities.includes(capability) ||
        (capability === "chat" && model.capabilities.includes("text")));
}

function detectHardware() {
    const cpus = os.cpus() || [];
    const memoryBytes = os.totalmem();
    const freeMemoryBytes = os.freemem();
    const reserveBytes = 1 * 1073741824;
    const gpu = text(process.env.NEXUS_GPU || process.env.GPU);
    return {
        platform: process.platform,
        arch: process.arch,
        cpu: cpus[0] ? cpus[0].model : "unknown",
        cpuCores: cpus.length,
        memoryBytes,
        memoryGB: Math.round(memoryBytes / 1073741824 * 100) / 100,
        freeMemoryBytes,
        availableMemoryGB: Math.round(
            Math.max(0, freeMemoryBytes - reserveBytes) / 1073741824 * 100
        ) / 100,
        gpu: gpu || null,
        hasGpu: Boolean(gpu),
        source: "runtime"
    };
}

function canRun(model, hardware) {
    const requirements = model.requirements || {};
    const memory = Number(requirements.memoryGB || requirements.minMemoryGB);
    const availableMemory = Number.isFinite(hardware.availableMemoryGB)
        ? hardware.availableMemoryGB
        : hardware.memoryGB;
    if (Number.isFinite(memory) && availableMemory < memory) return false;
    if (requirements.gpu && !hardware.hasGpu) return false;
    return true;
}

function score(model, requestedLevel, required, hardware) {
    const capabilityScore = required.length
        ? required.filter(cap => model.capabilities.includes(cap)).length * 100
        : 0;
    const qualityScore = requestedLevel === 0
        ? 0
        : Math.max(0, 30 - Math.abs(model.intelligenceLevel - requestedLevel) * 8);
    return capabilityScore + qualityScore + (model.local ? 2 : 0);
}

function selectModel(options) {
    const opts = typeof options === "string" ? { task: options } : (options || {});
    const hardware = opts.hardware || detectHardware();
    const required = requiredCapabilities(opts.task || opts.role, opts.capabilities);
    const requestedLevel = profileLevel(opts.intelligence || opts.profile || "balanced");
    const candidates = listModels().filter(model =>
        model.available &&
        model.configured &&
        (!opts.provider ||
            model.provider === text(opts.provider).toLowerCase()) &&
        supports(model, required));
    const preferred = opts.model || opts.name;
    if (preferred) {
        const exact = candidates.find(model =>
            model.model === preferred || `${model.provider}:${model.model}` === preferred);
        if (exact) return exact;
    }
    const withinMemoryBudget = candidates.filter(model => canRun(model, hardware));
    const ranked = withinMemoryBudget.length ? withinMemoryBudget : candidates;
    ranked.sort((a, b) => score(b, requestedLevel, required, hardware) -
        score(a, requestedLevel, required, hardware));
    return ranked[0] || null;
}

function ensureDefaults() {
    if (models.size) return;
    Object.entries(config.MODEL_ROLES).forEach(([role, entry]) => {
        const capabilities = role === "code" ? ["chat", "code", "tools"] :
            role === "planner" ? ["chat", "reasoning"] : ["chat"];
        registerModel({
            provider: entry.provider,
            model: entry.model,
            capabilities,
            intelligence: role === "planner" ? "high" : "balanced"
        });
    });
    [
        ["ollama", "llama3.1:8b", ["chat", "reasoning"], "balanced"],
        ["ollama", "llama3.2:3b", ["chat"], "fast"],
        ["ollama", "mistral:7b", ["chat"], "balanced"],
        ["ollama", "deepseek-coder-v2:16b", ["chat", "code", "tools"], "high"],
        ["ollama", "qwen2.5:7b", ["chat", "code", "tools"], "high"],
        ["ollama", "qwen2.5:1.5b", ["chat"], "fast"],
        ["ollama", "qwen2.5-coder:1.5b", ["chat", "code", "tools"], "fast"],
        ["ollama", "llava:13b", ["chat", "vision"], "balanced"],
        ["ollama", "nomic-embed-text", ["embedding"], "fast"],
        ["openai", "gpt-4o", ["chat", "reasoning", "code", "tools", "vision"], "high"],
        ["openai", "gpt-4o-mini", ["chat", "code", "vision"], "fast"],
        ["openai", "o4-mini", ["chat", "reasoning", "code", "tools"], "high"],
        ["openai", "gpt-image-2", ["image"], "high"],
        ["openai", "text-embedding-3-large", ["embedding"], "high"],
        ["anthropic", "claude-sonnet-4-20250514", ["chat", "reasoning", "code", "tools", "vision"], "expert"],
        ["anthropic", "claude-3-7-sonnet-20250219", ["chat", "reasoning", "code", "tools", "vision"], "very-high"],
        ["anthropic", "claude-3-5-haiku-20241022", ["chat", "code", "vision"], "fast"],
        ["google", "gemini-2.5-pro", ["chat", "reasoning", "code", "tools", "vision"], "high"],
        ["google", "gemini-2.5-flash", ["chat", "code", "vision"], "balanced"],
        ["google", "text-embedding-004", ["embedding"], "balanced"],
        ["groq", "llama-3.3-70b-versatile", ["chat", "reasoning", "code", "tools"], "high"],
        ["mistral", "mistral-large-latest", ["chat", "reasoning", "code", "tools"], "high"],
        ["mistral", "codestral-latest", ["chat", "code"], "high"],
        ["deepseek", "deepseek-chat", ["chat", "code", "tools"], "high"],
        ["deepseek", "deepseek-reasoner", ["chat", "reasoning", "code"], "expert"],
        ["xai", "grok-4", ["chat", "reasoning", "code", "tools", "vision"], "expert"],
    ].forEach(([provider, model, capabilities, intelligence]) => registerModel({
        provider,
        model,
        capabilities,
        intelligence,
        available: false,
        configured: false,
        metadata: { catalog: true, availability: "requires provider setup or local installation" }
    }));
}

function reset() {
    models.clear();
}

ensureDefaults();

module.exports = {
    INTELLIGENCE_PROFILES,
    PROFILES: INTELLIGENCE_PROFILES,
    TASK_CAPABILITIES,
    registerModel,
    addModel: registerModel,
    registerDiscoveredModels,
    unregisterModel,
    listModels,
    getModel,
    requiredCapabilities,
    matchTask: (task, options) => listModels(options).filter(model =>
        supports(model, requiredCapabilities(task, options && options.capabilities))),
    selectModel,
    select: selectModel,
    detectHardware,
    canRun,
    getHardwareMetadata: detectHardware,
    estimateLocalMemory,
    reset,
    profileLevel
};
