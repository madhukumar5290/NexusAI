/**
 * Headless UI smoke test.
 *
 * The bug this exists to catch: an unguarded throw during startup
 * aborts setupEvents(), so the page renders but NOTHING responds.
 * Rendering correctly is not the same as working, so this asserts
 * that real controls actually do something when clicked.
 *
 * Usage: node scripts/ui-smoke.mjs
 */

import { createRequire } from "node:module";
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function resolvePatchright() {
    const roots = [];
    for (const base of [
        join(homedir(), ".vscode", "extensions"),
        join(homedir(), ".vscode-server", "extensions")
    ]) {
        if (!existsSync(base)) continue;
        const dirs = readdirSync(base)
            .filter(d => d.startsWith("danielsanmedium.dscodegpt-"))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const newest = dirs[dirs.length - 1];
        if (newest) roots.push(join(base, newest, "standalone") + "/");
    }
    for (const root of roots) {
        try {
            const mod = createRequire(root)("patchright");
            const candidates = [mod, mod?.default, mod?.default?.default];
            for (const c of candidates) {
                if (c && typeof c.chromium?.launch === "function") return c;
            }
        } catch { /* next */ }
    }
    throw new Error("patchright not resolved");
}

const pw = resolvePatchright();
const URL = process.env.NEXUS_URL || "http://127.0.0.1:3000/";

const browser = await pw.chromium.launch({
    headless: true,
    channel: "chromium",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-unsafe-swiftshader"]
});

const context = await browser.newContext({ locale: "en-US" });
const page = await context.newPage();

const pageErrors = [];
page.on("pageerror", e => pageErrors.push(String(e.message || e)));
page.on("console", m => {
    if (m.type() === "error") pageErrors.push("console: " + m.text().slice(0, 200));
});
page.on("response", response => {
    if (response.status() === 404) pageErrors.push(`HTTP 404: ${response.url()}`);
});

await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForSelector(".sidebar", { timeout: 15000 });
await page.waitForTimeout(2500);

const entryExperience = await page.evaluate(() => ({
    welcomeExplainsJarwis: Boolean(
        document.querySelector(".welcome-message h1")?.textContent.includes("What would you like") &&
        document.querySelector(".welcome-intro")?.textContent.includes("local models")
    ),
    liveSetupStatus: Boolean(document.getElementById("welcomeReadiness")),
    signInExplainsWorkflow: Boolean(
        document.querySelector(".auth-visual-panel") &&
        document.querySelectorAll(".auth-workflow-card").length === 3
    )
}));

const modelReadiness = await page.evaluate(async () => {
    try {
        const [capabilitiesResponse, runtimeResponse] = await Promise.all([
            fetch("/api/capabilities"),
            fetch("/api/runtime?task=chat&intelligence=balanced")
        ]);
        if (!capabilitiesResponse.ok || !runtimeResponse.ok) return false;
        const [capabilities, runtime] = await Promise.all([
            capabilitiesResponse.json(),
            runtimeResponse.json()
        ]);
        const installed = (capabilities.models || []).filter(model =>
            model.provider === "ollama" && model.available
        );
        const candidates = (runtime.routing?.candidates || []).filter(model =>
            model.local === true
        );
        const subtitle = document.querySelector("#welcomeReadiness .welcome-readiness-item small")?.textContent || "";
        if (!installed.length) return subtitle.includes("No local model is installed");
        if (candidates.length) {
            return subtitle.includes(`${candidates.length} ready for auto-routing`);
        }
        return subtitle.includes(`${installed.length} installed`) &&
            !subtitle.includes("ready on this PC");
    } catch {
        return false;
    }
});

