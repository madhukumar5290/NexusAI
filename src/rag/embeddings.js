const config = require("../../lib/config");
const MODEL = "nomic-embed-text";

function embedUrl() {
    const base = String(config.PROVIDERS.ollama.baseUrl || "http://127.0.0.1:11434")
        .replace(/\/+$/, "");
    return `${base}/api/embed`;
}

async function createEmbedding(text) {
    const response = await fetch(embedUrl(), {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: MODEL,
            input: text
        })
    });

    if (!response.ok) {
        throw new Error(
            `Embedding request failed: ${response.status} ${response.statusText}`
        );
    }

    const data = await response.json();

    if (!data.embeddings || !data.embeddings[0]) {
        throw new Error("No embedding returned by Ollama.");
    }

    return data.embeddings[0];
}

module.exports = {
    createEmbedding
};