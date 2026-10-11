"use strict";

/*
 * Agent definitions are deliberately transport- and execution-independent.
 * API routes can use this registry to select an agent and pass its policy to
 * the agent loop without having to know how tools or providers are loaded.
 */

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const APPROVAL_MODES = new Set(["auto", "always", "never", "manual"]);
const agents = new Map();

const BUILT_INS = [
    {
        id: "general",
        name: "General assistant",
        description: "A general-purpose assistant with safe workspace and web access.",
        allowedTools: [
            "workspace_read_file", "workspace_list", "workspace_tree", "web_fetch"
        ],
        allowedModels: ["chat"],
        knowledge: { sources: ["conversation", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "coding",
        name: "Coding agent",
        description: "Builds and edits projects in the Nexus workspace.",
        allowedTools: [
            "workspace_create_file", "workspace_update_file", "workspace_read_file",
            "workspace_delete_file", "workspace_list", "workspace_tree",
            "terminal_execute", "git_status", "git_diff", "git_commit"
        ],
        allowedModels: ["code", "planner"],
        knowledge: { sources: ["conversation", "workspace", "project"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "research",
        name: "Research agent",
        description: "Researches the web and organizes findings in workspace files.",
        allowedTools: [
            "web_fetch", "research_run", "workspace_read_file", "workspace_list",
            "workspace_tree", "workspace_create_file", "workspace_update_file"
        ],
        allowedModels: ["chat", "planner"],
        knowledge: { sources: ["conversation", "workspace", "web"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },

    /*
    Specialist agents.

    Each entry names only tools that are actually registered in
    src/agent/tools.js, so an agent can never be selected and then
    fail because its tool list is aspirational.
    */
    {
        id: "data-analyst",
        name: "Data analyst",
        description: "Loads datasets, runs analysis, and produces charts and reports.",
        allowedTools: [
            "workspace_read_file", "workspace_list", "workspace_tree",
            "workspace_create_file", "workspace_update_file", "data_analyze",
            "db_query", "document_generate"
        ],
        allowedModels: ["code", "chat", "planner"],
        knowledge: { sources: ["conversation", "workspace", "project"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "browser",
        name: "Browser agent",
        description: "Navigates websites, extracts structured data, and completes multi-step web tasks.",
        allowedTools: [
            "web_fetch", "research_run", "workspace_create_file",
            "workspace_update_file", "workspace_read_file", "workspace_list"
        ],
        allowedModels: ["chat", "planner"],
        knowledge: { sources: ["conversation", "web", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "computer-use",
        name: "Computer use agent",
        description: "Operates the desktop: files, folders, applications, and screen understanding.",
        allowedTools: [
            "terminal_execute", "workspace_list", "workspace_tree",
            "workspace_read_file", "workspace_create_file", "workspace_update_file",
            "vision_analyze"
        ],
        allowedModels: ["planner", "chat"],
        knowledge: { sources: ["conversation", "workspace"] },
        approvalPolicy: { mode: "always", requiredForRiskyTools: true }
    },
    {
        id: "writer",
        name: "Writing agent",
        description: "Drafts and revises articles, stories, scripts, and long-form documents.",
        allowedTools: [
            "workspace_read_file", "workspace_list", "workspace_create_file",
            "workspace_update_file", "document_generate", "web_fetch"
        ],
        allowedModels: ["chat", "planner"],
        knowledge: { sources: ["conversation", "workspace", "project"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "documents",
        name: "Documents agent",
        description: "Creates PDFs, Word files, slide decks, and spreadsheets.",
        allowedTools: [
            "document_generate", "workspace_read_file", "workspace_list",
            "workspace_create_file", "workspace_update_file"
        ],
        allowedModels: ["chat", "code"],
        knowledge: { sources: ["conversation", "workspace", "project"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "presentations",
        name: "Presentations agent",
        description: "Builds slide decks from an outline, research, or existing notes.",
        allowedTools: [
            "document_generate", "workspace_read_file", "workspace_list",
            "workspace_create_file", "workspace_update_file", "web_fetch"
        ],
        allowedModels: ["chat", "planner"],
        knowledge: { sources: ["conversation", "workspace", "web"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "spreadsheets",
        name: "Spreadsheets agent",
        description: "Works with tabular data, formulas, and spreadsheet generation.",
        allowedTools: [
            "data_analyze", "document_generate", "workspace_read_file",
            "workspace_list", "workspace_create_file", "workspace_update_file",
            "db_query"
        ],
        allowedModels: ["code", "chat"],
        knowledge: { sources: ["conversation", "workspace", "project"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "science",
        name: "Science agent",
        description: "Scientific reasoning, method design, and literature grounding with sources.",
        allowedTools: [
            "web_fetch", "research_run", "data_analyze", "workspace_read_file",
            "workspace_create_file", "workspace_update_file", "document_generate"
        ],
        allowedModels: ["planner", "chat"],
        knowledge: { sources: ["conversation", "web", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "mathematics",
        name: "Mathematics agent",
        description: "Step-by-step mathematical reasoning, verification, and worked solutions.",
        allowedTools: [
            "data_analyze", "workspace_read_file", "workspace_create_file",
            "document_generate"
        ],
        allowedModels: ["planner", "code", "chat"],
        knowledge: { sources: ["conversation", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "business",
        name: "Business agent",
        description: "Strategy, planning, market analysis, and business documents.",
        allowedTools: [
            "web_fetch", "research_run", "document_generate", "data_analyze",
            "workspace_read_file", "workspace_create_file", "workspace_update_file"
        ],
        allowedModels: ["chat", "planner"],
        knowledge: { sources: ["conversation", "web", "workspace", "project"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "education",
        name: "Education agent",
        description: "Explains concepts at a chosen level and builds lessons and exercises.",
        allowedTools: [
            "web_fetch", "workspace_read_file", "workspace_create_file",
            "document_generate", "data_analyze", "vision_analyze"
        ],
        allowedModels: ["chat", "planner"],
        knowledge: { sources: ["conversation", "web", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "planner",
        name: "Planning agent",
        description: "Breaks a goal into ordered, verifiable steps before execution.",
        allowedTools: [
            "workspace_read_file", "workspace_list", "workspace_tree",
            "workspace_create_file", "web_fetch"
        ],
        allowedModels: ["planner", "chat"],
        knowledge: { sources: ["conversation", "project", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "project-manager",
        name: "Project manager agent",
        description: "Tracks tasks, milestones, and dependencies across a project.",
        allowedTools: [
            "workspace_read_file", "workspace_list", "workspace_tree",
            "workspace_create_file", "workspace_update_file", "document_generate",
            "git_status", "git_log"
        ],
        allowedModels: ["planner", "chat"],
        knowledge: { sources: ["conversation", "project", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "automation",
        name: "Automation agent",
        description: "Designs and runs repeatable workflows with checks between steps.",
        allowedTools: [
            "workspace_create_file", "workspace_update_file", "workspace_read_file",
            "terminal_execute", "web_fetch", "document_generate"
        ],
        allowedModels: ["code", "planner"],
        knowledge: { sources: ["conversation", "project", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "productivity",
        name: "Productivity agent",
        description: "Notes, summaries, action items, and day-to-day personal workflows.",
        allowedTools: [
            "workspace_read_file", "workspace_list", "workspace_create_file",
            "workspace_update_file", "document_generate", "web_fetch"
        ],
        allowedModels: ["chat"],
        knowledge: { sources: ["conversation", "project", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "vision",
        name: "Vision agent",
        description: "Reads images, screenshots, diagrams, and charts.",
        allowedTools: [
            "vision_analyze", "image_generate", "image_edit",
            "workspace_read_file", "workspace_list", "workspace_create_file"
        ],
        allowedModels: ["chat", "code"],
        knowledge: { sources: ["conversation", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "media",
        name: "Media agent",
        description: "Generates and edits images, and works with speech and audio.",
        allowedTools: [
            "image_generate", "image_edit", "audio_synthesize", "audio_transcribe",
            "vision_analyze", "workspace_list", "workspace_create_file"
        ],
        allowedModels: ["chat", "code"],
        knowledge: { sources: ["conversation", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "database",
        name: "Database agent",
        description: "Inspects and queries databases, and answers questions about their contents.",
        allowedTools: [
            "db_query", "db_exec", "data_analyze", "workspace_read_file",
            "workspace_list", "workspace_create_file"
        ],
        allowedModels: ["code", "chat"],
        knowledge: { sources: ["conversation", "workspace", "project"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "security-review",
        name: "Security review agent",
        description: "Reviews code and configuration for security weaknesses and risky patterns.",
        allowedTools: [
            "workspace_read_file", "workspace_list", "workspace_tree",
            "git_diff", "git_status", "git_log", "terminal_execute",
            "document_generate"
        ],
        allowedModels: ["code", "planner"],
        knowledge: { sources: ["conversation", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "devops",
        name: "DevOps agent",
        description: "Builds, tests, inspects logs, and prepares deployments.",
        allowedTools: [
            "terminal_execute", "git_status", "git_diff", "git_log", "git_commit",
            "workspace_read_file", "workspace_create_file", "workspace_update_file"
        ],
        allowedModels: ["code", "planner"],
        knowledge: { sources: ["conversation", "workspace", "project"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "translation",
        name: "Translation agent",
        description: "Translates between languages while preserving meaning and tone.",
        allowedTools: [
            "workspace_read_file", "workspace_create_file", "document_generate"
        ],
        allowedModels: ["chat"],
        knowledge: { sources: ["conversation", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "legal",
        name: "Legal research agent",
        description: "Summarises documents and finds relevant sources. Not a substitute for a qualified lawyer.",
        allowedTools: [
            "web_fetch", "research_run", "workspace_read_file", "workspace_list",
            "workspace_create_file", "document_generate"
        ],
        allowedModels: ["planner", "chat"],
        knowledge: { sources: ["conversation", "web", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "health",
        name: "Health information agent",
        description: "Explains health topics from sources. Educational only, not medical advice.",
        allowedTools: [
            "web_fetch", "research_run", "workspace_read_file",
            "workspace_create_file", "document_generate"
        ],
        allowedModels: ["planner", "chat"],
        knowledge: { sources: ["conversation", "web", "workspace"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    },
    {
        id: "design",
        name: "Design agent",
        description: "Produces layouts, UI concepts, diagrams, and visual specifications.",
        allowedTools: [
            "workspace_create_file", "workspace_update_file", "workspace_read_file",
            "image_generate", "image_edit", "vision_analyze", "document_generate"
        ],
        allowedModels: ["chat", "code"],
        knowledge: { sources: ["conversation", "workspace", "project"] },
        approvalPolicy: { mode: "manual", requiredForRiskyTools: true }
    }
];

function copy(value) {
    if (value === undefined) return value;
    return JSON.parse(JSON.stringify(value));
}

function strings(value, field, required) {
    if (value == null && !required) return [];
    if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
    const result = value.map(item => String(item).trim()).filter(Boolean);
    if (required && !result.length) throw new TypeError(`${field} must not be empty`);
    if (result.length !== value.length) throw new TypeError(`${field} must contain non-empty strings`);
    return [...new Set(result)];
}

function normalizeKnowledge(value) {
    if (value == null) return { sources: [] };
    if (Array.isArray(value)) return { sources: strings(value, "knowledge", false) };
    if (typeof value !== "object") throw new TypeError("knowledge must be an object or array");
    const result = copy(value);
    if (result.sources != null) result.sources = strings(result.sources, "knowledge.sources", false);
    return result;
}

function normalizeApproval(value) {
    const result = value == null ? {} : copy(value);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
        throw new TypeError("approvalPolicy must be an object");
    }
    const mode = result.mode == null ? "manual" : String(result.mode).toLowerCase();
    if (!APPROVAL_MODES.has(mode)) {
        throw new TypeError(`approvalPolicy.mode must be one of: ${[...APPROVAL_MODES].join(", ")}`);
    }
    result.mode = mode;
    result.requiredForRiskyTools = result.requiredForRiskyTools == null
        ? true : Boolean(result.requiredForRiskyTools);
    if (result.tools != null) result.tools = strings(result.tools, "approvalPolicy.tools", false);
    return result;
}

function normalize(input, prior) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("agent definition must be an object");
    }
    const source = { ...(prior || {}), ...input };
    const id = String(source.id || source.name || "").trim().toLowerCase();
    if (!id || !ID_PATTERN.test(id)) {
        throw new TypeError("agent id must start with a letter and contain only letters, numbers, ., _, or -");
    }
    const result = {
        id,
        name: String(source.name || id).trim(),
        description: String(source.description || "").trim(),
        allowedTools: strings(source.allowedTools == null ? source.tools : source.allowedTools, "allowedTools", false),
        allowedModels: strings(source.allowedModels == null ? source.models : source.allowedModels, "allowedModels", false),
        knowledge: normalizeKnowledge(source.knowledge),
        approvalPolicy: normalizeApproval(source.approvalPolicy),
        metadata: source.metadata == null ? {} : copy(source.metadata),
        builtin: Boolean(source.builtin)
    };
    if (!result.name) throw new TypeError("agent name must not be empty");
    return result;
}

function publicAgent(agent) {
    return copy(agent);
}

function register(definition) {
    const agent = normalize(definition);
    if (agents.has(agent.id)) throw new Error(`Agent already registered: ${agent.id}`);
    agents.set(agent.id, agent);
    return publicAgent(agent);
}

function update(id, changes) {
    const key = String(id || "").trim().toLowerCase();
    const existing = agents.get(key);
    if (!existing) return null;
    const updated = normalize({ ...changes, id: key, builtin: existing.builtin }, existing);
    agents.set(key, updated);
    return publicAgent(updated);
}

function get(id) {
    const agent = agents.get(String(id || "").trim().toLowerCase());
    return agent ? publicAgent(agent) : null;
}

function list(options) {
    const opts = options || {};
    return [...agents.values()]
        .filter(agent => opts.builtin == null || agent.builtin === Boolean(opts.builtin))
        .map(publicAgent);
}

function remove(id) {
    const key = String(id || "").trim().toLowerCase();
    const agent = agents.get(key);
    if (!agent || agent.builtin) return false;
    return agents.delete(key);
}

function allows(agentOrId, kind, value) {
    const agent = typeof agentOrId === "string" ? agents.get(agentOrId) : agentOrId;
    if (!agent) return false;
    const allowed = kind === "tool" ? agent.allowedTools : agent.allowedModels;
    return allowed.includes("*") || allowed.includes(String(value));
}

function canUseTool(agent, tool) { return allows(agent, "tool", tool); }
function canUseModel(agent, model) { return allows(agent, "model", model); }
function getAllowedTools(agent) {
    const found = typeof agent === "string" ? get(agent) : agent;
    return found ? [...found.allowedTools] : [];
}
function getAllowedModels(agent) {
    const found = typeof agent === "string" ? get(agent) : agent;
    return found ? [...found.allowedModels] : [];
}
function getKnowledge(agent) {
    const found = typeof agent === "string" ? get(agent) : agent;
    return found ? copy(found.knowledge) : null;
}
function getApprovalPolicy(agent) {
    const found = typeof agent === "string" ? get(agent) : agent;
    return found ? copy(found.approvalPolicy) : null;
}

function resolveForTask(task) {
    const value = String(task || "chat").toLowerCase();
    const id = value === "code" || value === "coding" ? "coding"
        : value === "research" || value === "web" ? "research"
            : value === "planner" || value === "planning" || value === "reasoning" ? "planner"
                : value === "image" || value === "vision" ? "vision"
                    : value === "document" || value === "documents" ? "documents"
                        : value === "slide" || value === "presentation" || value === "presentations" ? "presentations"
                            : value === "spreadsheet" || value === "data" || value === "data-analyst" ? "data-analyst"
                                : value === "database" || value === "sql" ? "database"
                                    : value === "translate" || value === "translation" ? "translation"
                                        : value === "design" || value === "ui" ? "design"
                                            : value === "security" || value === "security-review" ? "security-review"
                                                : value === "devops" || value === "deploy" ? "devops"
                                                    : value === "browser" ? "browser"
                                                        : "general";
    return get(id) || get("general");
}

function reset() {
    agents.clear();
    BUILT_INS.forEach(definition => agents.set(definition.id, normalize({ ...definition, builtin: true })));
}

reset();

module.exports = {
    APPROVAL_MODES: Object.freeze([...APPROVAL_MODES]),
    BUILT_INS: Object.freeze(BUILT_INS.map(copy)),
    register,
    registerAgent: register,
    update,
    updateAgent: update,
    get,
    getAgent: get,
    list,
    listAgents: list,
    remove,
    unregister: remove,
    removeAgent: remove,
    getAllowedTools,
    getAllowedModels,
    getKnowledge,
    getApprovalPolicy,
    resolveForTask,
    canUseTool,
    canUseModel,
    reset
};
