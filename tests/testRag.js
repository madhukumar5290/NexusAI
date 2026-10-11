const { retrieveContext, buildContext } = require("../src/rag/rag");

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "qwen2.5:1.5b";

async function askQuestion(question) {
    console.log("\nSearching documents...");

    const results = await retrieveContext(question, 5);

    const context = buildContext(results);

    const prompt = `
You are Nexus AI.

Answer the user's question using ONLY the information provided in the document context below.

If the answer cannot be found in the context, say:
"I couldn't find that information in the provided documents."

Do not invent information.

DOCUMENT CONTEXT:
${context}

USER QUESTION:
${question}
`;

    console.log("Sending context to Qwen...\n");

    const response = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: MODEL,
            messages: [
                {
                    role: "user",
                    content: prompt
                }
            ],
            stream: false
        })
    });

    if (!response.ok) {
        throw new Error(
            `Ollama request failed: ${response.status} ${response.statusText}`
        );
    }

    const data = await response.json();

    console.log("NEXUS AI ANSWER:\n");
    console.log(data.message.content);
}

askQuestion(
    "What is the role of an instructional designer in eLearning?"
).catch(error => {
    console.error("\nRAG test failed:");
    console.error(error);
});