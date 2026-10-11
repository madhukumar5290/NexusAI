/*
Nexus AI — Data Analysis Engine (spec section 13)

Sandboxed, dependency-free analysis of files inside the
Nexus workspace. No eval / new Function: every operation is
a declared, bounded transform.

Inputs : .csv .tsv .json .jsonl .txt (auto-delimiter)
Outputs: markdown report, CSV, JSON
Caps   : rows, columns, groups, output size.
*/

"use strict";

const fs = require("fs");
const path = require("path");
const workspaceTools = require("./workspaceTools");

const LIMITS = {
    maxRows: 200000,
    maxColumns: 200,
    maxGroups: 5000,
    maxOutputBytes: 4 * 1024 * 1024
};

const AGGREGATIONS = new Set([
    "count", "count_distinct", "sum", "mean",
    "median", "min", "max", "stddev", "first", "last"
]);

const NUMBER_PATTERN = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;
const BOOLEAN_VALUES = new Set(["true", "false", "yes", "no", "y", "n", "1", "0"]);

function round(value) {
    if (value == null || !Number.isFinite(value)) return value;
    return Math.round(value * 1e6) / 1e6;
}

/* RFC4180-style parser: quoted fields, "" escapes, embedded newlines. */
function parseDelimited(text, delimiter) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 1; }
                else inQuotes = false;
            } else field += char;
            continue;
        }

        if (char === '"') inQuotes = true;
        else if (char === delimiter) { row.push(field); field = ""; }
        else if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
        else if (char !== "\r") field += char;
    }

    if (field.length || row.length) { row.push(field); rows.push(row); }

    return rows.filter(cells => cells.some(cell => String(cell).trim() !== ""));
}

function detectDelimiter(text) {
    const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
    const candidates = [",", "\t", ";", "|"];
    let best = ",";
    let bestCount = -1;

    for (const delimiter of candidates) {
        const count = (sample.split(delimiter).length - 1);
        if (count > bestCount) { best = delimiter; bestCount = count; }
    }

    return best;
}

function looksNumeric(value) {
    const text = String(value ?? "").trim();
    if (!text) return false;
    return NUMBER_PATTERN.test(text.replace(/[$,%]/g, ""));
}

function toNumber(value) {
    const text = String(value ?? "").trim();
    if (!text) return NaN;
    const cleaned = text.replace(/[$,]/g, "").replace(/%$/, "");
    const number = Number(cleaned);
    return Number.isFinite(number) ? number : NaN;
}

function inferType(values) {
    const present = values.filter(v => String(v ?? "").trim() !== "");
    if (!present.length) return "empty";
    if (present.every(looksNumeric)) return "number";
    if (present.every(v => BOOLEAN_VALUES.has(String(v).trim().toLowerCase()))) return "boolean";
    if (present.every(v => DATE_PATTERN.test(String(v).trim()))) return "date";
    return "string";
}

function buildColumns(headers, matrix) {
    return headers.map((header, index) => {
        const values = matrix.map(row => row[index]);
        return {
            name: String(header ?? "").trim() || `column_${index + 1}`,
            index,
            type: inferType(values),
            missing: values.filter(v => String(v ?? "").trim() === "").length
        };
    });
}

