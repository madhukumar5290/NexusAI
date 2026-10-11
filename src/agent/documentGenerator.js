/*
Nexus AI — Document Generation Engine (spec sections 8, 12, 17)

Generates real, valid Office files into the workspace:
  .docx  (WordprocessingML, via jszip)
  .xlsx  (SpreadsheetML, via jszip)
  .pptx  (via pptxgenjs)
  .md .html .csv .json .txt

Every generator writes through workspaceTools so all output
stays sandboxed to the Nexus workspace. Inputs are plain JS
structures; nothing is eval'd.
*/

"use strict";

const fs = require("fs");
const path = require("path");
const workspaceTools = require("./workspaceTools");

const LIMITS = {
    maxSections: 500,
    maxRows: 20000,
    maxColumns: 200,
    maxSlides: 300
};

const AMP = String.fromCharCode(38);

const XML_ENTITIES = [
    [new RegExp(AMP, "g"), AMP + "amp;"],
    [/</g, AMP + "lt;"],
    [/>/g, AMP + "gt;"],
    [/"/g, AMP + "quot;"],
    [/'/g, AMP + "apos;"]
];

function xmlEscape(value) {
    let text = String(value ?? "");

    for (const [pattern, replacement] of XML_ENTITIES) {
        text = text.replace(pattern, replacement);
    }

    return text;
}

function ensureExtension(name, extension) {
    const text = String(name || `document.${extension}`);
    return text.toLowerCase().endsWith(`.${extension}`)
        ? text
        : `${text.replace(/\.[a-z0-9]+$/i, "")}.${extension}`;
}

function loadJSZip() {
    try {
        return require("jszip");
    } catch {
        throw new Error("jszip is required for DOCX/XLSX generation.");
    }
}

function writeBinary(relativePath, buffer) {
    const absolute = workspaceTools.resolveWorkspacePath(relativePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, buffer);
    return { path: relativePath, bytes: buffer.length };
}

function writeText(relativePath, content) {
    if (workspaceTools.fileExists(relativePath).exists) {
        workspaceTools.updateFile(relativePath, content);
    } else {
        workspaceTools.createFile(relativePath, content);
    }
    return { path: relativePath, bytes: Buffer.byteLength(content, "utf8") };
}

/*
--------------------------------------------------
DOCX
--------------------------------------------------
blocks: { type: heading|paragraph|bullet|number|code|table|pageBreak }
--------------------------------------------------
*/

function docxParagraph(text, options = {}) {
    const properties = [];
    if (options.style) properties.push(`<w:pStyle w:val="${options.style}"/>`);
    if (options.bullet) properties.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    if (options.number) properties.push('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>');
    const shading = options.code ? '<w:shd w:val="clear" w:fill="F4F4F4"/>' : "";
    const font = options.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : "";

    return (
        "<w:p>" +
        `<w:pPr>${properties.join("")}${shading}</w:pPr>` +
        `<w:r><w:rPr>${font}</w:rPr>` +
        `<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>` +
        "</w:p>"
    );
}

function docxTable(rows) {
    const body = rows.map((row, rowIndex) => {
        const cells = row.map(cell =>
            '<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>' +
            docxParagraph(cell, { style: rowIndex === 0 ? "TableHeader" : undefined }) +
            "</w:tc>"
        ).join("");
        return `<w:tr>${cells}</w:tr>`;
    }).join("");

    return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${body}</w:tbl>`;
}

function blocksToDocxBody(blocks) {
    return blocks.slice(0, LIMITS.maxSections).map(block => {
        switch (block.type) {
            case "heading":
                return docxParagraph(block.text, { style: `Heading${Math.min(Math.max(Number(block.level) || 1, 1), 6)}` });
            case "bullet":
                return docxParagraph(block.text, { bullet: true });
            case "number":
                return docxParagraph(block.text, { number: true });
            case "code":
                return docxParagraph(block.text, { code: true });
            case "table":
                return docxTable(block.rows || []);
            case "pageBreak":
                return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
            default:
                return docxParagraph(block.text || "");
        }
    }).join("");
}

async function createDocx(request) {
    const JSZip = loadJSZip();
    const zip = new JSZip();

    const blocks = Array.isArray(request.blocks) && request.blocks.length
        ? request.blocks
        : [{ type: "heading", level: 1, text: request.title || "Document" }]
            .concat((request.paragraphs || []).map(text => ({ type: "paragraph", text })));

    const body = blocksToDocxBody(blocks);

    zip.file("[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        "</Types>");

    zip.folder("_rels").file(".rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        "</Relationships>");

    const word = zip.folder("word");

    word.folder("_rels").file("document.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
        "</Relationships>");

    word.file("document.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>` +
        "</w:document>");

    word.file("styles.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
        [1, 2, 3, 4, 5, 6].map(level =>
            `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
            `<w:pPr><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
            `<w:rPr><w:b/><w:sz w:val="${36 - level * 4}"/></w:rPr></w:style>`
        ).join("") +
        '<w:style w:type="paragraph" w:styleId="TableHeader"><w:name w:val="Table Header"/><w:rPr><w:b/></w:rPr></w:style>' +
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders>' +
        ["top", "left", "bottom", "right", "insideH", "insideV"].map(side =>
            `<w:${side} w:val="single" w:sz="4" w:color="999999"/>`
        ).join("") +
        "</w:tblBorders></w:tblPr></w:style>" +
        "</w:styles>");

    word.file("numbering.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>' +
        '<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
        '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
        '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>' +
        "</w:numbering>");

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return writeBinary(ensureExtension(request.path || request.title || "document", "docx"), buffer);
}

/*
--------------------------------------------------
XLSX
--------------------------------------------------
sheets: [{ name, rows: [[...]] }]
--------------------------------------------------
*/

function columnLetter(index) {
    let letter = "";
    let n = index;
    while (n >= 0) {
        letter = String.fromCharCode((n % 26) + 65) + letter;
        n = Math.floor(n / 26) - 1;
    }
    return letter;
}

function sheetXml(rows) {
    const body = rows.slice(0, LIMITS.maxRows).map((row, rowIndex) => {
        const cells = row.slice(0, LIMITS.maxColumns).map((value, colIndex) => {
            const ref = `${columnLetter(colIndex)}${rowIndex + 1}`;
            if (typeof value === "number" && Number.isFinite(value)) {
                return `<c r="${ref}"><v>${value}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        }).join("");
        return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<sheetData>${body}</sheetData></worksheet>`;
}

async function createXlsx(request) {
    const JSZip = loadJSZip();
    const zip = new JSZip();

    const sheets = (Array.isArray(request.sheets) && request.sheets.length)
        ? request.sheets
        : [{ name: request.title || "Sheet1", rows: request.rows || [] }];

    const normalized = sheets.slice(0, 50).map((sheet, index) => ({
        name: String(sheet.name || `Sheet${index + 1}`).replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) || `Sheet${index + 1}`,
        rows: Array.isArray(sheet.rows) ? sheet.rows : []
    }));

    zip.file("[Content_Types].xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        normalized.map((_, index) =>
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        ).join("") +
        "</Types>");

    zip.folder("_rels").file(".rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>");

    const xl = zip.folder("xl");

    xl.file("workbook.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        "<sheets>" +
        normalized.map((sheet, index) =>
            `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
        ).join("") +
        "</sheets></workbook>");

    xl.folder("_rels").file("workbook.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        normalized.map((_, index) =>
            `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
        ).join("") +
        "</Relationships>");

    const worksheets = xl.folder("worksheets");
    normalized.forEach((sheet, index) => {
        worksheets.file(`sheet${index + 1}.xml`, sheetXml(sheet.rows));
    });

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return writeBinary(ensureExtension(request.path || request.title || "workbook", "xlsx"), buffer);
}

/*
--------------------------------------------------
PPTX (via pptxgenjs)
--------------------------------------------------
slides: [{ title, bullets: [], text, table, notes }]
--------------------------------------------------
*/

async function createPptx(request) {
    let PptxGenJS;
    try {
        PptxGenJS = require("pptxgenjs");
    } catch {
        throw new Error("pptxgenjs is required for PPTX generation.");
    }

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_16x9";
    if (request.title) pptx.title = request.title;
    if (request.author) pptx.author = request.author;

    const slides = (Array.isArray(request.slides) ? request.slides : []).slice(0, LIMITS.maxSlides);

    if (request.title) {
        const cover = pptx.addSlide();
        cover.addText(request.title, { x: 0.5, y: 2.0, w: 9, h: 1.2, fontSize: 40, bold: true, align: "center" });
        if (request.subtitle) {
            cover.addText(request.subtitle, { x: 0.5, y: 3.2, w: 9, h: 0.8, fontSize: 20, align: "center", color: "666666" });
        }
    }

    for (const slideSpec of slides) {
        const slide = pptx.addSlide();

        if (slideSpec.title) {
            slide.addText(String(slideSpec.title), {
                x: 0.5, y: 0.4, w: 9, h: 0.9, fontSize: 28, bold: true, color: "1F3864"
            });
        }

        const bullets = (slideSpec.bullets || []).map(text => ({
            text: String(text),
            options: { bullet: true, fontSize: 18, breakLine: true }
        }));

        if (bullets.length) {
            slide.addText(bullets, { x: 0.7, y: 1.4, w: 8.6, h: 4.0, valign: "top" });
        } else if (slideSpec.text) {
            slide.addText(String(slideSpec.text), { x: 0.7, y: 1.4, w: 8.6, h: 4.0, fontSize: 16, valign: "top" });
        }

        if (Array.isArray(slideSpec.table) && slideSpec.table.length) {
            slide.addTable(
                slideSpec.table.map((row, rowIndex) =>
                    row.map(cell => ({ text: String(cell ?? ""), options: { bold: rowIndex === 0, fontSize: 12 } }))
                ),
                { x: 0.5, y: 1.5, w: 9, border: { pt: 1, color: "CCCCCC" } }
            );
        }

        if (slideSpec.notes) slide.addNotes(String(slideSpec.notes));
    }

    if (!slides.length && !request.title) {
        const slide = pptx.addSlide();
        slide.addText("Jarwis Presentation", { x: 0.5, y: 2.3, w: 9, h: 1, fontSize: 32, align: "center" });
    }

    const data = await pptx.write({ outputType: "nodebuffer" });
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return writeBinary(ensureExtension(request.path || request.title || "presentation", "pptx"), buffer);
}

/*
--------------------------------------------------
TEXT FORMATS
--------------------------------------------------
*/

function toMarkdownTable(rows) {
    if (!rows.length) return "";
    const head = `| ${rows[0].map(String).join(" | ")} |`;
    const rule = `| ${rows[0].map(() => "---").join(" | ")} |`;
    const body = rows.slice(1).map(row => `| ${row.map(String).join(" | ")} |`);
    return [head, rule, ...body].join("\n");
}

function blocksToMarkdown(request) {
    if (typeof request.content === "string") return request.content;

    const lines = [];
    if (request.title) lines.push(`# ${request.title}`, "");

    for (const block of request.blocks || []) {
        switch (block.type) {
            case "heading":
                lines.push(`${"#".repeat(Math.min(block.level || 1, 6))} ${block.text}`, "");
                break;
            case "bullet":
                lines.push(`- ${block.text}`);
                break;
            case "number":
                lines.push(`1. ${block.text}`);
                break;
            case "code":
                lines.push("```" + (block.language || ""), block.text, "```", "");
                break;
            case "table":
                lines.push(toMarkdownTable(block.rows || []), "");
                break;
            case "pageBreak":
                lines.push("---", "");
                break;
            default:
                lines.push(String(block.text || ""), "");
        }
    }

    return lines.join("\n").trim() + "\n";
}

function createHtml(request) {
    const markdown = blocksToMarkdown(request);
    const body = markdown
        .split(/\n{2,}/)
        .filter(block => block.trim())
        .map(block => {
            const heading = block.match(/^(#+)\s*(.*)$/);
            if (heading) {
                const level = Math.min(heading[1].length, 6);
                return `<h${level}>${xmlEscape(heading[2])}</h${level}>`;
            }
            if (block.startsWith("```")) {
                const code = block.replace(/```[a-z]*\n?/gi, "");
                return `<pre><code>${xmlEscape(code)}</code></pre>`;
            }
            return `<p>${xmlEscape(block).replace(/\n/g, "<br>")}</p>`;
        })
        .join("\n");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${xmlEscape(request.title || "Document")}</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;max-width:820px;margin:48px auto;padding:0 20px;line-height:1.65;color:#1a1a1a}
h1,h2,h3{line-height:1.25}
pre{background:#f4f4f4;padding:14px;border-radius:8px;overflow:auto}
code{font-family:Consolas,Menlo,monospace}
table{border-collapse:collapse;width:100%}
td,th{border:1px solid #ccc;padding:7px 10px;text-align:left}
</style>
</head>
<body>
${body}
</body>
</html>`;

    return writeText(ensureExtension(request.path || request.title || "document", "html"), html);
}

function createCsv(request) {
    const rows = request.rows || [];
    const escapeCsv = value => {
        const text = String(value ?? "");
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const content = rows.slice(0, LIMITS.maxRows)
        .map(row => row.map(escapeCsv).join(","))
        .join("\n");
    return writeText(ensureExtension(request.path || request.title || "data", "csv"), content);
}

function createText(request) {
    const content = typeof request.content === "string"
        ? request.content
        : blocksToMarkdown(request);
    const extension = String(request.format || "txt").toLowerCase();
    return writeText(ensureExtension(request.path || request.title || "document", extension), content);
}

/*
--------------------------------------------------
PUBLIC ENTRY POINT
--------------------------------------------------
format: docx | xlsx | pptx | md | html | csv | json | txt
--------------------------------------------------
*/

async function generate(request = {}) {
    const format = String(request.format ||
        (request.path && request.path.includes(".") ? request.path.split(".").pop() : "md")).toLowerCase();

    switch (format) {
        case "docx":
        case "word":
            return { ok: true, format: "docx", artifact: await createDocx(request) };
        case "xlsx":
        case "excel":
            return { ok: true, format: "xlsx", artifact: await createXlsx(request) };
        case "pptx":
        case "powerpoint":
            return { ok: true, format: "pptx", artifact: await createPptx(request) };
        case "html":
            return { ok: true, format: "html", artifact: createHtml(request) };
        case "csv":
            return { ok: true, format: "csv", artifact: createCsv(request) };
        case "json": {
            const content = JSON.stringify(request.data ?? request.blocks ?? request.content ?? {}, null, 2);
            return { ok: true, format: "json", artifact: writeText(ensureExtension(request.path || request.title || "data", "json"), content) };
        }
        case "md":
        case "markdown":
            return { ok: true, format: "md", artifact: writeText(ensureExtension(request.path || request.title || "document", "md"), blocksToMarkdown(request)) };
        default:
            return { ok: true, format: "txt", artifact: createText(request) };
    }
}

module.exports = {
    LIMITS,
    generate,
    blocksToMarkdown,
    toMarkdownTable,
    createDocx,
    createXlsx,
    createPptx,
    createHtml,
    createCsv,
    createText,
    xmlEscape
};