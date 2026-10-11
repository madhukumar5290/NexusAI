const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const {
    StdioClientTransport
} = require("@modelcontextprotocol/sdk/client/stdio.js");

const { decideAction } = require("./agent");

async function createMcpClient() {
    const client = new Client({
        name: "Jarwis Agent",
        version: "1.0.0"
    });

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [require.resolve("../mcp/mcp-server.js")]
    });

    await client.connect(transport);

    return client;
}

async function runAgent(userMessage) {

    console.log("\nUser:", userMessage);

    // Connect to MCP
    const client = await createMcpClient();

    // Discover tools
    const toolResult = await client.listTools();

    const tools = toolResult.tools;

    console.log("\nAvailable tools:");

    tools.forEach(tool => {
        console.log(`- ${tool.name}`);
    });

    // Ask agent what to do
    const decision = await decideAction(
        userMessage,
        tools
    );

    console.log("\nAgent decision:", decision);

    // Execute selected tool
    if (
        decision.action === "tool" &&
        decision.tool
    ) {

        console.log(
            `\nExecuting MCP tool: ${decision.tool}`
        );

        const result = await client.callTool({
            name: decision.tool,
            arguments: {}
        });

        console.log("\nTool result:");

        console.log(
            result.content?.[0]?.text ||
            "No result returned."
        );
    } else {

        console.log(
            "\nNo tool required. Nexus would answer directly."
        );
    }

    await client.close();
}

async function main() {

    await runAgent(
        "What documents do I have?"
    );

    await runAgent(
        "What is 25 multiplied by 4?"
    );
}

main().catch(error => {
    console.error("\nAgent/MCP error:");
    console.error(error);
    process.exit(1);
});