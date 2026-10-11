/* =========================================================
   NEXUS AI 4.0
   Chat + Streaming + Workspace + Artifacts
   + Agent Activity + Preview + Verification
========================================================= */

const API_BASE = "";

let conversations = [];
let activeConversationId = null;
let activeProjectId = null;

let isSending = false;
let activeAbortController = null;
let activeAssistantElement = null;

let workspaceFiles = [];
let selectedFilePath = null;
let selectedFileContent = "";


/* =========================================================
   DOM
========================================================= */

/*
Composer and header icons are inline SVG rather than font
glyphs. Anything that changes an icon swaps this markup in
instead of writing text, so the SVG is never destroyed and
the button always keeps its shape and accessible label.
*/
const ICON_PLUS = `
    <span class="icon-glyph" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M9 3.5v11M3.5 9h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
    </span>`;

const ICON_SPINNER = `
    <span class="icon-glyph" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="2" fill="currentColor"/>
            <circle cx="14" cy="9" r="2" fill="currentColor" opacity=".35"/>
            <circle cx="4" cy="9" r="2" fill="currentColor" opacity=".35"/>
        </svg>
    </span>`;

const ICON_MIC = `
    <span class="icon-glyph" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="6.6" y="2.2" width="4.8" height="8" rx="2.4" stroke="currentColor" stroke-width="1.5"/>
            <path d="M4.2 8.6a4.8 4.8 0 0 0 9.6 0M9 13.4v2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
    </span>`;

const ICON_STOP = `
    <span class="icon-glyph" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" fill="currentColor"/>
        </svg>
    </span>`;

/*
Replace a button's icon markup. Only the icon subtree is
touched, so the button itself and its aria-label survive.
*/
function setButtonIcon(button, markup) {
    if (!button) return;
    button.innerHTML = markup;
}

function closeConversationMenus() {
    document.querySelectorAll(".conversation-action-menu.open").forEach(menu => {
        menu.classList.remove("open");
        const row = menu.closest(".conversation-item");
        row?.classList.remove("menu-open");
        row?.querySelector('[aria-haspopup="menu"]')?.setAttribute("aria-expanded", "false");
    });
}

const conversationList =
    document.getElementById("conversationList");

const chatTitle =
    document.getElementById("chatTitle");

const messages =
    document.getElementById("messages");

const messageInput =
    document.getElementById("messageInput");

const sendButton =
    document.getElementById("sendButton");

const attachmentButton =
    document.getElementById("attachmentButton");

const attachmentInput =
    document.getElementById("attachmentInput");

const toolsButton =
    document.getElementById("toolsButton");

const thinkButton =
    document.getElementById("thinkButton");

const webSearchButton =
    document.getElementById("webSearchButton");

const imageButton =
    document.getElementById("imageButton");

const voiceButton =
    document.getElementById("voiceButton");

const sidebarNavItems =
    document.querySelectorAll("[data-view]");

const modeTabs =
    document.querySelectorAll("[data-mode]");

const newChatButton =
    document.getElementById("newChatButton");

const searchInput =
    document.getElementById("searchInput");

const renameModal =
    document.getElementById("renameModal");

const renameChatInput =
    document.getElementById("renameChatInput");

const workspacePanel =
    document.getElementById("workspacePanel");

const workspacePage =
    document.getElementById("workspacePage");

const workspaceTabs =
    document.querySelectorAll("[data-workspace-section]");

const workspaceSections = {
    activity:
        document.getElementById("workspaceActivitySection"),
    files:
        document.getElementById("workspaceFilesSection"),
    preview:
        document.getElementById("workspacePreviewSection"),
    workspaceProjectSection:
        document.getElementById("workspaceProjectSection"),
    workspaceVerificationSection:
        document.getElementById("workspaceVerificationSection")
};

const sidebarToggle =
    document.getElementById("sidebarToggle");

const sidebar =
    document.querySelector(".sidebar");

const accountSettingsButton =
    document.getElementById("accountSettingsButton");

const workspaceTree =
    document.getElementById("workspaceTree");

const fileCount =
    document.getElementById("fileCount");

const agentActivity =
    document.getElementById("agentActivity");

const activityState =
    document.getElementById("activityState");

const agentStatus =
    document.getElementById("agentStatus");

function setAgentStatusClass(className) {
    if (agentStatus) agentStatus.className = className;
}

const projectInfo =
    document.getElementById("projectInfo");

const fileEditorSection =
    document.getElementById("fileEditorSection");

const selectedFileName =
    document.getElementById("selectedFileName");

const fileEditor =
    document.getElementById("fileEditor");

const saveFileButton =
    document.getElementById("saveFileButton");

const closeFileButton =
    document.getElementById("closeFileButton");

const refreshWorkspaceButton =
    document.getElementById("refreshWorkspace");

const previewContainer =
    document.getElementById("previewContainer");

const openPreviewButton =
    document.getElementById("openPreviewButton");

const refreshPreviewButton =
    document.getElementById("refreshPreviewButton");

const verificationPanel =
    document.getElementById("verificationPanel");

const controlCenterButton =
    document.getElementById("controlCenterButton");

const controlCenterModal =
    document.getElementById("controlCenterModal");

const controlCenterBody =
    document.getElementById("controlCenterBody");

const installAppButton =
    document.getElementById("installAppButton");

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (installAppButton) installAppButton.hidden = false;
});

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (installAppButton) installAppButton.hidden = true;
});

function setupProgressiveWebApp() {
    if (installAppButton) {
        installAppButton.addEventListener("click", async () => {
            if (!deferredInstallPrompt) return;
            const installPrompt = deferredInstallPrompt;
            deferredInstallPrompt = null;
            try {
                await installPrompt.prompt();
                await installPrompt.userChoice;
                installAppButton.hidden = true;
            } catch (error) {
                installAppButton.hidden = true;
                console.error("App installation prompt failed:", error);
                showCapabilityNotice("Jarwis could not open the install prompt. Use your browser’s Install option instead.");
            }
        });
    }

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("/service-worker.js")
            .catch(error => {
                console.error("Offline app shell registration failed:", error);
            });
    }
}

const modelSelector =
    document.getElementById("modelSelector");

const intelligenceSelector =
    document.getElementById("intelligenceSelector");

let selectedModelConfig = {
    provider: null,
    model: null
};
let autoRoutingSummary = null;
let selectedImageModel = localStorage.getItem("nexus-image-model") || "";

let advancedExecutionConfig = {};
try {
    advancedExecutionConfig = JSON.parse(localStorage.getItem("nexus-advanced-execution") || "{}");
} catch {
    advancedExecutionConfig = {};
}

/*
Sampling and execution options from Advanced Mode.

Only sent when Advanced Mode is on, so the default path keeps using
the provider's own defaults rather than silently overriding them.
*/
function advancedRequestOptions() {
    if (!advancedExecutionConfig.enabled) return {};

    const output = {};
    const numeric = [
        "temperature",
        "maxTokens",
        "maxAgentSteps",
        "topP",
        "topK",
        "repetitionPenalty",
        "seed"
    ];

    numeric.forEach(key => {
        const raw = advancedExecutionConfig[key];
        if (raw === "" || raw == null) return;
        const value = Number(raw);
        if (Number.isFinite(value)) output[key] = value;
    });

    return output;
}

let speechRecognition = null;
let voiceChatMode = false;
let voiceInputPaused = false;
let voiceInputPending = false;
let voiceSpeaking = false;
let voiceRestartTimer = null;
let thinkMode = false;
let webSearchMode = false;

let nexusKeepAwakeHandle = null;
let nexusFollowUpTimers = [];

function readNexusSettings() {
    try {
        return JSON.parse(localStorage.getItem("nexus-settings") || "{}");
    } catch {
        return {};
    }
}

function showFollowUpSuggestions(element) {
    const followUps = ["Summarize this in one line.", "Show a concrete example.", "What should I check next?"];
    const container = document.createElement("div");
    container.className = "follow-up-suggestions";
    container.innerHTML = followUps.map(text =>
        `<button type="button" class="follow-up-suggestion">${escapeHtml(text)}</button>`
    ).join("");
    container.querySelectorAll(".follow-up-suggestion").forEach((button, index) => {
        button.addEventListener("click", () => {
            messageInput.value = followUps[index];
            autoResizeTextarea();
            messageInput.focus();
        });
    });
    element?.appendChild(container);
}

async function applyKeepAwakeSetting() {
    const wanted = readNexusSettings().keepAwake === true;
    if (!wanted || !("wakeLock" in navigator)) return;
    if (nexusKeepAwakeHandle) return;
    try {
        nexusKeepAwakeHandle = await navigator.wakeLock.request("screen");
        nexusKeepAwakeHandle.addEventListener("release", () => {
            nexusKeepAwakeHandle = null;
        });
    } catch {
        nexusKeepAwakeHandle = null;
    }
}

function releaseKeepAwakeSetting() {
    try { nexusKeepAwakeHandle?.release(); } catch { /* already released */ }
    nexusKeepAwakeHandle = null;
}

/*
Which specialist agent a message belongs to.

The same mapping the server uses in agentRegistry.resolveForTask,
anchored on keywords so the header can show which agent will handle
the turn before the answer arrives.
*/
const TASK_PATTERNS = [
    ["research", /\b(search|browse|latest|current|today|news|research|source|citation)\b/],
    ["code", /\b(code|coding|debug|bug|function|javascript|python|refactor|compile|test suite|api|developer)\b/],
    ["writer", /\b(draft|compose|proofread|essay|story|blog|email|letter)\b/],
    ["presentations", /\b(slide|deck|presentation|powerpoint|ppt)\b/],
    ["documents", /\b(pdf|word|docx|document|report|memo)\b/],
    ["data-analyst", /\b(spreadsheet|csv|excel|pivot|dataset|chart|statistics)\b/],
    ["database", /\b(database|schema|create table|migration|sql query)\b/],
    ["translation", /\b(translate|translation)\b/],
    ["design", /\b(layout|wireframe|mockup|ui concept|visual spec)\b/],
    ["security-review", /\b(security|vulnerab|exploit|owasp|penetration)\b/],
    ["devops", /\b(deploy|docker|kubernetes|pipeline|devops|server log)\b/],
    ["planner", /\b(plan|roadmap|strategy|compare|decide|analy[sz]e|schedule|milestone)\b/],
    ["image", /\b(image|picture|illustration|logo|photo)\b/]
];

function inferTask(text) {
    const value = String(text || "").toLowerCase();
    if (webSearchMode) return "research";
    if (thinkMode) return "planner";
    for (const [task, pattern] of TASK_PATTERNS) {
        if (pattern.test(value)) return task;
    }
    return "chat";
}

/* Human-readable names for each routed task, shown in the activity feed. */
const AGENT_LABELS = {
    chat: "general assistant",
    research: "research agent",
    code: "coding agent",
    presentations: "presentations agent",
    documents: "documents agent",
    "data-analyst": "data analyst",
    database: "database agent",
    translation: "translation agent",
    design: "design agent",
    "security-review": "security review agent",
    devops: "DevOps agent",
    planner: "planning agent",
    image: "vision agent"
};

/*
Whether Enter sends a message.

Published at module scope, not inside the Settings builder: the
composer binds its keydown handler during setupEvents(), which runs
long before Settings is ever opened. Reading it only from storage at
that point keeps the behaviour correct on first load.
*/
window.__nexusEnterToSend = readNexusSettings().enterToSend !== false;

const sidebarCollapsed =
    localStorage.getItem("nexus-sidebar-collapsed") === "true";

const sidebarOpen =
    document.getElementById("sidebarOpen");

const searchToggle =
    document.getElementById("searchToggle");

const searchContainer =
    document.getElementById("searchContainer");

const modelMenuButton =
    document.getElementById("modelMenuButton");

const modelMenu =
    document.getElementById("modelMenu");

const modelMenuLabel =
    document.getElementById("modelMenuLabel");

const intelligenceMenuOptions =
    document.getElementById("intelligenceMenuOptions");

const modelMenuOptions =
    document.getElementById("modelMenuOptions");

const agentMenuOptions =
    document.getElementById("agentMenuOptions");

/*
The agent handling a turn.

null (the default) means "choose automatically from the message" —
the keyword mapping in inferTask(). A string pins that specific
agent for every turn until it is set back to auto.
*/
let pinnedAgentId = null;

/*
Agent ids that the automatic router can pick, paired with the label
shown in the picker. Kept in the same order the server resolves.
*/
const AGENT_OPTIONS = [
    ["auto", "Auto — choose per message"],
    ["general", "General assistant"],
    ["coding", "Coding agent"],
    ["research", "Research agent"],
    ["planner", "Planning agent"],
    ["data-analyst", "Data analyst"],
    ["documents", "Documents agent"],
    ["spreadsheets", "Spreadsheets agent"],
    ["presentations", "Presentations agent"],
    ["database", "Database agent"],
    ["browser", "Browser agent"],
    ["writer", "Writing agent"],
    ["vision", "Vision agent"],
    ["media", "Media agent"],
    ["design", "Design agent"],
    ["translation", "Translation agent"],
    ["science", "Science agent"],
    ["mathematics", "Mathematics agent"],
    ["business", "Business agent"],
    ["education", "Education agent"],
    ["project-manager", "Project manager agent"],
    ["automation", "Automation agent"],
    ["productivity", "Productivity agent"],
    ["security-review", "Security review agent"],
    ["devops", "DevOps agent"],
    ["computer-use", "Computer use agent"],
    ["legal", "Legal research agent"],
    ["health", "Health information agent"]
];

/* The task each pinned agent maps to, so the server routes to it. */
const AGENT_TASK_IDS = {
    general: "chat",
    coding: "code",
    research: "research",
    planner: "planner",
    "data-analyst": "data-analyst",
    spreadsheets: "data-analyst",
    "project-manager": "planner",
    productivity: "chat",
    writer: "chat",
    science: "research",
    mathematics: "planner",
    business: "research",
    education: "chat",
    media: "image",
    vision: "image"
};

/*
Keep the shell's collapsed class in sync with the sidebar so
the header's open-sidebar button appears only when needed.
*/
function syncSidebarState() {
    const collapsed = sidebar.classList.contains("collapsed");
    document.getElementById("appShell")?.classList.toggle("sidebar-collapsed", collapsed);
    if (sidebarToggle) sidebarToggle.setAttribute("aria-expanded", String(!collapsed));
    localStorage.setItem("nexus-sidebar-collapsed", String(collapsed));
}

if (sidebarCollapsed) {
    sidebar.classList.add("collapsed");
    sidebarToggle.setAttribute("aria-expanded", "false");
}

syncSidebarState();

intelligenceSelector.value =
    localStorage.getItem("nexus-intelligence") ||
    "balanced";


/* =========================================================
   STARTUP
========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        /*
        Every step here is guarded. An unguarded throw in this
        callback aborts the whole startup sequence — showWelcome,
        setupEvents, loadChats — leaving a page that renders but
        does not respond. Failures are logged rather than silent.
        */
        try {
            if (workspacePanel && workspacePage) {
                workspacePanel.hidden = false;
                workspacePanel.classList.add("workspace-page-panel");
                workspacePage.appendChild(workspacePanel);
            }
        } catch (error) {
            console.error("Workspace page initialization failed:", error);
        }

        try {
            applyStoredTheme();
        } catch (error) {
            console.error("Theme init failed:", error);
        }

        try {
            setupProgressiveWebApp();
        } catch (error) {
            console.error("Installable app setup failed:", error);
        }

        /*
        setupEvents binds every control in the app. It must be
        attempted even if something above failed, or the entire
        interface becomes inert.
        */
        try {
            setupEvents();
        } catch (error) {
            console.error("Event binding failed:", error);
        }

        /*
        Start on the empty state so the first paint matches
        ChatGPT's "How can I help?" screen. loadChats() will
        replace it if a conversation is selected.
        */
        if (messages && !messages.children.length) {
            showWelcome();
        }

        /*
        The rest of startup is independent: a failure in one must not
        prevent the others, so each is isolated. These run after the
        interface is already interactive.
        */
        for (const step of [
            ["chats", () => loadChats()],
            ["projects", () => renderSidebarProjects()],
            ["workspace", () => refreshWorkspace()],
            ["capabilities", () => loadCapabilities()],
            ["model routing", () => refreshAutoRoutingSummary()],
            ["composer resize", () => autoResizeTextarea()]
        ]) {
            try {
                await step[1]();
            } catch (error) {
                console.error("Startup step failed (" + step[0] + "):", error);
            }
        }

        setupGlobalShortcuts();

    }
);

async function refreshAutoRoutingSummary() {
    try {
        const params = new URLSearchParams({
            task: "chat",
            intelligence: intelligenceSelector.value || "balanced"
        });
        const response = await apiRequest(`/api/runtime?${params}`);
        if (!response.ok) {
            throw new Error(await getResponseError(response));
        }
        const runtime = await response.json();
        const selected = runtime.routing?.selected;
        autoRoutingSummary = selected
            ? `${selected.provider} · ${selected.model} · ${runtime.routing.rationale?.reasons?.[0] || "available now"}`
            : "No compatible model is currently available";
    } catch (error) {
        autoRoutingSummary = "Live availability could not be checked";
        console.warn("Automatic routing status is unavailable:", error.message);
    }
    window.refreshModelMenu?.();
}

/*
Global keyboard shortcuts, matching the catalogue shown in
Settings → Keyboard. Every case guards the element it touches,
so a missing element can never throw into the handler.
*/
function setupGlobalShortcuts() {
    document.addEventListener("keydown", event => {
        const key = event.key;
        const mod = event.ctrlKey || event.metaKey;

        if (mod && event.shiftKey && (key === "O" || key === "o")) {
            event.preventDefault();
            newChatButton?.click();
            return;
        }

        if (mod && (key === "k" || key === "K")) {
            event.preventDefault();
            searchInput?.focus();
            return;
        }

        if (mod && key === ",") {
            event.preventDefault();
            if (controlCenterModal.classList.contains("open")) {
                closeControlCenter();
            } else {
                openControlCenter();
            }
            return;
        }

        if (mod && (key === "b" || key === "B") && !event.shiftKey) {
            event.preventDefault();
            sidebarToggle?.click();
            return;
        }

        if (mod && event.shiftKey && (key === "B" || key === "b")) {
            event.preventDefault();
            showProductView("workspace");
            return;
        }

        if (key === "/" && document.activeElement === document.body) {
            event.preventDefault();
            messageInput?.focus();
            return;
        }

        if (key === "Escape" && isSending) {
            stopGeneration();
        }
    });
}

/*
Apply the saved theme (or follow the system) by setting
[data-theme] on <html>. Persisted by the Settings panel.

Also exposes a custom event so any part of Nexus can request a
theme change without reaching for a global function.
*/
function applyStoredTheme() {
    const stored = localStorage.getItem("nexus-theme") || "system";
    document.documentElement.setAttribute("data-theme", stored);

    /* Listen once, at startup, for theme-change requests. */
    document.addEventListener("nexus:theme-changed", event => {
        const next = event?.detail || "system";
        localStorage.setItem("nexus-theme", next);
        document.documentElement.setAttribute("data-theme", next);
    });
}

/*
Name for the theme-change event, plus a helper that dispatches
it. Both live on a single namespaced global so the UI and any
embedding surface share one contract.
*/
const NEXUS_THEME_EVENT = "nexus:theme-changed";

function requestTheme(theme) {
    const value = ["light", "dark", "system"].includes(theme) ? theme : "system";
    document.dispatchEvent(
        new CustomEvent(NEXUS_THEME_EVENT, { detail: value })
    );
    return value;
}

/*
Top-center model + intelligence picker.

This is the ChatGPT-style menu. It mirrors the two native
selects (#modelSelector, #intelligenceSelector) which the rest
of the script already reads — so the popover is purely a
friendlier surface over the same state, never a second source
of truth.
*/
function setupModelMenu() {
    if (!modelMenuButton || !modelMenu) return;

    const INTELLIGENCE_LABELS = {
        auto: "Auto",
        fast: "Fast",
        balanced: "Balanced",
        high: "High",
        "very-high": "Very High",
        maximum: "Maximum",
        expert: "Expert"
    };

    function renderIntelligence() {
        if (!intelligenceMenuOptions) return;
        const current = intelligenceSelector.value || "balanced";
        intelligenceMenuOptions.innerHTML = Object.entries(INTELLIGENCE_LABELS)
            .map(([value, label]) => `
                <button
                    type="button"
                    class="model-menu-option${value === current ? " selected" : ""}"
                    data-intelligence-value="${escapeAttribute(value)}"
                >
                    <span>${escapeHtml(label)}</span>
                    ${value === current ? '<span class="model-menu-option-hint">✓</span>' : ""}
                </button>
            `)
            .join("");

        intelligenceMenuOptions
            .querySelectorAll("[data-intelligence-value]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    intelligenceSelector.value = button.dataset.intelligenceValue;
                    intelligenceSelector.dispatchEvent(new Event("change"));
                    updateModelMenuLabel();
                    renderIntelligence();
                });
            });
    }

    function renderModels() {
        if (!modelMenuOptions) return;

        const options = [...modelSelector.options].map(option => ({
            value: option.value,
            label: option.textContent
        }));

        if (!options.length) {
            modelMenuOptions.innerHTML =
                '<button type="button" class="model-menu-option selected"><span>Configured model</span></button>';
            return;
        }

        const current = modelSelector.value;
        modelMenuOptions.innerHTML = options
            .map(option => `
                <button
                    type="button"
                    class="model-menu-option${option.value === current ? " selected" : ""}"
                    data-model-value="${escapeAttribute(option.value)}"
                >
                    <span>${escapeHtml(option.label)}</span>
                    ${option.value === current ? '<span class="model-menu-option-hint">✓</span>' : ""}
                </button>
            `)
            .join("");

        modelMenuOptions
            .querySelectorAll("[data-model-value]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    modelSelector.value = button.dataset.modelValue;
                    modelSelector.dispatchEvent(new Event("change"));
                    updateModelMenuLabel();
                    renderModels();
                });
            });
    }

    function updateModelMenuLabel() {
        if (!modelMenuLabel) return;
        const level = INTELLIGENCE_LABELS[intelligenceSelector.value] || "Balanced";
        /* Option text carries markup whitespace — collapse it. */
        const raw = modelSelector.selectedOptions?.[0]?.textContent || "Jarwis";
        const model = raw.replace(/\s+/g, " ").trim() || "Jarwis";
        /*
        Match ChatGPT's header: a short, clean name that reflects
        the active intelligence level. Jarwis shows "Jarwis" for
        the default level and "Jarwis · High" once the user
        raises it, so the header always says what is in effect.
        */
        const current = modelSelector.value;

        /*
        Header label, in priority order:
          - a pinned agent, so the override is always visible
          - "Auto" once the intelligence level is raised
          - "Jarwis" for the plain default
        */
        const agentName = pinnedAgentId
            ? (AGENT_OPTIONS.find(([value]) => value === pinnedAgentId)?.[1] || pinnedAgentId)
            : null;

        const label = agentName
            ? `Jarwis · ${agentName.replace(/\s+agent$/i, "")}`
            : (level === "Balanced" || level === "Auto"
                ? "Jarwis"
                : `Jarwis · ${level}`);

        modelMenuLabel.textContent = label;
        /* Full detail (model + level + agent) stays available on hover. */
        const routingHint = current === "auto" && autoRoutingSummary
            ? ` · ${autoRoutingSummary}`
            : "";
        modelMenuLabel.title = `${model} · ${level}${pinnedAgentId ? ` · ${pinnedAgentId}` : " · agent chosen automatically"}${routingHint}`;
    }

    /*
    Agent picker: "Auto" lets the router decide from the message text,
    any other choice pins that specialist for every turn.
    */
    function renderAgents() {
        if (!agentMenuOptions) return;
        const current = pinnedAgentId || "auto";

        agentMenuOptions.innerHTML = AGENT_OPTIONS
            .map(([value, label]) => `
                <button
                    type="button"
                    class="model-menu-option${value === current ? " selected" : ""}"
                    data-agent-value="${escapeAttribute(value)}"
                >
                    <span>${escapeHtml(label)}</span>
                    ${value === current ? '<span class="model-menu-option-hint">✓</span>' : ""}
                </button>
            `)
            .join("");

        agentMenuOptions
            .querySelectorAll("[data-agent-value]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    const value = button.dataset.agentValue;
                    pinnedAgentId = value === "auto" ? null : value;
                    localStorage.setItem(
                        "nexus-agent",
                        pinnedAgentId || "auto"
                    );
                    updateModelMenuLabel();
                    renderAgents();
                    showCapabilityNotice(
                        pinnedAgentId
                            ? `Agent pinned to ${AGENT_OPTIONS.find(([v]) => v === pinnedAgentId)?.[1] || pinnedAgentId}.`
                            : "Agent will be chosen automatically per message."
                    );
                });
            });
    }

    function openMenu() {
        renderIntelligence();
        renderModels();
        renderAgents();
        updateModelMenuLabel();
        modelMenu.hidden = false;
        modelMenuButton.setAttribute("aria-expanded", "true");
    }

    function closeMenu() {
        modelMenu.hidden = true;
        modelMenuButton.setAttribute("aria-expanded", "false");
    }

    modelMenuButton.addEventListener("click", event => {
        event.stopPropagation();
        if (modelMenu.hidden) openMenu();
        else closeMenu();
    });

    document.addEventListener("click", event => {
        if (modelMenu.hidden) return;
        if (modelMenu.contains(event.target) || modelMenuButton.contains(event.target)) return;
        closeMenu();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modelMenu.hidden) closeMenu();
    });

    /* Keep the label in step with programmatic changes. */
    intelligenceSelector.addEventListener("change", () => {
        updateModelMenuLabel();
        void refreshAutoRoutingSummary();
    });
    modelSelector.addEventListener("change", updateModelMenuLabel);

    /* Expose so loadCapabilities() can refresh after models arrive. */
    window.refreshModelMenu = function refreshModelMenu() {
        updateModelMenuLabel();
        if (!modelMenu.hidden) {
            renderIntelligence();
            renderModels();
            renderAgents();
        }
    };

    /* Restore a previously pinned agent. */
    pinnedAgentId = localStorage.getItem("nexus-agent") || null;
    if (pinnedAgentId === "auto") pinnedAgentId = null;
    if (
        pinnedAgentId &&
        !AGENT_OPTIONS.some(([value]) => value === pinnedAgentId)
    ) {
        pinnedAgentId = null;
    }

    updateModelMenuLabel();
}

/*
Public hook: any part of Nexus can switch themes by calling
setNexusTheme("dark"). The function is attached to the global
object so both the Settings panel and a host page can use it.
*/
function setNexusTheme(theme) {
    return requestTheme(theme);
}

/* Attach to the global object when one is available. */
if (typeof window !== "undefined") {
    window.setNexusTheme = setNexusTheme;
    window.NEXUS_THEME_EVENT = NEXUS_THEME_EVENT;
}

intelligenceSelector.addEventListener(
    "change",
    () => {
        localStorage.setItem(
            "nexus-intelligence",
            intelligenceSelector.value
        );
    }
);


/* =========================================================
   EVENTS
========================================================= */

