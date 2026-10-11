const {
    McpServer
} = require("@modelcontextprotocol/sdk/server/mcp.js");

const {
    StdioServerTransport
} = require("@modelcontextprotocol/sdk/server/stdio.js");

const {
    z
} = require("zod");

const server = new McpServer({
    name: "Nexus Web Tools",
    version: "1.0.0"
});

server.tool(
    "fetch_webpage",
    "Fetches the text content from a webpage URL.",
    {
        url: z.string().url()
    },
    async ({ url }) => {

        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent": "NexusAI/1.0"
                }
            });

            if (!response.ok) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to fetch webpage. HTTP status: ${response.status}`
                        }
                    ]
                };
            }

            const html = await response.text();

            // Remove scripts and styles
            const text = html
                .replace(/<script[\s\S]*?<\/script>/gi, " ")
                .replace(/<style[\s\S]*?<\/style>/gi, " ")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            // Keep the response reasonably small
            const limitedText = text.substring(0, 12000);

            return {
                content: [
                    {
                        type: "text",
                        text: limitedText
                    }
                ]
            };

        } catch (error) {

            return {
                content: [
                    {
                        type: "text",
                        text: `Unable to fetch webpage: ${error.message}`
                    }
                ]
            };
        }
    }
);

async function main() {

    const transport = new StdioServerTransport();

    await server.connect(transport);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});