/*
Each probe clicks a real control and checks for its observable
effect. If setupEvents() aborted, every one of these fails — which
is the signal that matters.
*/
const probes = await page.evaluate(() => {
    const results = [];

    const probe = (name, selector, effect) => {
        const el = document.querySelector(selector);
        if (!el) {
            results.push({ name, ok: false, why: "element missing" });
            return;
        }
        let ok = false;
        try {
            ok = effect(el);
        } catch (error) {
            results.push({ name, ok: false, why: String(error.message) });
            return;
        }
        results.push({ name, ok, why: ok ? "" : "no observable effect" });
    };

    /* The composer tool buttons toggle aria state. */
    probe("toolsButton", "#toolsButton", el => {
        const before = el.getAttribute("aria-expanded");
        el.click();
        return before !== el.getAttribute("aria-expanded");
    });

    probe("thinkButton", "#thinkButton", el => {
        const before = el.getAttribute("aria-pressed");
        el.click();
        return before !== el.getAttribute("aria-pressed");
    });

    probe("webSearchButton", "#webSearchButton", el => {
        const before = el.getAttribute("aria-pressed");
        el.click();
        return before !== el.getAttribute("aria-pressed");
    });

    /* The attachment button opens a menu. */
    probe("attachmentButton", "#attachmentButton", el => {
        el.click();
        const opened = !!document.querySelector(".attachment-menu");
        document.querySelector(".attachment-menu")?.remove();
        return opened;
    });

    /* The sidebar toggle collapses the rail. */
    probe("sidebarOpen", "#sidebarOpen", el => {
        const sidebar = document.querySelector(".sidebar");
        const before = sidebar.classList.contains("collapsed");
        el.click();
        const after = sidebar.classList.contains("collapsed");
        el.click(); /* restore */
        return before !== after;
    });

    probe("projectsPage", 'button[data-view="projects"]', el => {
        el.click();
        const pageWorks = Boolean(
            document.querySelector('#messages [data-product-action="open-project-create"]') &&
            document.querySelector("#projectsList") &&
            document.getElementById("chatTitle").textContent === "Projects"
        );
        document.querySelector('#messages [data-product-action="open-project-create"]')?.click();
        const createDialogWorks = document.getElementById("projectCreateModal")
            ?.getAttribute("aria-hidden") === "false";
        document.querySelector("#projectCreateModal [data-action='close-project-create']")?.click();
        document.getElementById("sidebarNewProject")?.click();
        const sidebarActionWorks = document.getElementById("projectCreateModal")
            ?.getAttribute("aria-hidden") === "false";
        document.querySelector("#projectCreateModal [data-action='close-project-create']")?.click();
        return pageWorks && createDialogWorks && sidebarActionWorks &&
            document.querySelector('button[data-view="projects"]')
                .classList.contains("active");
    });

    /* Settings must open and render its sections. */
    probe("controlCenterButton", "#controlCenterButton", el => {
        el.click();
        const modal = document.getElementById("controlCenterModal");
        return Boolean(modal && modal.classList.contains("open"));
    });

    /* Undo the modal for the next checks. */
    document.querySelectorAll(".modal-overlay").forEach(m => {
        m.classList.remove("open");
        m.setAttribute("aria-hidden", "true");
    });

    return results;
});

/* Once Settings is open, its sections must be present and switchable. */
await page.evaluate(() => document.getElementById("controlCenterButton").click());
await page.waitForTimeout(2500);

const settings = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll("[data-settings-section]")];
    if (!tabs.length) return { tabCount: 0, switchWorks: false, visiblePerTab: [] };

    const visiblePerTab = [];
    let switchWorks = true;

    for (const tab of tabs) {
        tab.click();
        const visible = [...document.querySelectorAll("[data-settings-panel]")]
            .filter(p => getComputedStyle(p).display !== "none").length;
        visiblePerTab.push({ section: tab.dataset.settingsSection, visible });
        if (visible !== 1) switchWorks = false;
    }

    const modelsTab = tabs.find(tab => tab.dataset.settingsSection === "models");
    modelsTab?.click();
    const cloudKeySetup = Boolean(
        document.querySelector('[data-provider-key-env="GOOGLE_API_KEY"]') &&
        document.querySelector('[data-provider-key-env="GROQ_API_KEY"]') &&
        document.querySelector('[data-provider-key-env="OPENROUTER_API_KEY"]') &&
        document.querySelector("[data-save-provider-keys]")
    );

    const profileTab = tabs.find(tab => tab.dataset.settingsSection === "profile");
    profileTab?.click();
    const accountSessionControls = Boolean(
        document.getElementById("profileAuthState") &&
        document.querySelector("[data-auth-signin]") &&
        document.querySelector("[data-auth-logout]")
    );
    const settingsNav = document.querySelector("#controlCenterModal .settings-nav");
    const activeHero = document.querySelector(
        "#controlCenterModal .settings-panel-section.active > h2 + .settings-description"
    );
    const settingsVisuals = Boolean(
        document.querySelector("#controlCenterModal .settings-nav-brand") &&
        document.querySelectorAll("#controlCenterModal .settings-nav-group-title").length === 4 &&
        settingsNav?.querySelectorAll(".settings-nav-item").length === 16 &&
        settingsNav?.querySelectorAll(".settings-nav-product").length === 6 &&
        document.querySelector('[data-settings-panel="memory"] #memoryList') &&
        settingsNav?.querySelector('[data-settings-section="security"]')?.textContent.trim() === "Admin" &&
        activeHero &&
        document.querySelector("#controlCenterModal .capability-section")
    );

    return {
        tabCount: tabs.length,
        switchWorks,
        visiblePerTab,
        cloudKeySetup,
        accountSessionControls,
        settingsVisuals
    };
});

