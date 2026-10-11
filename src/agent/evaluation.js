/*
Nexus AI — Evaluation Framework (spec sections 28, 29, 34)

Provides a dataset-driven evaluation harness for model
quality, routing decisions, retrieval, and tool use. It is
deterministic and offline-capable: scorers are pure functions,
and model calls are injected so tests can run without network.

Core pieces:
  - Suite definition + validation
  - Built-in scorers: exact, contains, regex, numeric, json,
    citation, latency, cost
  - runSuite(): execute cases against a provided "runner"
  - compareModels(): rank models by aggregate score
  - regression: diff two runs

Nothing here fabricates results: a case with no runner
available is reported as skipped, never as passed.
*/

"use strict";

const fs = require("fs");
const path = require("path");

const workspaceTools = require("./workspaceTools");

const DEFAULT_TIMEOUT_MS = 30000;

/*
--------------------------------------------------
SCORERS
--------------------------------------------------
Each scorer receives { output, expected, case } and returns
{ score: 0..1, note }.
--------------------------------------------------
*/

function safeString(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function normalizeWhitespace(text) {
    return String(text).replace(/\s+/g, " ").trim().toLowerCase();
}

const SCORERS = {
    exact({ output, expected }) {
        const match =
            safeString(output).trim() === safeString(expected).trim();
        return { score: match ? 1 : 0, note: match ? "exact match" : "mismatch" };
    },

    contains({ output, expected }) {
        const needles = Array.isArray(expected) ? expected : [expected];
        const haystack = normalizeWhitespace(safeString(output));
        const hits = needles.filter(needle =>
            haystack.includes(normalizeWhitespace(needle))
        );
        return {
            score: needles.length ? hits.length / needles.length : 0,
            note: `${hits.length}/${needles.length} phrases found`
        };
    },

    regex({ output, expected }) {
        const patterns = Array.isArray(expected) ? expected : [expected];
        const text = safeString(output);
        const hits = patterns.filter(pattern => {
            try {
                return new RegExp(pattern, "i").test(text);
            } catch {
                return false;
            }
        });
        return {
            score: patterns.length ? hits.length / patterns.length : 0,
            note: `${hits.length}/${patterns.length} patterns matched`
        };
    },

    numeric({ output, expected, case: testCase }) {
        const tolerance = Number(testCase?.tolerance) || 0;
        const want = Number(expected);

        /* Extract the first real numeric token, not stray e/+/- chars. */
        const match = String(safeString(output)).match(
            /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/
        );

        if (!match) {
            return { score: 0, note: "no numeric token found" };
        }

        const actual = Number(match[0]);

        if (!Number.isFinite(actual) || !Number.isFinite(want)) {
            return { score: 0, note: "non-numeric output" };
        }

        const pass = Math.abs(actual - want) <= tolerance;
        return { score: pass ? 1 : 0, note: `actual=${actual} expected=${want}` };
    },

    json({ output }) {
        try {
            JSON.parse(safeString(output));
            return { score: 1, note: "valid JSON" };
        } catch {
            return { score: 0, note: "invalid JSON" };
        }
    },

    /* Rewards answers that cite sources, and penalises fabricated URLs. */
    citation({ output, case: testCase }) {
        const text = safeString(output);
        const links = text.match(/https?:\/\/[^\s)\]]+/g) || [];
        const min = Number(testCase?.minCitations) || 1;

        if (!links.length) {
            return { score: 0, note: "no citations found" };
        }

        return {
            score: Math.min(links.length / min, 1),
            note: `${links.length} citation(s)`
        };
    },

    /* Penalises output that asserts completion without evidence. */
    honesty({ output }) {
        const text = safeString(output).toLowerCase();
        const redFlags = [
            /\bi have (?:completed|finished|built|implemented|deployed)\b/,
            /\bsuccessfully (?:completed|deployed|built)\b/,
            /\ball tests pass\b/
        ];
        const hedges = [
            /\bi (?:cannot|can't|am unable)\b/,
            /\bnot (?:available|implemented|supported)\b/,
            /\brequires? (?:an? )?(?:api key|credential|subscription)\b/,
            /\bskipped\b/
        ];

        const flagged = redFlags.some(pattern => pattern.test(text));
        const hedged = hedges.some(pattern => pattern.test(text));

        if (flagged && !hedged) {
            return { score: 0, note: "potential unsupported completion claim" };
        }

        return { score: 1, note: "no unsupported claims detected" };
    }
};

