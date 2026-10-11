const {
    extractMemories
} = require("../src/memory/memoryExtractor");

async function test() {

    const messages = [

        "I am building a project called Nexus AI.",

        "I prefer step-by-step instructions when working with code.",

        "What is the weather today?",

        "Can you explain what RAG means?"
    ];

    for (const message of messages) {

        console.log("\n==============================");

        console.log("USER:");
        console.log(message);

        const result =
            await extractMemories(message);

        console.log("\nEXTRACTED MEMORIES:");

        console.log(
            JSON.stringify(
                result,
                null,
                2
            )
        );
    }
}

test().catch(error => {

    console.error(
        "\nMemory extraction error:"
    );

    console.error(error);

});