const fs = require("fs");
const path = require("path");

const { readDocument } = require("./documentReader");
const { chunkText } = require("./chunker");
const { createEmbedding } = require("./embeddings");
const vectorStore = require("./vectorStore");

async function indexDocument(filePath) {
    const documentName = path.basename(filePath);

    console.log(`\nIndexing: ${documentName}`);

    // Extract text
    console.log("Reading document...");
    const text = await readDocument(filePath);
    if (!String(text || "").trim()) {
        throw new Error(`${documentName} did not contain readable text.`);
    }

    // Split into chunks
    const chunks = chunkText(text);

    console.log(`Found ${chunks.length} chunks.`);

    // Create the full replacement before touching the existing index.
    const indexedChunks = [];
    for (let i = 0; i < chunks.length; i++) {
        console.log(`Embedding chunk ${i + 1}/${chunks.length}...`);

        const embedding = await createEmbedding(chunks[i]);
        indexedChunks.push({ content: chunks[i], embedding });
    }

    vectorStore.replaceDocument(documentName, indexedChunks);
    console.log("\nDocument indexed successfully.");
}

async function main() {
    const pdfFolder = path.join(
        __dirname,
        "documents",
        "pdf"
    );

    const files = fs.readdirSync(pdfFolder);

    const pdfFile = files.find(
        file => file.toLowerCase().endsWith(".pdf")
    );

    if (!pdfFile) {
        console.log("No PDF found.");
        return;
    }

    const filePath = path.join(pdfFolder, pdfFile);

    try {
        await indexDocument(filePath);
    } catch (error) {
        console.error("\nIndexing failed:");
        console.error(error);
    }
}

if (require.main === module) {
    main();
}

module.exports = { indexDocument };