const accountAndProjects = await page.evaluate(async () => {
    const closeSettings = () => {
        const modal = document.getElementById("controlCenterModal");
        modal?.classList.remove("open");
        modal?.setAttribute("aria-hidden", "true");
    };
    const accountButton = document.getElementById("accountSettingsButton");
    const menu = document.getElementById("accountMenu");
    accountButton?.click();
    const menuOptions = [...(menu?.querySelectorAll("[data-account-action]") || [])]
        .map(button => button.dataset.accountAction);
    const menuOpens = Boolean(menu?.classList.contains("open"));
    const workspaceViews = [...(menu?.querySelectorAll("[data-view]") || [])]
        .map(button => button.dataset.view);
    const leftInMainNavigation = [...document.querySelectorAll(".sidebar-navigation [data-view]")]
        .map(button => button.dataset.view);
    menu?.querySelector('[data-account-action="settings"]')?.click();
    const settingsOpens = document.getElementById("controlCenterModal")?.getAttribute("aria-hidden") === "false";
    closeSettings();

    accountButton?.click();
    menu?.querySelector('[data-account-action="settings"]')?.click();
    await new Promise(resolve => setTimeout(resolve, 450));
    const settingsNav = document.querySelector("#controlCenterModal .settings-nav");
    const workspaceNavActions = [
        ...(settingsNav?.querySelectorAll("[data-settings-view]") || [])
    ].map(button => button.dataset.settingsView);
    const memoryNav = settingsNav?.querySelector('[data-settings-section="memory"]');
    memoryNav?.click();
    const memoryOpens = document.querySelector(
        '#controlCenterModal .settings-panel-section.active[data-settings-panel="memory"] #memoryList'
    ) !== null;
    const adminNav = settingsNav?.querySelector('[data-settings-section="security"]');
    adminNav?.click();
    await new Promise(resolve => setTimeout(resolve, 400));
    const adminOpens = document.querySelector(
        '#controlCenterModal .settings-panel-section.active[data-settings-panel="security"]'
    ) !== null;
    const adminControlsReady = Boolean(
        !document.getElementById("apiKeyList")?.textContent.includes("requires the owner or admin role") &&
        !document.getElementById("auditLogList")?.textContent.includes("requires the owner or admin role")
    );
    closeSettings();

    const featureTargets = [
        ["workspace", "#workspacePage:not([hidden])"],
        ["scheduled", "#scheduledBody"],
        ["library", "#libraryBody"],
        ["plugins", "#pluginsBody"],
        ["usage", "#usageBody"],
        ["benchmarks", "#benchmarkBody"]
    ];
    const workspaceNavigationWorks = [];
    let scheduledOpensFromSettings = false;
    for (const [view, selector] of featureTargets) {
        document.getElementById("controlCenterButton")?.click();
        for (let attempt = 0; attempt < 30; attempt += 1) {
            if (document.querySelector(`.settings-nav [data-settings-view="${view}"]`)) break;
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        const target = document.querySelector(`.settings-nav [data-settings-view="${view}"]`);
        target?.click();
        await new Promise(resolve => setTimeout(resolve, view === "workspace" ? 300 : 100));
        const workspacePreviewReady = view !== "workspace" || Boolean(
            document.querySelector("#previewContainer .preview-placeholder") &&
            !document.querySelector("#previewContainer iframe")
        );
        workspaceNavigationWorks.push(
            target !== null &&
            document.getElementById("controlCenterModal")?.getAttribute("aria-hidden") === "true" &&
            Boolean(document.querySelector(selector)) &&
            workspacePreviewReady
        );
        if (view === "scheduled") {
            scheduledOpensFromSettings = Boolean(document.querySelector("#scheduledBody"));
        }
    }
    const menuClosesAfterNavigation = !menu?.classList.contains("open");

    accountButton?.click();
    menu?.querySelector('[data-account-action="profile"]')?.click();
    await new Promise(resolve => setTimeout(resolve, 450));
    const profileOpens = document.querySelector(
        '#controlCenterModal .settings-panel-section.active[data-settings-panel="profile"]'
    ) !== null;
    closeSettings();

    document.querySelector('[data-view="projects"]')?.click();
    const projectPageOpens = Boolean(document.querySelector("#projectsList"));
    const createButton = document.querySelector('[data-product-action="open-project-create"]');
    const noInlineProjectForm = !document.querySelector("#messages #projectNameInput");
    createButton?.click();
    const modal = document.getElementById("projectCreateModal");
    const createModalOpens = modal?.getAttribute("aria-hidden") === "false";
    document.getElementById("projectNameInput")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
    );
    const emptyNameValidation = document.getElementById("projectCreateError")?.textContent.includes("project name");
    document.querySelector("#projectCreateModal [data-action='close-project-create']")?.click();
    document.getElementById("sidebarNewProject")?.click();
    const sidebarPlusOpensDialog = modal?.getAttribute("aria-hidden") === "false";
    modal?.classList.remove("open");
    modal?.setAttribute("aria-hidden", "true");

    return {
        menuOpens,
        menuOptions,
        workspaceViews,
        workspaceNavActions,
        memoryOpens,
        adminOpens,
        adminControlsReady,
        workspaceNavigationWorks,
        leftInMainNavigation,
        scheduledOpensFromSettings,
        menuClosesAfterNavigation,
        settingsOpens,
        profileOpens,
        projectPageOpens,
        noInlineProjectForm,
        createModalOpens,
        emptyNameValidation,
        sidebarPlusOpensDialog
    };
});