function setupEvents() {

    sidebarNavItems.forEach(item => {
        item.addEventListener("click", () => {
            closeAccountMenu();
            sidebarNavItems.forEach(navItem => {
                navItem.classList.toggle(
                    "active",
                    navItem === item
                );
            });

            const view =
                item.getAttribute("data-view");

            showProductView(view);
            if (window.matchMedia("(max-width: 900px)").matches) {
                sidebar.classList.add("collapsed");
                syncSidebarState();
            }
        });
    });

    modeTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            modeTabs.forEach(modeTab => {
                modeTab.classList.toggle(
                    "active",
                    modeTab === tab
                );
            });

            if (tab.getAttribute("data-mode") === "work") {
                showProductView("projects");
            }
        });
    });

    attachmentButton.addEventListener(
        "click",
        event => {
            event.stopPropagation();
            showAttachmentMenu();
        }
    );

    attachmentInput.addEventListener(
        "change",
        async () => {
            const files =
                Array.from(attachmentInput.files || []);

            if (!files.length) {
                return;
            }

            attachmentButton.disabled = true;
            setButtonIcon(attachmentButton, ICON_SPINNER);

            try {
                const payload = await Promise.all(
                    files.map(file => readFileForUpload(file))
                );

                const response = await apiRequest(
                    "/api/workspace/upload",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            files: payload,
                            projectId: activeProjectId
                        })
                    }
                );

                const result = await response.json();
                const uploaded =
                    (result.files || []).map(file => file.path);

                messageInput.placeholder =
                    `${uploaded.length} file${uploaded.length === 1 ? "" : "s"} added to workspace. Add a message...`;

                await refreshWorkspace();
                showCapabilityNotice(
                    `${uploaded.length} file${uploaded.length === 1 ? "" : "s"} added to the workspace.`
                );
            } catch (error) {
                showCapabilityNotice(
                    `File upload failed: ${error.message}`
                );
            } finally {
                attachmentButton.disabled = false;
                setButtonIcon(attachmentButton, ICON_PLUS);
                attachmentInput.value = "";
            }
        }
    );

    toolsButton.addEventListener(
        "click",
        () => {
            const expanded =
                toolsButton.getAttribute("aria-expanded") === "true";

            toolsButton.setAttribute(
                "aria-expanded",
                String(!expanded)
            );

            document.addEventListener(
                "click",
                event => {
                    if (
                        !event.target.closest(
                            ".attachment-menu, #attachmentButton"
                        )
                    ) {
                        document
                            .querySelector(".attachment-menu")
                            ?.remove();
                    }
                }
            );

            toolsButton.classList.toggle(
                "active",
                !expanded
            );
        }
    );

    thinkButton.addEventListener("click", () => {
        thinkMode = !thinkMode;
        thinkButton.setAttribute("aria-pressed", String(thinkMode));
        thinkButton.classList.toggle("active", thinkMode);
        if (thinkMode) {
            intelligenceSelector.value = "high";
        }
    });

    webSearchButton.addEventListener("click", () => {
        webSearchMode = !webSearchMode;
        webSearchButton.setAttribute("aria-pressed", String(webSearchMode));
        webSearchButton.classList.toggle("active", webSearchMode);
    });

    imageButton.addEventListener("click", () => {
        showProductView("images");
    });

    workspaceTabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const section =
                workspaceSections[
                    tab.getAttribute("data-workspace-section")
                ];

            if (!section) {
                return;
            }

            workspaceTabs.forEach(item => {
                item.classList.toggle(
                    "active",
                    item === tab
                );
            });

            section.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        });
    });

    sidebarToggle.addEventListener(
        "click",
        () => {
            sidebar.classList.toggle("collapsed");
            syncSidebarState();
        }
    );

    if (sidebarOpen) {
        sidebarOpen.addEventListener(
            "click",
            () => {
                /* ChatGPT's header toggle collapses AND expands. */
                sidebar.classList.toggle("collapsed");
                syncSidebarState();
            }
        );
    }

    if (searchToggle) {
        searchToggle.addEventListener(
            "click",
            () => {
                if (sidebar.classList.contains("collapsed")) {
                    sidebar.classList.remove("collapsed");
                    syncSidebarState();
                }
                searchContainer?.classList.toggle("search-hidden");
                searchInput?.focus();
            }
        );
    }

    setupModelMenu();

    /* Sidebar "+" opens the focused project-creation dialog. */
    const sidebarNewProject = document.getElementById("sidebarNewProject");
    if (sidebarNewProject) {
        sidebarNewProject.addEventListener("click", event => {
            event.stopPropagation();
            openProjectCreateModal();
        });
    }
    document.getElementById("projectNameInput")?.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        document.querySelector('#projectCreateModal [data-product-action="new-project"]')?.click();
    });

    newChatButton.addEventListener(
        "click",
        async () => {

            if (isSending) {
                stopGeneration();
            }

            await createNewChat();

        }
    );


    sendButton.addEventListener(
        "click",
        async () => {

            if (isSending) {
                stopGeneration();
                return;
            }

            await sendMessage();

        }
    );


    messageInput.addEventListener(
        "keydown",
        async event => {

            const enterToSend =
                window.__nexusEnterToSend !== false;

            if (
                event.key === "Enter" &&
                !event.shiftKey &&
                (enterToSend || event.ctrlKey || event.metaKey)
            ) {

                event.preventDefault();

                if (!isSending) {
                    await sendMessage();
                }

            }

        }
    );


    messageInput.addEventListener(
        "input",
        autoResizeTextarea
    );


    searchInput.addEventListener(
        "input",
        () => {

            renderConversations(
                searchInput.value.trim()
            );

        }
    );


    refreshWorkspaceButton.addEventListener(
        "click",
        refreshWorkspace
    );


    refreshPreviewButton.addEventListener(
        "click",
        refreshPreview
    );


    openPreviewButton.addEventListener(
        "click",
        openPreview
    );

    if (controlCenterButton) {
        controlCenterButton.addEventListener(
            "click",
            openControlCenter
        );
    }

    if (voiceButton) {
        voiceButton.addEventListener(
            "click",
            startVoiceConversation
        );
    }

    document.getElementById("voiceMicToggleButton")?.addEventListener(
        "click",
        toggleVoiceListening
    );
    document.getElementById("voiceEndButton")?.addEventListener(
        "click",
        stopVoiceConversation
    );
    document.getElementById("voiceEndSessionButton")?.addEventListener(
        "click",
        stopVoiceConversation
    );

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && voiceChatMode) {
            stopVoiceConversation();
        }
    });

    if (accountSettingsButton) {
        accountSettingsButton.addEventListener("click", () => {
            const menu = document.getElementById("accountMenu");
            const isOpen = menu?.classList.toggle("open");
            accountSettingsButton.setAttribute("aria-expanded", String(Boolean(isOpen)));
            if (isOpen) refreshAccountMenuStatus();
        });
    }

    document.querySelectorAll("[data-account-action]").forEach(button => {
        button.addEventListener("click", async () => {
            const action = button.dataset.accountAction;
            closeAccountMenu();
            if (action === "settings") {
                openControlCenter();
            } else if (action === "profile") {
                openControlCenter();
                setTimeout(() => {
                    document.querySelector('[data-settings-section="profile"]')?.click();
                }, 350);
            } else if (action === "signout") {
                await signOutAccount();
            }
        });
    });

    document.addEventListener("click", event => {
        if (!event.target.closest(".account-menu-container")) closeAccountMenu();
        if (!event.target.closest(".conversation-actions")) closeConversationMenus();
        if (event.target === document.getElementById("projectCreateModal")) {
            closeProjectCreateModal();
        }
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            closeProjectCreateModal();
            closeAccountMenu();
        }
    });


    saveFileButton.addEventListener(
        "click",
        saveSelectedFile
    );


    closeFileButton.addEventListener(
        "click",
        closeFileEditor
    );


    document.addEventListener(
        "click",
        async event => {

            const actionElement =
                event.target.closest(
                    "[data-action], [data-product-action], [data-integration-action]"
                );

            if (!actionElement) {
                return;
            }

            if (actionElement.dataset.action === "close-project-create") {
                closeProjectCreateModal();
                return;
            }
            if (actionElement.dataset.action === "close-chat-project") {
                closeModalById("chatProjectModal");
                return;
            }
            if (actionElement.dataset.action === "close-chat-share") {
                closeModalById("chatShareModal");
                return;
            }
            if (actionElement.dataset.action === "close-project-detail") {
                closeModalById("projectDetailModal");
                return;
            }

            const integrationAction =
                actionElement.dataset.integrationAction;

            if (integrationAction) {
                const integrationId =
                    actionElement.dataset.integrationId;
                actionElement.disabled = true;
                try {
                    const response = await apiRequest(
                        `/api/integrations/${encodeURIComponent(integrationId)}/${integrationAction}`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                metadata: {
                                    source: "settings"
                                }
                            })
                        }
                    );
                    if (!response.ok) {
                        throw new Error(
                            await getResponseError(response)
                        );
                    }
                    await loadCapabilities();
                    showCapabilityNotice(
                        `${integrationId} ${integrationAction}ed.`
                    );
                } catch (error) {
                    showCapabilityNotice(
                        `Integration action failed: ${error.message}`
                    );
                }
                return;
            }

            const productAction =
                actionElement.dataset.productAction;

            if (productAction === "open-settings") {
                openControlCenter();
                /*
                Let the caller name the section to land on, so the
                Plugins page can open Settings directly on Integrations.
                */
                const section =
                    actionElement.dataset.settingsSection;
                if (section) {
                    setTimeout(() => {
                        document
                            .querySelector(
                                `[data-settings-section="${section}"]`
                            )
                            ?.click();
                    }, 350);
                }
                return;
            }

            if (productAction === "open-work") {
                modeTabs.forEach(tab => {
                    tab.classList.toggle(
                        "active",
                        tab.getAttribute("data-mode") === "work"
                    );
                });
                showCapabilityNotice(
                    "Work mode is available in the composer."
                );
                return;
            }

            if (productAction === "open-project-create") {
                openProjectCreateModal();
                return;
            }

            if (productAction === "new-project") {
                const nameInput = document.getElementById("projectNameInput");
                const name = nameInput?.value || "";
                if (!name.trim()) {
                    nameInput?.focus();
                    const createError = document.getElementById("projectCreateError");
                    if (createError) {
                        createError.textContent = "Enter a project name to continue.";
                        createError.hidden = false;
                    }
                    return;
                }
                const goalInput = document.getElementById("projectGoalInput");
                const createError = document.getElementById("projectCreateError");
                const submitButton = actionElement;
                submitButton.disabled = true;
                submitButton.textContent = "Creating…";
                if (createError) createError.hidden = true;
                try {
                    const response = await apiRequest("/api/projects", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            name: name.trim(),
                            goal: goalInput?.value.trim() || ""
                        })
                    });
                    if (!response.ok) throw new Error(await getResponseError(response));
                    const result = await response.json();
                    activeProjectId = String(result.project.chatId);
                    closeProjectCreateModal();
                    await selectChat(result.chat.id);
                    showCapabilityNotice(`Project "${name.trim()}" created. Files uploaded here will stay in this project.`);
                    /* Keep the sidebar's project list in step. */
                    await renderSidebarProjects();
                    showProductView("projects");
                } catch (error) {
                    if (createError) {
                        createError.textContent = `Project creation failed: ${error.message}`;
                        createError.hidden = false;
                    }
                } finally {
                    submitButton.disabled = false;
                    submitButton.textContent = "Create project";
                }
                return;
            }

            if (productAction === "save-chat-project") {
                const modal = document.getElementById("chatProjectModal");
                const chatId = modal?.dataset.chatId;
                const projectId = document.getElementById("chatProjectSelect")?.value;
                const error = document.getElementById("chatProjectError");
                if (!chatId || !projectId) return;
                actionElement.disabled = true;
                if (error) error.hidden = true;
                try {
                    const response = await apiRequest(`/api/chats/${encodeURIComponent(chatId)}/project`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ projectId: Number(projectId) })
                    });
                    if (!response.ok) throw new Error(await getResponseError(response));
                    const updated = await response.json();
                    conversations = conversations.map(chat =>
                        Number(chat.id) === Number(updated.id) ? updated : chat
                    );
                    renderConversations();
                    closeModalById("chatProjectModal");
                    showCapabilityNotice("Chat added to the project.");
                    await renderSidebarProjects();
                } catch (failure) {
                    if (error) {
                        error.textContent = `Could not add this chat: ${failure.message}`;
                        error.hidden = false;
                    }
                } finally {
                    actionElement.disabled = false;
                }
                return;
            }

            if (productAction === "copy-chat-transcript") {
                const chatId = document.getElementById("chatShareModal")?.dataset.chatId;
                const error = document.getElementById("chatShareError");
                if (!chatId) return;
                actionElement.disabled = true;
                if (error) error.hidden = true;
                try {
                    const response = await apiRequest(`/api/chats/${encodeURIComponent(chatId)}`);
                    if (!response.ok) throw new Error(await getResponseError(response));
                    const data = await response.json();
                    const transcript = (data.messages || [])
                        .map(message => `${message.role === "assistant" ? "Jarwis" : "You"}:\n${message.content || ""}`)
                        .join("\n\n");
                    if (!transcript) throw new Error("This chat does not have any messages to copy yet.");
                    if (!navigator.clipboard?.writeText) {
                        throw new Error("Clipboard access is unavailable. Open Jarwis in its desktop app or a secure local browser.");
                    }
                    await navigator.clipboard.writeText(transcript);
                    closeModalById("chatShareModal");
                    showCapabilityNotice("Chat transcript copied to the clipboard.");
                } catch (failure) {
                    if (error) {
                        error.textContent = failure.message;
                        error.hidden = false;
                    }
                } finally {
                    actionElement.disabled = false;
                }
                return;
            }

            if (productAction === "open-project-details") {
                await openProjectDetails(actionElement.dataset.projectId);
                return;
            }

            if (productAction === "open-project-chat") {
                const chatId = actionElement.dataset.chatId;
                if (!chatId) return;
                closeModalById("projectDetailModal");
                await selectChat(chatId, true);
                return;
            }

            if (productAction === "save-project-details") {
                const modal = document.getElementById("projectDetailModal");
                const projectId = modal?.dataset.projectId;
                const name = document.getElementById("projectDetailName")?.value.trim();
                const goal = document.getElementById("projectDetailGoal")?.value.trim();
                if (!projectId || !name) {
                    showCapabilityNotice("A project name is required.");
                    return;
                }
                actionElement.disabled = true;
                try {
                    const response = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name, goal })
                    });
                    if (!response.ok) throw new Error(await getResponseError(response));
                    closeModalById("projectDetailModal");
                    await loadProjectsList();
                    await renderSidebarProjects();
                    showCapabilityNotice("Project details saved.");
                } catch (failure) {
                    showCapabilityNotice(`Could not save project details: ${failure.message}`);
                } finally {
                    actionElement.disabled = false;
                }
                return;
            }

            if (productAction === "delete-project") {
                const projectId = actionElement.dataset.projectId;
                if (!projectId || !window.confirm("Delete this project, its chat, and its uploaded files?")) {
                    return;
                }

                actionElement.disabled = true;
                try {
                    const response = await apiRequest(
                        `/api/projects/${encodeURIComponent(projectId)}`,
                        { method: "DELETE" }
                    );
                    if (!response.ok) throw new Error(await getResponseError(response));
                    if (String(activeProjectId) === projectId) activeProjectId = null;
                    await loadChats();
                    await renderSidebarProjects();
                    showProductView("projects");
                    showCapabilityNotice("Project and its files were deleted.");
                } catch (error) {
                    actionElement.disabled = false;
                    showCapabilityNotice(`Project deletion failed: ${error.message}`);
                }
                return;
            }

            if (productAction === "delete-project-file") {
                const projectId = actionElement.dataset.projectId;
                const fileName = actionElement.dataset.fileName;
                if (!projectId || !fileName) return;
                if (!window.confirm(`Delete "${fileName}" from this project?`)) return;

                actionElement.disabled = true;
                try {
                    const response = await apiRequest(
                        `/api/project/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileName)}`,
                        { method: "DELETE" }
                    );
                    if (!response.ok) throw new Error(await getResponseError(response));
                    await loadProjectsList();
                    showCapabilityNotice(`Deleted ${fileName}.`);
                } catch (error) {
                    actionElement.disabled = false;
                    showCapabilityNotice(`File deletion failed: ${error.message}`);
                }
                return;
            }

            if (productAction === "download-project-file") {
                const filePath = actionElement.dataset.filePath;
                const fileName = actionElement.dataset.fileName;
                if (!filePath || !fileName) return;
                actionElement.disabled = true;
                try {
                    await downloadWorkspaceFile(filePath, fileName);
                } catch (error) {
                    showCapabilityNotice(`File download failed: ${error.message}`);
                } finally {
                    actionElement.disabled = false;
                }
                return;
            }

            if (productAction === "delete-image") {
                const name = actionElement.dataset.imageName;
                if (!name || !window.confirm(`Delete "${name}" from your image gallery?`)) return;
                actionElement.disabled = true;
                try {
                    const response = await apiRequest(
                        `/api/images/${encodeURIComponent(name)}`,
                        { method: "DELETE" }
                    );
                    if (!response.ok) throw new Error(await getResponseError(response));
                    await loadImagesView();
                    showCapabilityNotice(`Deleted ${name}.`);
                } catch (error) {
                    actionElement.disabled = false;
                    showCapabilityNotice(`Image deletion failed: ${error.message}`);
                }
                return;
            }

            if (productAction === "download-image") {
                const filePath = actionElement.dataset.filePath;
                const name = actionElement.dataset.imageName;
                if (!filePath || !name) return;
                actionElement.disabled = true;
                try {
                    await downloadWorkspaceFile(filePath, name);
                } catch (error) {
                    showCapabilityNotice(`Image download failed: ${error.message}`);
                } finally {
                    actionElement.disabled = false;
                }
                return;
            }

            if (productAction === "select-project") {
                activeProjectId = actionElement.dataset.projectId;
                await selectChat(activeProjectId);
                return;
            }

            /*
            Attach files to a specific project. Opens the real file
            picker, then uploads straight into that project's folder.
            */
            if (productAction === "attach-project-file") {
                const projectId = actionElement.dataset.projectId;
                if (!projectId) return;

                const picked = await pickFilesForUpload();
                if (!picked.length) return;

                actionElement.disabled = true;
                actionElement.textContent = "Uploading…";

                try {
                    const payload = await Promise.all(
                        picked.map(file => readFileForUpload(file))
                    );

                    const response = await apiRequest(
                        "/api/workspace/upload",
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                files: payload,
                                projectId
                            })
                        }
                    );

                    if (!response.ok) {
                        throw new Error(await getResponseError(response));
                    }

                    const result = await response.json();
                    showCapabilityNotice(
                        `${(result.files || []).length} file(s) attached to the project.`
                    );
                } catch (error) {
                    showCapabilityNotice(`Attach failed: ${error.message}`);
                } finally {
                    actionElement.disabled = false;
                    actionElement.textContent = "Attach files";
                    await loadProjectsList();
                }
                return;
            }

            if (productAction === "run-automation") {
                const automationId = actionElement.dataset.automationId;
                if (!automationId) return;
                try {
                    const response = await apiRequest(
                        "/api/workflows/run",
                        {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ id: automationId })
                        }
                    );
                    if (!response.ok) throw new Error(await getResponseError(response));
                    showCapabilityNotice("Automation started.");
                } catch (error) {
                    showCapabilityNotice(`Could not run automation: ${error.message}`);
                }
                await loadScheduledView();
                return;
            }

            if (productAction === "refresh-plugins") {
                await loadPluginsView();
                return;
            }

            if (productAction === "refresh-library") {
                await loadLibraryView();
                return;
            }

            if (productAction === "refresh-agents") {
                await loadAgentsView();
                return;
            }

            if (productAction === "refresh-images") {
                await loadImagesView();
                return;
            }

            if (productAction === "refresh-scheduled") {
                showProductView("scheduled");
                return;
            }

            if (productAction === "refresh-usage") {
                await loadUsageView();
                return;
            }

            if (productAction === "run-benchmark") {
                /*
                Benchmarking calls real providers and can take a
                while. Report progress honestly rather than showing
                a spinner forever.
                */
                const body = document.getElementById("benchmarkBody");
                if (body) {
                    body.innerHTML = '<div class="product-card"><div class="product-card-meta">Running benchmark against configured models… this can take a minute.</div></div>';
                }
                try {
                    const response = await apiRequest("/api/benchmarks/run", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({})
                    });
                    if (!response.ok) throw new Error(await getResponseError(response));
                    showCapabilityNotice("Benchmark finished.");
                } catch (error) {
                    showCapabilityNotice(`Benchmark failed: ${error.message}`);
                }
                await loadBenchmarkView();
                return;
            }

            const action =
                actionElement.dataset.action;

            if (
                action ===
                "cancel-rename"
            ) {

                closeRenameModal();

                return;

            }


            if (
                action ===
                "save-rename"
            ) {

                await saveRename();

                return;

            }


            if (
                action ===
                "regenerate-response"
            ) {

                event.preventDefault();
                event.stopPropagation();

                await regenerateLastResponse();

            }

            if (
                action ===
                "close-control-center"
            ) {
                closeControlCenter();
            }

        }
    );

    renameChatInput.addEventListener(
        "keydown",
        async event => {

            if (event.key === "Enter") {
                event.preventDefault();
                await saveRename();
            }

            if (event.key === "Escape") {
                closeRenameModal();
            }
        }
    );
}

function openProjectCreateModal() {
    const modal = document.getElementById("projectCreateModal");
    const nameInput = document.getElementById("projectNameInput");
    const goalInput = document.getElementById("projectGoalInput");
    const error = document.getElementById("projectCreateError");
    if (!modal || !nameInput || !goalInput) {
        showCapabilityNotice("The project form could not be opened. Refresh Jarwis and try again.");
        return;
    }
    nameInput.value = "";
    goalInput.value = "";
    if (error) {
        error.textContent = "";
        error.hidden = true;
    }
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => nameInput.focus());
}

function closeProjectCreateModal() {
    const modal = document.getElementById("projectCreateModal");
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
}

function closeModalById(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
}

async function openChatProjectModal(chat) {
    const modal = document.getElementById("chatProjectModal");
    const select = document.getElementById("chatProjectSelect");
    const error = document.getElementById("chatProjectError");
    const submit = modal?.querySelector('[data-product-action="save-chat-project"]');
    if (!modal || !select) return;
    modal.dataset.chatId = String(chat.id);
    if (error) error.hidden = true;
    if (submit) submit.disabled = true;
    select.disabled = true;
    select.innerHTML = '<option value="">Loading projects…</option>';
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    try {
        const response = await apiRequest("/api/projects");
        if (!response.ok) throw new Error(await getResponseError(response));
        const data = await response.json();
        const projects = data.projects || [];
        if (!projects.length) {
            select.innerHTML = '<option value="">Create a project first</option>';
            select.disabled = true;
            if (submit) submit.disabled = true;
            if (error) {
                error.textContent = "There are no projects yet. Create one from the Projects page, then add this chat.";
                error.hidden = false;
            }
            return;
        }
        select.disabled = false;
        if (submit) submit.disabled = false;
        select.innerHTML = projects.map(project =>
            `<option value="${escapeAttribute(String(project.chatId))}" ${Number(project.chatId) === Number(chat.project_id) ? "selected" : ""}>${escapeHtml(project.name)}</option>`
        ).join("");
        select.focus();
    } catch (failure) {
        select.innerHTML = '<option value="">Projects could not be loaded</option>';
        select.disabled = true;
        if (submit) submit.disabled = true;
        if (error) {
            error.textContent = `Could not load projects: ${failure.message}`;
            error.hidden = false;
        }
    } finally {
        if (modal.dataset.chatId === String(chat.id)) {
            select.disabled = !select.options.length || !select.options[0].value;
            if (submit) submit.disabled = select.disabled;
        }
    }
}

function openChatShareModal(chat) {
    const modal = document.getElementById("chatShareModal");
    if (!modal) return;
    modal.dataset.chatId = String(chat.id);
    const error = document.getElementById("chatShareError");
    if (error) error.hidden = true;
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
}

async function openProjectDetails(projectId) {
    const modal = document.getElementById("projectDetailModal");
    const body = document.getElementById("projectDetailBody");
    if (!modal || !body || !projectId) return;
    modal.dataset.projectId = String(projectId);
    body.innerHTML = '<p class="capability-muted">Loading project details…</p>';
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    try {
        const response = await apiRequest(`/api/projects/${encodeURIComponent(projectId)}`);
        if (!response.ok) throw new Error(await getResponseError(response));
        const data = await response.json();
        const chats = data.chats || [];
        body.innerHTML = `
            <label for="projectDetailName" class="rename-input-label">Project name</label>
            <input id="projectDetailName" type="text" maxlength="100" value="${escapeAttribute(data.project.name || "")}">
            <label for="projectDetailGoal" class="rename-input-label project-goal-label">Goal and instructions</label>
            <textarea id="projectDetailGoal" rows="4" maxlength="2000">${escapeHtml(data.project.goal || "")}</textarea>
            <h3 class="project-detail-list-title">Chats in this project</h3>
            <div class="project-detail-chat-list">
                ${chats.length ? chats.map(chat => `
                    <button type="button" class="project-detail-chat" data-product-action="open-project-chat" data-chat-id="${escapeAttribute(String(chat.id))}">
                        <span aria-hidden="true">◌</span><span>${escapeHtml(chat.title || "New chat")}</span><span aria-hidden="true">↗</span>
                    </button>
                `).join("") : '<p class="capability-muted">No chats have been added to this project yet.</p>'}
            </div>
            <p class="project-detail-local-note">Project files remain in this computer’s local workspace.</p>
        `;
    } catch (failure) {
        body.innerHTML = `<p class="project-create-error">Could not load project details: ${escapeHtml(failure.message)}</p>`;
    }
}

function closeAccountMenu() {
    const menu = document.getElementById("accountMenu");
    menu?.classList.remove("open");
    accountSettingsButton?.setAttribute("aria-expanded", "false");
}

async function refreshAccountMenuStatus() {
    const statusElement = document.getElementById("accountMenuStatus");
    if (!statusElement) return;
    statusElement.textContent = "Checking session…";
    try {
        const response = await apiRequest("/api/auth/status");
        if (!response.ok) throw new Error(await getResponseError(response));
        const status = await response.json();
        const signedIn = Boolean(
            status.authenticated &&
            status.user &&
            status.user.kind !== "loopback"
        );
        statusElement.textContent = signedIn
            ? `Signed in as ${status.user.username || "account"}`
            : status.loopbackTrusted
                ? "Trusted local access · this PC"
                : "Local assistant · no account session";
    } catch (error) {
        statusElement.textContent = "Session status unavailable";
        console.error("Could not load account menu session status:", error);
    }
}

async function signOutAccount() {
    try {
        const statusResponse = await apiRequest("/api/auth/status");
        if (!statusResponse.ok) throw new Error(await getResponseError(statusResponse));
        const status = await statusResponse.json();
        const hasAccountSession = Boolean(
            status.authenticated &&
            status.user &&
            status.user.kind !== "loopback"
        );
        if (!hasAccountSession) {
            showCapabilityNotice(
                "This Jarwis installation uses trusted local access, so there is no account session to sign out of. Configure authentication in Settings → Security to enable account sign-out."
            );
            return;
        }
        const response = await apiRequest("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin"
        });
        if (!response.ok) throw new Error(await getResponseError(response));
        window.location.reload();
    } catch (error) {
        showCapabilityNotice(`Could not sign out: ${error.message}`);
    }
}

function showProductView(view) {
    sidebarNavItems.forEach(item => {
        item.classList.toggle("active", item.getAttribute("data-view") === view);
    });

    const showWorkspace = view === "workspace";
    if (workspacePage) workspacePage.hidden = !showWorkspace;
    messages.hidden = showWorkspace;
    if (showWorkspace) {
        setHeaderTitle("Artifacts & workspace");
        refreshWorkspace();
        return;
    }

    if (view === "projects") {
        chatTitle.textContent = "Projects";
        messages.innerHTML = `
            <div class="product-view">
                <section class="projects-hero">
                    <div class="projects-hero-glow" aria-hidden="true"></div>
                    <div class="projects-hero-copy">
                        <span class="projects-eyebrow">YOUR WORKSPACE</span>
                        <h1>Projects that remember the goal.</h1>
                        <p>Bring conversations, files, and instructions into one focused space. Jarwis can carry the context forward as your work grows.</p>
                        <div class="projects-hero-benefits" aria-label="Project features">
                            <span><i aria-hidden="true">✓</i> Persistent context</span>
                            <span><i aria-hidden="true">✓</i> Project files</span>
                            <span><i aria-hidden="true">✓</i> Local by default</span>
                        </div>
                    </div>
                    <div class="projects-hero-side">
                        <div class="projects-count-card">
                            <span class="projects-count-icon" aria-hidden="true">▦</span>
                            <span><strong id="projectCount">—</strong><small>PROJECT WORKSPACES</small></span>
                        </div>
                        <button type="button" class="modal-button primary project-create-trigger" data-product-action="open-project-create"><span aria-hidden="true">＋</span> New project</button>
                    </div>
                </section>
                <div class="projects-list-heading">
                    <div><span class="projects-eyebrow">CONTINUE YOUR WORK</span><h2>Your projects</h2></div>
                    <span class="projects-list-hint">Chats and files stay organized by goal</span>
                </div>
                <div class="projects-toolbar">
                    <label class="projects-search" for="projectsSearchInput"><span aria-hidden="true">⌕</span><input id="projectsSearchInput" type="search" placeholder="Search projects" autocomplete="off"></label>
                    <label class="projects-sort-label" for="projectsSortSelect">Sort
                        <select id="projectsSortSelect">
                            <option value="updated">Recently updated</option>
                            <option value="name">Name A–Z</option>
                        </select>
                    </label>
                </div>
                <div id="projectsList" class="product-list"><p>Loading projects...</p></div>
            </div>
        `;
        document.getElementById("projectsSearchInput")?.addEventListener("input", loadProjectsList);
        document.getElementById("projectsSortSelect")?.addEventListener("change", loadProjectsList);
        loadProjectsList();
        return;
    }

    if (view === "scheduled") {
        chatTitle.textContent = "Scheduled";
        messages.innerHTML = `
            <div class="product-view">
                <div class="product-view-header">
                    <div>
                        <h1>Scheduled tasks</h1>
                        <p>Bounded automations Nexus can run on triggers and schedules.</p>
                    </div>
                    <button type="button" class="modal-button secondary" data-product-action="refresh-scheduled">Refresh</button>
                </div>
                <div id="scheduledBody"><p>Loading automations...</p></div>
            </div>
        `;
        loadScheduledView();
        return;
    }

    if (view === "plugins") {
        chatTitle.textContent = "Plugins";
        messages.innerHTML = `
            <div class="product-view">
                <div class="product-view-header">
                    <div>
                        <h1>Plugins & connectors</h1>
                        <p>Integrations Nexus can act through — MCP servers, APIs, and services.</p>
                    </div>
                    <button type="button" class="modal-button secondary" data-product-action="refresh-plugins">Refresh</button>
                </div>
                <div id="pluginsBody"><p>Loading connectors...</p></div>
            </div>
        `;
        loadPluginsView();
        return;
    }

    if (view === "library") {
        chatTitle.textContent = "Library";
        messages.innerHTML = `
            <div class="product-view">
                <div class="product-view-header">
                    <div>
                        <h1>Library</h1>
                        <p>Every tool and agent Nexus can use, read live from the runtime.</p>
                    </div>
                    <button type="button" class="modal-button secondary" data-product-action="refresh-library">Refresh</button>
                </div>
                <div id="libraryBody"><p>Loading tools and agents...</p></div>
            </div>
        `;
        loadLibraryView();
        return;
    }

    if (view === "images") {
        chatTitle.textContent = "Images";
        messages.innerHTML = `
            <div class="product-view">
                <div class="product-view-header">
                    <div>
                        <h1>Image studio</h1>
                        <p>Generate original images with your configured image provider. Provider usage may be billed.</p>
                    </div>
                    <button type="button" class="modal-button secondary" data-product-action="refresh-images">Refresh gallery</button>
                </div>
                <form id="imageGenerationForm" class="image-generation-form">
                    <label class="settings-field">
                        <span>Describe your image</span>
                        <textarea id="imagePromptInput" class="settings-textarea" maxlength="32000" rows="4" placeholder="A misty evergreen forest at sunrise, viewed from a quiet lakeside cabin..." required></textarea>
                    </label>
                    <div class="image-generation-controls">
                        <label class="settings-field">
                            <span>Size</span>
                            <select id="imageSizeInput" class="settings-select">
                                <option value="1024x1024">Square</option>
                                <option value="1536x1024">Landscape</option>
                                <option value="1024x1536">Portrait</option>
                            </select>
                        </label>
                        <label class="settings-field">
                            <span>Quality</span>
                            <select id="imageQualityInput" class="settings-select">
                                <option value="auto">Automatic</option>
                                <option value="low">Low</option>
                                <option value="medium">Medium</option>
                                <option value="high">High</option>
                            </select>
                        </label>
                        <label class="settings-field">
                            <span>Format</span>
                            <select id="imageFormatInput" class="settings-select">
                                <option value="png">PNG</option>
                                <option value="webp">WebP</option>
                                <option value="jpeg">JPEG</option>
                            </select>
                        </label>
                        <button type="submit" class="modal-button primary">Generate image</button>
                    </div>
                    <p id="imageGenerationStatus" class="product-card-meta" role="status" aria-live="polite">Images are saved in your Jarwis workspace. Use of a hosted provider may incur charges.</p>
                </form>
                <section aria-labelledby="imageGalleryTitle">
                    <h2 class="settings-section-title" id="imageGalleryTitle">Your gallery</h2>
                    <div id="imagesBody" class="image-gallery"><p>Loading images...</p></div>
                </section>
            </div>
        `;
        document.getElementById("imageGenerationForm")?.addEventListener("submit", async event => {
            event.preventDefault();
            const form = event.currentTarget;
            await generateImageFromForm(
                event.submitter || form.querySelector('button[type="submit"]')
            );
        });
        loadImagesView();
        return;
    }

    if (view === "usage") {
        chatTitle.textContent = "Usage";
        messages.innerHTML = `
            <div class="product-view">
                <div class="product-view-header">
                    <div>
                        <h1>Usage</h1>
                        <p>Model calls, latency, tokens, and estimated cost for this instance.</p>
                    </div>
                    <button type="button" class="modal-button secondary" data-product-action="refresh-usage">Refresh</button>
                </div>
                <div id="usageBody"><p>Loading usage...</p></div>
            </div>
        `;
        loadUsageView();
        return;
    }

    async function loadImagesView() {
        const body = document.getElementById("imagesBody");
        const status = document.getElementById("imageGenerationStatus");
        if (!body) return;
        body.innerHTML = '<p class="product-card-meta">Loading saved images…</p>';
        try {
            const response = await apiRequest("/api/images");
            if (!response.ok) throw new Error(await getResponseError(response));
            const data = await response.json();
            const generateButton = document.querySelector(
                '#imageGenerationForm button[type="submit"]'
            );
            if (status && !data.available) {
                status.textContent = "Image generation is not configured yet. Set OPENAI_API_KEY in the Nexus environment and restart the server. Your saved images remain available.";
            }
            if (generateButton) generateButton.disabled = !data.available;
            const images = Array.isArray(data.images) ? data.images : [];
            body.innerHTML = images.length
                ? images.map(image => `
                    <article class="image-gallery-card">
                        <a href="${escapeHtml(image.previewUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHtml(image.name)}">
                            <img src="${escapeHtml(image.previewUrl)}" alt="${escapeHtml(image.name)}" loading="lazy">
                        </a>
                        <div class="image-gallery-card-footer">
                            <span title="${escapeHtml(image.path)}">${escapeHtml(image.name)}</span>
                            <button type="button" class="capability-action-button" data-product-action="download-image" data-file-path="${escapeAttribute(image.path)}" data-image-name="${escapeAttribute(image.name)}">Download</button>
                            <button type="button" class="capability-action-button danger" data-product-action="delete-image" data-image-name="${escapeAttribute(image.name)}">Delete</button>
                        </div>
                    </article>
                `).join("")
                : '<div class="product-card product-card-meta">Your generated images will appear here.</div>';
        } catch (error) {
            body.innerHTML = `<div class="product-card product-card-meta">Could not load images: ${escapeHtml(error.message)}</div>`;
        }
    }

    async function generateImageFromForm(button) {
        const form = document.getElementById("imageGenerationForm");
        const promptInput = document.getElementById("imagePromptInput");
        const status = document.getElementById("imageGenerationStatus");
        if (!form || !promptInput || !promptInput.value.trim()) {
            promptInput?.focus();
            return;
        }
        if (button) {
            button.disabled = true;
            button.textContent = "Generating…";
        }
        if (status) status.textContent = "Generating your image. This can take a little while.";
        try {
            const response = await apiRequest("/api/images/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prompt: promptInput.value.trim(),
                    model: selectedImageModel || undefined,
                    size: document.getElementById("imageSizeInput")?.value,
                    quality: document.getElementById("imageQualityInput")?.value,
                    format: document.getElementById("imageFormatInput")?.value
                })
            });
            if (!response.ok) throw new Error(await getResponseError(response));
            const generated = await response.json();
            if (status) status.textContent = `Image generated with ${generated.model || "the configured provider"} and saved to ${generated.path}.`;
            form.reset();
            await loadImagesView();
            showCapabilityNotice("Image generated and added to your gallery.");
        } catch (error) {
            if (status) status.textContent = `Image generation failed: ${error.message}`;
        } finally {
            if (button) {
                button.disabled = false;
                button.textContent = "Generate image";
            }
        }
    }

    if (view === "benchmarks") {
        chatTitle.textContent = "Benchmarks";
        messages.innerHTML = `
            <div class="product-view">
                <div class="product-view-header">
                    <div>
                        <h1>Model benchmarks</h1>
                        <p>Score configured models on reasoning, coding, instruction following, and safety.</p>
                    </div>
                    <button type="button" class="modal-button primary" data-product-action="run-benchmark">Run benchmark</button>
                </div>
                <div id="benchmarkBody"><p>Loading benchmark history...</p></div>
            </div>
        `;
        loadBenchmarkView();
        return;
    }
}

