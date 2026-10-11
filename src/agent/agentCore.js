const path = require("path");

const projectState = require("./projectState");
const database = require("../rag/database");
const workspaceTools = require("./workspaceTools");
const providers = require("../../lib/providers");
const { collect } = require("../../lib/providers/base");
const { parseJson } = require("../../lib/ollama");

function unique(values) {
    return [
        ...new Set(
            (values || [])
                .map(value =>
                    String(value || "").trim()
                )
                .filter(Boolean)
        )
    ];
}

/*
==================================================
PROJECT UNDERSTANDING
==================================================
*/

function inferProject(
    userMessage,
    conversation,
    existing
) {
    const text =
        `${conversation || ""}\n${userMessage || ""}`
            .toLowerCase();

    const detected =
        !!existing ||
        /\bportfolio\b/.test(text) ||
        /\bwebsite\b/.test(text) ||
        /\bweb site\b/.test(text) ||
        /\blanding page\b/.test(text) ||
        /\bweb app\b/.test(text) ||
        /\bwebapp\b/.test(text) ||
        /\bhtml\b/.test(text) ||
        /\bcss\b/.test(text) ||
        /\bjavascript\b/.test(text) ||
        /\breact\b/.test(text) ||
        /\bnode\b/.test(text);

    if (!detected) {
        return null;
    }

    let name =
        existing?.name ||
        "Website Project";

    let goal =
        existing?.goal ||
        "";

    if (/\bportfolio\b/.test(text)) {
        name = "Portfolio Website";

        if (!goal) {
            goal =
                "Create a live portfolio website";
        }
    } else if (!goal) {
        goal =
            "Create a functional web project";
    }

    const requirements = [
        ...(existing?.requirements || [])
    ];

    const preferences = [
        ...(existing?.preferences || [])
    ];

    const artifacts = [
        ...(existing?.artifacts || [])
    ];

    /*
    ----------------------------------------------
    Requirements
    ----------------------------------------------
    */

    if (
        /\blive\b/.test(text) ||
        /\bfunctional\b/.test(text) ||
        /\bworking\b/.test(text) ||
        /\bproduction\b/.test(text)
    ) {
        requirements.push(
            "functional/live website"
        );
    }

    if (
        /\bnot simple\b/.test(text) ||
        /\bnot basic\b/.test(text) ||
        /\badvanced\b/.test(text) ||
        /\bcomplex\b/.test(text) ||
        /\bmore than a simple\b/.test(text)
    ) {
        requirements.push(
            "more than a simple website"
        );
    }

    /*
    ----------------------------------------------
    Preferences
    ----------------------------------------------
    */

    if (
        /\bpremium\b/.test(text) ||
        /\bhigh[- ]end\b/.test(text) ||
        /\bprofessional\b/.test(text) ||
        /\bpolished\b/.test(text)
    ) {
        preferences.push(
            "premium visual design"
        );
    }

    if (
        /\bdark\b/.test(text) ||
        /\bdark theme\b/.test(text)
    ) {
        preferences.push(
            "dark theme"
        );
    }

    /*
    ----------------------------------------------
    Expected artifacts
    ----------------------------------------------
    */

    if (/\bhtml\b/.test(text)) {
        artifacts.push("index.html");
    }

    if (/\bcss\b/.test(text)) {
        artifacts.push("style.css");
    }

    if (
        /\bjavascript\b/.test(text) ||
        /\bjs\b/.test(text)
    ) {
        artifacts.push("script.js");
    }

    if (
        /\bportfolio\b/.test(text) ||
        /\bwebsite\b/.test(text) ||
        /\blanding page\b/.test(text)
    ) {
        artifacts.push(
            "index.html",
            "style.css",
            "script.js"
        );
    }

    return {
        name,
        goal,

        requirements:
            unique(requirements),

        preferences:
            unique(preferences),

        artifacts:
            unique(artifacts),

        status:
            "in_progress"
    };
}

/*
==================================================
REQUEST CLASSIFICATION
==================================================
*/