let chatProjectFlow = { ok: false, error: "flow did not run" };
let testProjectId = null;
let testChatId = null;
try {
    const projectResponse = await fetch(`${URL}api/projects`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: `UI flow ${Date.now()}`, goal: "UI regression check" })
        });
    if (!projectResponse.ok) throw new Error("project create failed");
    const project = await projectResponse.json();
    testProjectId = String(project.project.chatId);

    const chatResponse = await fetch(`${URL}api/chats`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "UI flow chat" })
        });
    if (!chatResponse.ok) throw new Error("chat create failed");
    const chat = await chatResponse.json();
    testChatId = String(chat.id);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(`.conversation-item[data-chat-id="${testChatId}"]`, { timeout: 10000 });
    const row = page.locator(`.conversation-item[data-chat-id="${testChatId}"]`);
    await row.hover();
    await row.locator('[aria-haspopup="menu"]').click();
    const menuActions = await row.locator("[data-chat-action]").evaluateAll(
        buttons => buttons.map(button => button.dataset.chatAction)
    );
    await row.locator('[data-chat-action="project"]').click();
    await page.waitForFunction(projectId => {
        return [...document.querySelectorAll("#chatProjectSelect option")]
            .some(option => option.value === projectId);
    }, testProjectId, { timeout: 5000 });
    await page.locator("#chatProjectSelect").selectOption(testProjectId);
    await page.locator('#chatProjectModal [data-product-action="save-chat-project"]').click();
    await page.waitForFunction(async ({ chatId, projectId }) => {
        const response = await fetch(`/api/chats/${chatId}`);
        if (!response.ok) return false;
        const data = await response.json();
        return Number(data.chat.project_id) === Number(projectId);
    }, { chatId: testChatId, projectId: testProjectId }, { timeout: 5000 });

    await page.locator('[data-view="projects"]').click();
    const detailsButton = page.locator(`[data-product-action="open-project-details"][data-project-id="${testProjectId}"]`);
    await detailsButton.waitFor({ timeout: 10000 });
    await detailsButton.click();
    await page.locator("#projectDetailModal")
        .getByText("UI flow chat", { exact: true })
        .waitFor({ timeout: 5000 });
    const detailWorks = await page.locator("#projectDetailModal").getAttribute("aria-hidden") === "false";
    await page.locator("#projectDetailModal .modal-close-button").click();
    await row.hover();
    await row.locator('[aria-haspopup="menu"]').click();
    await row.locator('[data-chat-action="share"]').click();
    const shareModal = page.locator("#chatShareModal");
    await shareModal.getByText("Share this chat", { exact: true }).waitFor({ timeout: 5000 });
    const shareExplainsLocalPrivacy = await shareModal
        .getByText(/public share links and invited collaborators are not enabled/)
        .count() === 1;
    await shareModal.locator('[data-product-action="copy-chat-transcript"]').click();
    await page.locator("#chatShareError")
        .getByText("This chat does not have any messages to copy yet.")
        .waitFor({ timeout: 5000 });
    const shareEmptyStateWorks = await shareModal.getAttribute("aria-hidden") === "false";
    await shareModal.locator(".modal-close-button").click();
    chatProjectFlow = {
        ok: menuActions.join(",") === "pin,rename,project,share,archive,delete" &&
            detailWorks && shareExplainsLocalPrivacy && shareEmptyStateWorks,
        menuActions,
        detailWorks,
        shareExplainsLocalPrivacy,
        shareEmptyStateWorks
    };
} catch (error) {
    chatProjectFlow = { ok: false, error: String(error.message || error) };
} finally {
    if (testProjectId) {
        await fetch(`${URL}api/projects/${encodeURIComponent(testProjectId)}`, { method: "DELETE" }).catch(() => {});
    }
    if (testChatId) {
        await fetch(`${URL}api/chats/${encodeURIComponent(testChatId)}`, { method: "DELETE" }).catch(() => {});
    }
}