/*
Usage panel — reads the observability ledger exposed at
/api/usage. Numbers are estimates, labelled as such.
*/
async function loadUsageView() {
    const body = document.getElementById("usageBody");
    if (!body) return;
    try {
        const response = await apiRequest("/api/usage?limit=500");
        if (!response.ok) throw new Error(await getResponseError(response));
        const data = await response.json();
        const summary = data.summary || {};
        const byModel = data.byModel || [];
        const recent = Array.isArray(data.recent) ? data.recent : [];
        const days = Array.from({ length: 7 }, (_, index) => {
            const day = new Date();
            day.setUTCHours(0, 0, 0, 0);
            day.setUTCDate(day.getUTCDate() - (6 - index));
            const key = day.toISOString().slice(0, 10);
            return { key, label: day.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }), calls: 0 };
        });
        const dayBuckets = new Map(days.map(day => [day.key, day]));
        recent.forEach(entry => {
            const key = String(entry.at || "").slice(0, 10);
            const bucket = dayBuckets.get(key);
            if (bucket) bucket.calls += 1;
        });
        const peakCalls = Math.max(1, ...days.map(day => day.calls));
        const recentRows = recent.slice(0, 12);

        body.innerHTML = `
            <div class="metric-grid">
                <div class="metric-card"><div class="metric-value">${Number(summary.calls || 0)}</div><div class="metric-label">Model calls</div></div>
                <div class="metric-card"><div class="metric-value">${Number(summary.totalTokens || 0)}</div><div class="metric-label">Tokens (est.)</div></div>
                <div class="metric-card"><div class="metric-value">${Number(summary.avgLatencyMs || 0)} ms</div><div class="metric-label">Avg latency</div></div>
                <div class="metric-card"><div class="metric-value">$${Number(summary.costUsd || 0).toFixed(4)}</div><div class="metric-label">Est. cost</div></div>
                <div class="metric-card"><div class="metric-value">${(Number(summary.errorRate || 0) * 100).toFixed(1)}%</div><div class="metric-label">Error rate</div></div>
            </div>
            <section class="usage-trend-section" aria-labelledby="usageTrendTitle">
                <h2 class="settings-section-title" id="usageTrendTitle">Recent activity</h2>
                <p class="product-card-meta">Daily model-call count across the last seven days. Cost and token totals are estimates.</p>
                <div class="usage-trend" role="img" aria-label="${days.map(day => `${day.label}: ${day.calls} calls`).join(", ")}">
                    ${days.map(day => `
                        <div class="usage-day" title="${day.calls} model calls on ${escapeHtml(day.label)}">
                            <div class="usage-bar-track"><span class="usage-bar" style="--bar-size:${Math.max(4, day.calls / peakCalls * 100)}%"></span></div>
                            <strong>${day.calls}</strong>
                            <small>${escapeHtml(day.label)}</small>
                        </div>
                    `).join("")}
                </div>
            </section>
            <h2 class="settings-section-title" style="margin-top:18px">By model</h2>
            <div class="product-list">
                ${byModel.length
                    ? byModel.map(item => `
                        <div class="product-card">
                            <div class="product-card-title">${escapeHtml(item.model)}</div>
                            <div class="product-card-meta">
                                ${item.calls} calls · ${item.avgLatencyMs} ms avg · ${item.tokens} tokens · $${Number(item.costUsd).toFixed(4)}
                            </div>
                        </div>
                    `).join("")
                    : '<div class="product-card"><div class="product-card-meta">No model calls recorded yet.</div></div>'}
            </div>
            <h2 class="settings-section-title" style="margin-top:18px">Latest calls</h2>
            <div class="usage-recent-list">
                ${recentRows.length
                    ? recentRows.map(entry => `
                        <article class="product-card usage-recent-row">
                            <div>
                                <div class="product-card-title">${escapeHtml(entry.model || "Unknown model")}</div>
                                <div class="product-card-meta">${escapeHtml(new Date(entry.at).toLocaleString())} · ${Number(entry.latencyMs || 0)} ms</div>
                            </div>
                            <div class="usage-recent-values">
                                <span class="status-pill ${entry.error ? "error" : "ok"}">${entry.error ? "Error" : "Success"}</span>
                                <span>${Number(entry.inputTokens || 0) + Number(entry.outputTokens || 0)} tokens</span>
                                <span>$${Number(entry.costUsd || 0).toFixed(4)}</span>
                            </div>
                            ${entry.error ? `<p class="product-card-meta usage-error-detail">${escapeHtml(entry.error)}</p>` : ""}
                        </article>
                    `).join("")
                    : '<div class="product-card product-card-meta">No recent model calls to show.</div>'}
            </div>
        `;
    } catch (error) {
        body.innerHTML = `<div class="product-card"><div class="product-card-meta">Could not load usage: ${escapeHtml(error.message)}</div>`;
    }
}

/*
Benchmarks panel — lists prior runs from /api/benchmarks and
can start a new sweep over the configured models.
*/
async function loadBenchmarkView() {
    const body = document.getElementById("benchmarkBody");
    if (!body) return;
    try {
        const response = await apiRequest("/api/benchmarks");
        if (!response.ok) throw new Error(await getResponseError(response));
        const data = await response.json();
        const latest = data.latest;
        const history = data.history || [];

        body.innerHTML = `
            ${latest
                ? `
                    <h2 class="settings-section-title">Latest run — ${escapeHtml(latest.ranAt || "")}</h2>
                    <div class="product-list">
                        ${(latest.ranked || []).map(entry => `
                            <div class="product-card">
                                <div class="product-card-title">#${entry.rank} ${escapeHtml(entry.model)}</div>
                                <div class="product-card-meta">
                                    accuracy ${(Number(entry.passRate || 0) * 100).toFixed(0)}% ·
                                    score ${Number(entry.averageScore || 0).toFixed(2)} ·
                                    errors ${Number(entry.errors || 0)}
                                </div>
                            </div>
                        `).join("")}
                    </div>
                `
                : '<div class="product-card"><div class="product-card-meta">No benchmark runs yet. Run one to compare configured models.</div></div>'}
            <h2 class="settings-section-title" style="margin-top:18px">History</h2>
            <div class="product-list">
                ${history.length
                    ? history.map(run => `
                        <div class="product-card">
                            <div class="product-card-meta">${escapeHtml(run.ranAt || run.file)} · ${Number(run.caseCount || 0)} cases</div>
                        </div>
                    `).join("")
                    : '<div class="product-card"><div class="product-card-meta">No previous runs.</div></div>'}
            </div>
        `;
    } catch (error) {
        body.innerHTML = `<div class="product-card"><div class="product-card-meta">Could not load benchmarks: ${escapeHtml(error.message)}</div></div>`;
    }
}