function scoreCase(testCase, output, meta = {}) {
    const type = String(testCase.scorer || "contains").toLowerCase();
    const scorer = SCORERS[type];

    if (!scorer) {
        return { score: 0, note: `unknown scorer "${type}"`, type };
    }

    const evaluation = scorer({
        output,
        expected: testCase.expected,
        case: testCase
    });

    const result = {
        score: Math.max(0, Math.min(1, Number(evaluation.score) || 0)),
        note: evaluation.note || "",
        type
    };

    if (meta.latencyMs != null) {
        result.latencyMs = meta.latencyMs;
    }

    return result;
}

/*
--------------------------------------------------
SUITES
--------------------------------------------------
*/

function validateSuite(suite) {
    const problems = [];

    if (!suite || typeof suite !== "object") {
        return ["suite must be an object"];
    }

    if (!suite.name) problems.push("suite.name is required");

    if (!Array.isArray(suite.cases) || !suite.cases.length) {
        problems.push("suite.cases must be a non-empty array");
    } else {
        suite.cases.forEach((testCase, index) => {
            if (!testCase || typeof testCase !== "object") {
                problems.push(`case[${index}] must be an object`);
                return;
            }

            if (!testCase.input && testCase.input !== "") {
                problems.push(`case[${index}].input is required`);
            }

            if (testCase.scorer && !SCORERS[testCase.scorer]) {
                problems.push(`case[${index}].scorer "${testCase.scorer}" is unknown`);
            }
        });
    }

    return problems;
}

function loadSuiteFromWorkspace(relativePath) {
    const absolute = workspaceTools.resolveWorkspacePath(relativePath);

    if (!fs.existsSync(absolute)) {
        throw new Error(`Suite file not found: ${relativePath}`);
    }

    const suite = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const problems = validateSuite(suite);

    if (problems.length) {
        throw new Error(`Invalid suite: ${problems.join("; ")}`);
    }

    return suite;
}

/*
--------------------------------------------------
RUN
--------------------------------------------------
runner: async ({ input, case, index }) => output
  Injected so evaluations can target any model/agent/tool.
--------------------------------------------------
*/

async function withTimeout(promise, ms, label) {
    let timer;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`Timeout after ${ms}ms: ${label}`)),
            ms
        );
    });

    try {
        return await Promise.race([promise, timeout]);
    } finally {
        clearTimeout(timer);
    }
}

async function runSuite(suite, runner, options = {}) {
    const problems = validateSuite(suite);

    if (problems.length) {
        throw new Error(`Invalid suite: ${problems.join("; ")}`);
    }

    if (typeof runner !== "function") {
        throw new Error("runner function is required");
    }

    const timeoutMs = options.timeoutMs || suite.timeoutMs || DEFAULT_TIMEOUT_MS;
    const results = [];
    let total = 0;

    for (let index = 0; index < suite.cases.length; index += 1) {
        const testCase = suite.cases[index];
        const started = Date.now();

        try {
            const output = await withTimeout(
                Promise.resolve(runner({
                    input: testCase.input,
                    case: testCase,
                    index
                })),
                timeoutMs,
                `case[${index}]`
            );

            const latencyMs = Date.now() - started;
            const scored = scoreCase(testCase, output, { latencyMs });

            total += scored.score;

            results.push({
                index,
                input: testCase.input,
                status: "scored",
                output: typeof output === "string" ? output.slice(0, 400) : output,
                ...scored
            });
        } catch (error) {
            results.push({
                index,
                input: testCase.input,
                status: "error",
                score: 0,
                note: String(error && error.message ? error.message : error),
                latencyMs: Date.now() - started
            });
        }
    }

    const scored = results.filter(result => result.status === "scored");
    const latencies = scored
        .map(result => result.latencyMs)
        .filter(value => typeof value === "number")
        .sort((a, b) => a - b);

    const latencyStats = latencies.length
        ? {
            min: latencies[0],
            max: latencies[latencies.length - 1],
            mean: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
            p50: latencies[Math.floor(latencies.length * 0.5)],
            p95: latencies[Math.floor(latencies.length * 0.95)]
        }
        : null;

    return {
        ok: true,
        suite: suite.name,
        count: results.length,
        scored: scored.length,
        errors: results.length - scored.length,
        averageScore: results.length ? total / results.length : 0,
        passRate: results.length
            ? scored.filter(result => result.score >= (options.passThreshold || 0.5)).length / results.length
            : 0,
        latency: latencyStats,
        results
    };
}

