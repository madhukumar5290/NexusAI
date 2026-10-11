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
    name: "Nexus Web Search",
    version: "1.0.0"
});

function decodeDuckDuckGoUrl(url) {

    try {

        if (url.startsWith("//duckduckgo.com/l/")) {

            const fullUrl = "https:" + url;

            const parsed = new URL(fullUrl);

            const destination = parsed.searchParams.get("uddg");

            if (destination) {
                return decodeURIComponent(destination);
            }
        }

    } catch (error) {
        console.error(
            "URL decode error:",
            error.message
        );
    }

    return url;
}

function cleanHtml(text) {

    return text
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'")
        .replace(/&#39;/g, "'")
        .trim();
}

server.tool(
    "web_search",
    "Searches the web for information.",
    {
        query: z.string()
    },
    async ({ query }) => {

        try {

            const url =
                "https://html.duckduckgo.com/html/?q=" +
                encodeURIComponent(query);

            const response = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0"
                }
            });

            if (!response.ok) {

                return {
                    content: [
                        {
                            type: "text",
                            text:
                                `Search failed. HTTP status: ${response.status}`
                        }
                    ]
                };
            }

            const html = await response.text();

            const results = [];

            const regex =
                /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>/gi;

            let match;

            while (
                (match = regex.exec(html)) !== null &&
                results.length < 5
            ) {

                const rawUrl = match[1];

                const title = cleanHtml(
                    match[2]
                );

                const destinationUrl =
                    decodeDuckDuckGoUrl(rawUrl);

                results.push({
                    title,
                    url: destinationUrl
                });
            }

            if (results.length === 0) {

                return {
                    content: [
                        {
                            type: "text",
                            text: "No search results found."
                        }
                    ]
                };
            }

            const output =
                results
                    .map((result, index) => {

                        return `${index + 1}. ${result.title}
URL: ${result.url}`;

                    })
                    .join("\n\n");

            return {
                content: [
                    {
                        type: "text",
                        text: output
                    }
                ]
            };

        } catch (error) {

            return {
                content: [
                    {
                        type: "text",
                        text:
                            `Web search failed: ${error.message}`
                    }
                ]
            };
        }
    }
);

async function main() {

    const transport =
        new StdioServerTransport();

    await server.connect(transport);
}

main().catch(error => {

    console.error(error);

    process.exit(1);
});