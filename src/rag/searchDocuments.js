const readline = require("readline");

const { createEmbedding } = require("./embeddings");
const vectorStore = require("./vectorStore");
const { findSimilarChunks } = require("./similarity");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question("Ask something about your documents: ", async (query) => {
    try {
        console.log("\nCreating query embedding...");

        const queryEmbedding = await createEmbedding(query);

        const chunks = vectorStore.getAllChunks();

        const results = findSimilarChunks(
            queryEmbedding,
            chunks,
            5
        );

        console.log("\nTop matching sections:\n");

        results.forEach((result, index) => {
            console.log(`--- Result ${index + 1} ---`);
            console.log(`Document: ${result.document_name}`);
            console.log(`Chunk: ${result.chunk_index}`);
            console.log(`Similarity: ${result.similarity.toFixed(4)}`);
            console.log(`\n${result.content}\n`);
        });

    } catch (error) {
        console.error("\nSearch failed:");
        console.error(error);
    }

    rl.close();
});