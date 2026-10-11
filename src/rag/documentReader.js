const fs = require("fs");
const path = require("path");

async function readPDF(filePath) {
    const pdfModule = require("pdf-parse");

    const PDFParse = pdfModule.PDFParse;

    if (!PDFParse) {
        throw new Error("PDFParse was not found in pdf-parse.");
    }

    const buffer = fs.readFileSync(filePath);

    const parser = new PDFParse({
        data: buffer
    });

    const result = await parser.getText();

    await parser.destroy();

    return result.text;
}

async function readDOCX(filePath) {
    const mammoth = require("mammoth");

    const result = await mammoth.extractRawText({
        path: filePath
    });

    return result.value;
}

async function readDocument(filePath) {
    const extension = path.extname(filePath).toLowerCase();

    if (extension === ".pdf") {
        return await readPDF(filePath);
    }

    if (extension === ".docx") {
        return await readDOCX(filePath);
    }

    if ([".txt", ".md", ".markdown", ".csv", ".json", ".log"].includes(extension)) {
        return fs.readFileSync(filePath, "utf8");
    }

    throw new Error(`Unsupported document type: ${extension}`);
}

module.exports = {
    readDocument
};