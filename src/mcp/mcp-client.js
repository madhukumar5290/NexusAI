const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {
    const client = new Client({
        name: "Jarwis",
        version: "1.0.0"
    });

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [require.resolve("./mcp-server.js")]
    });

    await client.connect(transport);

    console.log("Connected to Nexus MCP server.");

    const tools = await client.listTools();

    console.log("\nAvailable MCP tools:");

    for (const tool of tools.tools) {
        console.log(`- ${tool.name}: ${tool.description}`);
    }

   const result = await client.callTool({
    name: "list_documents",
    arguments: {}
});

    console.log("\nDocuments available to Nexus:");

console.log(result.content?.[0]?.text);

    await client.close();
}

main().catch((error) => {
    console.error("\nMCP client error:");
    console.error(error);
    process.exit(1);
});