/*
Projects page.

Each project is a persistent workspace. Files attached here are
stored under projects/<id>/uploads in the active workspace, so a
project keeps its own documents separate from every other one.
*/
async function loadProjectsList() {
    const list = document.getElementById("projectsList");
    if (!list) return;

    try {
        const response = await apiRequest("/api/projects");
        if (!response.ok) throw new Error(await getResponseError(response));
        const data = await response.json();
        const projects = data.projects || [];
        const projectCount = document.getElementById("projectCount");
        if (projectCount) projectCount.textContent = String(projects.length);

        if (!projects.length) {
            list.innerHTML = `
                <section class="projects-empty-state">
                    <div class="projects-empty-art" aria-hidden="true"><span></span><span></span><span></span></div>
                    <div class="projects-empty-copy">
                        <span class="projects-eyebrow">A GOOD PLACE TO BEGIN</span>
                        <h3>Your first project starts with a goal.</h3>
                        <p>Tell Jarwis what you want to accomplish. Add context now or attach files whenever you need them.</p>
                        <button type="button" class="modal-button primary project-create-trigger" data-product-action="open-project-create"><span aria-hidden="true">＋</span> Create your first project</button>
                    </div>
                </section>`;
            return;
        }

        const search = document.getElementById("projectsSearchInput")?.value.trim().toLocaleLowerCase() || "";
        const sortBy = document.getElementById("projectsSortSelect")?.value || "updated";
        const visibleProjects = projects
            .filter(project => `${project.name || ""} ${project.goal || ""}`.toLocaleLowerCase().includes(search))
            .sort((a, b) => sortBy === "name"
                ? String(a.name || "").localeCompare(String(b.name || ""))
                : String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

        if (!visibleProjects.length) {
            list.innerHTML = '<div class="product-card"><div class="product-card-meta">No projects match your search.</div></div>';
            return;
        }

        /* Load each project's attached files so the card can list them. */
        const withFiles = await Promise.all(
            visibleProjects.map(async project => {
                const filesResponse = await apiRequest(
                    "/api/project/" + encodeURIComponent(project.chatId) + "/files"
                );
                if (!filesResponse.ok) {
                    throw new Error(await getResponseError(filesResponse));
                }
                const filesData = await filesResponse.json();
                return { ...project, files: filesData.files || [] };
            })
        );

        list.innerHTML = withFiles.map(project => `
            <div class="product-card project-card">
                <div class="project-card-main">
                    <div class="product-card-title">${escapeHtml(project.name)}</div>
                    <div class="product-card-meta">
                        ${escapeHtml(project.goal || "Project workspace")} · ${escapeHtml(project.status || "in progress")}
                    </div>
                    ${project.files.length
                        ? `<div class="project-files">
                            ${project.files.map(file => `
                                <div class="project-file-row">
                                    <span class="project-file-chip" title="${escapeAttribute(file.name)}">▧ ${escapeHtml(file.name)}</span>
                                    <button type="button" class="capability-action-button" data-product-action="download-project-file" data-file-path="${escapeAttribute(file.path)}" data-file-name="${escapeAttribute(file.name)}">Download</button>
                                    <button type="button" class="capability-action-button danger" data-product-action="delete-project-file" data-project-id="${escapeAttribute(String(project.chatId))}" data-file-name="${escapeAttribute(file.name)}">Delete</button>
                                </div>
                            `).join("")}
                        </div>`
                        : '<div class="product-card-meta">No files attached yet.</div>'}
                </div>
                <div class="project-card-actions">
                    <button type="button" class="capability-action-button" data-product-action="attach-project-file" data-project-id="${escapeHtml(String(project.chatId))}">Attach files</button>
                    <button type="button" class="capability-action-button" data-product-action="open-project-details" data-project-id="${escapeAttribute(String(project.chatId))}">Details</button>
                    <button type="button" class="capability-action-button" data-product-action="select-project" data-project-id="${escapeHtml(String(project.chatId))}">Open</button>
                    <button type="button" class="capability-action-button danger" data-product-action="delete-project" data-project-id="${escapeAttribute(String(project.chatId))}">Delete project</button>
                </div>
            </div>
        `).join("");
    } catch (error) {
        list.innerHTML = `<div class="product-card"><div class="product-card-meta">Could not load projects: ${escapeHtml(error.message)}</div></div>`;
    }
}

/*
Scheduled page — the automation registry from /api/automations,
plus any recorded run history the engine exposes.
*/
async function loadScheduledView() {
    const body = document.getElementById("scheduledBody");
    if (!body) return;
    try {
        const response = await apiRequest("/api/automations");
        if (!response.ok) throw new Error(await getResponseError(response));
        const data = await response.json();
        const automations = data.automations || [];

        if (!automations.length) {
            body.innerHTML = '<div class="product-card"><div class="product-card-meta">No automations registered. Define one to run a task on a trigger or schedule.</div></div>';
            return;
        }

        body.innerHTML = `
            <div class="product-list">
                ${automations.map(item => `
                    <div class="product-card">
                        <div class="product-card-title">${escapeHtml(item.name || item.id || "Automation")}</div>
                        <div class="product-card-meta">
                            ${escapeHtml(item.trigger || item.schedule || "manual")}
                            ${item.description ? " · " + escapeHtml(item.description) : ""}
                        </div>
                        <div class="capability-row-actions" style="margin-top:8px">
                            <span class="status-pill ${item.enabled === false ? "" : "ok"}">
                                ${item.enabled === false ? "Paused" : "Active"}
                            </span>
                            <button type="button" class="capability-action-button" data-product-action="run-automation" data-automation-id="${escapeHtml(String(item.id || ""))}">Run now</button>
                        </div>
                    </div>
                `).join("")}
            </div>
        `;
    } catch (error) {
        body.innerHTML = `<div class="product-card"><div class="product-card-meta">Could not load automations: ${escapeHtml(error.message)}</div></div>`;
    }
}

/*
Plugins page — live connector registry from /api/integrations.
Each entry reports its own state so the page never claims a
connection that is not actually configured, and offers the real
connect/disconnect action rather than a placeholder button.
*/

/*
Brand marks for the connector tiles. Inline SVG so no external
assets are fetched, and a two-letter monogram fallback for any
connector without a dedicated mark.
*/
const CONNECTOR_ICONS = {
    mcp: { color: "#6b5bd2", glyph: "M" },
    github: { color: "#24292f", glyph: "GH" },
    "google-drive": { color: "#1a73e8", glyph: "▲" },
    onedrive: { color: "#0364b8", glyph: "☁" },
    database: { color: "#0f766e", glyph: "DB" },
    rest: { color: "#b45309", glyph: "{}" },
    email: { color: "#dc2626", glyph: "✉" },
    calendar: { color: "#7c3aed", glyph: "▤" },
    storage: { color: "#0891b2", glyph: "▣" },
    browser: { color: "#4d7c0f", glyph: "◍" }
};

function connectorIcon(id, name) {
    const key = String(id || "").toLowerCase();
    const icon = CONNECTOR_ICONS[key] || {
        color: "#6b7280",
        glyph: String(name || id || "?")
            .split(/\s+/)
            .map(word => word.charAt(0))
            .join("")
            .slice(0, 2)
            .toUpperCase()
    };
    return `
        <span class="connector-icon" style="background:${icon.color}" aria-hidden="true">${escapeHtml(icon.glyph)}</span>
    `;
}

async function loadPluginsView() {
    const body = document.getElementById("pluginsBody");
    if (!body) return;
    try {
        const response = await apiRequest("/api/integrations");
        if (!response.ok) throw new Error(await getResponseError(response));
        const data = await response.json();
        const integrations = data.integrations || data || [];
        const list = Array.isArray(integrations) ? integrations : [];

        if (!list.length) {
            body.innerHTML = '<div class="product-card"><div class="product-card-meta">No connectors registered.</div></div>';
            return;
        }

        body.innerHTML = `
            <p class="settings-description">
                ${list.filter(item => (item.state?.status || "") === "connected").length} of ${list.length}
                connectors connected. A connector only becomes available to the agent after it is connected.
            </p>
            <div class="product-list">
                ${list.map(item => {
                    const state = item.state || {};
                    const connected = state.status === "connected";
                    const capabilities = (item.capabilities || []).slice(0, 4);
                    return `
                        <div class="product-card connector-card">
                            <div class="connector-head">
                                ${connectorIcon(item.id, item.name)}
                                <div class="connector-head-text">
                                    <div class="product-card-title">${escapeHtml(item.name || item.id)}</div>
                                    <div class="product-card-meta">${escapeHtml(item.description || "Connector")}</div>
                                </div>
                                <span class="status-pill ${connected ? "ok" : state.status === "error" ? "warning" : ""}">
                                    ${connected ? "Connected" : state.status === "error" ? "Setup error" : item.adapterAvailable ? "Not connected" : "Adapter required"}
                                </span>
                            </div>
                            <p class="connector-status-message">
                                ${escapeHtml(state.error || (item.adapterAvailable
                                    ? "Connection has not been verified yet."
                                    : "Catalog entry only. Its real API/OAuth adapter is not implemented, so it cannot connect yet."))}
                            </p>
                            <div class="feature-chips" style="margin-top:8px">
                                ${capabilities.map(cap => `<span class="feature-chip">${escapeHtml(String(cap))}</span>`).join("")}
                            </div>
                            <div class="capability-row-actions" style="margin-top:10px">
                                <button
                                    type="button"
                                    class="capability-action-button"
                                    data-integration-toggle="${escapeHtml(item.id)}"
                                    data-integration-connected="${connected ? "1" : "0"}"
                                >${connected ? "Disconnect" : item.adapterAvailable ? "Connect" : "Check setup"}</button>
                                <button type="button" class="capability-action-button" data-product-action="open-settings" data-settings-section="integrations">Open in Settings</button>
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        `;

        body.querySelectorAll("[data-integration-toggle]").forEach(button => {
            button.addEventListener("click", async () => {
                const id = button.dataset.integrationToggle;
                const connected = button.dataset.integrationConnected === "1";
                button.disabled = true;
                button.textContent = connected ? "Disconnecting…" : "Connecting…";
                try {
                    const response = await apiRequest(
                        `/api/integrations/${encodeURIComponent(id)}/${connected ? "disconnect" : "connect"}`,
                        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
                    );
                    if (!response.ok) throw new Error(await getResponseError(response));
                    showCapabilityNotice(`${id} ${connected ? "disconnected" : "connected"}.`);
                    loadPluginsView();
                } catch (error) {
                    button.disabled = false;
                    button.textContent = connected ? "Disconnect" : "Check setup";
                    if (!connected) await loadPluginsView();
                    showCapabilityNotice(`Could not update ${id}: ${error.message}`);
                }
            });
        });
    } catch (error) {
        body.innerHTML = `<div class="product-card"><div class="product-card-meta">Could not load connectors: ${escapeHtml(error.message)}</div></div>`;
    }
}

/*
Library page — every registered tool and agent, read live from
the runtime so the list reflects what is actually available.
*/
async function loadLibraryView() {
    const body = document.getElementById("libraryBody");
    if (!body) return;
    try {
        const response = await apiRequest("/api/capabilities");
        if (!response.ok) throw new Error(await getResponseError(response));
        const data = await response.json();
        const tools = data.tools || [];
        const agents = data.agents || [];

        body.innerHTML = `
            <h2 class="settings-section-title">Tools (${tools.length})</h2>
            <div class="product-list">
                ${tools.length ? tools.map(tool => `
                    <div class="product-card">
                        <div class="product-card-title">${escapeHtml(tool.name || tool.id || "tool")}</div>
                        <div class="product-card-meta">${escapeHtml(tool.description || "")}</div>
                    </div>
                `).join("") : '<div class="product-card"><div class="product-card-meta">No tools registered.</div></div>'}
            </div>
            <h2 class="settings-section-title" style="margin-top:18px">Agents (${agents.length})</h2>
            <div class="product-list">
                ${agents.length ? agents.map(agent => `
                    <div class="product-card">
                        <div class="product-card-title">${escapeHtml(agent.name || agent.id || "agent")}</div>
                        <div class="product-card-meta">${escapeHtml(agent.description || agent.role || "")}</div>
                    </div>
                `).join("") : '<div class="product-card"><div class="product-card-meta">No agents registered.</div></div>'}
            </div>
        `;
    } catch (error) {
        body.innerHTML = `<div class="product-card"><div class="product-card-meta">Could not load the library: ${escapeHtml(error.message)}</div></div>`;
    }
}

/*
Agents page — the specialist agent registry with what each one
is able to do.
*/
async function loadAgentsView() {
    const body = document.getElementById("agentsBody");
    if (!body) return;
    try {
        const response = await apiRequest("/api/agents");
        if (!response.ok) throw new Error(await getResponseError(response));
        const data = await response.json();
        const agents = data.agents || [];

        if (!agents.length) {
            body.innerHTML = '<div class="product-card"><div class="product-card-meta">No agents registered.</div></div>';
            return;
        }

        body.innerHTML = `
            <div class="product-list">
                ${agents.map(agent => `
                    <div class="product-card">
                        <div class="product-card-title">${escapeHtml(agent.name || agent.id || "Agent")}</div>
                        <div class="product-card-meta">${escapeHtml(agent.description || agent.role || "")}</div>
                        <div class="feature-chips" style="margin-top:8px">
                            ${(agent.capabilities || agent.tools || []).slice(0, 6).map(cap =>
                                `<span class="feature-chip">${escapeHtml(String(cap))}</span>`
                            ).join("")}
                        </div>
                    </div>
                `).join("")}
            </div>
        `;
    } catch (error) {
        body.innerHTML = `<div class="product-card"><div class="product-card-meta">Could not load agents: ${escapeHtml(error.message)}</div></div>`;
    }
}

async function loadCapabilities() {
            try {
                const [response, metricsResponse] = await Promise.all([
                    apiRequest("/api/capabilities"),
                    apiRequest("/api/model-metrics")
                ]);
                const capabilities = await response.json();
                const metrics = await metricsResponse.json();
                renderCapabilities(capabilities, metrics.metrics || []);
            } catch (error) {
                console.error(error);
                controlCenterBody.innerHTML =
                    `<div class="capability-error">${escapeHtml(
                        error.message
                    )}</div>`;
            }
        }

        function openControlCenter() {
            controlCenterModal.classList.add("open");
            controlCenterModal.setAttribute("aria-hidden", "false");
            loadCapabilities();
        }

        function closeControlCenter() {
            controlCenterModal.classList.remove("open");
            controlCenterModal.setAttribute("aria-hidden", "true");
        }

        function renderCapabilities(data, modelMetrics = []) {
            const providers = data.providers || [];
            const roles = data.roles || [];
            const models = data.models || [];
            const tools = data.tools || [];
            const agents = data.agents || [];
            const automations = data.automations || [];
            const integrations = data.integrations || [];
            const permissions = data.permissions || {};
            const features = data.features || {};
            const active = data.active || {};
            const hardware = data.hardware || {};

            const storedRole =
                localStorage.getItem("nexus-model-role") || "auto";

            const chatModels = models.filter(model =>
                (model.capabilities || []).includes("chat")
            );
            const imageModels = models.filter(model =>
                model.provider === "openai" &&
                (model.capabilities || []).includes("image") &&
                model.configured &&
                model.available
            );
            const catalogOptions = chatModels.map(model => `
                <option
                    value="model:${escapeHtml(model.provider)}:${escapeHtml(model.model)}"
                    ${storedRole === `model:${model.provider}:${model.model}` ? "selected" : ""}
                    ${model.configured && model.available ? "" : "disabled"}
                >
                    ${escapeHtml(model.provider)} · ${escapeHtml(model.model)}
                    ${model.local && model.requirements?.memoryGB
                        ? Number(model.requirements.memoryGB) >= 1024
                            ? " · RAM estimate unavailable"
                            : ` · ~${escapeHtml(model.requirements.memoryGB)} GB RAM`
                        : ""}
                </option>
            `).join("");

            modelSelector.innerHTML = `
                <option value="auto" ${storedRole === "auto" ? "selected" : ""}>
                    Auto · Nexus chooses
                </option>
                <optgroup label="Task presets">
                ${roles.map(role => `
                <option value="${escapeHtml(role.role)}" ${
                    role.role === storedRole ? "selected" : ""
                }>
                    ${escapeHtml(role.role)} · ${escapeHtml(role.model)}
                </option>
                `).join("")}
                </optgroup>
                <optgroup label="Available models">
                    ${catalogOptions || `<option disabled>No configured models</option>`}
                </optgroup>`;

            if (storedRole === "auto") {
                selectedModelConfig = { provider: null, model: null };
            }

            const selectedCatalogModel = storedRole.startsWith("model:")
                ? models.find(model =>
                    model.configured &&
                    model.available &&
                    (model.capabilities || []).includes("chat") &&
                    `model:${model.provider}:${model.model}` === storedRole
                )
                : null;
            const selectedRole =
                roles.find(role => role.role === storedRole) ||
                roles.find(role => role.role === "chat") ||
                roles[0];

            selectedModelConfig = storedRole === "auto"
                ? { provider: null, model: null }
                : selectedCatalogModel
                ? {
                    provider: selectedCatalogModel.provider,
                    model: selectedCatalogModel.model
                }
                : selectedRole
                ? {
                    provider: selectedRole.provider,
                    model: selectedRole.model
                }
                : {
                    provider: null,
                    model: null
                };

            const providerCards = providers.map(provider => `
                <div class="capability-card">
                    <div class="capability-card-title">
                        ${escapeHtml(provider.label || provider.name)}
                        <span class="capability-badge ${
                            provider.configured ? "ready" : ""
                        }">
                            ${provider.configured ? "Credentials present" : "Needs credentials"}
                        </span>
                    </div>
                    <div class="capability-card-meta">
                        ${escapeHtml(provider.name)} ·
                        ${provider.local ? "Local" : "Remote"}
                    </div>
                    ${provider.configured
                        ? `<div class="capability-card-meta">${provider.local ? "Local runtime configured" : `Credential: ${escapeHtml(provider.credentialEnv || "provider API key")}`}</div>`
                        : `<div class="capability-card-meta">Add <code>${escapeHtml(provider.credentialEnv || "provider credential")}</code> to the local .env or hosting environment.</div>`}
                    <div class="provider-health-result" data-provider-health="${escapeHtml(provider.name)}" aria-live="polite">Connection not tested</div>
                    <div class="capability-row-actions">
                        <button type="button" class="capability-action-button" data-check-provider="${escapeHtml(provider.name)}">Test connection</button>
                        <button type="button" class="capability-action-button" data-discover-provider="${escapeHtml(provider.name)}" ${provider.configured ? "" : "disabled"}>Discover models</button>
                    </div>
                </div>
            `).join("");

            const providerKeyFields = [
                {
                    title: "Free-tier cloud providers",
                    providers: [
                        {
                            label: "Google Gemini",
                            env: "GOOGLE_API_KEY",
                            signup: "https://aistudio.google.com/apikey"
                        },
                        {
                            label: "Groq",
                            env: "GROQ_API_KEY",
                            signup: "https://console.groq.com/keys"
                        },
                        {
                            label: "OpenRouter",
                            env: "OPENROUTER_API_KEY",
                            signup: "https://openrouter.ai/settings/keys"
                        }
                    ]
                },
                {
                    title: "Other cloud providers (optional)",
                    providers: [
                        { label: "OpenAI", env: "OPENAI_API_KEY" },
                        { label: "Anthropic", env: "ANTHROPIC_API_KEY" },
                        { label: "DeepSeek", env: "DEEPSEEK_API_KEY" },
                        { label: "Mistral", env: "MISTRAL_API_KEY" },
                        { label: "xAI", env: "XAI_API_KEY" },
                        { label: "Together", env: "TOGETHER_API_KEY" },
                        { label: "OpenAI-compatible service", env: "COMPATIBLE_API_KEY" }
                    ]
                }
            ].map(group => `
                <div class="capability-section">
                    <div class="capability-section-title">${group.title}</div>
                    <div class="settings-preferences">
                        ${group.providers.map(provider => {
                            const configured = providers.some(item =>
                                item.credentialEnv === provider.env && item.configured
                            );
                            return `
                                <div class="settings-field">
                                    <label for="providerKey-${provider.env}">
                                        <strong>${provider.label}</strong>
                                        ${provider.signup
                                            ? `<small><a href="${provider.signup}" target="_blank" rel="noopener noreferrer">Get a key from ${provider.label}</a>. Free access and limits depend on the provider.</small>`
                                            : `<small>Optional. Your provider account may bill usage.</small>`}
                                    </label>
                                    <input
                                        id="providerKey-${provider.env}"
                                        class="settings-select"
                                        type="password"
                                        autocomplete="new-password"
                                        spellcheck="false"
                                        placeholder="${configured ? "Key saved · enter a new key to replace it" : `Paste ${provider.label} API key`}"
                                        data-provider-key-env="${provider.env}"
                                    >
                                </div>
                            `;
                        }).join("")}
                    </div>
                </div>
            `).join("");

            const roleRows = roles.map(role => `
                <div class="capability-row">
                    <span>${escapeHtml(role.role)}</span>
                    <strong>${escapeHtml(role.provider)} / ${
                        escapeHtml(role.model)
                    }</strong>
                </div>
            `).join("");

            const modelCatalogRows = models.map(model => `
                <div class="capability-row">
                    <span>${escapeHtml(model.provider)} / ${escapeHtml(model.model)}</span>
                    <strong class="${model.configured && model.available ? "capability-ready" : "capability-muted"}">
                        ${model.configured && model.available
                            ? model.local && model.requirements?.memoryGB >= 1024
                                ? "Available · RAM estimate unavailable"
                                : model.local && model.requirements?.memoryGB > hardware.memoryGB
                                ? `Available · may exceed ${escapeHtml(hardware.memoryGB)} GB RAM`
                                : "Available"
                            : "Requires setup"}
                    </strong>
                </div>
            `).join("");

            const modelHealthRows = modelMetrics
                .filter(metric => metric.configured && metric.available)
                .map(metric => `
                    <div class="capability-row">
                        <span>${escapeHtml(metric.provider)} / ${escapeHtml(metric.model)}</span>
                        <strong>${metric.attempts
                            ? `${Math.round((metric.successRate || 0) * 100)}% success · ${metric.averageLatencyMs ?? "-"} ms`
                            : "Awaiting requests"}</strong>
                    </div>
                `).join("") || `<div class="capability-row"><span>No configured models</span><strong class="capability-muted">Unavailable</strong></div>`;

            const localModelRows = models
                .filter(model => model.provider === "ollama" && model.configured && model.available)
                .map(model => `
                    <div class="capability-row">
                        <span>${escapeHtml(model.model)}</span>
                        <span class="capability-row-actions">
                            ${model.requirements?.memoryGB >= 1024
                                ? `<small class="capability-muted">RAM estimate unavailable</small>`
                                : model.requirements?.memoryGB > hardware.memoryGB
                                ? `<small class="capability-muted">May exceed ${escapeHtml(hardware.memoryGB)} GB RAM</small>`
                                : ""}
                            <button type="button" class="capability-action-button" data-remove-local-model="${escapeHtml(model.model)}">Remove</button>
                        </span>
                    </div>
                `).join("") || `<div class="capability-row"><span>No local models discovered</span><strong class="capability-muted">Ollama unavailable</strong></div>`;

            const toolRows = tools.map(tool => `
                <div class="capability-row">
                    <span>${escapeHtml(tool.name)}</span>
                    <strong class="${
                        tool.runnable ? "capability-ready" : "capability-muted"
                    }">${tool.runnable ? "Runnable" : "Permission needed"}</strong>
                </div>
            `).join("");

            const automationRows = automations.map(automation => `
                <div class="capability-row">
                    <span>${escapeHtml(automation.name)}</span>
                    <span class="capability-row-actions">
                        <strong>${escapeHtml(
                            (automation.triggers || []).join(", ") || "manual"
                        )}</strong>
                        <button
                            type="button"
                            class="capability-action-button"
                            data-run-automation="${escapeHtml(automation.name)}"
                        >Run</button>
                    </span>
                </div>
            `).join("");

            const agentRows = agents.map(agent => `
                <div class="capability-row">
                    <span>${escapeHtml(agent.name || agent.id)}</span>
                    <strong>${escapeHtml(
                        agent.builtin ? "Built-in" : "Custom"
                    )}</strong>
                </div>
            `).join("");

            const integrationRows = integrations.map(integration => `
                <div class="capability-row">
                    <span class="capability-row-content">
                        <strong>${escapeHtml(integration.name || integration.id)}</strong>
                        <small>${escapeHtml(integration.description || "Connector")}</small>
                    </span>
                    <span class="capability-row-actions">
                        <strong class="${
                            integration.state?.status === "connected"
                                ? "capability-ready"
                                : "capability-muted"
                        }">${escapeHtml(
                            integration.state?.status || "disconnected"
                        )}</strong>
                        <button
                            type="button"
                            class="capability-action-button"
                            data-integration-action="${
                                integration.state?.status === "connected"
                                    ? "disconnect"
                                    : "connect"
                            }"
                            data-integration-id="${escapeHtml(integration.id)}"
                        >${integration.state?.status === "connected" ? "Disconnect" : "Connect"}</button>
                    </span>
                </div>
            `).join("");

            const featureRows = Object.entries(features).map(
                ([name, enabled]) => `
                    <span class="feature-chip ${
                        enabled ? "enabled" : "disabled"
                    }">${escapeHtml(name)}: ${
                        enabled ? "on" : "off"
                    }</span>
                `
            ).join("");

            /*
            Settings is a single-column layout: a left nav and a
            right content column. Each section renders its OWN
            content inside its own panel — there is exactly one
            visibility mechanism ([data-settings-panel] + .active),
            so no section can leak into another.
            */
            controlCenterBody.innerHTML = `
                <div class="settings-layout">
                    <nav class="settings-nav" aria-label="Settings sections">
                        <div class="settings-nav-brand">
                            <span class="settings-nav-mark" aria-hidden="true">J</span>
                            <span><strong>Jarwis</strong><small>Control center</small></span>
                        </div>
                        <div class="settings-nav-group">
                            <span class="settings-nav-group-title">Your workspace</span>
                            <button class="settings-nav-item active" data-settings-section="general">General</button>
                            <button class="settings-nav-item" data-settings-section="appearance">Appearance</button>
                            <button class="settings-nav-item" data-settings-section="profile">Profile</button>
                            <button class="settings-nav-item" data-settings-section="personalization">Personalization</button>
                            <button class="settings-nav-item" data-settings-section="notifications">Notifications</button>
                        </div>
                        <div class="settings-nav-group">
                            <span class="settings-nav-group-title">AI &amp; capabilities</span>
                            <button class="settings-nav-item" data-settings-section="models">Models</button>
                            <button class="settings-nav-item" data-settings-section="voice">Voice</button>
                            <button class="settings-nav-item" data-settings-section="browser">Browser</button>
                            <button class="settings-nav-item" data-settings-section="computer">Computer Use</button>
                            <button class="settings-nav-item" data-settings-section="integrations">Integrations</button>
                            <button class="settings-nav-item" data-settings-section="shortcuts">Keyboard</button>
                        </div>
                        <div class="settings-nav-group">
                            <span class="settings-nav-group-title">Workspace &amp; tools</span>
                            <button class="settings-nav-product" type="button" data-settings-view="workspace">Artifacts &amp; workspace <span aria-hidden="true">↗</span></button>
                            <button class="settings-nav-product" type="button" data-settings-view="scheduled">Scheduled <span aria-hidden="true">↗</span></button>
                            <button class="settings-nav-product" type="button" data-settings-view="library">Library <span aria-hidden="true">↗</span></button>
                            <button class="settings-nav-item" data-settings-section="memory">Memory</button>
                            <button class="settings-nav-product" type="button" data-settings-view="plugins">Plugins <span aria-hidden="true">↗</span></button>
                            <button class="settings-nav-product" type="button" data-settings-view="usage">Usage <span aria-hidden="true">↗</span></button>
                            <button class="settings-nav-product" type="button" data-settings-view="benchmarks">Benchmarks <span aria-hidden="true">↗</span></button>
                            <button class="settings-nav-item" data-settings-section="security">Admin</button>
                        </div>
                        <div class="settings-nav-group">
                            <span class="settings-nav-group-title">Privacy &amp; data</span>
                            <button class="settings-nav-item" data-settings-section="archived">Archived chats</button>
                            <button class="settings-nav-item" data-settings-section="data">Data controls</button>
                            <button class="settings-nav-item" data-settings-section="about">About</button>
                        </div>
                        <div class="settings-nav-note">
                            <span class="settings-nav-note-dot" aria-hidden="true"></span>
                            <span><strong>Private by default</strong><small>Your workspace runs on this device.</small></span>
                        </div>
                    </nav>
                    <div class="settings-content">

                <!-- ============================
                     GENERAL
                     ============================ -->
                <section class="settings-panel-section active" data-settings-panel="general">
                    <h2>General</h2>
                    <p class="settings-description">Configure how Jarwis looks and behaves.</p>
                <div class="settings-preferences">
                    <div class="settings-preference">
                        <label for="settings-language"><strong>Language</strong><small>Preferred language for replies.</small></label>
                        <select id="settings-language" class="settings-select" data-setting-key="language">
                            <option value="auto">Auto-detect</option>
                            <option value="en">English</option>
                            <option value="es">Español</option>
                            <option value="fr">Français</option>
                            <option value="de">Deutsch</option>
                            <option value="pt">Português</option>
                            <option value="hi">हिन्दी</option>
                            <option value="ta">தமிழ்</option>
                            <option value="zh">中文</option>
                            <option value="ja">日本語</option>
                            <option value="ar">العربية</option>
                        </select>
                    </div>
                    <div class="settings-preference">
                        <label for="settings-intelligence"><strong>Default intelligence</strong><small>Used when a request does not specify a level.</small></label>
                        <select id="settings-intelligence" class="settings-select" data-setting-key="intelligence">
                            ${["auto", "fast", "balanced", "high", "very-high", "maximum", "expert"].map(level =>
                                `<option value="${level}">${level.replace("-", " ")}</option>`
                            ).join("")}
                        </select>
                    </div>
                    <div class="settings-preference">
                        <label for="settingsAutotitle"><strong>Auto-title new chats</strong><small>Name a conversation from its first message.</small></label>
                        <select id="settingsAutotitle" class="settings-select" data-setting-key="autoTitle">
                            <option value="on">On</option>
                            <option value="off">Off</option>
                        </select>
                    </div>
                </div>

                <section class="capability-section">
                    <div class="capability-section-title">Behaviour</div>
                    <div class="settings-preferences">
                        <label class="settings-toggle"><span><strong>Send with Enter</strong><small>When off, use Ctrl+Enter to send. Cmd+Enter always inserts a new line.</small></span><input id="settingsEnterToSend" type="checkbox" checked data-setting-key="enterToSend"></label>
                        <label class="settings-toggle"><span><strong>Show suggested prompts</strong><small>Display starter ideas on a new chat.</small></span><input id="settingsSuggestions" type="checkbox" checked data-setting-key="showSuggestions"></label>
                        <label class="settings-toggle"><span><strong>Wide layout</strong><small>Use the full window width for long answers.</small></span><input id="settingsWide" type="checkbox" data-setting-key="wideLayout"></label>
                        <label class="settings-toggle"><span><strong>Stream responses</strong><small>Show tokens as they are produced.</small></span><input id="settingsStream" type="checkbox" checked data-setting-key="streamResponses"></label>
                        <label class="settings-toggle"><span><strong>Keep screen awake</strong><small>Ask the browser to keep the display on during long tasks.</small></span><input id="settingsKeepAwake" type="checkbox" data-setting-key="keepAwake"></label>
                        <label class="settings-toggle"><span><strong>Always show follow-ups</strong><small>Offer suggested next messages after every reply.</small></span><input id="settingsFollowUps" type="checkbox" data-setting-key="alwaysFollowUps"></label>
                        <label class="settings-toggle"><span><strong>Show model reasoning summary</strong><small>Display a short summary of the approach used.</small></span><input id="settingsReasoningSummary" type="checkbox" checked data-setting-key="reasoningSummary"></label>
                    </div>
                </section>
                </section><!-- /general -->

                <!-- ============================
                     APPEARANCE
                     ============================ -->
                <section class="settings-panel-section" data-settings-panel="appearance">
                    <h2>Appearance</h2>
                    <p class="settings-description">Choose how Jarwis looks. Every change applies immediately.</p>

                    <section class="capability-section">
                        <div class="capability-section-title">Theme</div>
                        <div class="appearance-theme-grid">
                            <button type="button" class="theme-swatch" data-theme-choice="system">
                                <span class="theme-swatch-preview theme-preview-system"></span>
                                <span>System</span>
                            </button>
                            <button type="button" class="theme-swatch" data-theme-choice="light">
                                <span class="theme-swatch-preview theme-preview-light"></span>
                                <span>Light</span>
                            </button>
                            <button type="button" class="theme-swatch" data-theme-choice="dark">
                                <span class="theme-swatch-preview theme-preview-dark"></span>
                                <span>Dark</span>
                            </button>
                        </div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Colours</div>
                        <div class="settings-preferences">
                            <div class="settings-preference">
                                <label for="accentColor"><strong>Accent</strong><small>Used for buttons and highlights.</small></label>
                                <span class="capability-row-actions">
                                    <input id="accentColor" type="color" value="#14766d" data-setting-key="accentColor">
                                    <button type="button" class="capability-action-button" data-settings-action="reset-accent">Reset</button>
                                </span>
                            </div>
                            <div class="settings-preference">
                                <label for="backgroundColor"><strong>Background</strong><small>Main conversation background.</small></label>
                                <span class="capability-row-actions">
                                    <input id="backgroundColor" type="color" value="#fbfaf7" data-setting-key="backgroundColor">
                                    <button type="button" class="capability-action-button" data-settings-action="reset-background">Reset</button>
                                </span>
                            </div>
                            <div class="settings-preference">
                                <label for="sidebarColor"><strong>Sidebar</strong><small>Colour of the left navigation panel.</small></label>
                                <span class="capability-row-actions">
                                    <input id="sidebarColor" type="color" value="#f1f4f0" data-setting-key="sidebarColor">
                                    <button type="button" class="capability-action-button" data-settings-action="reset-sidebar">Reset</button>
                                </span>
                            </div>
                        </div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Typography</div>
                        <div class="settings-preferences">
                            <div class="settings-preference">
                                <label for="chatFont"><strong>Chat font</strong><small>Typeface used for messages.</small></label>
                                <select id="chatFont" class="settings-select" data-setting-key="chatFont">
                                    <option value="system">System default</option>
                                    <option value="sans">Sans-serif</option>
                                    <option value="serif">Serif</option>
                                    <option value="mono">Monospace</option>
                                    <option value="dyslexic">Dyslexia-friendly</option>
                                </select>
                            </div>
                            <div class="settings-preference">
                                <label for="chatFontSize"><strong>Chat font size</strong><small>Size of message text.</small></label>
                                <select id="chatFontSize" class="settings-select" data-setting-key="chatFontSize">
                                    <option value="small">Small</option>
                                    <option value="default" selected>Default</option>
                                    <option value="large">Large</option>
                                    <option value="xlarge">Extra large</option>
                                </select>
                            </div>
                            <div class="settings-preference">
                                <label for="codeFontSize"><strong>Code font size</strong><small>Size of text inside code blocks.</small></label>
                                <select id="codeFontSize" class="settings-select" data-setting-key="codeFontSize">
                                    <option value="small">Small</option>
                                    <option value="default" selected>Default</option>
                                    <option value="large">Large</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Accessibility</div>
                        <div class="settings-preferences">
                            <label class="settings-toggle"><span><strong>High contrast</strong><small>Increase contrast between text and background.</small></span><input id="highContrast" type="checkbox" data-setting-key="highContrast"></label>
                            <label class="settings-toggle"><span><strong>Use pointer cursors</strong><small>Show a hand cursor over buttons.</small></span><input id="pointerCursors" type="checkbox" data-setting-key="pointerCursors"></label>
                            <label class="settings-toggle"><span><strong>Translucent sidebar</strong><small>Blur the sidebar over content behind it.</small></span><input id="translucentSidebar" type="checkbox" data-setting-key="translucentSidebar"></label>
                            <label class="settings-toggle"><span><strong>Reduce motion</strong><small>Minimise animations throughout the interface.</small></span><input id="reduceMotion" type="checkbox" data-setting-key="reduceMotion"></label>
                        </div>
                    </section>
                </section>

                <!-- ============================
                     PROFILE
                     ============================ -->
                <section class="settings-panel-section" data-settings-panel="profile">
                    <h2>Profile</h2>
                    <p class="settings-description">How you appear inside Jarwis.</p>

                    <section class="capability-section">
                        <div class="capability-section-title">Your account</div>
                        <div class="profile-header">
                            <div id="profileAvatar" class="profile-avatar">N</div>
                            <div class="profile-fields">
                                <div class="settings-field">
                                    <label for="profileDisplayName"><strong>Display name</strong><small>Shown in the sidebar and on messages.</small></label>
                                    <input id="profileDisplayName" class="settings-select" type="text" placeholder="Your name" data-setting-key="displayName">
                                </div>
                                <div class="settings-field">
                                    <label for="profileUsername"><strong>Username</strong><small>A short handle for this installation.</small></label>
                                    <input id="profileUsername" class="settings-select" type="text" placeholder="local" data-setting-key="username">
                                </div>
                                <div class="settings-field">
                                    <label for="profileAvatarColor"><strong>Avatar colour</strong><small>Background of your avatar circle.</small></label>
                                    <input id="profileAvatarColor" type="color" value="#0d0d0d" data-setting-key="avatarColor">
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Sign-in &amp; session</div>
                        <div id="profileAuthState" class="account-session-card">
                            <span class="welcome-readiness-dot is-loading"></span>
                            <span>Checking this Jarwis session…</span>
                        </div>
                        <div class="settings-actions account-session-actions">
                            <button type="button" class="modal-button secondary" data-auth-signin hidden>Sign in</button>
                            <button type="button" class="modal-button secondary" data-auth-logout hidden>Sign out</button>
                        </div>
                        <p class="settings-description">Signing out ends this browser session. On a trusted local PC, Jarwis may still allow local access without an account.</p>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Usage insights</div>
                        <div id="profileUsage" class="capability-list"><p class="capability-muted">Loading…</p></div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Request</div>
                        <div class="settings-preference">
                            <label for="settingsRequestTimeout"><strong>Request timeout</strong><small>Seconds before a slow response is abandoned.</small></label>
                            <input id="settingsRequestTimeout" class="settings-select" type="number" min="15" max="600" step="5" value="180" data-setting-key="requestTimeout">
                        </div>
                    </section>
                </section><!-- /profile -->

                <section class="settings-panel-section" data-settings-panel="notifications">
                    <h2>Notifications</h2><p class="settings-description">Choose which local browser notifications Nexus may show.</p>
                    <div class="settings-preferences">
                        <label class="settings-toggle"><span><strong>Task updates</strong><small>Notify when an automation or long task finishes.</small></span><input type="checkbox" data-setting-key="notifyTasks"></label>
                        <label class="settings-toggle"><span><strong>Message notifications</strong><small>Notify when a response is ready while this tab is inactive.</small></span><input type="checkbox" data-setting-key="notifyMessages"></label>
                        <label class="settings-toggle"><span><strong>Sound effects</strong><small>Play a subtle sound for completed actions.</small></span><input type="checkbox" data-setting-key="soundEffects"></label>
                    </div>
                    <div class="settings-actions">
                        <button type="button" class="modal-button secondary" data-settings-action="request-notifications">Allow browser notifications</button>
                        <button type="button" class="modal-button secondary" data-settings-action="test-notification">Send a test notification</button>
                    </div>
                    <p class="settings-description" id="notificationStatus"></p>
                </section>
                <section class="settings-panel-section" data-settings-panel="personalization">
                    <h2>Personalization</h2>
                    <p class="settings-description">Tell Jarwis about you and how you want it to respond. These instructions are added to every conversation.</p>

                    <section class="capability-section">
                        <div class="capability-section-title">Custom instructions</div>
                        <div class="settings-field">
                            <label for="customInstructionsAbout"><strong>What should Nexus know about you?</strong><small>Your role, context, and preferences.</small></label>
                            <textarea id="customInstructionsAbout" class="settings-textarea" rows="3" data-setting-key="customAbout" placeholder="e.g. I am a software engineer working in TypeScript. Prefer concise answers."></textarea>
                        </div>
                        <div class="settings-field">
                            <label for="customInstructionsStyle"><strong>How should Nexus respond?</strong><small>Tone, format, and level of detail.</small></label>
                            <textarea id="customInstructionsStyle" class="settings-textarea" rows="3" data-setting-key="customStyle" placeholder="e.g. Answer in short paragraphs. Use code blocks for code."></textarea>
                        </div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Response style</div>
                        <div class="settings-preference">
                            <label for="responseStyle"><strong>Default style</strong><small>Applies unless a message asks for something else.</small></label>
                            <select id="responseStyle" class="settings-select" data-setting-key="responseStyle">
                                <option value="default">Default</option>
                                <option value="concise">Concise</option>
                                <option value="explanatory">Explanatory</option>
                                <option value="formal">Formal</option>
                                <option value="friendly">Friendly</option>
                            </select>
                        </div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Context</div>
                        <div class="settings-preferences">
                            <label class="settings-toggle"><span><strong>Use conversation context</strong><small>Include earlier messages from the current chat.</small></span><input type="checkbox" checked data-setting-key="useConversationContext"></label>
                            <label class="settings-toggle"><span><strong>Use project context</strong><small>Include files and instructions from the active project.</small></span><input type="checkbox" checked data-setting-key="useProjectContext"></label>
                            <label class="settings-toggle"><span><strong>Use saved memories</strong><small>Include facts Nexus has remembered about you.</small></span><input type="checkbox" checked data-setting-key="useMemory"></label>
                        </div>
                    </section>
                </section>
                <section class="settings-panel-section" data-settings-panel="memory">
                    <h2>Memory</h2>
                    <p class="settings-description">Review and remove facts Jarwis has saved about you. Memories are stored locally with this installation.</p>
                    <section class="capability-section">
                        <div class="capability-section-title">Saved memories</div>
                        <div id="memoryList" class="capability-list"><p class="capability-muted">Loading memories…</p></div>
                    </section>
                </section>
                <section class="settings-panel-section" data-settings-panel="voice">
                    <h2>Voice</h2>
                    <p class="settings-description">Dictation uses the browser's Speech Recognition. Read-aloud uses Speech Synthesis and never sends audio to a server.</p>

                    <section class="capability-section">
                        <div class="capability-section-title">Dictation</div>
                        <div class="settings-preferences">
                            <div class="settings-preference">
                                <span><strong>Speech recognition</strong><small>${("SpeechRecognition" in window || "webkitSpeechRecognition" in window) ? "Available in this browser." : "Not supported by this browser."}</small></span>
                                <button type="button" class="capability-action-button" data-settings-action="test-dictation">Test</button>
                            </div>
                            <div class="settings-preference">
                                <label for="dictationLanguage"><strong>Dictation language</strong><small>Which language is spoken to the microphone.</small></label>
                                <select id="dictationLanguage" class="settings-select" data-setting-key="dictationLanguage">
                                    <option value="en-US">English (US)</option>
                                    <option value="en-GB">English (UK)</option>
                                    <option value="es-ES">Español</option>
                                    <option value="fr-FR">Français</option>
                                    <option value="de-DE">Deutsch</option>
                                    <option value="hi-IN">हिन्दी</option>
                                    <option value="zh-CN">中文</option>
                                    <option value="ja-JP">日本語</option>
                                </select>
                            </div>
                            <label class="settings-toggle"><span><strong>Auto-send dictation</strong><small>Send automatically when you stop speaking.</small></span><input type="checkbox" data-setting-key="autoSendDictation"></label>
                        </div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Read aloud</div>
                        <div class="settings-preferences">
                            <label class="settings-toggle"><span><strong>Show read-aloud on replies</strong><small>Adds a speaker action to assistant messages.</small></span><input type="checkbox" checked data-setting-key="readAloud"></label>
                            <div class="settings-preference">
                                <label for="voiceSelect"><strong>Voice</strong><small>Voices installed on this device.</small></label>
                                <select id="voiceSelect" class="settings-select" data-setting-key="voiceName">
                                    <option value="">System default</option>
                                </select>
                            </div>
                            <div class="settings-preference">
                                <label for="voiceRate"><strong>Speed</strong><small>How fast replies are read.</small></label>
                                <span class="capability-row-actions">
                                    <input id="voiceRate" type="range" min="0.5" max="2" step="0.1" value="1" data-setting-key="voiceRate">
                                    <span id="voiceRateValue" class="capability-muted">1.0×</span>
                                </span>
                            </div>
                            <div class="settings-preference">
                                <label for="voicePitch"><strong>Pitch</strong><small>Lower is deeper, higher is brighter.</small></label>
                                <span class="capability-row-actions">
                                    <input id="voicePitch" type="range" min="0" max="2" step="0.1" value="1" data-setting-key="voicePitch">
                                    <span id="voicePitchValue" class="capability-muted">1.0</span>
                                </span>
                            </div>
                        </div>
                        <button type="button" class="modal-button primary" data-settings-action="voice">Test read aloud</button>
                    </section>
                </section>
                <section class="settings-panel-section" data-settings-panel="models">
                    <h2>Models</h2>
                    <p class="settings-description">Choose model defaults and inspect provider availability. Automatic routing selects the best configured model for each task.</p>

                    <section class="capability-section">
                        <div class="capability-section-title">Advanced execution</div>
                        <div class="settings-preferences">
                            <label class="settings-toggle"><span><strong>Advanced Mode</strong><small>Use these controls for new messages instead of automatic values.</small></span><input id="advancedModeEnabled" type="checkbox"></label>
                        </div>
                        <div class="settings-field">
                            <label for="advancedTemperature"><strong>Temperature — <span id="tempValue">0.7</span></strong><small>Lower is more deterministic; higher is more creative.</small></label>
                            <input id="advancedTemperature" type="range" min="0" max="2" step="0.1" value="0.7">
                        </div>
                        <div class="settings-field">
                            <label for="advancedTopP"><strong>Top-p — <span id="topPValue">1.0</span></strong><small>Nucleus sampling. 1.0 considers all tokens.</small></label>
                            <input id="advancedTopP" type="range" min="0.1" max="1" step="0.05" value="1">
                        </div>
                        <div class="settings-field">
                            <label for="advancedMaxTokens"><strong>Output budget (tokens)</strong><small>Upper bound on a single reply.</small></label>
                            <input id="advancedMaxTokens" class="settings-select" type="number" min="64" max="32768" step="64" value="2048">
                        </div>
                        <div class="settings-field">
                            <label for="advancedTopK"><strong>Top-k</strong><small>0 disables the limit. Lower restricts word choice.</small></label>
                            <input id="advancedTopK" class="settings-select" type="number" min="0" max="200" step="1" value="0">
                        </div>
                        <div class="settings-field">
                            <label for="advancedRepetitionPenalty"><strong>Repetition penalty — <span id="repPenaltyValue">1.0</span></strong><small>Above 1.0 discourages repeating itself.</small></label>
                            <input id="advancedRepetitionPenalty" type="range" min="0.5" max="2" step="0.05" value="1">
                        </div>
                        <div class="settings-field">
                            <label for="advancedMaxSteps"><strong>Agent steps</strong><small>How many tool steps a single request may take.</small></label>
                            <input id="advancedMaxSteps" class="settings-select" type="number" min="1" max="12" step="1" value="6">
                        </div>
                        <div class="settings-preference">
                            <label for="advancedSeed"><strong>Seed</strong><small>Blank for random. A fixed seed makes output repeatable.</small></label>
                            <input id="advancedSeed" class="settings-select" type="number" min="0" step="1" placeholder="random">
                        </div>
                    </section>

                    <div class="capability-summary">
                        <div>
                            <span class="capability-label">Active runtime</span>
                            <strong>${escapeHtml(active.type || "unknown")} /
                                ${escapeHtml(active.model || "unknown")}</strong>
                        </div>
                        <div>
                            <span class="capability-label">Nexus version</span>
                            <strong>${escapeHtml(data.product?.version || "unknown")}</strong>
                        </div>
                    </div>

                    <section class="capability-section">
                        <div class="capability-section-title">Connect cloud models</div>
                        <p class="settings-description">Keys are saved in Jarwis’s private local configuration and are never sent back to this screen. Cloud requests send their prompt and relevant conversation context to that provider. Free plans, model access, and rate limits vary; Jarwis cannot create accounts or provide API keys for you.</p>
                        ${providerKeyFields}
                        <button type="button" class="modal-button primary" data-save-provider-keys>Save API keys on this PC</button>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Keep cloud costs under your control</div>
                        <label class="settings-toggle">
                            <span><strong>Allow paid models in automatic routing</strong><small>Off by default. Turn this on only if you accept possible provider charges. You can still choose any configured model manually.</small></span>
                            <input id="paidAutoRouting" type="checkbox" ${data.paidAutoRoutingEnabled ? "checked" : ""}>
                        </label>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Providers (${providers.length})</div>
                        <div class="capability-grid">${providerCards}</div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Model roles (${roles.length})</div>
                        <div class="capability-list">${roleRows}</div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Image generation</div>
                        <label class="settings-preference" for="imageModelSelector">
                            <span><strong>Image model</strong><small>Choose a discovered OpenAI image model, or leave the provider default.</small></span>
                            <select id="imageModelSelector" class="settings-select">
                                <option value="" ${selectedImageModel ? "" : "selected"}>Provider default</option>
                                ${imageModels.map(model => `
                                    <option
                                        value="${escapeHtml(model.model)}"
                                        ${selectedImageModel === model.model ? "selected" : ""}
                                    >${escapeHtml(model.model)}</option>
                                `).join("")}
                            </select>
                        </label>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Model catalog (${models.length})</div>
                        <div class="capability-list capability-scroll">${modelCatalogRows}</div>
                    </section>

                    ${modelHealthRows
                        ? `<section class="capability-section">
                            <div class="capability-section-title">Routing health</div>
                            <div class="capability-list capability-scroll">${modelHealthRows}</div>
                        </section>`
                        : ""}

                    <section class="capability-section">
                        <div class="capability-section-title">Local models</div>
                        <div class="settings-preference">
                            <label for="localModelName"><strong>Install with Ollama</strong><small>RAM estimates are advisory only. Large models may run slowly or fail, but Jarwis will not block installation.</small></label>
                            <span class="capability-row-actions"><input id="localModelName" class="settings-select" placeholder="qwen2.5-coder:1.5b" autocomplete="off"><button type="button" class="capability-action-button" data-install-local-model>Install</button></span>
                        </div>
                        <div class="capability-list capability-scroll">${localModelRows}</div>
                    </section>
                </section>

                <!-- ============================
                     INTEGRATIONS
                     ============================ -->
                <!-- ============================
                     KEYBOARD SHORTCUTS
                     ============================ -->
                <section class="settings-panel-section" data-settings-panel="shortcuts">
                    <h2>Keyboard</h2>
                    <p class="settings-description">Every shortcut Nexus responds to. Use the filter to find one quickly.</p>
                    <div class="settings-field">
                        <label for="shortcutFilter"><strong>Filter shortcuts</strong></label>
                        <input id="shortcutFilter" class="settings-select" type="text" placeholder="Search shortcuts…" autocomplete="off">
                    </div>
                    <div id="shortcutList" class="capability-list"></div>
                </section>

                <!-- ============================
                     BROWSER
                     ============================ -->
                <section class="settings-panel-section" data-settings-panel="browser">
                    <h2>Browser</h2>
                    <p class="settings-description">Control where the built-in browser agent is allowed to operate.</p>
                    <div class="settings-preferences">
                        <label class="settings-toggle"><span><strong>Enable browser agent</strong><small>Allow Nexus to navigate and read pages on your behalf.</small></span><input id="browserEnabled" type="checkbox" checked data-setting-key="browserEnabled"></label>
                        <label class="settings-toggle"><span><strong>Show browsing activity live</strong><small>Display each navigation step in the activity panel.</small></span><input id="browserLiveActivity" type="checkbox" checked data-setting-key="browserLiveActivity"></label>
                        <label class="settings-toggle"><span><strong>Download files automatically</strong><small>Save pages and files it retrieves into the workspace.</small></span><input id="browserDownloads" type="checkbox" data-setting-key="browserDownloads"></label>
                    </div>
                    <section class="capability-section">
                        <div class="capability-section-title">Allowed sites</div>
                        <p class="settings-description">Only these hosts may be opened. One per line. Leave empty to allow any site.</p>
                        <div class="settings-field">
                            <textarea id="browserAllowed" class="settings-textarea" rows="3" data-setting-key="browserAllowed" placeholder="example.com&#10;docs.internal"></textarea>
                        </div>
                    </section>
                    <section class="capability-section">
                        <div class="capability-section-title">Blocked sites</div>
                        <p class="settings-description">These hosts are never opened, even if allowed above.</p>
                        <div class="settings-field">
                            <textarea id="browserBlocked" class="settings-textarea" rows="3" data-setting-key="browserBlocked" placeholder="bank.example.com"></textarea>
                        </div>
                    </section>
                </section>

                <!-- ============================
                     COMPUTER USE
                     ============================ -->
                <section class="settings-panel-section" data-settings-panel="computer">
                    <h2>Computer Use</h2>
                    <p class="settings-description">Desktop control lets Nexus move the mouse, type, and launch applications. Everything here is off by default.</p>
                    <div class="settings-preferences">
                        <label class="settings-toggle"><span><strong>Enable computer use</strong><small>Master switch for desktop interaction.</small></span><input id="computerUseEnabled" type="checkbox" data-setting-key="computerUseEnabled"></label>
                        <label class="settings-toggle"><span><strong>Read the screen</strong><small>Allow screenshots and UI element detection.</small></span><input id="computerRead" type="checkbox" data-setting-key="computerRead"></label>
                        <label class="settings-toggle"><span><strong>Move the mouse and click</strong><small>Allow pointer control.</small></span><input id="computerClick" type="checkbox" data-setting-key="computerClick"></label>
                        <label class="settings-toggle"><span><strong>Type into applications</strong><small>Allow keyboard input.</small></span><input id="computerType" type="checkbox" data-setting-key="computerType"></label>
                        <label class="settings-toggle"><span><strong>Launch applications</strong><small>Allow starting installed programs.</small></span><input id="computerLaunch" type="checkbox" data-setting-key="computerLaunch"></label>
                        <label class="settings-toggle"><span><strong>Require confirmation for every action</strong><small>Ask before each click or keystroke.</small></span><input id="computerConfirm" type="checkbox" checked data-setting-key="computerConfirm"></label>
                    </div>
                </section>

                <section class="settings-panel-section" data-settings-panel="integrations">
                    <h2>Integrations</h2>
                    <p class="settings-description">Manage connected services. A connector is only usable after authentication and transport health checks succeed.</p>
                    <section class="capability-section">
                        <div class="capability-section-title">Connectors (${integrations.length})</div>
                        <div class="capability-list">${integrationRows}</div>
                    </section>
                </section>

                <!-- ============================
                     DATA CONTROLS
                     ============================ -->
                <section class="settings-panel-section" data-settings-panel="data">
                    <h2>Data controls</h2>
                    <p class="settings-description">Nexus stores conversations and workspace files locally. These controls do not affect external services.</p>
                    <div class="settings-preferences">
                        <div class="settings-preference"><span><strong>Local storage</strong><small>Conversations, preferences, and workspace metadata remain on this installation.</small></span><strong class="capability-ready">Local</strong></div>
                        <div class="settings-preference"><span><strong>Export conversations</strong><small>Download every chat as a JSON file.</small></span><button type="button" class="capability-action-button" data-settings-action="export-chats">Export</button></div>
                        <div class="settings-preference"><span><strong>Delete all conversations</strong><small>Permanently removes every chat on this installation.</small></span><button type="button" class="capability-action-button" data-settings-action="delete-all-chats">Delete all</button></div>
                        <div class="settings-preference"><span><strong>Clear saved memories</strong><small>Removes facts Nexus has remembered about you.</small></span><button type="button" class="capability-action-button" data-settings-action="clear-memories">Clear</button></div>
                    </div>
                    <section class="capability-section">
                        <div class="capability-section-title">Automations (${automations.length})</div>
                        <div class="capability-list capability-scroll">${automationRows}</div>
                    </section>
                </section>

                <!-- ============================
                     SECURITY
                     ============================ -->
                <!-- ============================
                     ARCHIVED CHATS
                     ============================ -->
                <section class="settings-panel-section" data-settings-panel="archived">
                    <h2>Archived chats</h2>
                    <p class="settings-description">Chats you archived are hidden from the sidebar but still available here.</p>
                    <div class="settings-preference">
                        <span><strong>Keep archived chats</strong><small>Retain archived conversations instead of deleting them.</small></span>
                        <span class="capability-row-actions">
                            <button type="button" class="capability-action-button" data-settings-action="archive-all">Archive all</button>
                            <button type="button" class="capability-action-button" data-settings-action="unarchive-all">Unarchive all</button>
                        </span>
                    </div>
                    <div id="archivedList" class="capability-list"><p class="capability-muted">Loading archived chats…</p></div>
                </section>

                <!-- ============================
                     ABOUT
                     ============================ -->
                <section class="settings-panel-section" data-settings-panel="about">
                    <h2>About</h2>
                    <p class="settings-description">Runtime information for this Nexus installation.</p>
                    <div id="aboutBody" class="capability-list"><p class="capability-muted">Loading…</p></div>
                </section>

                <section class="settings-panel-section" data-settings-panel="security">
                    <h2>Admin</h2>
                    <p class="settings-description">Review installation access, API keys, audit history, and the tools and agents available to this Jarwis instance.</p>

                    <section class="capability-section">
                        <div class="capability-section-title">Runtime protections</div>
                        <div class="settings-preferences">
                            <div class="settings-preference"><span><strong>Approval gates</strong><small>Risky actions require explicit approval before execution.</small></span><strong class="capability-ready">Enabled</strong></div>
                            <div class="settings-preference"><span><strong>Workspace sandbox</strong><small>File operations are restricted to the configured workspace.</small></span><strong class="capability-ready">Enabled</strong></div>
                            <div class="settings-preference"><span><strong>Audit logging</strong><small>Security-relevant actions are written to the audit log.</small></span><strong class="capability-ready">Enabled</strong></div>
                        </div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Authentication</div>
                        <div id="authStatus" class="settings-preferences">
                            <p class="capability-muted">Checking authentication status…</p>
                        </div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">API keys</div>
                        <p class="settings-description">Keys authenticate external clients against the Nexus API. A key is shown once when created.</p>
                        <div class="settings-preference">
                            <label for="newKeyLabel"><strong>Create a key</strong><small>Give it a name you will recognise later.</small></label>
                            <span class="capability-row-actions">
                                <input id="newKeyLabel" class="settings-select" placeholder="my-app" autocomplete="off">
                                <select id="newKeyRole" class="settings-select">
                                    <option value="owner">owner</option>
                                    <option value="admin">admin</option>
                                    <option value="member">member</option>
                                    <option value="viewer">viewer</option>
                                </select>
                                <button type="button" class="capability-action-button" data-settings-action="create-key">Create</button>
                            </span>
                        </div>
                        <div id="apiKeyList" class="capability-list"><p class="capability-muted">Loading keys…</p></div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Audit log</div>
                        <p class="settings-description">The most recent security-relevant actions on this installation.</p>
                        <div id="auditLogList" class="capability-list capability-scroll"><p class="capability-muted">Loading audit log…</p></div>
                    </section>

                    <section class="capability-section">
                        <div class="capability-section-title">Granted permissions</div>
                        <div class="feature-chips">${(permissions.granted || []).map(p => `<span class="feature-chip enabled">${escapeHtml(p)}</span>`).join("") || '<span class="feature-chip disabled">None granted</span>'}</div>
                    </section>
                    <section class="capability-section">
                        <div class="capability-section-title">Agents (${agents.length})</div>
                        <div class="capability-list capability-scroll">${agentRows}</div>
                    </section>
                    <section class="capability-section">
                        <div class="capability-section-title">Tools (${tools.length})</div>
                        <div class="capability-list capability-scroll">${toolRows}</div>
                    </section>
                </section>

                </div><!-- /.settings-content -->
                </div><!-- /.settings-layout -->
            `;

            const settingsStorageKey = "nexus-settings";
            let savedSettings = {};
            try {
                savedSettings = JSON.parse(localStorage.getItem(settingsStorageKey) || "{}");
            } catch {
                savedSettings = {};
            }
            controlCenterBody.querySelectorAll("[data-setting-key]").forEach(input => {
                const key = input.dataset.settingKey;
                if (Object.prototype.hasOwnProperty.call(savedSettings, key)) {
                    if (input.type === "checkbox") input.checked = Boolean(savedSettings[key]);
                    else input.value = savedSettings[key];
                }
                input.addEventListener("change", () => {
                    savedSettings[key] = input.type === "checkbox" ? input.checked : input.value;
                    localStorage.setItem(settingsStorageKey, JSON.stringify(savedSettings));
                    if (key === "intelligence") {
                        localStorage.setItem("nexus-intelligence", input.value);
                    }
                    if (key === "theme") {
                        /* Apply immediately and remember the choice. */
                        window.setNexusTheme(input.value);
                    }
                });
            });

            /* Populate the dedicated Memory settings panel from the local store. */
            const memoryList = controlCenterBody.querySelector("#memoryList");
            if (memoryList) {
                apiRequest("/api/memories")
                    .then(response => response.json())
                    .then(memories => {
                        const list = Array.isArray(memories) ? memories : [];
                        if (!list.length) {
                            memoryList.innerHTML = '<p class="capability-muted">Nothing remembered yet. Tell Nexus something worth keeping and it will appear here.</p>';
                            return;
                        }
                        memoryList.innerHTML = list.map(item => `
                            <div class="capability-row">
                                <span class="capability-row-content">
                                    <strong>${escapeHtml(item.key)}</strong>
                                    <small>${escapeHtml(String(item.value || "").slice(0, 120))}</small>
                                </span>
                                <button type="button" class="capability-action-button" data-forget-memory="${escapeHtml(item.key)}">Forget</button>
                            </div>
                        `).join("");

                        memoryList
                            .querySelectorAll("[data-forget-memory]")
                            .forEach(button => {
                                button.addEventListener("click", async () => {
                                    const key = button.dataset.forgetMemory;
                                    button.disabled = true;
                                    try {
                                        await apiRequest(
                                            "/api/memory/" + encodeURIComponent(key),
                                            { method: "DELETE" }
                                        );
                                        showCapabilityNotice("Forgot " + key + ".");
                                        button.closest(".capability-row")?.remove();
                                    } catch (error) {
                                        button.disabled = false;
                                        showCapabilityNotice("Could not forget: " + error.message);
                                    }
                                });
                            });
                    })
                    .catch(error => {
                        memoryList.innerHTML = `<p class="capability-muted">Could not load memories: ${escapeHtml(error.message)}</p>`;
                    });
            }

            /*
            Read a single saved setting.

            Declared here, ahead of every block that uses it, because
            these are `const` arrow functions: referencing one before
            its declaration throws (temporal dead zone) and silently
            empties the whole Settings panel.
            */
            const readStoredSettingsValue = key => {
                try {
                    const all = JSON.parse(localStorage.getItem("nexus-settings") || "{}");
                    return all[key];
                } catch {
                    return undefined;
                }
            };

            const readStoredSettings = readStoredSettingsValue;

            /*
            APPEARANCE

            Every control writes a CSS custom property or a body class
            immediately, so the effect is visible without a reload. The
            saved value is re-applied on load by applyAppearance().
            */
            const appearanceControls = {
                accentColor: "--accent",
                backgroundColor: "--bg-main",
                sidebarColor: "--bg-sidebar"
            };

            Object.entries(appearanceControls).forEach(([key, variable]) => {
                const input = controlCenterBody.querySelector("#" + key);
                if (!input) return;

                const stored = readStoredSettingsValue(key);
                if (stored) input.value = stored;

                input.addEventListener("input", () => {
                    document.documentElement.style.setProperty(variable, input.value);
                });
            });

            /*
            Reset copy for the three colour pickers. The default comes
            from the stylesheet, so clearing the inline property returns
            to it rather than hard-coding a value here.
            */
            const colourResets = {
                "reset-accent": "--accent",
                "reset-background": "--bg-main",
                "reset-sidebar": "--bg-sidebar"
            };

            Object.entries(colourResets).forEach(([action, variable]) => {
                controlCenterBody
                    .querySelectorAll('[data-settings-action="' + action + '"]')
                    .forEach(button => {
                        button.addEventListener("click", () => {
                            /*
                            Clearing the inline property is what actually
                            restores the stylesheet default. The swatch is
                            also moved back to that default so the picker
                            matches, but the `input` handler must NOT be
                            re-dispatched — doing so re-applied the colour
                            immediately and cancelled the reset.
                            */
                            document.documentElement.style.removeProperty(variable);

                            const key = variable === "--accent"
                                ? "accentColor"
                                : variable === "--bg-main"
                                    ? "backgroundColor"
                                    : "sidebarColor";

                            const fallback = getComputedStyle(document.documentElement)
                                .getPropertyValue(variable).trim() ||
                                (key === "accentColor" ? "#14766d"
                                    : key === "backgroundColor" ? "#fbfaf7" : "#f1f4f0");

                            const input = controlCenterBody.querySelector("#" + key);
                            if (input) input.value = fallback;

                            /* Persist the reset so it survives a reload. */
                            try {
                                const all = JSON.parse(
                                    localStorage.getItem("nexus-settings") || "{}"
                                );
                                delete all[key];
                                localStorage.setItem(
                                    "nexus-settings",
                                    JSON.stringify(all)
                                );
                            } catch { /* storage unavailable */ }

                            showCapabilityNotice(
                                key === "accentColor" ? "Accent reset."
                                    : key === "backgroundColor" ? "Background reset."
                                        : "Sidebar colour reset."
                            );
                        });
                    });
            });

            /* Theme swatches. */
            controlCenterBody
                .querySelectorAll("[data-theme-choice]")
                .forEach(swatch => {
                    swatch.addEventListener("click", () => {
                        const choice = swatch.dataset.themeChoice;
                        document.dispatchEvent(
                            new CustomEvent("nexus:theme-changed", { detail: choice })
                        );
                        markActiveThemeSwatch(choice);
                    });
                });

            function markActiveThemeSwatch(choice) {
                controlCenterBody
                    .querySelectorAll("[data-theme-choice]")
                    .forEach(el => el.classList.toggle("active", el.dataset.themeChoice === choice));
            }
            markActiveThemeSwatch(
                localStorage.getItem("nexus-theme") || "system"
            );

            /*
            Typography, accessibility, and the remaining appearance
            toggles: apply on change via a data attribute on <body> so
            the CSS owns the actual values.
            */
            const bodyAttributes = {
                chatFont: "data-chat-font",
                chatFontSize: "data-chat-font-size",
                codeFontSize: "data-code-font-size"
            };

            Object.entries(bodyAttributes).forEach(([key, attribute]) => {
                const input = controlCenterBody.querySelector("#" + key);
                if (!input) return;

                const stored = readStoredSettingsValue(key);
                if (stored) input.value = stored;

                const apply = () => {
                    if (input.value) {
                        document.body.setAttribute(attribute, input.value);
                    } else {
                        document.body.removeAttribute(attribute);
                    }
                };
                apply();
                input.addEventListener("change", apply);
            });

            const bodyClasses = {
                highContrast: "high-contrast",
                pointerCursors: "pointer-cursors",
                translucentSidebar: "translucent-sidebar",
                reduceMotion: "reduce-motion"
            };

            Object.entries(bodyClasses).forEach(([key, className]) => {
                const input = controlCenterBody.querySelector("#" + key);
                if (!input) return;

                const stored = readStoredSettingsValue(key);
                input.checked = stored === true;

                const apply = () => {
                    document.body.classList.toggle(className, input.checked);
                };
                apply();
                input.addEventListener("change", apply);
            });

            /*
            Keyboard shortcuts catalogue, filtered live.
            */
            const SHORTCUTS = [
                ["Send message", "Enter"],
                ["New line in message", "Shift + Enter"],
                ["New line in message", "Ctrl + Enter"],
                ["New chat", "Ctrl + Shift + O"],
                ["Search chats", "Ctrl + K"],
                ["Open settings", "Ctrl + ,"],
                ["Toggle sidebar", "Ctrl + B"],
                ["Toggle artifacts panel", "Ctrl + Shift + B"],
                ["Focus the composer", "/"],
                ["Stop generating", "Escape"],
                ["Edit last message", "Ctrl + Shift + E"],
                ["Copy last reply", "Ctrl + Shift + C"],
                ["Regenerate reply", "Ctrl + Shift + R"],
                ["Toggle voice input", "Ctrl + M"],
                ["Delete current chat", "Ctrl + Shift + D"],
                ["Previous chat", "Alt + ↑"],
                ["Next chat", "Alt + ↓"],
                ["Scroll to top", "Ctrl + Home"],
                ["Scroll to bottom", "Ctrl + End"],
                ["Open models menu", "Ctrl + Shift + M"]
            ];

            const shortcutList = controlCenterBody.querySelector("#shortcutList");
            const shortcutFilter = controlCenterBody.querySelector("#shortcutFilter");

            if (shortcutList) {
                const renderShortcuts = query => {
                    const term = String(query || "").toLowerCase();
                    const rows = SHORTCUTS.filter(([name, keys]) =>
                        !term ||
                        name.toLowerCase().includes(term) ||
                        keys.toLowerCase().includes(term)
                    );
                    shortcutList.innerHTML = rows.length
                        ? rows.map(([name, keys]) => `
                            <div class="capability-row">
                                <span class="capability-row-content"><strong>${escapeHtml(name)}</strong></span>
                                <kbd class="shortcut-key">${escapeHtml(keys)}</kbd>
                            </div>
                        `).join("")
                        : '<p class="capability-muted">No shortcuts match that filter.</p>';
                };
                renderShortcuts("");
                shortcutFilter?.addEventListener("input", () => {
                    renderShortcuts(shortcutFilter.value);
                });
            }

            /*
            About: versions and runtime.
            */
            const aboutBody = controlCenterBody.querySelector("#aboutBody");
            if (aboutBody) {
                aboutBody.innerHTML = `
                    <div class="capability-row">
                        <span class="capability-row-content"><strong>Jarwis</strong><small>Local-first AI workspace</small></span>
                        <strong>${escapeHtml(data.product?.version || "unknown")}</strong>
                    </div>
                    <div class="capability-row">
                        <span class="capability-row-content"><strong>Active runtime</strong><small>Provider and model in use</small></span>
                        <strong>${escapeHtml(active.type || "unknown")} / ${escapeHtml(active.model || "unknown")}</strong>
                    </div>
                    <div class="capability-row">
                        <span class="capability-row-content"><strong>Browser</strong><small>Rendering engine</small></span>
                        <strong>${escapeHtml(navigator.userAgent.slice(0, 60))}</strong>
                    </div>
                    <div class="capability-row">
                        <span class="capability-row-content"><strong>Platform</strong><small>Reported by the browser</small></span>
                        <strong>${escapeHtml(navigator.platform || "unknown")}</strong>
                    </div>
                `;
            }

            /*
            Profile: fill the form and the usage insights.
            */
            const displayNameInput = controlCenterBody.querySelector("#profileDisplayName");
            if (displayNameInput) {
                const stored = readStoredSettingsValue("displayName");
                if (stored) displayNameInput.value = stored;

                const applyName = () => {
                    const name = displayNameInput.value.trim() || "Jarwis";
                    const label = document.querySelector(".footer-name");
                    if (label) label.textContent = name;
                    const avatar = controlCenterBody.querySelector("#profileAvatar");
                    if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
                };
                applyName();
                displayNameInput.addEventListener("change", applyName);
            }

            const avatarColor = controlCenterBody.querySelector("#profileAvatarColor");
            if (avatarColor) {
                const stored = readStoredSettingsValue("avatarColor");
                if (stored) avatarColor.value = stored;
                const apply = () => {
                    const avatar = controlCenterBody.querySelector("#profileAvatar");
                    if (avatar) avatar.style.background = avatarColor.value;
                };
                apply();
                avatarColor.addEventListener("input", apply);
            }

            const profileUsage = controlCenterBody.querySelector("#profileUsage");
            if (profileUsage) {
                apiRequest("/api/usage")
                    .then(response => response.json())
                    .then(usageData => {
                        const summary = usageData.summary || {};
                        profileUsage.innerHTML = `
                            <div class="metric-grid">
                                <div class="metric-card"><div class="metric-value">${Number(summary.calls || 0)}</div><div class="metric-label">Model calls</div></div>
                                <div class="metric-card"><div class="metric-value">${Number(summary.totalTokens || 0)}</div><div class="metric-label">Tokens</div></div>
                                <div class="metric-card"><div class="metric-value">${Math.round(Number(summary.avgLatencyMs || 0))} ms</div><div class="metric-label">Avg latency</div></div>
                            </div>`;
                    })
                    .catch(() => {
                        profileUsage.innerHTML = '<p class="capability-muted">Usage unavailable.</p>';
                    });
            }

            /*
            Archived chats list, with per-chat restore.

            Exposed as a function so it can be re-run when the tab is
            opened and after archive/unarchive. Loading it only once at
            panel build meant the list went stale the moment the user
            archived something.
            */
            async function reloadArchivedList() {
                const archivedList = controlCenterBody.querySelector("#archivedList");
                if (!archivedList) return;

                try {
                    const response = await apiRequest("/api/chats");
                    const chats = await response.json();
                    const list = Array.isArray(chats) ? chats : (chats.chats || []);
                    const archived = list.filter(c => Number(c.archived) === 1);

                    archivedList.innerHTML = archived.length
                        ? archived.map(chat => `
                            <div class="capability-row">
                                <span class="capability-row-content"><strong>${escapeHtml(chat.title || "Untitled")}</strong><small>Archived</small></span>
                                <button type="button" class="capability-action-button" data-unarchive="${escapeHtml(String(chat.id))}">Unarchive</button>
                            </div>
                        `).join("")
                        : '<p class="capability-muted">No archived chats.</p>';

                    archivedList
                        .querySelectorAll("[data-unarchive]")
                        .forEach(button => {
                            button.addEventListener("click", async () => {
                                button.disabled = true;
                                try {
                                    await apiRequest(
                                        "/api/chat/" + encodeURIComponent(button.dataset.unarchive) + "/archive",
                                        {
                                            method: "POST",
                                            headers: { "Content-Type": "application/json" },
                                            body: JSON.stringify({ archived: false })
                                        }
                                    );
                                    showCapabilityNotice("Chat restored.");
                                    button.closest(".capability-row")?.remove();
                                    await loadChats();
                                    await renderSidebarProjects();
                                } catch (error) {
                                    button.disabled = false;
                                    showCapabilityNotice("Could not restore: " + error.message);
                                }
                            });
                        });
                } catch {
                    archivedList.innerHTML =
                        '<p class="capability-muted">Could not load archived chats.</p>';
                }
            }

            /*
            Expose so the nav handler and archive actions can refresh
            it. The initial load is fired without await: this block is
            synchronous, and an await here would be a syntax error.
            */
            window.__nexusReloadArchived = reloadArchivedList;
            reloadArchivedList();

            /*
            Voice settings: populate the real voices installed on
            this device, and keep the slider readouts in step.
            */
            const voiceSelect = controlCenterBody.querySelector("#voiceSelect");
            if (voiceSelect && "speechSynthesis" in window) {
                const fillVoices = () => {
                    const voices = window.speechSynthesis.getVoices();
                    if (!voices.length) return;
                    const grouped = voices.map(v =>
                        `<option value="${escapeAttribute(v.name)}">${escapeHtml(v.name)} (${escapeHtml(v.lang)})</option>`
                    ).join("");
                    voiceSelect.innerHTML =
                        '<option value="">System default</option>' + grouped;
                };
                fillVoices();
                /* Voices load asynchronously in most browsers. */
                window.speechSynthesis.onvoiceschanged = fillVoices;
            }

            const rateInput = controlCenterBody.querySelector("#voiceRate");
            const rateValue = controlCenterBody.querySelector("#voiceRateValue");
            if (rateInput && rateValue) {
                rateInput.addEventListener("input", () => {
                    rateValue.textContent = Number(rateInput.value).toFixed(1) + "×";
                });
            }

            const pitchInput = controlCenterBody.querySelector("#voicePitch");
            const pitchValue = controlCenterBody.querySelector("#voicePitchValue");
            if (pitchInput && pitchValue) {
                pitchInput.addEventListener("input", () => {
                    pitchValue.textContent = Number(pitchInput.value).toFixed(1);
                });
            }

            /*
            Load the security surfaces: auth posture, API keys, and
            the audit log. Each degrades to a plain message when the
            caller lacks the ADMIN capability, so a viewer never sees
            a broken panel.
            */
            const authStatus = controlCenterBody.querySelector("#authStatus");
            const profileAuthState = controlCenterBody.querySelector("#profileAuthState");
            const profileSignIn = controlCenterBody.querySelector("[data-auth-signin]");
            const profileSignOut = controlCenterBody.querySelector("[data-auth-logout]");
            if (authStatus || profileAuthState) {
                apiRequest("/api/auth/status")
                    .then(response => {
                        if (!response.ok) throw new Error("Could not read the current account session.");
                        return response.json();
                    })
                    .then(status => {
                        const hasAccountSession = Boolean(
                            status.authenticated &&
                            status.user &&
                            status.user.kind !== "loopback"
                        );
                        if (authStatus) {
                            authStatus.innerHTML = `
                                <div class="settings-preference">
                                    <span><strong>Authentication</strong><small>${status.authRequired ? "A signed-in session is required for protected features." : "This local installation can run without an account."}</small></span>
                                    <strong class="${status.authRequired ? "capability-ready" : "capability-muted"}">${status.authRequired ? "Required" : "Local mode"}</strong>
                                </div>
                                <div class="settings-preference">
                                    <span><strong>Current session</strong><small>${escapeHtml(hasAccountSession ? status.user.role : (status.loopbackTrusted ? "trusted local" : "guest"))} access</small></span>
                                    <strong>${escapeHtml(status.user?.username || (status.loopbackTrusted ? "This PC" : "Not signed in"))}</strong>
                                </div>`;
                        }
                        if (profileAuthState) {
                            if (hasAccountSession) {
                                profileAuthState.innerHTML = `
                                    <span class="welcome-readiness-dot is-ready"></span>
                                    <span><strong>Signed in as ${escapeHtml(status.user.username)}</strong><small>${escapeHtml(status.user.role)} account · this browser session</small></span>
                                `;
                            } else if (status.loopbackTrusted || status.user?.kind === "loopback") {
                                profileAuthState.innerHTML = `
                                    <span class="welcome-readiness-dot is-ready"></span>
                                    <span><strong>Local access is active</strong><small>This Jarwis server trusts requests from this PC; an account is optional.</small></span>
                                `;
                            } else {
                                profileAuthState.innerHTML = `
                                    <span class="welcome-readiness-dot is-idle"></span>
                                    <span><strong>No account session</strong><small>Sign in to continue to protected Jarwis features.</small></span>
                                `;
                            }
                        }
                        if (profileSignIn) profileSignIn.hidden = !status.authRequired || hasAccountSession;
                        if (profileSignOut) profileSignOut.hidden = !hasAccountSession;
                        loadSecurityManagement(
                            status.loopbackTrusted === true ||
                            (status.authenticated === true &&
                                ["owner", "admin"].includes(status.user?.role))
                        );
                    })
                    .catch(error => {
                        if (authStatus) authStatus.innerHTML = `<p class="capability-muted">${escapeHtml(error.message)}</p>`;
                        if (profileAuthState) profileAuthState.innerHTML = `<p class="capability-muted">${escapeHtml(error.message)}</p>`;
                        loadSecurityManagement(
                            (permissions.granted || []).includes("ADMIN")
                        );
                    });
            }

            profileSignIn?.addEventListener("click", () => {
                requestLogin();
            });

            profileSignOut?.addEventListener("click", async () => {
                profileSignOut.disabled = true;
                profileSignOut.textContent = "Signing out…";
                try {
                    const response = await fetch(`${API_BASE}/api/auth/logout`, {
                        method: "POST",
                        credentials: "same-origin"
                    });
                    if (!response.ok) throw new Error(await getResponseError(response));
                    window.location.reload();
                } catch (error) {
                    profileSignOut.disabled = false;
                    profileSignOut.textContent = "Sign out";
                    showCapabilityNotice(`Could not sign out: ${error.message}`);
                }
            });

            const loadSecurityManagement = canManageSecurity => {
                const apiKeyList = controlCenterBody.querySelector("#apiKeyList");
                if (apiKeyList && canManageSecurity) {
                apiRequest("/api/auth/keys")
                    .then(response => {
                        if (!response.ok) throw new Error("not authorized");
                        return response.json();
                    })
                    .then(data => {
                        const keys = data.keys || [];
                        apiKeyList.innerHTML = keys.length
                            ? keys.map(key => `
                                <div class="capability-row">
                                    <span class="capability-row-content">
                                        <strong>${escapeHtml(key.label)}</strong>
                                        <small>${escapeHtml(key.role)} · ${escapeHtml(key.prefix)}… · created ${escapeHtml(String(key.createdAt || "").slice(0, 10))}</small>
                                    </span>
                                    <button type="button" class="capability-action-button" data-revoke-key="${escapeHtml(key.id)}">Revoke</button>
                                </div>
                            `).join("")
                            : '<p class="capability-muted">No API keys yet.</p>';

                        apiKeyList
                            .querySelectorAll("[data-revoke-key]")
                            .forEach(button => {
                                button.addEventListener("click", async () => {
                                    button.disabled = true;
                                    try {
                                        await apiRequest(
                                            "/api/auth/keys/" + encodeURIComponent(button.dataset.revokeKey),
                                            { method: "DELETE" }
                                        );
                                        showCapabilityNotice("Key revoked.");
                                        button.closest(".capability-row")?.remove();
                                    } catch (error) {
                                        button.disabled = false;
                                        showCapabilityNotice("Could not revoke: " + error.message);
                                    }
                                });
                            });
                    })
                    .catch(error => {
                        apiKeyList.innerHTML = `<p class="capability-muted">Could not load API keys: ${escapeHtml(error.message)}</p>`;
                    });
                } else if (apiKeyList) {
                    apiKeyList.innerHTML = '<p class="capability-muted">Managing API keys requires the owner or admin role.</p>';
                }

                const auditLogList = controlCenterBody.querySelector("#auditLogList");
                if (auditLogList && canManageSecurity) {
                    apiRequest("/api/auth/audit?limit=25")
                    .then(response => {
                        if (!response.ok) throw new Error("not authorized");
                        return response.json();
                    })
                    .then(data => {
                        const entries = data.entries || [];
                        auditLogList.innerHTML = entries.length
                            ? entries.map(entry => `
                                <div class="activity-item">
                                    <span class="activity-text">${escapeHtml(entry.action)}${entry.target ? " · " + escapeHtml(entry.target) : ""}</span>
                                    <span class="activity-time">${escapeHtml(String(entry.at || "").slice(11, 19))}</span>
                                </div>
                            `).join("")
                            : '<p class="capability-muted">No audit entries yet.</p>';
                    })
                    .catch(error => {
                        auditLogList.innerHTML = `<p class="capability-muted">Could not load the audit log: ${escapeHtml(error.message)}</p>`;
                    });
                } else if (auditLogList) {
                    auditLogList.innerHTML = '<p class="capability-muted">Reading the audit log requires the owner or admin role.</p>';
                }
            };

            /*
            One visibility mechanism: the clicked nav item becomes
            active and the matching panel becomes active. Every
            other panel is hidden by .settings-panel-section's
            default display:none.
            */
            controlCenterBody
                .querySelectorAll("[data-settings-section]")
                .forEach(button => {
                    button.addEventListener("click", () => {
                        const section = button.dataset.settingsSection;
                        controlCenterBody
                            .querySelectorAll("[data-settings-section]")
                            .forEach(item => item.classList.toggle("active", item === button));
                        controlCenterBody
                            .querySelectorAll("[data-settings-panel]")
                            .forEach(panel => panel.classList.toggle("active", panel.dataset.settingsPanel === section));
                        /* Keep the modal from jumping between sections. */
                        controlCenterBody.scrollTop = 0;

                        /*
                        These panels read live server state, so refresh
                        them each time they are opened rather than
                        showing whatever was true when Settings built.
                        */
                        if (section === "archived") {
                            window.__nexusReloadArchived?.();
                        }
                        if (section === "profile") {
                            window.__nexusReloadProfile?.();
                        }
                    });
                });

            controlCenterBody
                .querySelectorAll("[data-settings-view]")
                .forEach(button => {
                    button.addEventListener("click", () => {
                        closeControlCenter();
                        closeAccountMenu();
                        showProductView(button.dataset.settingsView);
                        if (window.matchMedia("(max-width: 900px)").matches) {
                            sidebar.classList.add("collapsed");
                            syncSidebarState();
                        }
                    });
                });

            /*
            Settings action buttons do real work rather than
            showing a placeholder notice. Each action maps to a
            concrete behaviour a user can observe.
            */
            controlCenterBody
                .querySelectorAll("[data-settings-action]")
                .forEach(button => {
                    button.addEventListener("click", async () => {
                        const action = button.dataset.settingsAction;

                        /*
                        Read a line aloud using the voice, speed, and
                        pitch chosen in this panel — so the test
                        reflects the actual settings.
                        */
                        if (action === "voice") {
                            if (!("speechSynthesis" in window)) {
                                showCapabilityNotice(
                                    "Read aloud is not supported by this browser."
                                );
                                return;
                            }

                            const utterance = new SpeechSynthesisUtterance(
                                "Nexus voice is working. This is the selected voice."
                            );

                            const chosenVoice = document.getElementById("voiceSelect")?.value;
                            if (chosenVoice) {
                                const match = window.speechSynthesis
                                    .getVoices()
                                    .find(v => v.name === chosenVoice);
                                if (match) utterance.voice = match;
                            }

                            utterance.rate = Number(
                                document.getElementById("voiceRate")?.value || 1
                            );
                            utterance.pitch = Number(
                                document.getElementById("voicePitch")?.value || 1
                            );

                            window.speechSynthesis.cancel();
                            window.speechSynthesis.speak(utterance);
                            showCapabilityNotice("Testing read aloud.");
                            return;
                        }

                        /*
                        Dictation test: start recognition for a moment
                        so the user can see it is actually listening.
                        */
                        if (action === "test-dictation") {
                            const Recognition =
                                window.SpeechRecognition ||
                                window.webkitSpeechRecognition;

                            if (!Recognition) {
                                showCapabilityNotice(
                                    "This browser does not support speech recognition."
                                );
                                return;
                            }

                            try {
                                const recognition = new Recognition();
                                recognition.lang =
                                    document.getElementById("dictationLanguage")?.value ||
                                    "en-US";
                                recognition.interimResults = true;
                                recognition.onresult = event => {
                                    const said = event.results?.[0]?.[0]?.transcript;
                                    if (said) {
                                        messageInput.value = said;
                                        autoResizeTextarea();
                                    }
                                };
                                recognition.onerror = () => {
                                    showCapabilityNotice("Dictation could not start (microphone permission?).");
                                };
                                recognition.start();
                                showCapabilityNotice("Listening… speak now.");
                                setTimeout(() => {
                                    try { recognition.stop(); } catch { /* already stopped */ }
                                }, 5000);
                            } catch (error) {
                                showCapabilityNotice("Dictation failed: " + error.message);
                            }
                            return;
                        }

                        /* Ask the browser for notification permission. */
                        if (action === "request-notifications") {
                            const status = document.getElementById("notificationStatus");
                            if (!("Notification" in window)) {
                                if (status) status.textContent = "This browser does not support notifications.";
                                return;
                            }
                            const permission = await Notification.requestPermission();
                            if (status) {
                                status.textContent = permission === "granted"
                                    ? "Notifications are allowed."
                                    : "Notifications were not allowed.";
                            }
                            return;
                        }

                        /* Fire one notification so the user can see it. */
                        if (action === "test-notification") {
                            const status = document.getElementById("notificationStatus");
                            if (!("Notification" in window) || Notification.permission !== "granted") {
                                if (status) status.textContent = "Allow notifications first.";
                                return;
                            }
                            new Notification("Jarwis", {
                                body: "Notifications are working."
                            });
                            if (status) status.textContent = "Test notification sent.";
                            return;
                        }

                        /* Download every conversation as JSON. */
                        if (action === "export-chats") {
                            try {
                                const response = await apiRequest("/api/chats");
                                const chats = await response.json();
                                const blob = new Blob(
                                    [JSON.stringify(chats, null, 2)],
                                    { type: "application/json" }
                                );
                                const url = URL.createObjectURL(blob);
                                const link = document.createElement("a");
                                link.href = url;
                                link.download = "nexus-conversations.json";
                                /*
                                The anchor must be in the document for the
                                programmatic click to start a download in
                                every browser, and the object URL must stay
                                alive until the download has begun —
                                revoking it synchronously cancels it.
                                */
                                link.style.display = "none";
                                document.body.appendChild(link);
                                link.click();
                                link.remove();
                                setTimeout(() => URL.revokeObjectURL(url), 10000);
                                showCapabilityNotice("Conversations exported.");
                            } catch (error) {
                                showCapabilityNotice("Export failed: " + error.message);
                            }
                            return;
                        }

                        /* Clear saved memories. */
                        if (action === "clear-memories") {
                            if (!window.confirm("Delete every saved memory? This cannot be undone.")) return;
                            try {
                                const response = await apiRequest("/api/memories", { method: "DELETE" });
                                if (!response.ok) throw new Error(await getResponseError(response));
                                showCapabilityNotice("Saved memories cleared.");
                            } catch (error) {
                                showCapabilityNotice("Could not clear memories: " + error.message);
                            }
                            return;
                        }

                        /* Delete every conversation. */
                        if (action === "delete-all-chats") {
                            if (!window.confirm("Delete every conversation? This cannot be undone.")) return;
                            try {
                                const response = await apiRequest("/api/chats", {
                                    method: "DELETE"
                                });
                                if (!response.ok) throw new Error(await getResponseError(response));
                                await loadChats();
                                showCapabilityNotice("All conversations deleted.");
                            } catch (error) {
                                showCapabilityNotice("Could not delete conversations: " + error.message);
                            }
                            return;
                        }

                        /* Create an API key and show it exactly once. */
                        if (action === "create-key") {
                            const label = document.getElementById("newKeyLabel")?.value || "";
                            const role = document.getElementById("newKeyRole")?.value || "owner";
                            if (!label.trim()) {
                                showCapabilityNotice("Name the key first.");
                                return;
                            }
                            try {
                                const response = await apiRequest("/api/auth/keys", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ label: label.trim(), role })
                                });
                                if (!response.ok) throw new Error(await getResponseError(response));
                                const created = await response.json();

                                /* Show the plaintext key once, with a copy action. */
                                const list = document.getElementById("apiKeyList");
                                if (list) {
                                    const banner = document.createElement("div");
                                    banner.className = "capability-row";
                                    banner.innerHTML = `
                                        <span class="capability-row-content">
                                            <strong>New key — copy it now</strong>
                                            <small><code>${escapeHtml(created.key)}</code></small>
                                        </span>
                                        <button type="button" class="capability-action-button" data-copy-key>Copy</button>`;
                                    list.prepend(banner);
                                    banner.querySelector("[data-copy-key]")?.addEventListener("click", () => {
                                        navigator.clipboard?.writeText(created.key);
                                        showCapabilityNotice("Key copied.");
                                    });
                                }
                            } catch (error) {
                                showCapabilityNotice("Could not create key: " + error.message);
                            }
                            return;
                        }

                        /* Archive or restore every conversation. */
                        if (action === "archive-all" || action === "unarchive-all") {
                            const archived = action === "archive-all";
                            try {
                                const response = await apiRequest("/api/chats/archive", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ archived })
                                });
                                if (!response.ok) throw new Error(await getResponseError(response));
                                showCapabilityNotice(
                                    archived ? "All conversations archived." : "All conversations restored."
                                );
                                await loadChats();
                                /* Refresh both lists so the change is visible. */
                                await window.__nexusReloadArchived?.();
                                await renderSidebarProjects();
                            } catch (error) {
                                if (error.message.includes("404") || error.message.includes("not found")) {
                                    showCapabilityNotice("Archiving is not available on this build.");
                                } else {
                                    showCapabilityNotice("Archive failed: " + error.message);
                                }
                            }
                            return;
                        }

                        /* Review the data-controls section. */
                        if (action === "data") {
                            controlCenterBody
                                .querySelector('[data-settings-section="data"]')
                                ?.click();
                            return;
                        }

                        showCapabilityNotice("This control is not available yet.");
                    });
                });

            controlCenterBody.querySelectorAll("[data-discover-provider]").forEach(button => {
                button.addEventListener("click", async () => {
                    const provider = button.dataset.discoverProvider;
                    button.disabled = true;
                    button.textContent = "Discovering...";
                    try {
                        const response = await apiRequest(
                            `/api/providers/models?provider=${encodeURIComponent(provider)}`
                        );
                        const result = await response.json();
                        if (!response.ok) {
                            throw new Error(result.error || `Model discovery failed (${response.status}).`);
                        }
                        await loadCapabilities();
                        showCapabilityNotice(
                            `Discovered ${result.models.length} models from ${provider}.`
                        );
                    } catch (error) {
                        button.disabled = false;
                        button.textContent = "Retry discovery";
                        showCapabilityNotice(error.message);
                    }
                });
            });

            controlCenterBody.querySelector("[data-save-provider-keys]")?.addEventListener("click", async event => {
                const button = event.currentTarget;
                const fields = [...controlCenterBody.querySelectorAll("[data-provider-key-env]")];
                const values = Object.fromEntries(fields
                    .map(input => [input.dataset.providerKeyEnv, input.value.trim()])
                    .filter(([, value]) => value));
                if (!Object.keys(values).length) {
                    showCapabilityNotice("Paste at least one new provider API key first.");
                    return;
                }

                button.disabled = true;
                button.textContent = "Saving securely…";
                try {
                    const response = await apiRequest("/api/settings/providers", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(values)
                    });
                    const result = await response.json();
                    if (!response.ok) {
                        throw new Error(result.error || `Could not save API keys (${response.status}).`);
                    }
                    fields.forEach(input => { input.value = ""; });
                    await loadCapabilities();
                    showCapabilityNotice("API keys saved on this PC. Test a provider connection to discover available models.");
                } catch (error) {
                    showCapabilityNotice(`Could not save API keys: ${error.message}`);
                } finally {
                    button.disabled = false;
                    button.textContent = "Save API keys on this PC";
                }
            });

            controlCenterBody.querySelector("#paidAutoRouting")?.addEventListener("change", async event => {
                const checkbox = event.currentTarget;
                if (checkbox.checked &&
                    !window.confirm("Paid models may charge your provider account. Allow Jarwis to select paid models automatically?")) {
                    checkbox.checked = false;
                    return;
                }
                checkbox.disabled = true;
                try {
                    const response = await apiRequest("/api/settings/providers", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            NEXUS_AUTO_ALLOW_PAID_API: checkbox.checked
                        })
                    });
                    const result = await response.json();
                    if (!response.ok) {
                        throw new Error(result.error || `Could not save this preference (${response.status}).`);
                    }
                    showCapabilityNotice(
                        checkbox.checked
                            ? "Paid-model automatic routing enabled."
                            : "Paid-model automatic routing disabled."
                    );
                } catch (error) {
                    checkbox.checked = !checkbox.checked;
                    showCapabilityNotice(`Could not update paid-model routing: ${error.message}`);
                } finally {
                    checkbox.disabled = false;
                }
            });

            controlCenterBody.querySelectorAll("[data-check-provider]").forEach(button => {
                button.addEventListener("click", async () => {
                    const provider = button.dataset.checkProvider;
                    const result = controlCenterBody.querySelector(
                        `[data-provider-health="${CSS.escape(provider)}"]`
                    );
                    button.disabled = true;
                    button.textContent = "Checking...";
                    if (result) result.textContent = "Checking provider credentials and availability…";
                    try {
                        const response = await apiRequest(
                            `/api/providers/${encodeURIComponent(provider)}/health`
                        );
                        const health = await response.json();
                        if (result) {
                            result.textContent = health.ok
                                ? `Connected · ${health.models.length} model(s) discovered`
                                : `Not connected · ${health.reason || health.error || `HTTP ${response.status}`}`;
                            result.classList.toggle("is-error", !health.ok);
                            result.classList.toggle("is-ok", health.ok);
                        }
                        if (!response.ok && !health.reason) {
                            throw new Error(health.error || `Connection check failed (${response.status}).`);
                        }
                    } catch (error) {
                        if (result) {
                            result.textContent = `Connection check failed · ${error.message}`;
                            result.classList.add("is-error");
                        }
                    } finally {
                        button.disabled = false;
                        button.textContent = "Test connection";
                    }
                });
            });

            controlCenterBody
                .querySelectorAll("[data-run-automation]")
                .forEach(button => {
                    button.addEventListener("click", async () => {
                        const name =
                            button.getAttribute(
                                "data-run-automation"
                            );

                        button.disabled = true;
                        button.textContent = "Running...";

                        try {
                            const response = await apiRequest(
                                `/api/automations/${encodeURIComponent(name)}/run`,
                                {
                                    method: "POST",
                                    headers: {
                                        "Content-Type": "application/json"
                                    },
                                    body: JSON.stringify({
                                        input: {},
                                        trigger: "manual"
                                    })
                                }
                            );

                            const result = await response.json();
                            button.textContent =
                                result.approvalRequired
                                    ? "Approval needed"
                                    : "Started";
                        } catch (error) {
                            button.disabled = false;
                            button.textContent = "Retry";
                            console.error(
                                "Automation run failed:",
                                error
                            );
                        }
                    });
                });

            controlCenterBody.querySelectorAll("[data-install-local-model]").forEach(button => {
                button.addEventListener("click", async () => {
                    const input = controlCenterBody.querySelector("#localModelName");
                    const model = input?.value.trim();
                    if (!model) return showCapabilityNotice("Enter an Ollama model name to install.");
                    button.disabled = true;
                    button.textContent = "Installing...";
                    try {
                        const estimateResponse = await apiRequest(
                            `/api/local-models/estimate?model=${encodeURIComponent(model)}`
                        );
                        if (!estimateResponse.ok) {
                            throw new Error(await getResponseError(estimateResponse));
                        }
                        const estimate = await estimateResponse.json();
                        if (
                            (!estimate.knownEstimate || !estimate.fitsAvailableRam) &&
                            !window.confirm(
                                estimate.knownEstimate
                                    ? `This model is estimated to need ${estimate.requiredMemoryGB} GB RAM, while this device has ${estimate.availableMemoryGB} GB. It may run slowly or fail. Install anyway?`
                                    : "Nexus cannot estimate this model's RAM use. It may run slowly or fail. Install anyway?"
                            )
                        ) {
                            button.disabled = false;
                            button.textContent = "Install";
                            return;
                        }
                        const response = await apiRequest("/api/local-models/pull", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ model })
                        });
                        if (!response.ok) throw new Error(await getResponseError(response));
                        const result = await response.json();
                        showCapabilityNotice(result.memoryWarning || `${model} is installed locally.`);
                        loadCapabilities();
                    } catch (error) {
                        button.disabled = false;
                        button.textContent = "Install";
                        showCapabilityNotice(error.message);
                    }
                });
            });

            /*
            Advanced execution controls. Every field is restored from
            the saved config, echoed to its slider readout, and saved
            on both `input` (for live sliders) and `change`.
            */
            const advancedFields = {
                enabled: controlCenterBody.querySelector("#advancedModeEnabled"),
                temperature: controlCenterBody.querySelector("#advancedTemperature"),
                topP: controlCenterBody.querySelector("#advancedTopP"),
                maxTokens: controlCenterBody.querySelector("#advancedMaxTokens"),
                topK: controlCenterBody.querySelector("#advancedTopK"),
                repetitionPenalty: controlCenterBody.querySelector("#advancedRepetitionPenalty"),
                maxAgentSteps: controlCenterBody.querySelector("#advancedMaxSteps"),
                seed: controlCenterBody.querySelector("#advancedSeed")
            };

            const readouts = {
                temperature: ["#tempValue", v => Number(v).toFixed(1)],
                topP: ["#topPValue", v => Number(v).toFixed(2)],
                repetitionPenalty: ["#repPenaltyValue", v => Number(v).toFixed(2)]
            };

            if (advancedFields.enabled) {
                advancedFields.enabled.checked = Boolean(advancedExecutionConfig.enabled);

                Object.entries(advancedFields).forEach(([key, input]) => {
                    if (!input) return;

                    /* Restore a saved value, else keep the markup default. */
                    if (key !== "enabled" && advancedExecutionConfig[key] != null) {
                        input.value = advancedExecutionConfig[key];
                    }

                    /* Keep slider readouts in step with the thumb. */
                    const updateReadout = () => {
                        const entry = readouts[key];
                        if (!entry) return;
                        const el = controlCenterBody.querySelector(entry[0]);
                        if (el) el.textContent = entry[1](input.value);
                    };
                    updateReadout();

                    const save = () => {
                        advancedExecutionConfig[key] =
                            key === "enabled" ? input.checked : input.value;
                        localStorage.setItem(
                            "nexus-advanced-execution",
                            JSON.stringify(advancedExecutionConfig)
                        );
                    };

                    input.addEventListener("input", () => {
                        updateReadout();
                        save();
                    });
                    input.addEventListener("change", save);
                });
            }

            /*
            General behaviour toggles that change how the app works
            right away rather than only being stored.
            */
            const enterToSend = controlCenterBody.querySelector("#settingsEnterToSend");

            if (enterToSend) {
                /*
                Restore the saved choice and publish it immediately, so
                the composer obeys it before the toggle is ever touched.
                (The generic data-setting-key handler stores the value but
                does not restore it, and only runs on `change`.)
                */
                enterToSend.checked = readStoredSettingsValue("enterToSend") !== false;
                window.__nexusEnterToSend = enterToSend.checked;

                enterToSend.addEventListener("change", () => {
                    window.__nexusEnterToSend = enterToSend.checked;
                });
            }

            const wideLayout = controlCenterBody.querySelector("#settingsWide");

            if (wideLayout) {
                wideLayout.checked = readStoredSettingsValue("wideLayout") === true;
                document.body.classList.toggle("wide-layout", wideLayout.checked);

                wideLayout.addEventListener("change", () => {
                    document.body.classList.toggle("wide-layout", wideLayout.checked);
                });
            }

            /* Re-apply stored general behaviour on first paint. */
            if (readStoredSettingsValue("wideLayout") === true) {
                document.body.classList.add("wide-layout");
            }
            window.__nexusEnterToSend = readStoredSettingsValue("enterToSend") !== false;

            controlCenterBody.querySelectorAll("[data-remove-local-model]").forEach(button => {
                button.addEventListener("click", async () => {
                    const model = button.dataset.removeLocalModel;
                    if (!window.confirm(`Remove local model ${model}? This frees its downloaded files.`)) return;
                    button.disabled = true;
                    try {
                        const response = await apiRequest("/api/local-models/delete", {
                            method: "POST", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ model, confirm: true })
                        });
                        if (!response.ok) throw new Error(await getResponseError(response));
                        showCapabilityNotice(`${model} was removed.`);
                        loadCapabilities();
                    } catch (error) {
                        button.disabled = false;
                        showCapabilityNotice(error.message);
                    }
                });
            });

            /*
            The model catalog just changed. Refresh the
            ChatGPT-style picker so it lists what is actually
            configured.
            */
            if (typeof window.refreshModelMenu === "function") {
                window.refreshModelMenu();
            }
        }

        modelSelector.addEventListener(
            "change",
            () => {
                const role = modelSelector.value;
                localStorage.setItem("nexus-model-role", role);
                if (role === "auto") {
                    selectedModelConfig = { provider: null, model: null };
            } else if (role.startsWith("model:")) {
                const [, provider, ...modelParts] = role.split(":");
                selectedModelConfig = {
                    provider,
                    model: modelParts.join(":")
                };
            } else {
                const selectedRole = roles.find(item => item.role === role);
                selectedModelConfig = selectedRole
                    ? { provider: selectedRole.provider, model: selectedRole.model }
                    : { provider: null, model: null };
            }
            loadCapabilities();
        }
        );

        controlCenterBody.addEventListener("change", event => {
            if (event.target?.id !== "imageModelSelector") return;
            selectedImageModel = event.target.value;
            localStorage.setItem("nexus-image-model", selectedImageModel);
        });

        function escapeHtml(value) {
            return String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

function showAttachmentMenu() {
    document
        .querySelector(".attachment-menu")
        ?.remove();

    const menu = document.createElement("div");
    menu.className = "attachment-menu";
    menu.innerHTML = `
        <button type="button" data-attachment-action="local">
            <span>▧</span> Upload from this device
        </button>
        <button type="button" data-attachment-action="drive">
            <span>◫</span> Add from Drive
        </button>
        <button type="button" data-attachment-action="github">
            <span>⌘</span> Add GitHub repository
        </button>
    `;

    attachmentButton.parentElement.appendChild(menu);

    menu.querySelectorAll("[data-attachment-action]")
        .forEach(action => {
            action.addEventListener("click", () => {
                const type =
                    action.getAttribute(
                        "data-attachment-action"
                    );

                menu.remove();

                if (type === "local") {
                    attachmentInput.click();
                    return;
                }

                /*
                Cloud attachments check the real connector state rather
                than assuming. A connected connector opens the picker; an
                unconnected one says exactly what is missing and offers a
                one-click route to Settings.
                */
                if (type === "drive" || type === "github") {
                    handleCloudAttachment(type);
                    return;
                }
            });
        });
}

/*
Resolve whether a named connector is actually connected, then act.
*/
async function handleCloudAttachment(type) {
    const connectorId = type === "drive" ? "google-drive" : "github";
    const label = type === "drive" ? "Google Drive" : "GitHub";

    try {
        const response = await apiRequest("/api/integrations");
        const data = await response.json();
        const list = Array.isArray(data) ? data : (data.integrations || []);

        const connector = list.find(item =>
            String(item.id || "").toLowerCase().includes(connectorId) ||
            String(item.name || "").toLowerCase().includes(type)
        );

        if (connector && connector.state?.status === "connected") {
            showCapabilityNotice(
                label + " is connected. Choose a file from your device to upload into the workspace."
            );
            attachmentInput.click();
            return;
        }

        /*
        Not connected: open Settings on the Integrations section so the
        user can fix it in one step.
        */
        showCapabilityNotice(
            label + " is not connected yet. Opening Integrations…"
        );
        if (typeof openControlCenter === "function") {
            openControlCenter();
            setTimeout(() => {
                document
                    .querySelector('[data-settings-section="integrations"]')
                    ?.click();
            }, 400);
        }
    } catch (error) {
        showCapabilityNotice(
            "Could not check " + label + ": " + error.message
        );
    }
}

/*
Open a real file picker and resolve with the chosen File objects.

Uses a throwaway input element so it can be triggered from any
button, and rejects on cancel by resolving an empty list when the
picker closes without a selection.
*/
function pickFilesForUpload() {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = true;
        input.style.display = "none";

        let settled = false;

        const finish = files => {
            if (settled) return;
            settled = true;
            input.remove();
            resolve(files);
        };

        input.addEventListener("change", () => {
            finish(Array.from(input.files || []));
        });

        /*
        A cancelled picker fires no change event in most engines. The
        window regaining focus is the reliable signal that the dialog
        closed, so treat a focus regain with no selection as a cancel.
        */
        window.addEventListener(
            "focus",
            () => setTimeout(() => finish(Array.from(input.files || [])), 400),
            { once: true }
        );

        document.body.appendChild(input);
        input.click();
    });
}

/*
Read the personalization preferences saved by Settings.

These travel with every chat request so custom instructions,
response style, and the memory toggle always apply, even after
a reload.
*/
function nexusPreferences() {
    let saved = {};
    try {
        saved = JSON.parse(localStorage.getItem("nexus-settings") || "{}");
    } catch {
        saved = {};
    }

    return {
        customAbout: saved.customAbout || "",
        customStyle: saved.customStyle || "",
        responseStyle: saved.responseStyle || "default",
        useMemory: saved.useMemory !== false,
        useConversationContext: saved.useConversationContext !== false,
        useProjectContext: saved.useProjectContext !== false
    };
}

function readFileForUpload(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const result = String(reader.result || "");
            const comma = result.indexOf(",");

            resolve({
                name: file.name,
                content:
                    comma === -1
                        ? result
                        : result.slice(comma + 1),
                encoding: "base64"
            });
        };

        reader.onerror = () => {
            reject(
                new Error(`Could not read ${file.name}.`)
            );
        };

        reader.readAsDataURL(file);
    });
}

function showCapabilityNotice(message) {
    const notice = document.createElement("div");
    notice.className = "composer-notice";
    notice.textContent = message;
    document.body.appendChild(notice);

    setTimeout(() => notice.remove(), 5000);
}

function setVoiceStatus(message) {
    const status = document.getElementById("voiceModeStatus");
    if (status) status.textContent = message;
}

function scheduleVoiceListening(delay = 350) {
    clearTimeout(voiceRestartTimer);
    voiceRestartTimer = setTimeout(() => {
        if (
            voiceChatMode &&
            !voiceInputPaused &&
            !voiceInputPending &&
            !voiceSpeaking &&
            !isSending
        ) {
            listenForVoiceInput();
        }
    }, delay);
}

function startVoiceConversation() {
    const Recognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    if (!Recognition) {
        showCapabilityNotice(
            "Voice input is not supported by this browser. Try Chrome or Edge, or use the keyboard."
        );
        return;
    }
    if (!("speechSynthesis" in window)) {
        showCapabilityNotice(
            "Spoken replies are not supported by this browser. Use a browser with speech output or read replies on screen."
        );
        return;
    }

    if (voiceChatMode) {
        toggleVoiceListening();
        return;
    }

    voiceChatMode = true;
    voiceInputPaused = false;
    voiceInputPending = false;
    voiceSpeaking = false;
    const modal = document.getElementById("voiceModeModal");
    modal?.classList.add("open");
    modal?.setAttribute("aria-hidden", "false");
    if (voiceButton) {
        voiceButton.classList.add("active");
        voiceButton.setAttribute("aria-label", "Voice conversation active");
        voiceButton.title = "Voice conversation active";
    }
    document.getElementById("voiceModeTranscript").textContent =
        "Start speaking when the microphone is listening.";
    document.getElementById("voiceMicToggleButton").textContent =
        "Pause microphone";
    document.getElementById("voiceEndButton")?.focus();
    listenForVoiceInput();
}

function toggleVoiceListening() {
    if (!voiceChatMode) return;
    voiceInputPaused = !voiceInputPaused;
    const button = document.getElementById("voiceMicToggleButton");
    if (voiceInputPaused) {
        clearTimeout(voiceRestartTimer);
        if (speechRecognition) {
            speechRecognition.stop();
            speechRecognition = null;
        }
        button.textContent = "Resume microphone";
        setVoiceStatus("Microphone paused");
        return;
    }
    button.textContent = "Pause microphone";
    listenForVoiceInput();
}

function stopVoiceConversation() {
    voiceChatMode = false;
    voiceInputPaused = false;
    voiceInputPending = false;
    voiceSpeaking = false;
    clearTimeout(voiceRestartTimer);
    if (speechRecognition) {
        speechRecognition.abort();
        speechRecognition = null;
    }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const modal = document.getElementById("voiceModeModal");
    modal?.classList.remove("open");
    modal?.setAttribute("aria-hidden", "true");
    if (voiceButton) {
        voiceButton.classList.remove("active");
        voiceButton.setAttribute("aria-label", "Start voice chat");
        voiceButton.title = "Start voice chat";
        setButtonIcon(voiceButton, ICON_MIC);
        voiceButton.focus();
    }
}

function listenForVoiceInput() {
    const Recognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;
    if (!voiceChatMode || voiceInputPaused || voiceInputPending || isSending || !Recognition) {
        return;
    }
    if (speechRecognition) return;

    speechRecognition = new Recognition();
    speechRecognition.continuous = false;
    speechRecognition.interimResults = true;
    speechRecognition.lang =
        navigator.language || "en-US";

    speechRecognition.onresult = event => {
        const transcript = Array.from(event.results)
            .slice(event.resultIndex)
            .map(result => result[0].transcript)
            .join(" ")
            .trim();
        const finalResult = Array.from(event.results)
            .slice(event.resultIndex)
            .some(result => result.isFinal);

        if (transcript) {
            const transcriptView = document.getElementById("voiceModeTranscript");
            if (transcriptView) transcriptView.textContent = transcript;
            if (finalResult && voiceChatMode && !isSending) {
                voiceInputPending = true;
                setVoiceStatus("Thinking…");
                messageInput.value = transcript;
                autoResizeTextarea();
                speechRecognition?.stop();
                sendMessage();
            }
        }
    };

    speechRecognition.onerror = event => {
        if (!voiceChatMode) return;
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
            voiceInputPaused = true;
            document.getElementById("voiceMicToggleButton").textContent =
                "Resume microphone";
            setVoiceStatus("Microphone permission was denied. Allow microphone access in your browser to continue.");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
            setVoiceStatus("Speech recognition stopped. Check your browser connection and try again.");
        }
        speechRecognition = null;
        scheduleVoiceListening(event.error === "network" ? 1500 : 500);
    };

    speechRecognition.onend = () => {
        speechRecognition = null;
        if (voiceChatMode && !voiceInputPending && !voiceSpeaking) {
            setVoiceStatus(voiceInputPaused ? "Microphone paused" : "Listening…");
            scheduleVoiceListening();
        }
    };

    try {
        speechRecognition.start();
        setVoiceStatus("Listening…");
    } catch (error) {
        speechRecognition = null;
        setVoiceStatus(`Could not start the microphone: ${error.message}`);
    }
}

function speakText(text) {
    if (!voiceChatMode || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(String(text || "").slice(0, 12000));
    const settings = readNexusSettings();
    const selectedVoice = String(settings.voiceName || "");
    if (selectedVoice) {
        utterance.voice = window.speechSynthesis
            .getVoices()
            .find(voice => voice.name === selectedVoice) || null;
    }
    utterance.rate = Math.min(2, Math.max(0.5, Number(settings.voiceRate) || 1));
    utterance.pitch = Math.min(2, Math.max(0, Number(settings.voicePitch) || 1));
    utterance.onstart = () => {
        voiceSpeaking = true;
        setVoiceStatus("Nexus is speaking…");
    };
    utterance.onend = () => {
        voiceSpeaking = false;
        if (voiceChatMode) {
            setVoiceStatus("Listening…");
            scheduleVoiceListening();
        }
    };
    utterance.onerror = () => {
        voiceSpeaking = false;
        if (voiceChatMode) {
            setVoiceStatus("Spoken reply failed. You can still read the response and continue by voice.");
            scheduleVoiceListening();
        }
    };
    voiceSpeaking = true;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}


/* =========================================================
   API
========================================================= */

async function apiRequest(
    url,
    options = {}
) {

    const response = await fetchAuthenticated(
        API_BASE + url,
        options
    );


    if (!response.ok) {

        let message =
            `Request failed (${response.status})`;


        try {

            const data =
                await response.json();


            if (data.error) {
                message = data.error;
            }

        } catch (_) {}


        throw new Error(message);

    }


    return response;

}

let pendingLogin = null;
let resolvePendingLogin = null;

const authLoginForm = document.getElementById("authLoginForm");
const authLoginModal = document.getElementById("authLoginModal");
const googleSignInButton = document.getElementById("googleSignInButton");
const authLoginError = document.getElementById("authLoginError");
const authSignupButton = document.getElementById("authSignupToggle");
const authLoginToggle = document.getElementById("authLoginToggle");
const authForgotPasswordButton = document.getElementById("authForgotPasswordButton");
const authSignupConfirm = document.getElementById("authSignupConfirm");
const authSignupConfirmLabel = document.getElementById("authSignupConfirmLabel");
const authSignupInvite = document.getElementById("authSignupInvite");
const authSignupInviteLabel = document.getElementById("authSignupInviteLabel");
const authSignInDivider = document.getElementById("authSignInDivider");
const authTerms = document.getElementById("authTerms");
const authPasswordLabel = document.getElementById("authLoginPasswordLabel");
const authResetToken = document.getElementById("authResetToken");
let authSignupAvailable = false;
let authInviteRequired = false;
let authInviteAvailable = false;
let googleSignInAvailable = false;
let authEmailVerificationRequired = false;
let authAccountEmailConfigured = false;
let authFormMode = "login";

const GOOGLE_AUTH_ERRORS = {
    google_state_invalid: "Google sign-in expired. Please try again.",
    google_signin_cancelled: "Google sign-in was cancelled.",
    google_account_not_allowed: "This Google account is not allowed to sign in.",
    google_signin_failed: "Google sign-in failed. Please try again.",
    email_verification_invalid: "That verification link is invalid or has expired. Request a new one."
};

const googleAuthError = new URLSearchParams(window.location.search).get("auth_error");
const verifiedEmail = new URLSearchParams(window.location.search).get("email_verified");
if (googleAuthError && authLoginError) {
    authLoginError.textContent =
        GOOGLE_AUTH_ERRORS[googleAuthError] || "Sign-in failed. Please try again.";
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);
}
if (verifiedEmail === "1" && authLoginError) {
    authLoginError.textContent = "Email verified. You can now sign in.";
    authLoginError.classList.add("is-success");
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);
}

fetch(`${API_BASE}/api/auth/methods`)
    .then(response => {
        if (!response.ok) throw new Error(`Auth methods request failed (${response.status}).`);
        return response.json();
    })
    .then(methods => {
        authSignupAvailable = Boolean(methods.signup);
        authInviteRequired = Boolean(methods.inviteRequired);
        authInviteAvailable = Boolean(methods.inviteAvailable);
        googleSignInAvailable = Boolean(methods.google);
        authEmailVerificationRequired = Boolean(methods.emailVerificationRequired);
        authAccountEmailConfigured = Boolean(methods.accountEmailConfigured);
        setAuthFormMode(authFormMode);
    })
    .catch(error => {
        console.error("Could not load available sign-in methods:", error.message);
    });

function setAuthFormMode(mode) {
    const allowedModes = ["login", "signup", "forgot", "verify", "reset"];
    authFormMode = allowedModes.includes(mode) ? mode : "login";
    if (authFormMode === "signup" && !authSignupAvailable) authFormMode = "login";
    if (["forgot", "verify"].includes(authFormMode) && !authAccountEmailConfigured) {
        authFormMode = "login";
    }
    const isSignup = authFormMode === "signup";
    const isForgot = authFormMode === "forgot";
    const isVerify = authFormMode === "verify";
    const isReset = authFormMode === "reset";
    const isEmailOnly = isForgot || isVerify;
    const title = document.getElementById("authLoginTitle");
    const subtitle = document.getElementById("authLoginSubtitle");
    const submit = document.getElementById("authLoginSubmit");
    const password = document.getElementById("authLoginPassword");
    const usernameLabel = document.getElementById("authLoginUsernameLabel");
    const username = document.getElementById("authLoginUsername");

    if (title) {
        title.textContent = isSignup ? "Create your account"
            : isForgot ? "Reset your password"
                : isVerify ? "Verify your email"
                    : isReset ? "Choose a new password" : "Sign in";
    }
    if (subtitle) {
        subtitle.textContent = isSignup
            ? authEmailVerificationRequired
                ? "Use your email address. We’ll send a link to verify it before you can sign in."
                : "Use your email address. An invitation code is optional."
            : isForgot
                ? "Enter the email address on your account. We’ll send a reset link if it’s eligible."
                : isVerify
                    ? "Enter your email address and we’ll send another verification link."
                    : isReset
                        ? "Choose a new password with at least 12 characters."
                        : "Continue to your Jarwis workspace.";
    }
    if (submit) {
        submit.textContent = isSignup ? "Create account"
            : isForgot ? "Send reset link"
                : isVerify ? "Resend verification email"
                    : isReset ? "Update password" : "Sign in";
    }
    if (usernameLabel) {
        usernameLabel.textContent = isSignup || isForgot || isVerify
            ? "Email address" : "Email or username";
        usernameLabel.hidden = isReset;
    }
    if (username) {
        username.type = isSignup || isForgot || isVerify ? "email" : "text";
        username.autocomplete = isSignup || isForgot || isVerify ? "email" : "username";
        username.placeholder = isSignup ? "you@example.com" : "you@example.com";
        username.hidden = isReset;
        username.required = !isReset;
    }
    if (password) {
        password.hidden = isEmailOnly;
        password.required = !isEmailOnly;
        password.autocomplete = isSignup || isReset ? "new-password" : "current-password";
    }
    const passwordHelp = document.querySelector(".auth-password-help");
    if (passwordHelp) passwordHelp.hidden = isEmailOnly;
    if (authPasswordLabel) {
        authPasswordLabel.hidden = isEmailOnly;
        authPasswordLabel.textContent = isReset ? "New password" : "Password";
    }
    if (authSignupConfirm) {
        authSignupConfirm.hidden = !isSignup && !isReset;
        authSignupConfirm.required = isSignup || isReset;
        authSignupConfirm.autocomplete = isReset ? "new-password" : "new-password";
        authSignupConfirm.placeholder = isReset ? "Enter your new password again" : "Enter your password again";
    }
    if (authSignupConfirmLabel) {
        authSignupConfirmLabel.hidden = !isSignup && !isReset;
        authSignupConfirmLabel.textContent = isReset ? "Confirm new password" : "Confirm password";
    }
    if (authSignupInvite) {
        authSignupInvite.hidden = !isSignup || !authInviteAvailable;
        authSignupInvite.required = isSignup && authInviteRequired;
    }
    if (authSignupInviteLabel) {
        authSignupInviteLabel.hidden = !isSignup || !authInviteAvailable;
        authSignupInviteLabel.textContent = authInviteRequired
            ? "Invitation code"
            : "Invitation code (optional)";
    }
    if (googleSignInButton) googleSignInButton.hidden = !googleSignInAvailable || authFormMode !== "login";
    if (authSignInDivider) authSignInDivider.hidden = !googleSignInAvailable || authFormMode !== "login";
    if (authSignupButton) authSignupButton.hidden = !authSignupAvailable || authFormMode !== "login";
    if (authLoginToggle) {
        authLoginToggle.hidden = authFormMode === "login";
        authLoginToggle.textContent = isSignup ? "Back to sign in" : "Return to sign in";
    }
    if (authForgotPasswordButton) {
        authForgotPasswordButton.hidden =
            authFormMode !== "login" || !authAccountEmailConfigured;
    }
    if (authTerms) authTerms.hidden = false;
    if (authTerms && isSignup) {
        authTerms.textContent = authEmailVerificationRequired
            ? "New accounts have member access. Your email must be verified before signing in."
            : "New accounts have member access. This instance may share workspace data between accounts.";
    } else if (authTerms && isForgot) {
        authTerms.textContent = "For your safety, Jarwis does not reveal whether an account exists.";
    } else if (authTerms && isVerify) {
        authTerms.textContent = "Verification links expire after 30 minutes.";
    } else if (authTerms) {
        authTerms.textContent =
            "Your workspace belongs to this Jarwis server. Prompts sent to connected cloud providers leave this machine.";
    }
}

authSignupButton?.addEventListener("click", () => setAuthFormMode("signup"));
authLoginToggle?.addEventListener("click", () => setAuthFormMode("login"));
authForgotPasswordButton?.addEventListener("click", () => setAuthFormMode("forgot"));

function requestLogin() {
    if (pendingLogin) return pendingLogin;

    pendingLogin = new Promise(resolve => {
        resolvePendingLogin = resolve;
        setAuthFormMode("login");
        authLoginModal?.classList.add("open");
        authLoginModal?.setAttribute("aria-hidden", "false");
        if (googleAuthError && authLoginError) {
            authLoginError.textContent =
                GOOGLE_AUTH_ERRORS[googleAuthError] || "Sign-in failed. Please try again.";
        }
        document.getElementById("authLoginUsername")?.focus();
    });

    return pendingLogin;
}

if (authLoginForm) {
    authLoginForm.addEventListener("submit", async event => {
        event.preventDefault();
        const submit = document.getElementById("authLoginSubmit");
        const error = document.getElementById("authLoginError");
        const username = document.getElementById("authLoginUsername").value.trim();
        const passwordInput = document.getElementById("authLoginPassword");
        const password = passwordInput.value;
        const isSignup = authFormMode === "signup";
        const isForgot = authFormMode === "forgot";
        const isVerify = authFormMode === "verify";
        const isReset = authFormMode === "reset";
        submit.disabled = true;
        error.textContent = "";
        error.classList.remove("is-success");

        try {
            if ((isSignup || isReset) && authSignupConfirm?.value !== password) {
                throw new Error("The passwords do not match.");
            }

            if (isForgot || isVerify) {
                const endpoint = isForgot
                    ? "/api/auth/password-reset/request"
                    : "/api/auth/verify-email/resend";
                const response = await fetch(`${API_BASE}${endpoint}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ username })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "Could not send the email.");
                error.textContent = result.message;
                error.classList.add("is-success");
                return;
            }

            if (isReset) {
                const response = await fetch(`${API_BASE}/api/auth/password-reset`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        token: authResetToken?.value,
                        password
                    })
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || "Password update failed.");
                authLoginForm.reset();
                setAuthFormMode("login");
                error.textContent = result.message;
                error.classList.add("is-success");
                window.history.replaceState({}, "", window.location.pathname + window.location.hash);
                return;
            }

            const response = await fetch(`${API_BASE}/api/auth/${isSignup ? "register" : "login"}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username,
                    password,
                    inviteCode: authSignupInvite?.value || ""
                })
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || (isSignup ? "Account creation failed." : "Sign-in failed."));
            }
            if (isSignup && result.verificationRequired) {
                authLoginForm.reset();
                document.getElementById("authLoginUsername").value = username;
                setAuthFormMode("verify");
                error.textContent = result.message;
                error.classList.add("is-success");
                return;
            }
            if (isSignup) {
                showCapabilityNotice(
                    "Account created. This Jarwis instance uses a shared workspace; keep it private unless per-user data isolation is configured."
                );
            }

            authLoginForm.reset();
            setAuthFormMode("login");
            authLoginModal.classList.remove("open");
            authLoginModal.setAttribute("aria-hidden", "true");
            const resolve = resolvePendingLogin;
            resolvePendingLogin = null;
            pendingLogin = null;
            resolve?.(true);
        } catch (loginError) {
            error.textContent = loginError.message;
        } finally {
            submit.disabled = false;
        }
    });
}

const passwordResetToken =
    new URLSearchParams(window.location.search).get("reset_password");
if (passwordResetToken && authResetToken && authLoginModal) {
    authResetToken.value = passwordResetToken;
    setAuthFormMode("reset");
    authLoginModal.classList.add("open");
    authLoginModal.setAttribute("aria-hidden", "false");
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);
}

async function fetchAuthenticated(url, options = {}) {
    const send = () => fetch(url, options);

    let response = await send();
    if (
        response.status !== 401 ||
        String(url).includes("/api/auth/login")
    ) {
        return response;
    }

    if (!await requestLogin()) return response;
    response = await send();
    return response;
}


/* =========================================================
   LOAD CHATS
========================================================= */

async function loadChats() {

    try {

        const response =
            await apiRequest(
                "/api/chats"
            );


        const data =
            await response.json();


        conversations =
            Array.isArray(data)
                ? data
                : (data.chats || []);


        activeConversationId = null;

        chatTitle.textContent =
            "Jarwis";


        renderConversations();

        showWelcome();


    } catch (error) {

        console.error(error);

        showToast(
            "Unable to load chats.",
            "error"
        );

    }

}


/* =========================================================
   PROJECT LIST (SIDEBAR)
========================================================= */

/*
Projects appear in the sidebar above chats, the way ChatGPT
lists them. Each row opens that project's conversation.
*/
const sidebarProjectList =
    document.getElementById("sidebarProjectList");

async function renderSidebarProjects() {
    if (!sidebarProjectList) return;

    try {
        const response = await apiRequest("/api/projects");
        const data = await response.json();
        const projects = data.projects || [];

        if (!projects.length) {
            sidebarProjectList.innerHTML =
                '<div class="conversation-empty">No projects yet</div>';
            return;
        }

        sidebarProjectList.innerHTML = projects.map(project => `
            <button
                type="button"
                class="conversation-item project-item${String(project.chatId) === String(activeProjectId) ? " active" : ""}"
                data-project-id="${escapeAttribute(String(project.chatId))}"
                title="${escapeAttribute(project.name || "Project")}"
            >
                <span class="project-item-icon" aria-hidden="true">▢</span>
                <span class="conversation-content">${escapeHtml(project.name || "Untitled project")}</span>
                <span class="conversation-actions">
                    <span class="conversation-action" data-project-open="${escapeAttribute(String(project.chatId))}" title="Open project">›</span>
                </span>
            </button>
        `).join("");

        sidebarProjectList
            .querySelectorAll("[data-project-id]")
            .forEach(button => {
                button.addEventListener("click", async () => {
                    const projectId = button.dataset.projectId;
                    activeProjectId = projectId;
                    await selectChat(projectId);
                });
            });
    } catch {
        sidebarProjectList.innerHTML =
            '<div class="conversation-empty">Projects unavailable</div>';
    }
}

/*
=========================================================
   CHAT LIST
========================================================= */

function renderConversations(
    filter = ""
) {

    conversationList.innerHTML = "";


    let filtered =
        conversations.filter(chat => Number(chat.archived) !== 1);


    if (filter) {

        const search =
            filter.toLowerCase();


        filtered =
            filtered.filter(
                chat =>
                    String(
                        chat.title || ""
                    )
                    .toLowerCase()
                    .includes(search)
            );

    }


    if (!filtered.length) {

        conversationList.innerHTML = `
            <div class="conversation-empty">
                No chats found.
            </div>
        `;

        return;

    }


    filtered.forEach(
        chat => {

            const item =
                document.createElement(
                    "div"
                );


            item.className =
                "conversation-item" +
                (
                    Number(chat.id) ===
                    Number(activeConversationId)
                        ? " active"
                        : ""
                );
            item.dataset.chatId = String(chat.id);


            /*
            A leading icon keeps chat rows aligned with project rows,
            which also carry one — without it the text of the two
            lists starts at different x positions.
            */
            const chatIcon =
                document.createElement("span");

            chatIcon.className =
                "project-item-icon";

            chatIcon.setAttribute("aria-hidden", "true");

            chatIcon.innerHTML =
                '<svg width="14" height="14" viewBox="0 0 16 16" fill="none">' +
                '<path d="M13.5 7.5a5.5 5.5 0 0 1-7.6 5l-3.4.9.9-3.3A5.5 5.5 0 1 1 13.5 7.5z" ' +
                'stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';


            const content =
                document.createElement(
                    "div"
                );


            content.className =
                "conversation-content";

            content.textContent =
                chat.title ||
                "New Chat";

            item.title =
                chat.title || "New Chat";


            const actions =
                document.createElement(
                    "div"
                );

            actions.className =
                "conversation-actions";


            const menuToggle = createConversationAction("···", "Chat options");
            menuToggle.setAttribute("aria-haspopup", "menu");
            menuToggle.setAttribute("aria-expanded", "false");
            menuToggle.innerHTML = '<span aria-hidden="true">···</span>';
            const menu = document.createElement("div");
            menu.className = "conversation-action-menu";
            menu.setAttribute("role", "menu");
            menu.innerHTML = `
                <button type="button" role="menuitem" data-chat-action="pin">${Number(chat.pinned) === 1 ? "★  Unpin chat" : "☆  Pin chat"}</button>
                <button type="button" role="menuitem" data-chat-action="rename">✎  Rename</button>
                <button type="button" role="menuitem" data-chat-action="project">▦  Add to project</button>
                <button type="button" role="menuitem" data-chat-action="share">↗  Share chat</button>
                <button type="button" role="menuitem" data-chat-action="archive">▱  Archive</button>
                <button type="button" role="menuitem" class="danger" data-chat-action="delete">×  Delete</button>
            `;
            menuToggle.addEventListener("click", event => {
                event.stopPropagation();
                const opening = !menu.classList.contains("open");
                document.querySelectorAll(".conversation-action-menu.open").forEach(openMenu => {
                    openMenu.classList.remove("open");
                    const openRow = openMenu.closest(".conversation-item");
                    openRow?.classList.remove("menu-open");
                    openRow?.querySelector('[aria-haspopup="menu"]')?.setAttribute("aria-expanded", "false");
                });
                menu.classList.toggle("open", opening);
                item.classList.toggle("menu-open", opening);
                menuToggle.setAttribute("aria-expanded", String(opening));
            });
            menu.addEventListener("click", async event => {
                const option = event.target.closest("[data-chat-action]");
                if (!option) return;
                event.stopPropagation();
                menu.classList.remove("open");
                item.classList.remove("menu-open");
                menuToggle.setAttribute("aria-expanded", "false");
                switch (option.dataset.chatAction) {
                    case "pin":
                        await togglePin(chat);
                        break;
                    case "rename":
                        openRenameModal(chat);
                        break;
                    case "project":
                        await openChatProjectModal(chat);
                        break;
                    case "share":
                        openChatShareModal(chat);
                        break;
                    case "archive":
                        try {
                            const response = await apiRequest(`/api/chat/${encodeURIComponent(chat.id)}/archive`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ archived: true })
                            });
                            if (!response.ok) throw new Error(await getResponseError(response));
                            conversations = conversations.filter(item => Number(item.id) !== Number(chat.id));
                            if (Number(activeConversationId) === Number(chat.id)) {
                                activeConversationId = null;
                                showWelcome();
                            }
                            renderConversations();
                            showCapabilityNotice("Chat archived. You can restore it from Settings → Archived chats.");
                        } catch (failure) {
                            showCapabilityNotice(`Could not archive this chat: ${failure.message}`);
                        }
                        break;
                    case "delete":
                        await deleteChat(chat);
                        break;
                    default:
                        break;
                }
            });
            item.addEventListener("keydown", event => {
                if (event.key === "Escape" && menu.classList.contains("open")) {
                    menu.classList.remove("open");
                    item.classList.remove("menu-open");
                    menuToggle.setAttribute("aria-expanded", "false");
                    menuToggle.focus();
                }
            });
            actions.appendChild(menuToggle);
            actions.appendChild(menu);


            item.appendChild(chatIcon);
            item.appendChild(content);
            item.appendChild(actions);


            item.addEventListener(
                "click",
                async () => {

                    if (isSending) {
                        stopGeneration();
                    }

                    await selectChat(
                        chat.id,
                        true
                    );

                }
            );


            conversationList.appendChild(
                item
            );

        }
    );

}


function createConversationAction(
    text,
    title,
    isDelete = false
) {

    const button =
        document.createElement(
            "button"
        );

    button.type = "button";

    button.className =
        "conversation-action" +
        (isDelete ? " delete" : "");

    button.title = title;

    button.textContent = text;

    return button;

}


/* =========================================================
   CREATE CHAT
========================================================= */

async function createNewChat() {

    try {

        const response =
            await apiRequest(
                "/api/chats",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            title:
                                "New Chat"
                        })

                }
            );


        const data =
            await response.json();


        const chat =
            data.chat || data;


        if (!chat || !chat.id) {
            throw new Error(
                "Invalid chat response."
            );
        }


        conversations =
            conversations.filter(
                item =>
                    Number(item.id) !==
                    Number(chat.id)
            );


        conversations.unshift(chat);


        activeConversationId =
            chat.id;
        activeProjectId = data.project?.chatId
            ? String(data.project.chatId)
            : null;

        chatTitle.textContent =
            chat.title ||
            "New Chat";

        /* An active conversation shows its name in the header. */
        chatTitle.hidden = false;


        renderConversations();

        showWelcome();

        resetWorkspaceActivity();

        messageInput.value = "";

        autoResizeTextarea();

        messageInput.focus();


        return chat;


    } catch (error) {

        console.error(error);

        showToast(
            error.message ||
            "Unable to create chat.",
            "error"
        );

        return null;

    }

}


/* =========================================================
   SELECT CHAT
========================================================= */

async function selectChat(
    chatId,
    shouldFocus = true
) {

    try {

        const response =
            await apiRequest(
                `/api/chats/${chatId}`
            );


        const data =
            await response.json();


        const chat =
            data.chat || data;


        activeConversationId =
            chat.id;


        chatTitle.textContent =
            chat.title ||
            "New Chat";


        renderConversations(
            searchInput.value.trim()
        );


        renderMessages(
            data.messages || []
        );


        resetWorkspaceActivity();

        await refreshWorkspace();


        if (shouldFocus) {
            messageInput.focus();
        }


    } catch (error) {

        console.error(error);

        showToast(
            "Unable to open chat.",
            "error"
        );

    }

}


/* =========================================================
   MESSAGES
========================================================= */

function renderMessages(
    chatMessages
) {

    if (workspacePage) workspacePage.hidden = true;
    messages.hidden = false;
    sidebarNavItems.forEach(item => item.classList.remove("active"));
    messages.innerHTML = "";


    if (
        !chatMessages ||
        !chatMessages.length
    ) {

        showWelcome();

        return;

    }


    let latestAssistantIndex = -1;


    for (
        let i =
            chatMessages.length - 1;
        i >= 0;
        i--
    ) {

        if (
            chatMessages[i].role ===
            "assistant"
        ) {

            latestAssistantIndex = i;

            break;

        }

    }


    chatMessages.forEach(
        (message, index) => {

            const contentElement =
                appendMessage(
                    message.role,
                    message.content
                );

            if (message.role === "assistant") {
                addModelAttribution(contentElement, message.metadata);
            }

            if (
                message.role === "assistant" &&
                index === latestAssistantIndex
            ) {

                addRegenerateButton(
                    contentElement
                );

            }

        }
    );


    scrollMessagesToBottom(false);

}


function wireWelcomeSuggestions() {
    messages
        .querySelectorAll("[data-welcome-prompt]")
        .forEach(button => {
            button.addEventListener("click", () => {
                const prompt = button.dataset.welcomePrompt;
                if (!prompt) return;
                messageInput.value = prompt;
                autoResizeTextarea();
                /*
                Send straight away, the way ChatGPT's suggested
                prompts do. sendMessage() reads the textarea and
                clears it on success.
                */
                sendMessage();
            });
        });
}

/*
Set the header title and keep its visibility in step.

ChatGPT always shows a name in the header: the conversation
title, or the app name on the empty state. It is never blank,
so the label stays visible and falls back to "Jarwis" when no
chat or product page is active.
*/
function setHeaderTitle(text) {
    if (!chatTitle) return;
    const value = String(text || "").trim();
    chatTitle.textContent = value || "Jarwis";
    chatTitle.hidden = false;
}

function showWelcome() {

    if (workspacePage) workspacePage.hidden = true;
    messages.hidden = false;
    sidebarNavItems.forEach(item => item.classList.remove("active"));
    setHeaderTitle("");

    messages.innerHTML = `

        <div class="welcome-message">

            <div class="welcome-orbit-mark" aria-hidden="true">
                <span></span><span></span><span></span>
            </div>
            <p class="welcome-eyebrow">YOUR PERSONAL AI WORKSPACE</p>
            <h1>
                What would you like to work on?
            </h1>
            <p class="welcome-intro">Start with a question or a goal. Jarwis can explain, write, research, work with files, and coordinate tools—with local models first and cloud models when you connect them.</p>

            <section class="welcome-start-card" aria-labelledby="welcomeStartTitle">
                <div class="welcome-start-heading">
                    <div>
                        <span class="welcome-card-kicker">YOUR SETUP</span>
                        <h2 id="welcomeStartTitle">Ready when you are</h2>
                    </div>
                    <button type="button" class="welcome-connect-button" data-product-action="open-settings" data-settings-section="models">Connect a model <span aria-hidden="true">↗</span></button>
                </div>
                <div id="welcomeReadiness" class="welcome-readiness" aria-live="polite">
                    <div class="welcome-readiness-item"><span class="welcome-readiness-dot is-loading"></span><span><strong>Local models</strong><small>Checking this PC…</small></span></div>
                    <div class="welcome-readiness-item"><span class="welcome-readiness-dot is-loading"></span><span><strong>Cloud providers</strong><small>Checking saved connections…</small></span></div>
                    <div class="welcome-readiness-item"><span class="welcome-readiness-dot is-loading"></span><span><strong>Tools &amp; agents</strong><small>Loading Jarwis capabilities…</small></span></div>
                </div>
            </section>

            <div class="welcome-section-label">A few ways to get started</div>

            <div class="welcome-suggestions">

                <button type="button" class="welcome-suggestion" data-welcome-prompt="Explain how HTTPS works in simple terms">
                    <span class="welcome-suggestion-icon">01</span>
                    <span><strong>Learn something</strong><small>Explain a tricky idea simply</small></span>
                </button>

                <button type="button" class="welcome-suggestion" data-welcome-prompt="Write a Python script that renames every file in a folder">
                    <span class="welcome-suggestion-icon">02</span>
                    <span><strong>Build or code</strong><small>Plan, create, and improve</small></span>
                </button>

                <button type="button" class="welcome-suggestion" data-welcome-prompt="Summarize the key ideas in a document I upload">
                    <span class="welcome-suggestion-icon">03</span>
                    <span><strong>Work with a file</strong><small>Summarize or extract insights</small></span>
                </button>

                <button type="button" class="welcome-suggestion" data-welcome-prompt="Research the latest developments in AI and give me a summary with sources">
                    <span class="welcome-suggestion-icon">04</span>
                    <span><strong>Research a topic</strong><small>Find information and sources</small></span>
                </button>

            </div>

            <p class="welcome-privacy-note"><span aria-hidden="true">◈</span> Local models keep prompts on this PC. Connected cloud providers receive the prompts you send them.</p>
        </div>

    `;

    wireWelcomeSuggestions();
    refreshWelcomeReadiness();

}

async function refreshWelcomeReadiness() {
    const readiness = document.getElementById("welcomeReadiness");
    if (!readiness) return;

    try {
        const [response, runtimeResponse] = await Promise.all([
            apiRequest("/api/capabilities"),
            apiRequest("/api/runtime?task=chat&intelligence=balanced")
        ]);
        if (!response.ok) throw new Error(await getResponseError(response));
        if (!runtimeResponse.ok) throw new Error(await getResponseError(runtimeResponse));
        const [data, runtime] = await Promise.all([
            response.json(),
            runtimeResponse.json()
        ]);
        const localModels = (data.models || []).filter(model =>
            model.provider === "ollama" && model.available
        );
        const localCandidates = (runtime.routing?.candidates || []).filter(candidate =>
            candidate.local === true
        );
        const selected = runtime.routing?.selected;
        const cloudProviders = (data.providers || []).filter(provider =>
            provider.name !== "ollama" && provider.configured
        );
        const tools = data.tools || [];
        const agents = data.agents || [];
        const localStatus = localModels.length === 0
            ? "No local model is installed and available"
            : localCandidates.length
                ? `${localCandidates.length} ready for auto-routing · ${localModels.length} installed`
                : selected?.provider && selected.provider !== "ollama"
                    ? `${localModels.length} installed · routing through ${selected.provider}`
                    : `${localModels.length} installed · none ready for auto-routing right now`;

        readiness.innerHTML = `
            <div class="welcome-readiness-item">
                <span class="welcome-readiness-dot ${localCandidates.length ? "is-ready" : "is-idle"}"></span>
                <span><strong>Local models</strong><small>${escapeHtml(localStatus)}</small></span>
            </div>
            <div class="welcome-readiness-item">
                <span class="welcome-readiness-dot ${cloudProviders.length ? "is-ready" : "is-idle"}"></span>
                <span><strong>Cloud providers</strong><small>${cloudProviders.length ? `${cloudProviders.length} provider key${cloudProviders.length === 1 ? "" : "s"} saved` : "Optional · none connected yet"}</small></span>
            </div>
            <div class="welcome-readiness-item">
                <span class="welcome-readiness-dot ${(tools.length || agents.length) ? "is-ready" : "is-idle"}"></span>
                <span><strong>Tools &amp; agents</strong><small>${tools.length} tools · ${agents.length} specialist agents available</small></span>
            </div>
        `;
    } catch (error) {
        console.error("Could not load Jarwis setup status:", error);
        readiness.innerHTML = `
            <div class="welcome-readiness-item welcome-readiness-error">
                <span class="welcome-readiness-dot is-idle"></span>
                <span><strong>Setup status unavailable</strong><small>${escapeHtml(error.message || "Reconnect to the local Jarwis server and try again.")}</small></span>
            </div>
        `;
    }
}

function appendMessage(
    role,
    content,
    messageId = null
) {

    const welcome =
        messages.querySelector(
            ".welcome-message"
        );


    if (welcome) {
        welcome.remove();
    }


    if (role === "assistant") {
        removeRegenerateButtons();
    }


    const message =
        document.createElement(
            "div"
        );


    message.className =
        `message ${role}`;
    if (messageId != null) message.dataset.messageId = String(messageId);


    const inner =
        document.createElement(
            "div"
        );


    inner.className =
        "message-inner";


    const avatar =
        document.createElement(
            "div"
        );


    avatar.className =
        "message-avatar";


    avatar.textContent =
        role === "user"
            ? "You"
            : "N";


    const body =
        document.createElement(
            "div"
        );


    body.className =
        "message-body";


    const sender =
        document.createElement(
            "div"
        );


    sender.className =
        "message-sender";


    sender.textContent =
        role === "user"
            ? "You"
            : "Jarwis";


    const contentElement =
        document.createElement(
            "div"
        );


    contentElement.className =
        "message-content";


    contentElement.innerHTML =
        formatMessage(
            content || ""
        );


    body.appendChild(sender);
    body.appendChild(contentElement);

    if (role === "assistant") {
        const audioButton = document.createElement("button");
        audioButton.type = "button";
        audioButton.className = "message-action-button";
        audioButton.textContent = "Read aloud";
        audioButton.addEventListener("click", () => {
            if (!("speechSynthesis" in window)) {
                showCapabilityNotice("Read aloud is not supported by this browser.");
                return;
            }
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(
                contentElement.textContent
            );
            window.speechSynthesis.speak(utterance);
        });
        body.appendChild(audioButton);
    }

    if (messageId != null) {
        const branchButton = document.createElement("button");
        branchButton.type = "button";
        branchButton.className = "message-action-button";
        branchButton.textContent = "Branch";
        branchButton.addEventListener("click", () => branchConversation(messageId));
        body.appendChild(branchButton);
    }

    inner.appendChild(avatar);
    inner.appendChild(body);

    message.appendChild(inner);

    messages.appendChild(message);


    attachCopyHandlers(
        contentElement
    );


    return contentElement;

}

function addModelAttribution(contentElement, attribution) {
    if (!contentElement || !attribution?.model || !attribution?.provider) {
        return;
    }
    const body = contentElement.closest(".message-body");
    if (!body) return;
    body.querySelector(".model-attribution")?.remove();

    const label = document.createElement("div");
    label.className = "model-attribution";
    label.textContent = `${attribution.model} · ${attribution.provider}` +
        (attribution.fallback ? " · switched automatically" : "");
    if (attribution.selectionReason) {
        label.title = attribution.selectionReason;
    }
    body.appendChild(label);
}


/* =========================================================
   REGENERATE
========================================================= */

function removeRegenerateButtons() {

    document
        .querySelectorAll(
            "[data-action='regenerate-response']"
        )
        .forEach(
            button => {

                const actions =
                    button.closest(
                        ".message-actions"
                    );

                if (actions) {
                    actions.remove();
                } else {
                    button.remove();
                }

            }
        );

}


function addRegenerateButton(
    contentElement
) {

    if (
        !contentElement ||
        isSending
    ) {
        return;
    }


    const message =
        contentElement.closest(
            ".message.assistant"
        );


    if (!message) {
        return;
    }


    removeRegenerateButtons();


    const actions =
        document.createElement(
            "div"
        );


    actions.className =
        "message-actions";


    const button =
        document.createElement(
            "button"
        );


    button.type = "button";

    button.className =
        "message-action-button";

    button.dataset.action =
        "regenerate-response";

    button.textContent =
        "↻ Regenerate";


    actions.appendChild(button);


    const body =
        message.querySelector(
            ".message-body"
        );


    if (body) {
        body.appendChild(actions);
    }

}


async function regenerateLastResponse() {

    if (
        isSending ||
        !activeConversationId
    ) {
        return;
    }


    const assistantMessages =
        messages.querySelectorAll(
            ".message.assistant"
        );


    if (!assistantMessages.length) {
        return;
    }


    assistantMessages[
        assistantMessages.length - 1
    ].remove();


    removeRegenerateButtons();


    isSending = true;

    activeAbortController =
        new AbortController();


    setSendingState(true);

    startAgentActivity(
        "regenerate",
        "Regenerating response..."
    );

    showThinking();


    try {

        const response =
            await fetchAuthenticated(
                `/api/chats/${activeConversationId}/regenerate`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/x-ndjson, application/json"
                    },

                    body:
                        JSON.stringify({
                            stream: true
                        }),

                    signal:
                        activeAbortController.signal
                }
            );


        if (!response.ok) {
            throw new Error(
                await getResponseError(response)
            );
        }


        removeThinking();


        if (
            (
                response.headers.get(
                    "content-type"
                ) || ""
            )
            .includes(
                "application/x-ndjson"
            )
        ) {

            await handleStreamingResponse(
                response
            );

        } else {

            const data =
                await response.json();


            const element =
                appendMessage(
                    "assistant",
                    data.answer || ""
                );

            addModelAttribution(element, data);

            addRegenerateButton(
                element
            );

        }


        await refreshChatsAfterMessage();

        completeAgentActivity();


    } catch (error) {

        removeThinking();

        if (
            error.name !== "AbortError"
        ) {

            appendMessage(
                "assistant",
                `Error: ${escapeHtml(
                    error.message
                )}`
            );

            showToast(
                error.message,
                "error"
            );

        }

    } finally {

        isSending = false;
        voiceInputPending = false;

        activeAbortController = null;
        activeAssistantElement = null;

        setSendingState(false);

        messageInput.focus();
        if (voiceChatMode && !voiceSpeaking) {
            scheduleVoiceListening(600);
        }

    }

}


/* =========================================================
   SEND
========================================================= */

async function sendMessage() {

    if (isSending) {
        return;
    }

    const text =
        messageInput.value.trim();


    if (!text) {
        return;
    }


    if (!activeConversationId) {

        const chat =
            await createNewChat();


        if (!chat) {
            return;
        }

    }


    isSending = true;

    activeAbortController =
        new AbortController();


    removeRegenerateButtons();


    appendMessage(
        "user",
        text
    );


    messageInput.value = "";

    autoResizeTextarea();

    setSendingState(true);

    showThinking();

    scrollMessagesToBottom();


    resetWorkspaceActivity();


    addActivity(
        "understanding",
        "Understanding your request...",
        "active"
    );

    /*
    Which agent handles this turn.

    A pinned agent always wins; otherwise the message text decides,
    which is the automatic behaviour. `agentId` is sent explicitly so
    the server uses the same agent the UI just named.
    */
    const routedTask = pinnedAgentId
        ? (AGENT_TASK_IDS[pinnedAgentId] || pinnedAgentId)
        : inferTask(text);

    const routedAgentLabel = pinnedAgentId
        ? (AGENT_OPTIONS.find(([value]) => value === pinnedAgentId)?.[1] || pinnedAgentId)
        : (AGENT_LABELS[routedTask] || `${routedTask} agent`);

    addActivity(
        "agent",
        pinnedAgentId
            ? `Using the pinned ${routedAgentLabel}…`
            : `Routing to the ${routedAgentLabel}…`,
        "active"
    );

    applyKeepAwakeSetting();


    try {

        const response =
            await fetchAuthenticated(
                `${API_BASE}/api/chat`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Accept":
                            "application/x-ndjson, application/json"
                    },

                    body:
                        JSON.stringify({
                            chatId:
                                activeConversationId,

                            message:
                                text,

                            provider:
                                selectedModelConfig.provider,

                            model:
                                selectedModelConfig.model,

                            imageModel:
                                selectedImageModel || undefined,

                            intelligence:
                                thinkMode
                                    ? "high"
                                    : intelligenceSelector.value,
                            task:
                                routedTask,

                            /*
                            The exact agent the UI named. When set, the
                            server uses it instead of re-deriving one from
                            the task, so a pinned agent is never ignored.
                            */
                            agent:
                                pinnedAgentId || undefined,

                            webSearch:
                                webSearchMode,

                            /*
                            Personalization from Settings: custom
                            instructions, response style, and the
                            memory toggle. Sent with every turn so
                            the model always sees them.
                            */
                            preferences:
                                nexusPreferences(),

                            ...advancedRequestOptions(),

                            stream:
                                true
                        }),

                    signal:
                        activeAbortController.signal
                }
            );


        if (!response.ok) {

            throw new Error(
                await getResponseError(response)
            );

        }


        removeThinking();


        const contentType =
            response.headers.get(
                "content-type"
            ) || "";


        if (
            contentType.includes(
                "application/x-ndjson"
            )
        ) {

            await handleStreamingResponse(
                response
            );

        } else {

            const data =
                await response.json();


            if (data.error) {
                throw new Error(
                    data.error
                );
            }


            const element =
                appendMessage(
                    "assistant",
                    data.answer || ""
                );


            addRegenerateButton(
                element
            );


            processAgentPayload(
                data
            );

        }


        await refreshChatsAfterMessage();

        await refreshWorkspace();

        completeAgentActivity();

        /* Optional follow-up suggestions after a completed reply. */
        if (
            readNexusSettings().alwaysFollowUps === true &&
            activeAssistantElement?.textContent?.trim()
        ) {
            showFollowUpSuggestions(
                activeAssistantElement.closest(".message")
            );
        }

        if (voiceChatMode && activeAssistantElement?.textContent?.trim()) {
            const voiceReply = activeAssistantElement.textContent.trim();
            const transcriptView = document.getElementById("voiceModeTranscript");
            if (transcriptView) transcriptView.textContent = voiceReply;
            speakText(voiceReply);
        }


    } catch (error) {

        removeThinking();

        if (
            error.name === "AbortError"
        ) {

            if (
                activeAssistantElement &&
                activeAssistantElement.textContent.trim()
            ) {

                addRegenerateButton(
                    activeAssistantElement
                );

            }

        } else {

            console.error(
                "Send error:",
                error
            );


            appendMessage(
                "assistant",
                `Error: ${escapeHtml(
                    error.message ||
                    "Something went wrong."
                )}`
            );


            showToast(
                error.message ||
                "Unable to get a response.",
                "error"
            );


            failAgentActivity(
                error.message
            );

        }

    } finally {

        isSending = false;

        activeAbortController = null;
        activeAssistantElement = null;

        releaseKeepAwakeSetting();

        setSendingState(false);

        messageInput.focus();

    }

}


/* =========================================================
   STREAMING

========================================================= */

async function handleStreamingResponse(
    response
) {

    if (!response.body) {
        throw new Error(
            "Streaming is not supported."
        );
    }


    const reader =
        response.body.getReader();


    const decoder =
        new TextDecoder("utf-8");


    let buffer = "";
    let assistantText = "";


    removeRegenerateButtons();


    const assistantContentElement =
        appendMessage(
            "assistant",
            ""
        );

    const resetAssistantText = () => {
        assistantText = "";
        assistantContentElement.replaceChildren();
    };


    activeAssistantElement =
        assistantContentElement;

    if (typeof setButtonIcon === "function") {
        setButtonIcon(sendButton, ICON_SPINNER);
    }



    try {

        while (true) {

            const {
                value,
                done
            } =
                await reader.read();


            if (done) {
                break;
            }


            buffer +=
                decoder.decode(
                    value,
                    {
                        stream: true
                    }
                );


            const lines =
                buffer.split("\n");


            buffer =
                lines.pop() || "";


            for (
                const rawLine of lines
            ) {

                const line =
                    rawLine.trim();


                if (!line) {
                    continue;
                }


                let data;


                try {

                    data =
                        JSON.parse(line);

                } catch (_) {

                    continue;

                }


                processStreamEvent(
                    data,
                    text => {

                        assistantText +=
                            text;

                        assistantContentElement.innerHTML =
                            formatMessage(
                                assistantText
                            );

                        attachCopyHandlers(
                            assistantContentElement
                        );

                        scrollMessagesToBottom();

                    },
                    resetAssistantText
                );

            }

        }


        buffer +=
            decoder.decode();


        const finalLines =
            buffer
                .split("\n")
                .map(
                    line =>
                        line.trim()
                )
                .filter(Boolean);


        for (
            const line of finalLines
        ) {

            try {

                const data =
                    JSON.parse(line);


                processStreamEvent(
                    data,
                    text => {

                        assistantText +=
                            text;

                        assistantContentElement.innerHTML =
                            formatMessage(
                                assistantText
                            );

                        attachCopyHandlers(
                            assistantContentElement
                        );

                    },
                    resetAssistantText
                );

            } catch (_) {}

        }


        if (assistantText.trim()) {

            addRegenerateButton(
                assistantContentElement
            );

        }


    } finally {

        reader.releaseLock();

    }

}


function processStreamEvent(
    data,
    appendText,
    resetText
) {

    if (
        data.type === "activity" ||
        data.type === "agent_activity"
    ) {

        processAgentActivityEvent(
            data
        );

        return;
    }

    if (data.type === "reset") {
        resetText?.();
        return;
    }


    if (
        data.type === "chunk"
    ) {

        appendText(
            data.content || ""
        );

        return;
    }


    if (
        data.type === "done"
    ) {

        if (
            data.answer &&
            activeAssistantElement &&
            !activeAssistantElement.textContent.trim()
        ) {

            activeAssistantElement.innerHTML =
                formatMessage(
                    data.answer
                );

        }

        if (activeAssistantElement) {
            addModelAttribution(activeAssistantElement, data);
        }

        processAgentPayload(
            data
        );

        return;
    }


    if (
        data.type === "error"
    ) {

        throw new Error(
            data.error ||
            "Streaming error."
        );

    }

}


function processAgentPayload(
    data
) {

    if (!data) {
        return;
    }


    if (
        Array.isArray(data.activity)
    ) {

        data.activity.forEach(
            processAgentActivityEvent
        );

    }


    if (data.project) {
        renderProject(
            data.project
        );
    }


    if (
        data.verification
    ) {

        renderVerification(
            data.verification
        );

    }


    if (
        data.previewUrl
    ) {

        showPreview(
            data.previewUrl
        );

    }


    if (
        Array.isArray(data.changedFiles)
    ) {

        data.changedFiles.forEach(
            file => {

                addActivity(
                    "file",
                    `Changed ${file}`,
                    "completed"
                );

            }
        );

    }

}


/* =========================================================
   AGENT ACTIVITY
========================================================= */

function resetWorkspaceActivity() {

    agentActivity.innerHTML = `
        <div class="activity-empty">
            Jarwis activity will appear here when it works on your project.
        </div>
    `;

    activityState.textContent =
        "Ready";

    setAgentStatusClass("agent-status");

}


function startAgentActivity(
    type,
    message
) {

    addActivity(
        type,
        message,
        "active"
    );

}


function addActivity(
    type,
    message,
    state = "completed"
) {

    const empty =
        agentActivity.querySelector(
            ".activity-empty"
        );


    if (empty) {
        empty.remove();
    }


    const item =
        document.createElement(
            "div"
        );


    item.className =
        `activity-item ${state}`;


    const icon =
        document.createElement(
            "div"
        );


    icon.className =
        "activity-icon";


    icon.textContent =
        getActivityIcon(type);


    const text =
        document.createElement(
            "div"
        );


    text.className =
        "activity-text";


    text.textContent =
        message;


    const time =
        document.createElement(
            "span"
        );


    time.className =
        "activity-time";


    time.textContent =
        new Date().toLocaleTimeString(
            [],
            {
                hour: "2-digit",
                minute: "2-digit"
            }
        );


    text.appendChild(time);

    item.appendChild(icon);
    item.appendChild(text);

    agentActivity.appendChild(item);


    agentActivity.scrollTop =
        agentActivity.scrollHeight;


    if (state === "active") {

        activityState.textContent =
            "Working";

        setAgentStatusClass("agent-status working");

    }

}


function processAgentActivityEvent(
    data
) {

    const message =
        data.message ||
        data.content ||
        data.text ||
        "Agent activity";


    const type =
        data.stage ||
        data.action ||
        data.type ||
        "agent";


    addActivity(
        type,
        message,
        data.status === "error"
            ? "error"
            : data.status === "completed"
                ? "completed"
                : "active"
    );

}


function completeAgentActivity() {

    activityState.textContent =
        "Completed";

    setAgentStatusClass("agent-status success");

}


function failAgentActivity(
    message
) {

    activityState.textContent =
        "Error";

    setAgentStatusClass("agent-status");

    addActivity(
        "error",
        message ||
        "Agent operation failed.",
        "completed"
    );

}


function getActivityIcon(
    type
) {

    const value =
        String(type)
            .toLowerCase();


    if (value.includes("understand")) {
        return "◌";
    }

    if (value.includes("plan")) {
        return "◇";
    }

    if (value.includes("inspect")) {
        return "⌕";
    }

    if (
        value.includes("write") ||
        value.includes("create")
    ) {
        return "+";
    }

    if (
        value.includes("file") ||
        value.includes("update")
    ) {
        return "□";
    }

    if (value.includes("verify")) {
        return "✓";
    }

    if (value.includes("preview")) {
        return "▣";
    }

    if (value.includes("error")) {
        return "!";
    }

    return "•";

}


/* =========================================================
   WORKSPACE
========================================================= */

async function refreshWorkspace() {

    try {

        const response =
            await apiRequest(
                "/api/workspace"
            );


        const data =
            await response.json();


        const tree =
            data.tree ||
            data.files ||
            data;


        workspaceFiles =
            flattenWorkspaceTree(
                tree
            );


        renderWorkspaceTree(
            tree
        );


        fileCount.textContent =
            workspaceFiles.length;


        detectProject(
            workspaceFiles
        );


        if (
            workspaceFiles.some(
                file =>
                    file.path === "index.html"
            )
        ) {

            showPreview(
                getPreviewUrl()
            );

        } else {

            showPreviewPlaceholder();

        }


    } catch (error) {

        console.warn(
            "Workspace unavailable:",
            error
        );

        workspaceFiles = [];

        renderWorkspaceTree([]);
        showPreviewPlaceholder();

    }

}


function flattenWorkspaceTree(
    tree,
    result = []
) {

    if (!Array.isArray(tree)) {
        return result;
    }


    tree.forEach(
        item => {

            if (!item) {
                return;
            }


            const path = item.path || item.relativePath || item.name;


            if (
                item.type === "file" ||
                item.kind === "file" ||
                item.isFile === true
            ) {

                if (path) {
                    result.push({
                        path,
                        type: "file",
                        name:
                            item.name ||
                            path.split(/[\\/]/).pop()
                    });
                }

            }


            const children =
                item.children;


            if (
                Array.isArray(children)
            ) {

                flattenWorkspaceTree(
                    children,
                    result
                );

            }

        }
    );


    return result;

}


function renderWorkspaceTree(
    tree
) {

    workspaceTree.innerHTML = "";


    if (
        !Array.isArray(tree) ||
        !tree.length
    ) {

        workspaceTree.innerHTML = `
            <div class="tree-empty">
                Workspace is empty.
            </div>
        `;

        return;

    }


    const container =
        buildTreeElements(
            tree
        );


    workspaceTree.appendChild(
        container
    );

}


function buildTreeElements(
    items
) {

    const fragment =
        document.createDocumentFragment();


    items.forEach(
        item => {

            if (!item) {
                return;
            }


            const path =
                item.path ||
                item.relativePath ||
                item.name;


            const isDirectory =
                item.type === "directory" ||
                item.kind === "directory" ||
                item.isDirectory === true;


            const row =
                document.createElement(
                    "div"
                );


            row.className =
                `tree-item ${
                    isDirectory
                        ? "tree-folder"
                        : ""
                }`;


            if (
                selectedFilePath === path
            ) {

                row.classList.add(
                    "selected"
                );

            }


            const icon =
                document.createElement(
                    "span"
                );


            icon.className =
                "tree-icon";


            icon.textContent =
                isDirectory
                    ? "▾"
                    : getFileIcon(path);


            const name =
                document.createElement(
                    "span"
                );


            name.className =
                "tree-name";


            name.textContent =
                item.name ||
                path;


            row.appendChild(icon);
            row.appendChild(name);


            if (!isDirectory) {
                const actions = document.createElement("span");
                actions.className = "workspace-file-actions";

                const download = document.createElement("button");
                download.type = "button";
                download.className = "workspace-file-action";
                download.dataset.action = "download-workspace-file";
                download.dataset.filePath = path;
                download.title = `Download ${item.name || path}`;
                download.setAttribute("aria-label", download.title);
                download.textContent = "↓";
                download.addEventListener("click", async event => {
                    event.stopPropagation();
                    download.disabled = true;
                    try {
                        await downloadWorkspaceFile(path, item.name || path);
                    } catch (error) {
                        showCapabilityNotice(`File download failed: ${error.message}`);
                    } finally {
                        download.disabled = false;
                    }
                });

                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "workspace-file-action danger";
                remove.dataset.action = "delete-workspace-file";
                remove.dataset.filePath = path;
                remove.title = `Delete ${item.name || path}`;
                remove.setAttribute("aria-label", remove.title);
                remove.textContent = "×";
                remove.addEventListener("click", async event => {
                    event.stopPropagation();
                    if (!window.confirm(`Delete "${path}" from the workspace?`)) return;
                    remove.disabled = true;
                    try {
                        const response = await apiRequest(
                            `/api/workspace/file?path=${encodeURIComponent(path)}`,
                            { method: "DELETE" }
                        );
                        if (!response.ok) throw new Error(await getResponseError(response));
                        if (selectedFilePath === path) closeFileEditor();
                        await refreshWorkspace();
                        showCapabilityNotice(`Deleted ${path}.`);
                    } catch (error) {
                        remove.disabled = false;
                        showCapabilityNotice(`File deletion failed: ${error.message}`);
                    }
                });

                actions.append(download, remove);
                row.appendChild(actions);

                row.addEventListener(
                    "click",
                    async () => {

                        await openWorkspaceFile(
                            path
                        );

                    }
                );

            }


            fragment.appendChild(row);


            if (
                Array.isArray(
                    item.children
                )
            ) {

                const children =
                    document.createElement(
                        "div"
                    );


                children.className =
                    "tree-children";


                children.appendChild(
                    buildTreeElements(
                        item.children
                    )
                );


                fragment.appendChild(
                    children
                );

            }

        }
    );


    return fragment;

}


function getFileIcon(
    path
) {

    const lower =
        String(path)
            .toLowerCase();


    if (lower.endsWith(".html")) {
        return "H";
    }

    if (lower.endsWith(".css")) {
        return "#";
    }

    if (lower.endsWith(".js")) {
        return "J";
    }

    if (lower.endsWith(".json")) {
        return "{}";
    }

    if (lower.endsWith(".md")) {
        return "M";
    }

    return "·";

}


/* =========================================================
   PROJECT
========================================================= */

function detectProject(
    files
) {

    const paths =
        files.map(
            file =>
                String(
                    file.path || ""
                ).toLowerCase()
        );


    const hasHtml =
        paths.some(
            path =>
                path.endsWith(".html")
        );


    const hasCss =
        paths.some(
            path =>
                path.endsWith(".css")
        );


    const hasJs =
        paths.some(
            path =>
                path.endsWith(".js")
        );


    if (!files.length) {

        projectInfo.innerHTML = `
            <div class="project-empty">
                No project detected yet.
            </div>
        `;

        return;

    }


    let type =
        "Workspace Project";


    if (
        hasHtml &&
        hasCss &&
        hasJs
    ) {

        type =
            "Web Application";

    } else if (hasHtml) {

        type =
            "Website";

    }


    projectInfo.innerHTML = `

        <div class="project-card">

            <div class="project-name">
                Jarwis Workspace
            </div>

            <div class="project-type">
                ${escapeHtml(type)}
            </div>

            <div class="project-meta">

                <span class="project-tag">
                    ${files.length} files
                </span>

                ${
                    hasHtml
                        ? `
                            <span class="project-tag">
                                HTML
                            </span>
                        `
                        : ""
                }

                ${
                    hasCss
                        ? `
                            <span class="project-tag">
                                CSS
                            </span>
                        `
                        : ""
                }

                ${
                    hasJs
                        ? `
                            <span class="project-tag">
                                JavaScript
                            </span>
                        `
                        : ""
                }

            </div>

        </div>

    `;

}


/* =========================================================
   FILE EDITOR
========================================================= */

async function openWorkspaceFile(
    path
) {

    try {

        const response =
            await apiRequest(
                `/api/workspace/file?path=${encodeURIComponent(
                    path
                )}`
            );
        if (!response.ok) {
            throw new Error(await getResponseError(response));
        }


        const data =
            await response.json();


        const content =
            data.content ??
            data.file?.content ??
            "";


        selectedFilePath =
            path;

        selectedFileContent =
            content;


        selectedFileName.textContent =
            path;


        fileEditor.value =
            content;


        fileEditorSection.classList.remove(
            "hidden"
        );


        renderWorkspaceTree(
            await getWorkspaceTree()
        );


    } catch (error) {

        showToast(
            error.message ||
            "Unable to open file.",
            "error"
        );

    }

}

async function downloadWorkspaceFile(filePath, fileName) {
    const response = await apiRequest(
        `/api/workspace/download?path=${encodeURIComponent(filePath)}`
    );
    if (!response.ok) throw new Error(await getResponseError(response));

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName || filePath.split(/[\\/]/).pop() || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}


async function getWorkspaceTree() {

    try {

        const response =
            await apiRequest(
                "/api/workspace"
            );


        const data =
            await response.json();


        return (
            data.tree ||
            data.files ||
            data
        );

    } catch (_) {

        return [];

    }

}


async function saveSelectedFile() {

    if (!selectedFilePath) {
        return;
    }


    const content =
        fileEditor.value;


    try {

        const response = await apiRequest(
            "/api/workspace/file",
            {
                method: "PUT",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify({
                        path:
                            selectedFilePath,

                        content
                    })

            }
        );
        if (!response.ok) {
            throw new Error(await getResponseError(response));
        }


        selectedFileContent =
            content;


        addActivity(
            "update",
            `Saved ${selectedFilePath}`,
            "completed"
        );


        showToast(
            "File saved."
        );


        await refreshWorkspace();

        refreshPreview();


    } catch (error) {

        showToast(
            error.message ||
            "Unable to save file.",
            "error"
        );

    }

}


function closeFileEditor() {

    selectedFilePath = null;

    selectedFileContent = "";

    fileEditorSection.classList.add(
        "hidden"
    );

}


/* =========================================================
   PREVIEW
========================================================= */

function getPreviewUrl() {

    return (
        "/api/preview/index.html"
    );

}

function showPreviewPlaceholder() {
    previewContainer.innerHTML = `
        <div class="preview-placeholder">
            <div class="preview-icon" aria-hidden="true">◇</div>
            <div class="preview-title">No preview yet</div>
            <div class="preview-description">Create or upload an index.html file in your workspace to see a live preview here.</div>
        </div>
    `;
}


function showPreview(
    url
) {

    if (!url) {
        return;
    }


    const existing =
        previewContainer.querySelector(
            "iframe"
        );


    if (existing) {

        existing.src =
            `${url}${
                url.includes("?")
                    ? "&"
                    : "?"
            }t=${Date.now()}`;

        return;

    }


    previewContainer.innerHTML = "";


    const iframe =
        document.createElement(
            "iframe"
        );


    iframe.src =
        `${url}${
            url.includes("?")
                ? "&"
                : "?"
        }t=${Date.now()}`;


    iframe.title =
        "Jarwis live preview";


    iframe.loading =
        "lazy";


    previewContainer.appendChild(
        iframe
    );

}


function refreshPreview() {

    if (!workspaceFiles.some(file => file.path === "index.html")) {
        showPreviewPlaceholder();
        return;
    }

    const iframe =
        previewContainer.querySelector(
            "iframe"
        );


    if (iframe) {

        const current =
            iframe.src.split(
                "?t="
            )[0];


        iframe.src =
            `${current}?t=${Date.now()}`;

    } else {

        showPreview(
            getPreviewUrl()
        );

    }

}


function openPreview() {

    if (!workspaceFiles.some(file => file.path === "index.html")) {
        showCapabilityNotice("Create or upload an index.html file before opening a live preview.");
        return;
    }

    const url =
        getPreviewUrl();


    window.open(
        url,
        "_blank",
        "noopener,noreferrer"
    );

}


/* =========================================================
   VERIFICATION
========================================================= */

function renderVerification(
    result
) {

    if (!result) {
        return;
    }


    const success =
        result.success !== false &&
        result.valid !== false;


    const checks =
        result.checks ||
        result.results ||
        [];


    verificationPanel.innerHTML = `

        <div
            class="
                verification-result
                ${success ? "success" : "error"}
            "
        >

            <div class="verification-title">

                ${success
                    ? "✓ Verification passed"
                    : "Verification found issues"}

            </div>

            <div class="verification-details">

                ${
                    Array.isArray(checks)
                        ? checks
                            .map(
                                check => `
                                    <div class="verification-item">
                                        ${
                                            check.success === false ||
                                            check.valid === false
                                                ? "✗"
                                                : "✓"
                                        }
                                        ${escapeHtml(
                                            check.message ||
                                            check.name ||
                                            String(check)
                                        )}
                                    </div>
                                `
                            )
                            .join("")
                        : escapeHtml(
                            result.message ||
                            "Verification completed."
                        )
                }

            </div>

        </div>

    `;

}


/* =========================================================
   STOP
========================================================= */

function stopGeneration() {

    if (!isSending) {
        return;
    }


    if (activeAbortController) {
        activeAbortController.abort();
    }


    removeThinking();

}


/* =========================================================
   THINKING
========================================================= */

function showThinking() {

    removeThinking();


    const message =
        document.createElement(
            "div"
        );


    message.id =
        "thinkingMessage";


    message.className =
        "message thinking-message";


    message.innerHTML = `

        <div class="message-inner">

            <div class="message-avatar">
                N
            </div>

            <div class="message-body">

                <div class="message-sender">
                    Jarwis
                </div>

                <div class="thinking-indicator">

                    <span></span>
                    <span></span>
                    <span></span>

                </div>

            </div>

        </div>

    `;


    messages.appendChild(
        message
    );


    scrollMessagesToBottom();

}


function removeThinking() {

    const element =
        document.getElementById(
            "thinkingMessage"
        );


    if (element) {
        element.remove();
    }

}


/* =========================================================
   SEND STATE
========================================================= */

function setSendingState(
    sending
) {

    const text =
        sendButton.querySelector(
            ".send-button-text"
        );


    const icon =
        sendButton.querySelector(
            ".send-button-icon"
        );

    if (sending) {

        sendButton.title =
            "Stop generating";

        sendButton.setAttribute(
            "aria-label",
            "Stop generating"
        );

        setButtonIcon(sendButton, ICON_STOP);

    } else {

        sendButton.title =
            "Send message";

        sendButton.setAttribute(
            "aria-label",
            "Send message"
        );

        setButtonIcon(sendButton, ICON_PLUS);

    }

}


/* =========================================================
   REFRESH CHATS
========================================================= */

async function refreshChatsAfterMessage() {

    try {

        const response =
            await apiRequest(
                "/api/chats"
            );


        const data =
            await response.json();


        conversations =
            Array.isArray(data)
                ? data
                : (data.chats || []);


        const active =
            conversations.find(
                chat =>
                    Number(chat.id) ===
                    Number(activeConversationId)
            );


        if (active) {

            chatTitle.textContent =
                active.title ||
                "New Chat";

        }


        renderConversations(
            searchInput.value.trim()
        );


    } catch (error) {

        console.warn(error);

    }

}


/* =========================================================
   RENAME
========================================================= */

function openRenameModal(
    chat
) {

    if (!chat) {
        return;
    }


    renameChatInput.value =
        chat.title || "";


    renameModal.dataset.chatId =
        chat.id;


    renameModal.classList.add(
        "open"
    );


    renameModal.setAttribute(
        "aria-hidden",
        "false"
    );


    setTimeout(
        () => {

            renameChatInput.focus();

            renameChatInput.select();

        },
        50
    );

}


function closeRenameModal() {

    renameModal.classList.remove(
        "open"
    );


    renameModal.setAttribute(
        "aria-hidden",
        "true"
    );


    delete renameModal.dataset.chatId;

}


async function saveRename() {

    const chatId =
        renameModal.dataset.chatId;


    if (!chatId) {
        closeRenameModal();
        return;
    }


    const title =
        renameChatInput.value.trim();


    if (!title) {
        showToast(
            "Please enter a chat name.",
            "error"
        );

        return;
    }


    try {

        const response =
            await apiRequest(
                `/api/chats/${chatId}`,
                {
                    method: "PATCH",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            title
                        })

                }
            );


        const data =
            await response.json();


        const updated =
            data.chat || data;


        const chat =
            conversations.find(
                item =>
                    Number(item.id) ===
                    Number(chatId)
            );


        if (chat) {

            chat.title =
                updated.title ||
                title;

        }


        if (
            Number(activeConversationId) ===
            Number(chatId)
        ) {

            chatTitle.textContent =
                updated.title ||
                title;

        }


        renderConversations(
            searchInput.value.trim()
        );


        closeRenameModal();


    } catch (error) {

        showToast(
            error.message ||
            "Unable to rename chat.",
            "error"
        );

    }

}


/* =========================================================
   PIN
========================================================= */

async function togglePin(
    chat
) {

    try {

        const pinned =
            Number(chat.pinned) === 1
                ? 0
                : 1;


        const response =
            await apiRequest(
                `/api/chats/${chat.id}/pin`,
                {
                    method: "PATCH",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            pinned
                        })

                }
            );


        const data =
            await response.json();


        const updated =
            data.chat || data;


        chat.pinned =
            updated.pinned ??
            pinned;


        conversations.sort(
            (a, b) => {

                if (
                    Number(a.pinned) !==
                    Number(b.pinned)
                ) {

                    return (
                        Number(b.pinned) -
                        Number(a.pinned)
                    );

                }


                return (
                    new Date(
                        b.updated_at || 0
                    ) -
                    new Date(
                        a.updated_at || 0
                    )
                );

            }
        );


        renderConversations(
            searchInput.value.trim()
        );


    } catch (error) {

        showToast(
            error.message ||
            "Unable to pin chat.",
            "error"
        );

    }

}


/* =========================================================
   DELETE
========================================================= */

async function deleteChat(
    chat
) {

    if (!chat) {
        return;
    }


    if (
        !window.confirm(
            `Delete "${chat.title || "this chat"}"?`
        )
    ) {
        return;
    }


    try {

        await apiRequest(
            `/api/chats/${chat.id}`,
            {
                method: "DELETE"
            }
        );


        conversations =
            conversations.filter(
                item =>
                    Number(item.id) !==
                    Number(chat.id)
            );


        if (
            Number(activeConversationId) ===
            Number(chat.id)
        ) {

            activeConversationId = null;

            chatTitle.textContent =
                "Jarwis";

            showWelcome();

            resetWorkspaceActivity();

        }


        renderConversations(
            searchInput.value.trim()
        );


    } catch (error) {

        showToast(
            error.message ||
            "Unable to delete chat.",
            "error"
        );

    }

}


/* =========================================================
   FORMAT MESSAGE
========================================================= */

function formatMessage(
    text
) {

    if (!text) {
        return "";
    }


    let safe =
        escapeHtml(text);


    const codeBlocks = [];


    safe =
        safe.replace(
            /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g,
            (
                match,
                language,
                code
            ) => {

                const index =
                    codeBlocks.length;


                codeBlocks.push({
                    language:
                        language ||
                        "code",

                    code:
                        code.trim()
                });


                return (
                    `@@NEXUS_CODE_${index}@@`
                );

            }
        );


    safe =
        safe.replace(
            /^### (.+)$/gm,
            "<h3>$1</h3>"
        );


    safe =
        safe.replace(
            /^## (.+)$/gm,
            "<h2>$1</h2>"
        );


    safe =
        safe.replace(
            /^# (.+)$/gm,
            "<h1>$1</h1>"
        );


    safe =
        safe.replace(
            /\*\*(.+?)\*\*/g,
            "<strong>$1</strong>"
        );


    safe =
        safe.replace(
            /(^|[^\*])\*([^*\n]+)\*(?!\*)/g,
            "$1<em>$2</em>"
        );


    safe =
        safe.replace(
            /`([^`\n]+)`/g,
            "<code>$1</code>"
        );


    safe =
        safe.replace(
            /^(?:[-*]) (.+)$/gm,
            "<li>$1</li>"
        );


    safe =
        safe.replace(
            /((?:<li>.*<\/li>\s*)+)/g,
            "<ul>$1</ul>"
        );


    safe =
        safe.replace(
            /^\d+\. (.+)$/gm,
            "<li>$1</li>"
        );


    safe =
        safe.replace(
            /\n/g,
            "<br>"
        );


    codeBlocks.forEach(
        (
            block,
            index
        ) => {

            const codeHtml = `
                <div class="code-block">

                    <div class="code-header">

                        <span>
                            ${escapeHtml(
                                block.language
                            )}
                        </span>

                        <button
                            type="button"
                            class="copy-code-button"
                            data-code="${escapeAttribute(
                                block.code
                            )}"
                        >
                            Copy
                        </button>

                    </div>

                    <pre><code>${escapeHtml(
                        block.code
                    )}</code></pre>

                </div>
            `;


            safe =
                safe.replace(
                    `@@NEXUS_CODE_${index}@@`,
                    codeHtml
                );

        }
    );


    return safe;

}


/* =========================================================
   COPY
========================================================= */

function attachCopyHandlers(
    container
) {

    container
        .querySelectorAll(
            ".copy-code-button"
        )
        .forEach(
            button => {

                if (
                    button.dataset.bound ===
                    "true"
                ) {
                    return;
                }


                button.dataset.bound =
                    "true";


                button.addEventListener(
                    "click",
                    async () => {

                        try {

                            await navigator.clipboard.writeText(
                                button.dataset.code ||
                                ""
                            );


                            const original =
                                button.textContent;


                            button.textContent =
                                "Copied";


                            setTimeout(
                                () => {

                                    button.textContent =
                                        original;

                                },
                                1200
                            );


                        } catch (_) {

                            showToast(
                                "Unable to copy code.",
                                "error"
                            );

                        }

                    }
                );

            }
        );

}


/* =========================================================
   ESCAPE
========================================================= */

function escapeHtml(
    value
) {

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}


function escapeAttribute(
    value
) {

    return escapeHtml(value)
        .replace(
            /`/g,
            "&#096;"
        );

}


/* =========================================================
   TEXTAREA
========================================================= */

function autoResizeTextarea() {

    messageInput.style.height =
        "auto";


    const height =
        Math.min(
            messageInput.scrollHeight,
            180
        );


    messageInput.style.height =
        `${height}px`;

}


/* =========================================================
   SCROLL
========================================================= */

function scrollMessagesToBottom(
    smooth = true
) {

    requestAnimationFrame(
        () => {

            messages.scrollTo({
                top:
                    messages.scrollHeight,

                behavior:
                    smooth
                        ? "smooth"
                        : "auto"
            });

        }
    );

}


/* =========================================================
   ERROR RESPONSE
========================================================= */

async function getResponseError(
    response
) {

    let message =
        `Request failed (${response.status})`;


    try {

        const data =
            await response.json();


        if (data.error) {
            message =
                data.error;
        }

    } catch (_) {}


    return message;

}


/* =========================================================
   TOAST
========================================================= */

function showToast(
    message,
    type = "info"
) {

    const existing =
        document.querySelector(
            ".nexus-toast"
        );


    if (existing) {
        existing.remove();
    }


    const toast =
        document.createElement(
            "div"
        );


    toast.className =
        `nexus-toast ${type}`;


    toast.textContent =
        message;


    document.body.appendChild(
        toast
    );


    setTimeout(
        () => {

            toast.remove();

        },
        2800
    );

}

async function branchConversation(messageId) {
    if (!activeConversationId || isSending) return;
    try {
        const response = await apiRequest(`/api/chats/${activeConversationId}/branch`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messageId })
        });
        const data = await response.json();
        conversations.unshift(data.chat);
        activeConversationId = data.chat.id;
        chatTitle.textContent = data.chat.title;
        renderConversations();
        await openConversation(data.chat.id);
        showCapabilityNotice("Created a conversation branch.");
    } catch (error) {
        showCapabilityNotice(error.message);
    }
}
