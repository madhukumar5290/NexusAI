const fs = require("fs");
const path = require("path");

const {
    McpServer
} = require("@modelcontextprotocol/sdk/server/mcp.js");

const {
    StdioServerTransport
} = require("@modelcontextprotocol/sdk/server/stdio.js");

const server = new McpServer({
    name: "Nexus Local Tools",
    version: "1.0.0"
});

server.tool(
    "get_nexus_status",
    "Returns the current status of the Jarwis system.",
    {},
    async () => {
        return {
            content: [
                {
                    type: "text",
                    text: "Jarwis is online and ready."
                }
            ]
        };
    }
);

server.tool(
    "list_documents",
    "Lists documents currently available to Jarwis.",
    {},
    async () => {
        const documentsRoot = path.join(
            __dirname,
            "..",
            "..",
            "documents"
        );

        const folders = [
            path.join(documentsRoot, "pdf"),
            path.join(documentsRoot, "docx"),
            path.join(documentsRoot, "pptx")
        ];

        const documents = [];

        for (const folder of folders) {
            if (!fs.existsSync(folder)) {
                continue;
            }

            const files = fs.readdirSync(folder);

            for (const file of files) {
                documents.push(file);
            }
        }

        if (documents.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "No documents are currently available."
                    }
                ]
            };
        }

        return {
            content: [
                {
                    type: "text",
                    text: documents.join("\n")
                }
            ]
        };
    }
);

async function main() {
    const transport = new StdioServerTransport();

    await server.connect(transport);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});