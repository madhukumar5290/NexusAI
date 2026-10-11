const {
    Client
} = require("@modelcontextprotocol/sdk/client/index.js");

const {
    StdioClientTransport
} = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {

    const client = new Client({
        name: "Nexus Web Test",
        version: "1.0.0"
    });

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [require.resolve("../src/mcp/web-mcp-server.js")]
    });

    await client.connect(transport);

    const tools = await client.listTools();

    console.log("Available web tools:");

    tools.tools.forEach(tool => {
        console.log(
            `- ${tool.name}: ${tool.description}`
        );
    });

    const result = await client.callTool({
        name: "fetch_webpage",
        arguments: {
            url: "https://example.com"
        }
    });

    console.log("\nWebpage result:\n");

    console.log(
        result.content?.[0]?.text ||
        "No content returned."
    );

    await client.close();
}

main().catch(error => {
    console.error("\nWeb MCP error:");
    console.error(error);
});