function percentile(sorted, p) {
    if (!sorted.length) return null;
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function describeNumbers(values) {
    const numbers = values.map(toNumber).filter(Number.isFinite);
    if (!numbers.length) return null;

    const sorted = [...numbers].sort((a, b) => a - b);
    const count = numbers.length;
    const sum = numbers.reduce((total, v) => total + v, 0);
    const mean = sum / count;
    const variance = numbers.reduce((t, v) => t + (v - mean) ** 2, 0) / count;

    return {
        count,
        sum: round(sum),
        mean: round(mean),
        min: round(sorted[0]),
        max: round(sorted[sorted.length - 1]),
        median: round(percentile(sorted, 0.5)),
        p25: round(percentile(sorted, 0.25)),
        p75: round(percentile(sorted, 0.75)),
        stdDev: round(Math.sqrt(variance)),
        range: round(sorted[sorted.length - 1] - sorted[0])
    };
}

function resolveDataPath(relativePath) {
    if (!relativePath) throw new Error("A data file path is required.");
    const absolute = workspaceTools.resolveWorkspacePath(String(relativePath));
    if (!fs.existsSync(absolute)) throw new Error(`Data file not found: ${relativePath}`);
    if (!fs.statSync(absolute).isFile()) throw new Error(`Not a file: ${relativePath}`);
    return absolute;
}

function objectsToMatrix(objects) {
    const headers = [...objects.reduce((set, row) => {
        Object.keys(row).forEach(key => set.add(key));
        return set;
    }, new Set())];
    const matrix = objects.map(row => headers.map(header => row[header]));
    return { headers, matrix };
}

function loadDataset(relativePath, options = {}) {
    const absolute = resolveDataPath(relativePath);
    const extension = path.extname(absolute).toLowerCase();
    const text = fs.readFileSync(absolute, "utf8");

    let headers = [];
    let matrix = [];

    if (extension === ".json") {
        const parsed = JSON.parse(text);
        const rows = Array.isArray(parsed) ? parsed
            : Array.isArray(parsed?.data) ? parsed.data : [parsed];
        const objects = rows.filter(r => r && typeof r === "object" && !Array.isArray(r));
        if (!objects.length) throw new Error("JSON dataset must be an array of objects.");
        ({ headers, matrix } = objectsToMatrix(objects));
    } else if (extension === ".jsonl" || extension === ".ndjson") {
        const objects = text.split(/\r?\n/).filter(l => l.trim())
            .map(l => JSON.parse(l)).filter(r => r && typeof r === "object");
        if (!objects.length) throw new Error("JSONL dataset is empty.");
        ({ headers, matrix } = objectsToMatrix(objects));
    } else {
        const delimiter = options.delimiter || detectDelimiter(text);
        const table = parseDelimited(text, delimiter);
        if (!table.length) throw new Error("Dataset is empty.");
        headers = table[0].map((h, i) => String(h ?? "").trim() || `column_${i + 1}`);
        matrix = table.slice(1);
    }

    if (matrix.length > LIMITS.maxRows) {
        throw new Error(`Dataset exceeds the ${LIMITS.maxRows} row analysis limit.`);
    }
    if (headers.length > LIMITS.maxColumns) {
        throw new Error(`Dataset exceeds the ${LIMITS.maxColumns} column limit.`);
    }

    const columns = buildColumns(headers, matrix);

    const records = matrix.map(cells => {
        const record = {};
        headers.forEach((header, index) => {
            const raw = cells[index];
            record[header] = raw === undefined || raw === null ? "" : String(raw);
        });
        return record;
    });

    return {
        path: relativePath,
        absolutePath: absolute,
        extension,
        rowCount: records.length,
        columnCount: headers.length,
        headers,
        columns,
        records
    };
}

function compareValues(a, b) {
    const numberA = toNumber(a);
    const numberB = toNumber(b);
    if (Number.isFinite(numberA) && Number.isFinite(numberB)) return numberA - numberB;
    return String(a ?? "").localeCompare(String(b ?? ""));
}

function matchFilter(record, filter) {
    const field = String(filter.field || "");
    const operator = String(filter.operator || "eq").toLowerCase();
    const expected = filter.value;
    const actual = record[field];

    switch (operator) {
        case "eq": return String(actual) === String(expected);
        case "ne": return String(actual) !== String(expected);
        case "gt": return compareValues(actual, expected) > 0;
        case "gte": return compareValues(actual, expected) >= 0;
        case "lt": return compareValues(actual, expected) < 0;
        case "lte": return compareValues(actual, expected) <= 0;
        case "contains":
            return String(actual).toLowerCase().includes(String(expected).toLowerCase());
        case "startswith":
            return String(actual).toLowerCase().startsWith(String(expected).toLowerCase());
        case "endswith":
            return String(actual).toLowerCase().endsWith(String(expected).toLowerCase());
        case "in": {
            const list = Array.isArray(expected) ? expected : String(expected).split(",");
            return list.map(v => String(v).trim()).includes(String(actual));
        }
        case "notnull": return String(actual ?? "").trim() !== "";
        case "isnull": return String(actual ?? "").trim() === "";
        default: return true;
    }
}

function applyFilters(records, filters) {
    if (!Array.isArray(filters) || !filters.length) return records;
    return records.filter(record => filters.every(filter => matchFilter(record, filter)));
}

function aggregateGroup(records, measure, operation) {
    const op = String(operation || "count").toLowerCase();
    if (!AGGREGATIONS.has(op)) {
        throw new Error(`Unsupported aggregation "${operation}". Allowed: ${[...AGGREGATIONS].join(", ")}`);
    }
    if (op === "count") return records.length;

    const values = records.map(r => r[measure]).filter(v => String(v ?? "").trim() !== "");
    if (op === "count_distinct") return new Set(values.map(String)).size;
    if (!values.length) return null;
    if (op === "first") return values[0];
    if (op === "last") return values[values.length - 1];

    const stats = describeNumbers(values);
    return stats ? (stats[op] ?? null) : null;
}

function applyGroupBy(records, groupBy, measures) {
    const groups = new Map();

    for (const record of records) {
        const key = groupBy.map(field => String(record[field] ?? "")).join(" | ");
        if (!groups.has(key)) {
            if (groups.size >= LIMITS.maxGroups) {
                throw new Error(`Too many groups (limit ${LIMITS.maxGroups}).`);
            }
            groups.set(key, []);
        }
        groups.get(key).push(record);
    }

    const list = Array.isArray(measures) && measures.length
        ? measures
        : [{ field: groupBy[0], operation: "count" }];

    const result = [...groups.entries()].map(([key, rows]) => {
        const entry = {};
        const parts = String(key).split(" | ");
        groupBy.forEach((field, index) => { entry[field] = parts[index]; });
        entry.__count = rows.length;
        list.forEach(measure => {
            const label = measure.alias ||
                `${measure.operation || "count"}_${measure.field || "*"}`;
            entry[label] = aggregateGroup(rows, measure.field, measure.operation);
        });
        return entry;
    });

    result.sort((a, b) => (b.__count || 0) - (a.__count || 0));
    return result;
}

function describeDataset(dataset, options = {}) {
    const targetColumns = Array.isArray(options.columns) && options.columns.length
        ? options.columns
        : dataset.columns.filter(c => c.type === "number").map(c => c.name);

    const numeric = {};
    for (const name of targetColumns) {
        const stats = describeNumbers(dataset.records.map(r => r[name]));
        if (stats) numeric[name] = stats;
    }

    const sample = dataset.records.slice(0, options.sampleSize || 10).map(record => {
        const clean = {};
        dataset.headers.forEach(header => { clean[header] = record[header]; });
        return clean;
    });

    return {
        path: dataset.path,
        rowCount: dataset.records.length,
        columnCount: dataset.columnCount,
        columns: dataset.columns.map(c => ({ name: c.name, type: c.type, missing: c.missing })),
        numeric,
        sample
    };
}

function toMarkdownTable(headers, rows) {
    if (!rows.length) return "_No rows._";
    const escape = value => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    const head = `| ${headers.map(escape).join(" | ")} |`;
    const rule = `| ${headers.map(() => "---").join(" | ")} |`;
    const body = rows.map(row => `| ${headers.map(h => escape(row[h])).join(" | ")} |`);
    return [head, rule, ...body].join("\n");
}

function buildProfileReport(dataset, options = {}) {
    const description = describeDataset(dataset, options);
    const lines = [];

    lines.push(`# Data Profile — ${dataset.path}`, "");
    lines.push(`Rows: **${description.rowCount}** · Columns: **${description.columnCount}**`, "");

    lines.push("## Columns", "");
    lines.push(toMarkdownTable(
        ["Column", "Type", "Missing"],
        description.columns.map(c => ({ Column: c.name, Type: c.type, Missing: c.missing }))
    ), "");

    if (Object.keys(description.numeric).length) {
        lines.push("## Numeric Summary", "");
        lines.push(toMarkdownTable(
            ["Column", "Count", "Mean", "Median", "Std Dev", "Min", "Max"],
            Object.entries(description.numeric).map(([column, s]) => ({
                Column: column, Count: s.count, Mean: s.mean, Median: s.median,
                "Std Dev": s.stdDev, Min: s.min, Max: s.max
            }))
        ), "");
    }

    lines.push("## Sample Rows", "");
    lines.push(toMarkdownTable(dataset.headers, description.sample));

    return { markdown: lines.join("\n"), description };
}

function writeArtifact(relativePath, content) {
    const size = Buffer.byteLength(content, "utf8");
    if (size > LIMITS.maxOutputBytes) {
        throw new Error(`Output exceeds ${LIMITS.maxOutputBytes} bytes.`);
    }
    if (workspaceTools.fileExists(relativePath).exists) {
        workspaceTools.updateFile(relativePath, content);
    } else {
        workspaceTools.createFile(relativePath, content);
    }
    return { path: relativePath, bytes: size };
}

function sanitizeName(value) {
    const base = String(value || "dataset").replace(/\\/g, "/").split("/").pop()
        .replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "").slice(0, 60);
    return base || "dataset";
}

