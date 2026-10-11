const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
    StdioClientTransport
} = require("@modelcontextprotocol/sdk/client/stdio.js");

const { decideAction } = require("./agent");

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL = "qwen2.5:1.5b";

async function createMcpClient(serverFile) {

    const client = new Client({
        name: "Jarwis Agent",
        version: "1.0.0"
    });

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverFile]
    });

    await client.connect(transport);

    return client;
}

async function generateAnswer(userMessage, toolResult = null) {

    let prompt = `
You are Jarwis.

Answer the user's question naturally and clearly.

USER QUESTION:
${userMessage}
`;

    if (toolResult) {

        prompt += `

INFORMATION FROM TOOL:
${toolResult}

Use this information to answer the user's question.

Do not mention:
- MCP
- tools
- agents
- internal processes

If the tool information contains URLs, preserve them when useful.
Do not invent information that is not present in the tool result.
`;
    }

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
            `Ollama request failed: ${response.status}`
        );
    }

    const data = await response.json();

    return (
        data.message?.content ||
        "I couldn't generate a response."
    );
}

async function runAgent(userMessage) {

    console.log("\n==============================");
    console.log("USER:");
    console.log(userMessage);

    /*
     * Connect to the main Nexus MCP server.
     */
    const nexusClient =
        await createMcpClient(require.resolve("../mcp/mcp-server.js"));

    /*
     * Connect to the web-search MCP server.
     */
    const webClient =
        await createMcpClient(require.resolve("../mcp/web-search-mcp-server.js"));

    /*
     * Get tools from both servers.
     */
    const nexusTools =
        await nexusClient.listTools();

    const webTools =
        await webClient.listTools();

    const tools = [
        ...nexusTools.tools,
        ...webTools.tools
    ];

    console.log("\nAVAILABLE TOOLS:");

    tools.forEach(tool => {
        console.log(`- ${tool.name}`);
    });

    /*
     * Ask the AI which tool should be used.
     */
    const decision = await decideAction(
        userMessage,
        tools
    );

    console.log("\nAGENT DECISION:");
    console.log(decision);

    let answer;

    /*
     * Execute selected tool.
     */
    if (
        decision.action === "tool" &&
        decision.tool
    ) {

        console.log("\nEXECUTING TOOL:");
        console.log(decision.tool);

        let result;

        /*
         * Web search
         */
        if (decision.tool === "web_search") {

            result = await webClient.callTool({
    name: "web_search",
    arguments: {
        query: decision.query || userMessage
    }
});
        }

        /*
         * Nexus tools
         */
        else {

            result = await nexusClient.callTool({
                name: decision.tool,
                arguments: {}
            });

        }

        const resultText =
            result.content?.[0]?.text ||
            "No result returned.";

        console.log("\nTOOL RESULT:");
        console.log(resultText);

        /*
         * Let Qwen turn the raw tool result
         * into a natural response.
         */
        answer = await generateAnswer(
            userMessage,
            resultText
        );

    } else {

        /*
         * No tool required.
         */
        answer = await generateAnswer(
            userMessage
        );
    }

    await nexusClient.close();
    await webClient.close();

    console.log("\nNEXUS AI:");
    console.log(answer);
}

async function main() {

    await runAgent(
        "Search the web for Articulate Storyline 360"
    );

    await runAgent(
        "What is 25 multiplied by 4?"
    );
}

main().catch(error => {

    console.error("\nAgent error:");
    console.error(error);

    process.exit(1);
});