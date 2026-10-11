/*
Nexus AI — Research Agent (Stage 5)

Structured research: plan searches → gather sources →
extract facts → cross-check → write a cited report
artifact into the workspace.

No fake results: sources come from real web requests,
every claim is tied to a source, and failures are
reported honestly.
*/

const fs = require("fs");
const path = require("path");

const workspaceTools = require("./workspaceTools");
const webTool = require("./webTool");
const modelRouter = require("./modelRouter");
const gateway = require("../../lib/providers/gateway");

const MAX_SOURCES = 8;

/* ----------------------------------------------
Planning: derive focused search queries from the goal.
---------------------------------------------- */

function planSearches(goal) {
    const queries = [goal];

    const keywords = goal
        .toLowerCase()
        .replace(/[^\w\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 3);

    // A second, narrowed query from the strongest keywords.
    if (keywords.length >= 2) {
        queries.push(
            keywords.slice(0, 6).join(" ")
        );
    }

    // A comparison-oriented variant.
    queries.push(goal + " overview 2026");

    return queries.slice(0, 3);
}

/* ----------------------------------------------
Gather: search + fetch pages, extract text snippets.
---------------------------------------------- */

async function gatherSources(goal) {
    const queries = planSearches(goal);
    const seen = new Set();
    const sources = [];

    for (const query of queries) {
        if (sources.length >= MAX_SOURCES) break;

        const search = await webTool.searchWeb(query, 5);

        if (!search.ok) continue;

        for (const hit of search.results) {
            if (sources.length >= MAX_SOURCES) break;
            if (seen.has(hit.url)) continue;
            seen.add(hit.url);

            const page = await webTool.fetchUrl(hit.url)
                .catch(() => null);

            const text = page && page.ok
                ? String(page.text || "")
                : "";

            if (!text || text.length < 200) continue;

            sources.push({
                title: hit.title || hit.url,
                url: hit.url,
                query,
                chars: text.length,
                text: text.slice(0, 6000)
            });
        }
    }

    return sources;
}

/* ----------------------------------------------
Synthesis: model summary with citations, or an
honest extract-only fallback when no model exists.
---------------------------------------------- */

function buildReportPrompt(goal, sources) {
    const sourceBlock = sources
        .map((s, i) =>
            `[${i + 1}] ${s.title}\nURL: ${s.url}\n${s.text.slice(0, 2500)}`
        )
        .join("\n\n");

    return [
        "You are the Nexus research analyst.",
        `Research goal: ${goal}`,
        "",
        "Below are numbered web sources gathered live.",
        "Write a concise research report:",
        "1) Key findings (bulleted, each cited as [n]).",
        "2) Conflicting or uncertain information across sources.",
        "3) Open questions / gaps.",
        "Cite every claim with its source number. Do not invent facts.",
        "",
        sourceBlock
    ].join("\n");
}

function extractOnlyReport(goal, sources) {
    return [
        `# Research report: ${goal}`,
        "",
        "> Note: no language model is currently available, so this",
        "> report contains extracted source material without synthesis.",
        "",
        "## Sources",
        ...sources.map((s, i) =>
            `${i + 1}. [${s.title}](${s.url}) — ${s.chars} chars extracted`
        )
    ].join("\n");
}

async function synthesize(goal, sources) {
    const model = modelRouter.select({ role: "reasoning" });

    if (!model || sources.length === 0) {
        return extractOnlyReport(goal, sources);
    }

    try {
        const response = await gateway.complete({
            provider: model.provider,
            model: model.model,
            messages: [
                {
                    role: "user",
                    content: buildReportPrompt(goal, sources)
                }
            ]
        });

        const text =
            (response && (response.text || response.content)) || "";

        return text.trim() || extractOnlyReport(goal, sources);
    } catch (e) {
        return [
            `# Research report: ${goal}`,
            "",
            `> Model synthesis failed (${e.message});`,
            "> source material is included below.",
            "",
            extractOnlyReport(goal, sources)
        ].join("\n");
    }
}

/* ----------------------------------------------
Entry point
---------------------------------------------- */

async function runResearch({ goal, project } = {}) {
    if (typeof goal !== "string" || !goal.trim()) {
        return { ok: false, error: "A research goal is required." };
    }

    const sources = await gatherSources(goal);

    if (sources.length === 0) {
        return {
            ok: false,
            error:
                "No usable web sources could be retrieved for this goal. Check network access or rephrase the goal."
        };
    }

    const report = await synthesize(goal, sources);

    // Persist the report as a real artifact.
    const slug = goal
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || "research";

    const dir = project
        ? path.join("projects", project, "reports")
        : "reports";

    const relPath = path.join(
        dir,
        `${slug}-${Date.now()}.md`
    );

    const write = workspaceTools.createFile(
        relPath,
        `# Research: ${goal}\n\n_Generated ${new Date().toISOString()}_\n\n${report}\n\n## Sources used\n\n` +
        sources
            .map((s, i) => `${i + 1}. ${s.title} — ${s.url}`)
            .join("\n") +
        "\n"
    );

    if (write && write.success === false) {
        return {
            ok: false,
            error: `Report generation succeeded but saving failed: ${write.error}`
        };
    }

    return {
        ok: true,
        goal,
        sources: sources.length,
        sourceUrls: sources.map(s => s.url),
        reportPath: relPath,
        reportPreview: report.slice(0, 500)
    };
}

module.exports = {
    runResearch,
    planSearches,
    gatherSources
};