function classify(
    userMessage,
    conversation,
    project
) {
    const text =
        String(userMessage || "")
            .trim()
            .toLowerCase();

    const context =
        `${conversation || ""}\n${text}`
            .toLowerCase();

    const workspaceCreate =
        (
            /\b(create|make|build|generate|develop|write)\b/
                .test(text) &&
            /\b(file|files|website|web site|web app|portfolio|project)\b/
                .test(text)
        ) ||
        /\bcan you create the file\b/.test(text) ||
        /\bcreate the file\b/.test(text);

    const workspaceModify =
        /\b(modify|update|change|edit|fix|improve|redesign|rewrite|refactor)\b/
            .test(text) &&
        (
            !!project ||
            /\b(file|files|website|portfolio|code|html|css|javascript)\b/
                .test(context)
        );

    /*
    ----------------------------------------------
    Intent rules, evaluated in order. The first
    match wins.
    ----------------------------------------------
    */

    const rules = [
        {
            name: "simple",

            test: () =>
                /^(hi|hello|hey|good morning|good afternoon|good evening)[!. ]*$/
                    .test(text)
        },

        {
            name: "web",

            test: () =>
                /\blatest\b/.test(text) ||
                /\bcurrent\b/.test(text) ||
                /\brecent news\b/.test(text) ||
                /\bsearch the web\b/.test(text) ||
                /\bsearch online\b/.test(text) ||
                /\bon the internet\b/.test(text) ||
                /\blook it up online\b/.test(text)
        },

        {
            name: "documents",

            test: () =>
                /\b(list|show|what are)\b/.test(text) &&
                /\b(documents|files)\b/.test(text)
        },

        {
            name: "rag",

            test: () =>
                (
                    /\baccording to\b/.test(text) &&
                    /\b(document|pdf|file)\b/.test(text)
                ) ||
                (
                    /\bwhat does\b/.test(text) &&
                    /\b(document|pdf|file)\b/.test(text) &&
                    /\bsay\b/.test(text)
                )
        },

        {
            name: "status",

            test: () =>
                /\bnexus status\b/.test(text) ||
                /\bstatus of nexus\b/.test(text) ||
                /\bis nexus running\b/.test(text)
        },

        {
            name: "workspace_modify",

            test: () => workspaceModify
        },

        {
            name: "workspace_create",

            test: () => workspaceCreate
        },

        {
            name: "workspace_read",

            test: () =>
                /\b(read|open|show|inspect|look at|check)\b/.test(text) &&
                /\b(file|files|workspace|code)\b/.test(text)
        },

        {
            name: "code",

            test: () =>
                /\b(give me|show me|write|generate|provide)\b/.test(text) &&
                /\b(code|implementation)\b/.test(text)
        }
    ];

    for (const rule of rules) {
        if (rule.test()) {
            return rule.name;
        }
    }

    return "direct";
}

/*
==================================================
PROJECT STATE
==================================================
*/

function buildProjectContext(
    chatId,
    userMessage,
    conversation,
    inheritedProject = null
) {
    const ownProject = projectState.get(chatId);
    const existing = ownProject || inheritedProject;

    const inferred =
        inferProject(
            userMessage,
            conversation,
            existing
        );

    if (!inferred) {
        return existing;
    }

    return projectState.save(
        inheritedProject && !ownProject
            ? inheritedProject.chatId
            : chatId,
        inferred
    );
}

/*
==================================================
WORKSPACE PLAN
==================================================
*/

async function generateWorkspacePlan(
    userMessage,
    conversation,
    project,
    existingFiles,
    mode,
    provider,
    model
) {
    const fileSummary =
        (existingFiles || [])
            .slice(0, 25)
            .map(
                file =>
                    `--- ${file.path} ---\n${file.content}`
            )
            .join("\n\n");

    const prompt = `
You are the implementation engine for Jarwis.

TASK:
${userMessage}

MODE:
${mode}

ACTIVE PROJECT:
Name: ${project?.name || "Web Project"}

Goal:
${project?.goal || "Build a functional web project"}

Requirements:
${(project?.requirements || []).join(", ") || "None"}

Preferences:
${(project?.preferences || []).join(", ") || "None"}

EXISTING WORKSPACE FILES:
${fileSummary || "No existing files."}

Return ONLY valid JSON in this exact shape:

{
  "files": [
    {
      "path": "relative/path/file.ext",
      "content": "complete file content"
    }
  ]
}

RULES:

- Return complete files.
- Never return partial snippets.
- Never use Markdown fences.
- Paths must be relative to the Nexus workspace.
- Never use .. in paths.
- Never use absolute paths.
- Keep the project coherent and runnable.
- For a browser portfolio, normally use:
  index.html
  style.css
  script.js
- If existing files are provided and MODE is MODIFY:
  preserve useful existing functionality.
- Return the complete updated files.
- Do not claim deployment.
- Do not claim hosting.
- Do not claim Git commits.
- Do not perform external actions.
- Do not return explanations outside the JSON.
`;

    const completion = await collect(providers.chat({
        role: "code",
        provider,
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        maxTokens: 16000
    }));
    const answer = completion.text;

    const parsed =
        parseJson(answer);

    if (
        !parsed ||
        !Array.isArray(parsed.files)
    ) {
        throw new Error(
            "Invalid workspace plan: files array is missing."
        );
    }

    return parsed;
}

