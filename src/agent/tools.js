/*
Nexus AI — Tool definitions (Stage 2)

Registers the built-in tools into the registry.
Filesystem tools go through workspaceTools so every
path stays inside the Nexus workspace.
*/

const toolRegistry = require("./toolRegistry");

const workspaceTools =
    require("./workspaceTools");

const terminalTool =
    require("./terminalTool");

const gitTool =
    require("./gitTool");

const webTool =
    require("./webTool");

const dbTool =
    require("./dbTool");

const visionTool =
    require("./visionTool");

const imageGeneration =
    require("./imageGeneration");

const audio =
    require("./audio");

const researchAgent =
    require("./researchAgent");

const dataAnalysis =
    require("./dataAnalysis");

const documentGenerator =
    require("./documentGenerator");

let registered = false;

function ensureTools() {
    if (registered) {
        return;
    }

    /*
    ----------------------------------------------
    FILESYSTEM
    ----------------------------------------------
    */

    toolRegistry.register({
        name: "workspace_create_file",

        description:
            "Create a file inside the Nexus workspace with content. Path must be relative.",

        permissions: ["READ", "WRITE"],

        schema: {
            type: "object",

            properties: {
                path: { type: "string" },

                content: { type: "string" }
            },

            required: ["path", "content"]
        },

        handler: input =>
            workspaceTools.createFile(
                input.path,
                input.content
            ),

        verify: input =>
            workspaceTools.fileExists(input.path)
    });

    toolRegistry.register({
        name: "workspace_update_file",

        description:
            "Update an existing file inside the Nexus workspace.",

        permissions: ["READ", "WRITE"],

        schema: {
            type: "object",

            properties: {
                path: { type: "string" },

                content: { type: "string" }
            },

            required: ["path", "content"]
        },

        handler: input =>
            workspaceTools.updateFile(
                input.path,
                input.content
            ),

        verify: input => {
            const saved =
                workspaceTools.readFile(
                    input.path
                );

            return {
                verified:
                    saved.content ===
                    String(input.content ?? ""),

                note: "content compared after write"
            };
        }
    });

    toolRegistry.register({
        name: "workspace_read_file",

        description:
            "Read a file from the Nexus workspace.",

        permissions: ["READ"],

        schema: {
            type: "object",

            properties: {
                path: { type: "string" }
            },

            required: ["path"]
        },

        handler: input =>
            workspaceTools.readFile(input.path),

        verify: (input, result) => ({
            verified: result.success === true
        })
    });

    toolRegistry.register({
        name: "workspace_delete_file",

        description:
            "Delete a file from the Nexus workspace. Destructive.",

        permissions: ["READ", "DELETE"],

        risky: true,

        schema: {
            type: "object",

            properties: {
                path: { type: "string" }
            },

            required: ["path"]
        },

        handler: input =>
            workspaceTools.deleteFile(
                input.path
            ),

        verify: input => ({
            verified:
                !workspaceTools.fileExists(
                    input.path
                ).exists
        })
    });

    toolRegistry.register({
        name: "workspace_list",

        description:
            "List workspace entries at a relative path.",

        permissions: ["READ"],

        schema: {
            type: "object",

            properties: {
                path: {
                    type: "string",

                    default: ""
                }
            }
        },

        handler: input =>
            workspaceTools.listFiles(
                input.path || ""
            ),

        verify: (input, result) => ({
            verified: result.success === true
        })
    });

    toolRegistry.register({
        name: "workspace_tree",

        description:
            "Get the full workspace file tree.",

        permissions: ["READ"],

        schema: { type: "object" },

        handler: () =>
            workspaceTools.getWorkspaceTree(),

        verify: (input, result) => ({
            verified: result.success === true
        })
    });

    /*
    ----------------------------------------------
    IMAGE GENERATION
    ----------------------------------------------
    */

    toolRegistry.register({
        name: "image_generate",

        description:
            "Generate one image from a prompt using the configured OpenAI image provider and save it in the workspace. This makes a billed external API call.",

        permissions: ["READ", "WRITE", "NETWORK"],

        risky: true,

        available: () => Boolean(
            require("../../lib/config").PROVIDERS.openai.apiKey
        ),

        schema: {
            type: "object",

            properties: {
                prompt: { type: "string" },
                outputPath: { type: "string", description: "Workspace file path, e.g. generated/hero.png" },
                model: { type: "string" },
                size: { type: "string", default: "1024x1024" },
                quality: { type: "string", default: "auto" },
                background: { type: "string", default: "auto" },
                format: { type: "string", default: "png" }
            },

            required: ["prompt"]
        },

        handler: input => imageGeneration.generateImage(input),

        verify: (input, result) => ({
            verified: result.ok === true && workspaceTools.fileExists(result.path).exists,
            note: result.path
        })
    });

    toolRegistry.register({
        name: "image_edit",
        description: "Edit an existing workspace image using a prompt and save a new image. This makes a billed external API call and never overwrites the source by default.",
        permissions: ["READ", "WRITE", "NETWORK"],
        risky: true,
        available: () => Boolean(require("../../lib/config").PROVIDERS.openai.apiKey),
        schema: {
            type: "object",
            properties: {
                sourcePath: { type: "string" }, prompt: { type: "string" }, outputPath: { type: "string" },
                model: { type: "string" }, size: { type: "string", default: "1024x1024" },
                quality: { type: "string", default: "auto" }, background: { type: "string", default: "auto" },
                format: { type: "string", default: "png" }
            },
            required: ["sourcePath", "prompt"]
        },
        handler: input => imageGeneration.editImage(input),
        verify: (input, result) => ({ verified: result.ok === true && workspaceTools.fileExists(result.path).exists, note: result.path })
    });

    toolRegistry.register({
        name: "audio_synthesize",
        description: "Create AI-generated speech from text and save it to the workspace. The result must be disclosed as AI-generated when shared.",
        permissions: ["READ", "WRITE", "NETWORK"], risky: true,
        available: () => Boolean(require("../../lib/config").PROVIDERS.openai.apiKey),
        schema: { type: "object", properties: { text: { type: "string" }, outputPath: { type: "string" }, voice: { type: "string", default: "coral" }, instructions: { type: "string" }, format: { type: "string", default: "mp3" }, speed: { type: "number" } }, required: ["text"] },
        handler: input => audio.synthesizeSpeech(input),
        verify: (input, result) => ({ verified: result.ok && workspaceTools.fileExists(result.path).exists, note: result.path })
    });

    toolRegistry.register({
        name: "audio_transcribe",
        description: "Transcribe a workspace audio file to text using the configured speech-to-text provider.",
        permissions: ["READ", "NETWORK"], risky: true,
        available: () => Boolean(require("../../lib/config").PROVIDERS.openai.apiKey),
        schema: { type: "object", properties: { sourcePath: { type: "string" }, language: { type: "string" }, prompt: { type: "string" }, model: { type: "string" } }, required: ["sourcePath"] },
        handler: input => audio.transcribeAudio(input),
        verify: (input, result) => ({ verified: result.ok && Boolean(result.text), note: "transcript returned" })
    });

    /*
    ----------------------------------------------
    TERMINAL (controlled)
    ----------------------------------------------
    */

    toolRegistry.register({
        name: "terminal_execute",

        description:
            "Run an allowlisted development command (node, npm, npx, git) inside the Nexus workspace. Sandboxed: no shell, hard timeout, output capped, blocked arguments rejected.",

        permissions: ["READ", "EXECUTE"],

        risky: true,

        schema: {
            type: "object",

            properties: {
                command: {
                    type: "string"
                },

                args: {
                    type: "array",

                    items: {
                        type: "string"
                    }
                },

                cwd: {
                    type: "string"
                },

                timeoutMs: {
                    type: "number"
                }
            },

            required: ["command"]
        },

        handler: input =>
            terminalTool.executeCommand({
                command: input.command,

                args: input.args || [],

                cwd: input.cwd || "",

                timeoutMs: input.timeoutMs
            }),

        verify: (input, result) => ({
            verified:
                result.exitCode === 0,

            note: `exit=${result.exitCode} duration=${result.durationMs}ms`
        })
    });

    /*
    ----------------------------------------------
    GIT (safe operations)
    ----------------------------------------------
    */

    toolRegistry.register({
        name: "git_status",

        description:
            "Get git status of the workspace repository: branch and changed files.",

        permissions: ["READ", "EXECUTE", "GIT"],

        schema: { type: "object" },

        handler: () => gitTool.getStatus(),

        verify: (input, result) => ({
            verified: result.ok === true
        })
    });

    toolRegistry.register({
        name: "git_diff",

        description:
            "Get the current uncommitted git diff of the workspace.",

        permissions: ["READ", "EXECUTE", "GIT"],

        schema: { type: "object" },

        handler: () => gitTool.getDiff(),

        verify: (input, result) => ({
            verified: result.ok === true
        })
    });

    toolRegistry.register({
        name: "git_log",

        description:
            "Get recent commit history of the workspace repository.",

        permissions: ["READ", "EXECUTE", "GIT"],

        schema: {
            type: "object",

            properties: {
                limit: {
                    type: "number",

                    default: 10
                }
            }
        },

        handler: input =>
            gitTool.getLog(input.limit || 10),

        verify: (input, result) => ({
            verified: result.ok === true
        })
    });

    toolRegistry.register({
        name: "git_commit",

        description:
            "Stage all workspace changes and create a git commit. Local only — never pushes.",

        permissions: ["READ", "WRITE", "EXECUTE", "GIT"],

        risky: true,

        schema: {
            type: "object",

            properties: {
                message: {
                    type: "string"
                }
            },

            required: ["message"]
        },

        handler: async input => {
            await gitTool.stageAll();

            return gitTool.commit(
                input.message
            );
        },

        verify: (input, result) => ({
            verified: result.ok === true,

            note: result.output
        })
    });

    /*
    ----------------------------------------------
    WEB (controlled fetch)
    ----------------------------------------------
    */

    toolRegistry.register({
        name: "web_fetch",

        description:
            "Fetch a URL (http/https only), extract readable text from HTML, return status and content. Size- and timeout-capped. Use this to read web pages, docs, or API responses.",

        permissions: ["READ", "NETWORK"],

        schema: {
            type: "object",

            properties: {
                url: { type: "string" }
            },

            required: ["url"]
        },

        handler: input =>
            webTool.fetchUrl(input.url),

        verify: (input, result) => ({
            verified: result.ok === true,

            note: `status=${result.status}`
        })
    });

    /*
    ----------------------------------------------
    DATABASE (SQLite, workspace-scoped)
    ----------------------------------------------
    */

    toolRegistry.register({
        name: "db_query",

        description:
            "Run a read-only SQL query (SELECT/PRAGMA/WITH) against a SQLite database file inside the Nexus workspace. Rows are capped.",

        permissions: ["READ", "DATABASE"],

        schema: {
            type: "object",

            properties: {
                path: { type: "string" },

                sql: { type: "string" },

                params: {
                    type: "array"
                }
            },

            required: ["path", "sql"]
        },

        handler: input =>
            dbTool.query({
                db: input.path,
                sql: input.sql,
                params: input.params
            }),

        verify: (input, result) => ({
            verified: result.ok === true,

            note: `rows=${result.rowCount}`
        })
    });

    toolRegistry.register({
        name: "db_exec",

        description:
            "Run a write SQL statement (CREATE TABLE, INSERT, UPDATE, DELETE) against a SQLite database file inside the Nexus workspace.",

        permissions: ["READ", "WRITE", "DATABASE"],

        risky: true,

        schema: {
            type: "object",

            properties: {
                path: { type: "string" },

                sql: { type: "string" }
            },

            required: ["path", "sql"]
        },

        handler: input =>
            dbTool.exec({
                db: input.path,
                sql: input.sql
            }),

        verify: (input, result) => ({
            verified: result.ok === true,

            note: `changes=${result.changes}`
        })
    });

    /*
    ----------------------------------------------
    VISION
    ----------------------------------------------
    */

    toolRegistry.register({
        name: "vision_analyze",

        description:
            "Analyze an image (screenshot, photo, diagram, rendered UI) with a vision model. Returns a description plus findings relevant to a goal, e.g. visual QA of a rendered page.",

        permissions: ["READ", "NETWORK"],

        schema: {
            type: "object",

            properties: {
                path: {
                    type: "string",

                    description:
                        "Workspace-relative or absolute path of the image to analyze"
                },

                prompt: {
                    type: "string",

                    description:
                        "What to look for, e.g. 'check for layout errors'"
                }
            },

            required: ["path"]
        },

        handler: input =>
            visionTool.analyzeImage({
                source: input.path,
                prompt: input.prompt
            }),

        verify: (input, result) => ({
            verified: result.ok === true,

            note: result.ok
                ? "vision analysis returned"
                : String(result.error || "vision failed")
        })
    });

    /*
    ----------------------------------------------
    RESEARCH
    ----------------------------------------------
    */

    toolRegistry.register({
        name: "research_run",

        description:
            "Run a structured research task: plan searches, gather web sources, extract facts, cross-check, and produce a cited report artifact in the workspace.",

        permissions: ["READ", "WRITE", "NETWORK"],

        schema: {
            type: "object",

            properties: {
                goal: {
                    type: "string",

                    description: "The research question or goal"
                },

                project: {
                    type: "string",

                    description: "Project name to store the report artifact in"
                }
            },

            required: ["goal"]
        },

        handler: input =>
            researchAgent.runResearch({
                goal: input.goal,
                project: input.project
            }),

        verify: (input, result) => ({
            verified: result.ok === true &&
                result.sources >= 1,

            note: result.ok
                ? `sources=${result.sources}`
                : String(result.error || "research failed")
        })
    });

    /*
    ----------------------------------------------
    DATA ANALYSIS
    ----------------------------------------------
    */

    toolRegistry.register({
        name: "data_analyze",

        description:
            "Analyze a workspace data file (CSV, TSV, JSON, JSONL, delimited text) with a bounded, sandboxed engine. Operations: profile, describe, query/filter, group_by/aggregate, report, export. Never executes arbitrary code.",

        permissions: ["READ", "WRITE"],

        schema: {
            type: "object",

            properties: {
                path: {
                    type: "string",
                    description: "Workspace-relative data file path"
                },

                operation: {
                    type: "string",
                    description:
                        "profile | describe | query | filter | group_by | aggregate | report | export"
                },

                filters: {
                    type: "array",
                    description:
                        "Array of { field, operator, value }. Operators: eq, ne, gt, gte, lt, lte, contains, startswith, endswith, in, notnull, isnull.",
                    items: { type: "object" }
                },

                groupBy: {
                    type: "array",
                    description: "Columns to group by",
                    items: { type: "string" }
                },

                measures: {
                    type: "array",
                    description:
                        "Array of { field, operation, alias }. Operations: count, count_distinct, sum, mean, median, min, max, stddev, first, last.",
                    items: { type: "object" }
                },

                columns: {
                    type: "array",
                    description: "Column subset to select",
                    items: { type: "string" }
                },

                limit: {
                    type: "number",
                    description: "Row limit for query/export"
                },

                format: {
                    type: "string",
                    description: "Export format: csv or json"
                },

                outputPath: {
                    type: "string",
                    description: "Workspace path to write the report/export"
                }
            },

            required: ["path"]
        },

        handler: input => dataAnalysis.analyze(input),

        verify: (input, result) => ({
            verified: result.ok === true,

            note: result.ok
                ? `operation=${result.operation}`
                : String(result.error || "data analysis failed")
        })
    });

    /*
    ----------------------------------------------
    DOCUMENT GENERATION
    ----------------------------------------------
    */

    toolRegistry.register({
        name: "document_generate",

        description:
            "Generate a real document artifact in the workspace: DOCX, XLSX, PPTX, Markdown, HTML, CSV, JSON or TXT. Provide blocks for prose/office docs, sheets for spreadsheets, or slides for presentations.",

        permissions: ["READ", "WRITE"],

        schema: {
            type: "object",

            properties: {
                format: {
                    type: "string",
                    description:
                        "docx | xlsx | pptx | md | html | csv | json | txt"
                },

                path: {
                    type: "string",
                    description: "Workspace-relative output path"
                },

                title: { type: "string" },

                subtitle: { type: "string" },

                author: { type: "string" },

                content: {
                    type: "string",
                    description: "Raw content for md/txt/json"
                },

                blocks: {
                    type: "array",
                    description:
                        "Array of { type: heading|paragraph|bullet|number|code|table|pageBreak, text, level, rows, language }",
                    items: { type: "object" }
                },

                sheets: {
                    type: "array",
                    description: "Array of { name, rows: [[...]] } for xlsx",
                    items: { type: "object" }
                },

                rows: {
                    type: "array",
                    description: "Array of arrays (header + data) for xlsx/csv",
                    items: { type: "array" }
                },

                slides: {
                    type: "array",
                    description:
                        "Array of { title, bullets: [], text, table, notes } for pptx",
                    items: { type: "object" }
                }
            },

            required: ["format"]
        },

        handler: input => documentGenerator.generate(input),

        verify: (input, result) => ({
            verified: result.ok === true &&
                Boolean(result.artifact && result.artifact.path),

            note: result.ok && result.artifact
                ? `wrote ${result.artifact.path}`
                : String(result.error || "document generation failed")
        })
    });

    registered = true;
}

function ensureRegistered() {
    ensureTools();
}

module.exports = {
    ensureRegistered
};
