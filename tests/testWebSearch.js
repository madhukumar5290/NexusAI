const {
    Client
} = require("@modelcontextprotocol/sdk/client/index.js");

const {
    StdioClientTransport
} = require("@modelcontextprotocol/sdk/client/stdio.js");

async function main() {

    const client = new Client({
        name: "Nexus Web Search Test",
        version: "1.0.0"
    });

    const transport =
        new StdioClientTransport({
            command: process.execPath,
            args: [require.resolve("../src/mcp/web-search-mcp-server.js")]
        });

    await client.connect(transport);

    const tools =
        await client.listTools();

    console.log("Available tools:");

    tools.tools.forEach(tool => {
        console.log(
            `- ${tool.name}: ${tool.description}`
        );
    });

    const result =
        await client.callTool({
            name: "web_search",
            arguments: {
                query: "Articulate Storyline 360"
            }
        });

    console.log("\nSearch results:\n");

    console.log(
        result.content?.[0]?.text ||
        "No results returned."
    );

    await client.close();
}

main().catch(error => {

    console.error("\nWeb search error:");
    console.error(error);

});