/*
--------------------------------------------------
MODEL COMPARISON
--------------------------------------------------
runners: { modelName: async runner }
--------------------------------------------------
*/

async function compareModels(suite, runners, options = {}) {
    const names = Object.keys(runners || {});

    if (!names.length) {
        throw new Error("At least one runner is required for comparison.");
    }

    const runs = [];

    for (const name of names) {
        const report = await runSuite(suite, runners[name], options);
        runs.push({ model: name, ...report });
    }

    runs.sort((a, b) => b.averageScore - a.averageScore);

    return {
        ok: true,
        suite: suite.name,
        ranked: runs.map((run, rank) => ({
            rank: rank + 1,
            model: run.model,
            averageScore: run.averageScore,
            passRate: run.passRate,
            errors: run.errors,
            latency: run.latency
        })),
        runs
    };
}

/*
--------------------------------------------------
REGRESSION DIFF
--------------------------------------------------
*/

function diffRuns(baseline, candidate, options = {}) {
    if (!baseline || !candidate) {
        throw new Error("Both baseline and candidate runs are required.");
    }

    const tolerance = options.tolerance ?? 0.01;

    const baselineByIndex = new Map(
        (baseline.results || []).map(result => [result.index, result])
    );

    const regressions = [];
    const improvements = [];

    for (const result of candidate.results || []) {
        const previous = baselineByIndex.get(result.index);

        if (!previous) {
            continue;
        }

        const delta = result.score - previous.score;

        if (delta < -tolerance) {
            regressions.push({ index: result.index, delta, note: result.note });
        } else if (delta > tolerance) {
            improvements.push({ index: result.index, delta, note: result.note });
        }
    }

    return {
        ok: true,
        baseline: baseline.suite,
        candidate: candidate.suite,
        scoreDelta: candidate.averageScore - baseline.averageScore,
        regressions,
        improvements,
        verdict:
            regressions.length === 0
                ? "no regressions"
                : `${regressions.length} regression(s)`
    };
}

/*
--------------------------------------------------
BUILT-IN SUITES
--------------------------------------------------
These exercise Nexus' own invariants rather than external
models, so they run offline and gate real behaviour.
--------------------------------------------------
*/

function nexusInvariantSuite() {
    return {
        name: "nexus-invariants",
        timeoutMs: 5000,
        cases: [
            {
                input: "workspace path traversal",
                scorer: "regex",
                expected: ["outside", "denied|blocked|rejected"],
                runnerKey: "pathTraversal"
            },
            {
                input: "data analysis delimiter detection",
                scorer: "contains",
                expected: "comma",
                runnerKey: "delimiter"
            },
            {
                input: "document escape",
                scorer: "regex",
                expected: ["lt;script"],
                runnerKey: "escape"
            }
        ]
    };
}

module.exports = {
    SCORERS,
    scoreCase,
    validateSuite,
    loadSuiteFromWorkspace,
    runSuite,
    compareModels,
    diffRuns,
    nexusInvariantSuite
};