/*
==================================================
PATH SECURITY
==================================================
*/

function validateRelativePath(
    filePath
) {
    const raw =
        String(filePath || "").trim();

    if (!raw) {
        throw new Error(
            "File path is empty."
        );
    }

    if (path.isAbsolute(raw)) {
        throw new Error(
            `Absolute paths are not allowed: ${raw}`
        );
    }

    const normalized =
        path.posix.normalize(
            raw.replace(/\\/g, "/")
        );

    if (
        normalized === ".." ||
        normalized.startsWith("../") ||
        normalized.includes("/../") ||
        normalized.includes("\0")
    ) {
        throw new Error(
            `Unsafe file path: ${raw}`
        );
    }

    return normalized.replace(
        /^\/+/,
        ""
    );
}

/*
==================================================
WORKSPACE INSPECTION
==================================================
*/

function collectWorkspaceFiles(
    tree,
    prefix = ""
) {
    const result = [];

    if (!Array.isArray(tree)) {
        return result;
    }

    for (const item of tree) {
        const itemPath =
            item.path ||
            item.name;

        if (!itemPath) {
            continue;
        }

        const fullPath =
            prefix
                ? `${prefix}/${itemPath}`
                : itemPath;

        if (
            item.type === "directory" ||
            Array.isArray(item.children)
        ) {
            result.push(
                ...collectWorkspaceFiles(
                    item.children || [],
                    fullPath
                )
            );
        } else {
            result.push(fullPath);
        }
    }

    return result;
}

/*
==================================================
EXECUTE + VERIFY
==================================================
*/

async function executeWorkspace(
    chatId,
    userMessage,
    conversation,
    project,
    mode,
    emitActivity = null,
    modelOptions = {}
) {
    function activity(message) {
        if (typeof emitActivity === "function") {
            try {
                emitActivity(message);
            } catch {}
        }
    }
    const tree =
        workspaceTools.getWorkspaceTree();

    const existingPaths =
        collectWorkspaceFiles(tree);

    const existingFiles = [];

    for (
        const filePath of existingPaths.slice(
            0,
            50
        )
    ) {
        try {
            const file =
                workspaceTools.readFile(
                    filePath
                );

            const content = file?.content;

            if (content != null) {
                existingFiles.push({
                    path: filePath,
                    content:
                        String(content).slice(
                            0,
                            30000
                        )
                });
            }
        } catch {}
    }

    activity(`Inspecting ${existingFiles.length} existing file(s)`);

    const plan =
        await generateWorkspacePlan(
            userMessage,
            conversation,
            project,
            existingFiles,
            mode,
            modelOptions.provider,
            modelOptions.model
        );

    const changed = [];
    const verified = [];

    activity(`Writing ${plan.files.length} file(s)`);

    for (const file of plan.files) {
        const relativePath =
            validateRelativePath(
                file.path
            );

        const content =
            String(
                file.content ?? ""
            );

        if (!content) {
            throw new Error(
                `Generated file is empty: ${relativePath}`
            );
        }

        const exists =
            workspaceTools.fileExists(
                relativePath
            ).exists;

        if (
            mode === "MODIFY" &&
            exists
        ) {
            workspaceTools.updateFile(
                relativePath,
                content
            );
        } else {
            workspaceTools.createFile(
                relativePath,
                content
            );
        }

        changed.push(
            relativePath
        );

        activity(`Wrote + verified ${relativePath}`);

        /*
        ------------------------------------------
        Verification 1
        ------------------------------------------
        */

        if (
            !workspaceTools.fileExists(
                relativePath
            ).exists
        ) {
            throw new Error(
                `Verification failed: ${relativePath}`
            );
        }

        /*
        ------------------------------------------
        Verification 2
        ------------------------------------------
        */

        const saved =
            workspaceTools.readFile(
                relativePath
            ).content;

        if (
            String(saved) !== content
        ) {
            throw new Error(
                `Verification failed: saved content differs for ${relativePath}`
            );
        }

        verified.push(
            relativePath
        );
    }

    const updatedProject =
        projectState.merge(
            project?.chatId || chatId,
            {
                name:
                    project?.name ||
                    "Website Project",

                goal:
                    project?.goal ||
                    "Create a functional web project",

                artifacts:
                    changed,

                status:
                    "in_progress"
            }
        );

    activity(`Verification passed for ${verified.length} file(s)`);

    return {
        success: true,

        mode,

        changed,

        verified,

        project:
            updatedProject,

        workspaceRoot:
            workspaceTools.getWorkspaceRoot()
    };
}

