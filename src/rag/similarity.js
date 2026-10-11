function cosineSimilarity(a, b) {
    if (a.length !== b.length) {
        throw new Error("Embedding dimensions do not match.");
    }

    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        magnitudeA += a[i] * a[i];
        magnitudeB += b[i] * b[i];
    }

    if (magnitudeA === 0 || magnitudeB === 0) {
        return 0;
    }

    return dotProduct /
        (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

function findSimilarChunks(queryEmbedding, chunks, limit = 5) {
    const results = chunks.map(chunk => {
        const embedding = JSON.parse(chunk.embedding);

        return {
            ...chunk,
            similarity: cosineSimilarity(
                queryEmbedding,
                embedding
            )
        };
    });

    return results
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
}

module.exports = {
    cosineSimilarity,
    findSimilarChunks
};