function analyze(request = {}) {
    const operation = String(request.operation || "profile").toLowerCase();
    const dataset = loadDataset(request.path, { delimiter: request.delimiter });
    const filtered = applyFilters(dataset.records, request.filters);
    const view = { ...dataset, records: filtered };

    if (operation === "query" || operation === "filter") {
        const limit = Math.min(Math.max(Number(request.limit) || 50, 1), 1000);
        const selection = Array.isArray(request.columns) && request.columns.length
            ? request.columns : dataset.headers;
        const rows = filtered.slice(0, limit).map(record => {
            const row = {};
            selection.forEach(column => { row[column] = record[column]; });
            return row;
        });
        return { ok: true, operation, matched: filtered.length, returned: rows.length, columns: selection, rows };
    }

    if (operation === "group_by" || operation === "aggregate") {
        const groupBy = Array.isArray(request.groupBy) ? request.groupBy
            : String(request.groupBy || "").split(",").map(v => v.trim()).filter(Boolean);
        if (!groupBy.length) throw new Error("groupBy is required for group_by aggregation.");
        const rows = applyGroupBy(filtered, groupBy, request.measures);
        return { ok: true, operation: "group_by", groupBy, groupCount: rows.length, inputRows: filtered.length, rows };
    }

    if (operation === "describe") {
        return { ok: true, operation: "describe", ...describeDataset(view, request) };
    }

    if (operation === "report") {
        const report = buildProfileReport(view, request);
        const outputPath = request.outputPath || `reports/${sanitizeName(dataset.path)}-profile.md`;
        const artifact = writeArtifact(outputPath, report.markdown);
        return { ok: true, operation: "report", artifact, rowCount: filtered.length, preview: report.markdown.slice(0, 2000) };
    }

    if (operation === "export") {
        const format = String(request.format || "csv").toLowerCase();
        const selection = Array.isArray(request.columns) && request.columns.length
            ? request.columns : dataset.headers;
        const rows = filtered.slice(0, Math.min(Number(request.limit) || filtered.length, LIMITS.maxRows));

        let content;
        if (format === "json") {
            content = JSON.stringify(rows.map(record => {
                const row = {};
                selection.forEach(column => { row[column] = record[column]; });
                return row;
            }), null, 2);
        } else {
            const escapeCsv = value => {
                const text = String(value ?? "");
                return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
            };
            const lines = [selection.join(",")];
            rows.forEach(record => {
                lines.push(selection.map(column => escapeCsv(record[column])).join(","));
            });
            content = lines.join("\n");
        }

        const extension = format === "json" ? "json" : "csv";
        const outputPath = request.outputPath ||
            `reports/${sanitizeName(dataset.path)}-export.${extension}`;
        const artifact = writeArtifact(outputPath, content);
        return { ok: true, operation: "export", artifact, format, rowCount: rows.length };
    }

    return { ok: true, operation: "profile", ...describeDataset(dataset, request) };
}

module.exports = {
    LIMITS, AGGREGATIONS, parseDelimited, detectDelimiter, inferType, toNumber,
    describeNumbers, loadDataset, applyFilters, applyGroupBy, describeDataset,
    buildProfileReport, toMarkdownTable, analyze
};