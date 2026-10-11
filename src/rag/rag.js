const { createEmbedding } = require("./embeddings");
const vectorStore = require("./vectorStore");
const { findSimilarChunks } = require("./similarity");

async function retrieveContext(query, limit = 5) {
    const queryEmbedding = await createEmbedding(query);

    const chunks = vectorStore.getAllChunks();

    const results = findSimilarChunks(
        queryEmbedding,
        chunks,
        limit
    );

    return results;
}

function buildContext(results) {
    return results
        .map((result, index) => {
            return `SOURCE ${index + 1}
Document: ${result.document_name}
Chunk: ${result.chunk_index}

${result.content}`;
        })
        .join("\n\n-------------------------\n\n");
}

module.exports = {
    retrieveContext,
    buildContext
};