/*
==================================================
RESULT
==================================================
*/

function formatWorkspaceResult(
    result
) {
    const verb =
        result.mode === "MODIFY"
            ? "updated"
            : "created";

    return [
        `Done. I ${verb} the project files in the Nexus workspace.`,
        "",
        `Project: ${
            result.project?.name ||
            "Website Project"
        }`,
        `Workspace: ${
            result.workspaceRoot
        }`,
        "",
        "Verified files:",

        ...result.verified.map(
            file => `- ${file}`
        ),

        "",
        "The file contents were written and verified successfully."
    ].join("\n");
}

/*
==================================================
MAIN AGENT
==================================================
*/

async function run({
    chatId,
    userMessage,
    conversation,
    executeWorkspaceActions = true,
    onActivity = null,
    provider = null,
    model = null
}) {
    /*
    Emit a concise agent-activity event (never
    chain-of-thought) to the optional listener.
    */
    function emitActivity(message, status = "done") {
        if (typeof onActivity === "function") {
            try {
                onActivity({ message, status });
            } catch {}
        }
    }
    const chatRecord = database.getChat(chatId);
    const inheritedProject = chatRecord?.project_id
        ? projectState.get(chatRecord.project_id)
        : null;
    const existing =
        projectState.get(chatId) ||
        inheritedProject;

    const project =
        buildProjectContext(
            chatId,
            userMessage,
            conversation,
            inheritedProject
        );

    const type =
        classify(
            userMessage,
            conversation,
            project
        );

    emitActivity(`Understanding request (${type})`);

    /*
    ----------------------------------------------
    CREATE
    ----------------------------------------------
    */

    if (
        type === "workspace_create" &&
        executeWorkspaceActions
    ) {
        emitActivity("Planning workspace changes");

        const result =
            await executeWorkspace(
                chatId,
                userMessage,
                conversation,
                project,
                "CREATE",
                emitActivity,
                { provider, model }
            );

        return {
            type,

            project:
                result.project,

            actionTaken:
                true,

            result,

            response:
                formatWorkspaceResult(
                    result
                )
        };
    }

    /*
    ----------------------------------------------
    MODIFY
    ----------------------------------------------
    */

    if (
        type === "workspace_modify" &&
        executeWorkspaceActions
    ) {
        emitActivity("Planning workspace changes");

        const result =
            await executeWorkspace(
                chatId,
                userMessage,
                conversation,
                project,
                "MODIFY",
                emitActivity,
                { provider, model }
            );

        return {
            type,

            project:
                result.project,

            actionTaken:
                true,

            result,

            response:
                formatWorkspaceResult(
                    result
                )
        };
    }

    /*
    ----------------------------------------------
    READ
    ----------------------------------------------
    */

    if (
        type === "workspace_read"
    ) {
        return {
            type,

            project,

            actionTaken:
                false,

            response:
                null
        };
    }

    /*
    ----------------------------------------------
    Normal project conversation
    ----------------------------------------------
    */

    return {
        type,

        project:
            project || existing,

        actionTaken:
            false,

        response:
            null
    };
}

module.exports = {
    run,
    classify,
    inferProject,
    buildProjectContext,
    executeWorkspace,
    generateWorkspacePlan,
    formatWorkspaceResult
};