await page.setViewportSize({ width: 390, height: 844 });
const mobileResponsive = await page.evaluate(() => {
    document.querySelector('[data-view="projects"]')?.click();
    const mobileSidebarCloses = document.querySelector(".sidebar")?.classList.contains("collapsed") === true;
    const login = document.getElementById("authLoginModal");
    login?.classList.add("open");
    login?.setAttribute("aria-hidden", "false");
    const form = login?.querySelector(".auth-login-modal");
    const visual = login?.querySelector(".auth-visual-panel");
    const settingsModal = document.getElementById("controlCenterModal");
    settingsModal?.classList.add("open");
    settingsModal?.setAttribute("aria-hidden", "false");
    const nav = document.querySelector("#controlCenterModal .settings-nav");
    const projectsHero = document.querySelector(".projects-hero");
    const formBounds = form?.getBoundingClientRect();
    const projectsHeroBounds = projectsHero?.getBoundingClientRect();
    const result = {
        loginFitsViewport: Boolean(formBounds && formBounds.width <= innerWidth),
        loginArtworkStacksAway: Boolean(visual && getComputedStyle(visual).display === "none"),
        settingsNavigationScrolls: Boolean(nav && nav.scrollWidth > nav.clientWidth),
        mobileSidebarCloses,
        projectsDashboardFits: Boolean(
            projectsHeroBounds &&
            projectsHeroBounds.width >= 280 &&
            document.documentElement.scrollWidth <= innerWidth
        )
    };
    login?.classList.remove("open");
    login?.setAttribute("aria-hidden", "true");
    settingsModal?.classList.remove("open");
    settingsModal?.setAttribute("aria-hidden", "true");
    return result;
});

await browser.close();

const failedProbes = probes.filter(p => !p.ok);

const report = {
    probes,
    passed: probes.length - failedProbes.length,
    total: probes.length,
    entryExperience,
    modelReadiness,
    settings,
    accountAndProjects,
    chatProjectFlow,
    mobileResponsive,
    pageErrors
};

console.log(JSON.stringify(report, null, 1));

const ok =
    failedProbes.length === 0 &&
    settings.tabCount > 0 &&
    settings.switchWorks &&
    settings.cloudKeySetup &&
    settings.accountSessionControls &&
    settings.settingsVisuals &&
    accountAndProjects.menuOpens &&
    accountAndProjects.menuOptions.join(",") === "settings,profile,signout" &&
    accountAndProjects.workspaceViews.length === 0 &&
    accountAndProjects.workspaceNavActions.join(",") === "workspace,scheduled,library,plugins,usage,benchmarks" &&
    accountAndProjects.memoryOpens &&
    accountAndProjects.adminOpens &&
    accountAndProjects.adminControlsReady &&
    accountAndProjects.workspaceNavigationWorks.every(Boolean) &&
    accountAndProjects.leftInMainNavigation.join(",") === "projects,images" &&
    accountAndProjects.scheduledOpensFromSettings &&
    accountAndProjects.menuClosesAfterNavigation &&
    accountAndProjects.settingsOpens &&
    accountAndProjects.profileOpens &&
    accountAndProjects.projectPageOpens &&
    accountAndProjects.noInlineProjectForm &&
    accountAndProjects.createModalOpens &&
    accountAndProjects.emptyNameValidation &&
    accountAndProjects.sidebarPlusOpensDialog &&
    chatProjectFlow.ok &&
    mobileResponsive.loginFitsViewport &&
    mobileResponsive.loginArtworkStacksAway &&
    mobileResponsive.settingsNavigationScrolls &&
    mobileResponsive.mobileSidebarCloses &&
    mobileResponsive.projectsDashboardFits &&
    entryExperience.welcomeExplainsJarwis &&
    entryExperience.liveSetupStatus &&
    modelReadiness &&
    entryExperience.signInExplainsWorkflow &&
    pageErrors.length === 0;

console.log(ok ? "\nUI SMOKE: PASS" : "\nUI SMOKE: FAIL");
process.exit(ok ? 0 : 1);