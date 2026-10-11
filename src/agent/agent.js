const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "qwen2.5:1.5b";

async function decideAction(userMessage, tools) {

    const toolDescriptions = tools.map(tool => {
        return `${tool.name}: ${tool.description}`;
    }).join("\n");

    const prompt = `
Choose one action for the user's message.

Available actions:
- answer
- web_search
- list_documents
- get_nexus_status

Tools:
${toolDescriptions}

Rules:
- Use web_search for web, online, latest, current, recent news, or internet searches.
- Use list_documents when the user asks to list/show available documents or files.
- Use get_nexus_status when the user asks about Nexus status or whether Nexus is running.
- Otherwise use answer.

Return ONLY valid JSON:
{"action":"answer","tool":null,"query":null}

User message:
${userMessage}
`;

    const response = await fetch(
        OLLAMA_URL,
        {
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
        }
    );

    if (!response.ok) {
        throw new Error(
            `Ollama request failed: ${response.status} ${response.statusText}`
        );
    }

    const data = await response.json();

    const content =
        data.message?.content || "";

    console.log(
        "Raw agent response:",
        content
    );

    try {

        const decision =
            JSON.parse(content);

        return {
            action: decision.action || "answer",
            tool: decision.tool || null,
            query: decision.query || null
        };

    } catch (error) {

        return {
            action: "answer",
            tool: null,
            query: null
        };
    }
}

module.exports = {
    decideAction
};