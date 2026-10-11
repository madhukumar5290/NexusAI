const { decideAction } = require("../src/agent/agent");

const tools = [
    {
        name: "get_nexus_status",
        description: "Returns the current status of Nexus AI."
    },
    {
        name: "list_documents",
        description: "Lists documents currently available to Nexus AI."
    },
    {
        name: "web_search",
        description: "Searches the web for information."
    }
];

async function test() {

    const questions = [
        "What documents do I have?",
        "What is 25 multiplied by 4?",
        "Search the web for Articulate Storyline 360"
    ];

    for (const question of questions) {

        console.log("\nUser:", question);

        const decision = await decideAction(
            question,
            tools
        );

        console.log("Agent decision:", decision);
    }
}

test().catch(error => {
    console.error(error);
});