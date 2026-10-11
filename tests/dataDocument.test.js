/*
Nexus AI — tests for data analysis and document generation engines.
Run: node --test tests/dataDocument.test.js
*/

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");

const workspaceTools = require("../src/agent/workspaceTools");
const dataAnalysis = require("../src/agent/dataAnalysis");
const documentGenerator = require("../src/agent/documentGenerator");

function workspacePath(relative) {
    return workspaceTools.resolveWorkspacePath(relative);
}

function cleanup(relative) {
    const absolute = workspacePath(relative);
    if (fs.existsSync(absolute)) fs.rmSync(absolute, { force: true });
}

const SALES_CSV = [
    "region,product,units,revenue,date",
    "North,Widget Large,10,1000,2024-01-05",
    "South,Widget,5,500,2024-01-06",
    "North,Widget,7,700,2024-02-01",
    "East,Gadget,3,900,2024-02-02",
    "South,Gadget,12,3600,2024-03-01",
    "North,Gadget,2,600,2024-03-05"
].join("\n");

test("data analysis: parses quoted CSV fields", () => {
    const rows = dataAnalysis.parseDelimited(
        "a,\"b,c\",d\n1,2,3",
        ","
    );

    assert.deepStrictEqual(rows, [
        ["a", "b,c", "d"],
        ["1", "2", "3"]
    ]);
});

test("data analysis: detects delimiter", () => {
    assert.strictEqual(dataAnalysis.detectDelimiter("a,b,c\n1,2,3"), ",");
    assert.strictEqual(dataAnalysis.detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
});

test("data analysis: types and statistics", () => {
    assert.strictEqual(dataAnalysis.inferType(["1", "2", "3"]), "number");
    assert.strictEqual(dataAnalysis.inferType(["x", "y"]), "string");
    assert.strictEqual(dataAnalysis.inferType(["true", "false"]), "boolean");

    const stats = dataAnalysis.describeNumbers([1, 2, 3, 4]);
    assert.strictEqual(stats.count, 4);
    assert.strictEqual(stats.mean, 2.5);
    assert.strictEqual(stats.median, 2.5);
    assert.strictEqual(stats.min, 1);
    assert.strictEqual(stats.max, 4);
});

test("data analysis: profile report on a workspace CSV", () => {
    workspaceTools.createFile("tests/data/sales.csv", SALES_CSV);

    try {
        const result = dataAnalysis.analyze({
            path: "tests/data/sales.csv",
            operation: "profile"
        });

        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.rowCount, 6);
        assert.ok(result.numeric.revenue);
        assert.strictEqual(result.numeric.revenue.sum, 7300);
    } finally {
        cleanup("tests/data/sales.csv");
    }
});

test("data analysis: group_by with aggregations", () => {
    workspaceTools.createFile("tests/data/sales.csv", SALES_CSV);

    try {
        const result = dataAnalysis.analyze({
            path: "tests/data/sales.csv",
            operation: "group_by",
            groupBy: ["region"],
            measures: [
                { field: "revenue", operation: "sum", alias: "total" },
                { field: "units", operation: "mean", alias: "avgUnits" }
            ]
        });

        assert.strictEqual(result.ok, true);

        const north = result.rows.find(row => row.region === "North");
        const south = result.rows.find(row => row.region === "South");

        assert.strictEqual(north.total, 2300);
        assert.strictEqual(south.total, 4100);
    } finally {
        cleanup("tests/data/sales.csv");
    }
});

test("data analysis: filters", () => {
    workspaceTools.createFile("tests/data/sales.csv", SALES_CSV);

    try {
        const result = dataAnalysis.analyze({
            path: "tests/data/sales.csv",
            operation: "query",
            filters: [
                { field: "region", operator: "eq", value: "North" },
                { field: "revenue", operator: "gte", value: 700 }
            ]
        });

        assert.strictEqual(result.matched, 2);
    } finally {
        cleanup("tests/data/sales.csv");
    }
});

test("data analysis: export writes a CSV artifact", () => {
    workspaceTools.createFile("tests/data/sales.csv", SALES_CSV);

    try {
        const result = dataAnalysis.analyze({
            path: "tests/data/sales.csv",
            operation: "export",
            format: "csv",
            outputPath: "tests/data/sales-export.csv"
        });

        assert.strictEqual(result.ok, true);
        assert.ok(fs.existsSync(workspacePath("tests/data/sales-export.csv")));
    } finally {
        cleanup("tests/data/sales.csv");
        cleanup("tests/data/sales-export.csv");
    }
});

test("document generator: markdown", async () => {
    const result = await documentGenerator.generate({
        format: "md",
        path: "tests/docs/report.md",
        title: "Report",
        blocks: [
            { type: "heading", level: 2, text: "Findings" },
            { type: "bullet", text: "Revenue grew" },
            { type: "table", rows: [["A", "B"], ["1", "2"]] }
        ]
    });

    try {
        assert.strictEqual(result.ok, true);
        const content = fs.readFileSync(workspacePath("tests/docs/report.md"), "utf8");
        assert.match(content, /# Report/);
        assert.match(content, /## Findings/);
        assert.match(content, /- Revenue grew/);
    } finally {
        cleanup("tests/docs/report.md");
    }
});

test("document generator: creates a valid DOCX zip", async () => {
    await documentGenerator.createDocx({
        path: "tests/docs/report.docx",
        title: "Quarterly Report",
        blocks: [
            { type: "heading", level: 1, text: "Quarterly Report" },
            { type: "paragraph", text: "Revenue rose 12 percent." },
            { type: "bullet", text: "North led growth" }
        ]
    });

    try {
        assert.ok(fs.existsSync(workspacePath("tests/docs/report.docx")));

        const JSZip = require("jszip");
        const zip = await JSZip.loadAsync(fs.readFileSync(workspacePath("tests/docs/report.docx")));
        assert.ok(zip.file("word/document.xml"));
        assert.ok(zip.file("[Content_Types].xml"));

        const doc = await zip.file("word/document.xml").async("string");
        assert.match(doc, /Quarterly Report/);
    } finally {
        cleanup("tests/docs/report.docx");
    }
});

test("document generator: creates a valid XLSX zip", async () => {
    await documentGenerator.createXlsx({
        path: "tests/docs/data.xlsx",
        sheets: [
            { name: "Sales", rows: [["Region", "Revenue"], ["North", 2300], ["South", 4100]] }
        ]
    });

    try {
        assert.ok(fs.existsSync(workspacePath("tests/docs/data.xlsx")));

        const JSZip = require("jszip");
        const zip = await JSZip.loadAsync(fs.readFileSync(workspacePath("tests/docs/data.xlsx")));
        assert.ok(zip.file("xl/workbook.xml"));
        assert.ok(zip.file("xl/worksheets/sheet1.xml"));

        const sheet = await zip.file("xl/worksheets/sheet1.xml").async("string");
        assert.match(sheet, /Revenue/);
        assert.match(sheet, /2300/);
    } finally {
        cleanup("tests/docs/data.xlsx");
    }
});

test("document generator: creates a PPTX presentation", async () => {
    await documentGenerator.createPptx({
        path: "tests/docs/deck.pptx",
        title: "Strategy Deck",
        slides: [
            { title: "Overview", bullets: ["Goal A", "Goal B"] },
            { title: "Numbers", table: [["Metric", "Value"], ["Revenue", "7300"]] }
        ]
    });

    try {
        assert.ok(fs.existsSync(workspacePath("tests/docs/deck.pptx")));
        const size = fs.statSync(workspacePath("tests/docs/deck.pptx")).size;
        assert.ok(size > 1000, "pptx should have real content");
    } finally {
        cleanup("tests/docs/deck.pptx");
    }
});

test("document generator: HTML escaping is safe", () => {
    const raw = String.fromCharCode(60) + "script" + String.fromCharCode(62);
    const escaped = documentGenerator.xmlEscape(raw);

    assert.strictEqual(escaped.indexOf(String.fromCharCode(60)), -1);
    assert.ok(escaped.indexOf("lt;script") !== -1);
});

test("tools: data_analyze and document_generate are registered", () => {
    require("../src/agent/tools").ensureRegistered();
    const toolRegistry = require("../src/agent/toolRegistry");
    const names = toolRegistry.list().map(tool => tool.name);

    assert.ok(names.includes("data_analyze"));
    assert.ok(names.includes("document_generate"));
});