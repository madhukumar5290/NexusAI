const { askOllama } = require("../../lib/ollama");

const memory = require("./memory");


/* =====================================================
   QUESTION FILTER
===================================================== */

function isLikelyQuestion(text) {

    const trimmed = text.trim();

    const questionPatterns = [
        /^what\b/i,
        /^why\b/i,
        /^how\b/i,
        /^when\b/i,
        /^where\b/i,
        /^who\b/i,
        /^which\b/i,

        /^can you\b/i,
        /^could you\b/i,
        /^would you\b/i,

        /^do you\b/i,
        /^does\b/i,
        /^did\b/i,

        /^is\b/i,
        /^are\b/i,
        /^will\b/i,
        /^should\b/i,

        /^explain\b/i,
        /^tell me\b/i,

        /\?$/
    ];

    return questionPatterns.some(
        pattern => pattern.test(trimmed)
    );
}


/* =====================================================
   EXPLICIT USER STATEMENT FILTER
===================================================== */

function isExplicitUserStatement(text) {

    const statementPatterns = [

        /^i am\b/i,
        /^i'm\b/i,

        /^i work\b/i,
        /^i use\b/i,

        /^i prefer\b/i,
        /^i like\b/i,
        /^i dislike\b/i,

        /^i want\b/i,
        /^i need\b/i,
        /^i have\b/i,

        /^i'm building\b/i,
        /^i am building\b/i,

        /^my goal\b/i,
        /^my project\b/i,
        /^my preference\b/i,

        /^my favorite\b/i,
        /^my favourite\b/i,

        /^i'm working\b/i,
        /^i am working\b/i,

        /^i'm now\b/i,
        /^i am now\b/i,

        /^my .* is\b/i,
        /^my .* are\b/i
    ];

    return statementPatterns.some(
        pattern => pattern.test(text.trim())
    );
}


/* =====================================================
   KNOWN MEMORY KEY DETECTION
===================================================== */

function detectKnownMemoryKey(userMessage) {

    const text =
        userMessage
            .trim()
            .toLowerCase();


    /* -----------------------------------------
       FAVORITE PROJECT
    ----------------------------------------- */

    if (
        /^my (favorite|favourite) project\b/i.test(text)
    ) {

        return "user_favorite_project";
    }


    /* -----------------------------------------
       NEXUS AI PROJECT
    ----------------------------------------- */

    if (
        /\bnexus ai\b/i.test(text) &&
        (
            /\bbuilding\b/i.test(text) ||
            /\bproject\b/i.test(text)
        )
    ) {

        return "user_building_nexus_ai";
    }


    /* -----------------------------------------
       ARTICULATE STORYLINE
    ----------------------------------------- */

    if (
        /\barticulate storyline\b/i.test(text)
    ) {

        return "user_uses_articulate_storyline";
    }


    /* -----------------------------------------
       CODING PREFERENCE
    ----------------------------------------- */

    if (
        /\b(step[- ]by[- ]step|one step at a time|detailed instructions|coding preference)\b/i.test(
            text
        )
    ) {

        return "user_coding_preference";
    }


    /* -----------------------------------------
       JOB ROLE
    ----------------------------------------- */

    if (
        /^i am (now )?(a |an )?/i.test(text) &&
        (
            /\blearning developer\b/i.test(text) ||
            /\bsenior learning developer\b/i.test(text) ||
            /\blead learning developer\b/i.test(text) ||
            /\belearning developer\b/i.test(text) ||
            /\binstructional designer\b/i.test(text)
        )
    ) {

        return "user_job_role";
    }


    return null;
}


/* =====================================================
   CONVERT USER STATEMENT TO MEMORY SENTENCE
===================================================== */

function buildDeterministicMemoryValue(userMessage) {

    const cleanedMessage =
        userMessage
            .trim()
            .replace(/[.!?]+$/, "");

    let value = cleanedMessage;


    if (/^I am\b/i.test(value)) {

        value =
            value.replace(
                /^I am\b/i,
                "The user is"
            );

    }

    else if (/^I'm\b/i.test(value)) {

        value =
            value.replace(
                /^I'm\b/i,
                "The user is"
            );

    }

    else if (/^I use\b/i.test(value)) {

        value =
            value.replace(
                /^I use\b/i,
                "The user uses"
            );

    }

    else if (/^I prefer\b/i.test(value)) {

        value =
            value.replace(
                /^I prefer\b/i,
                "The user prefers"
            );

    }

    else if (/^I like\b/i.test(value)) {

        value =
            value.replace(
                /^I like\b/i,
                "The user likes"
            );

    }

    else if (/^I dislike\b/i.test(value)) {

        value =
            value.replace(
                /^I dislike\b/i,
                "The user dislikes"
            );

    }

    else if (/^I work\b/i.test(value)) {

        value =
            value.replace(
                /^I work\b/i,
                "The user works"
            );

    }

    else if (/^My favorite\b/i.test(value)) {

        value =
            value.replace(
                /^My favorite\b/i,
                "The user's favorite"
            );

    }

    else if (/^My favourite\b/i.test(value)) {

        value =
            value.replace(
                /^My favourite\b/i,
                "The user's favorite"
            );

    }

    else {

        value =
            `The user stated: ${cleanedMessage}`;
    }


    return value.endsWith(".")
        ? value
        : `${value}.`;
}


/* =====================================================
   UNKNOWN MEMORY EXTRACTION PROMPT
===================================================== */

function buildExtractionPrompt(userMessage) {

    return `
Extract ONE long-term fact explicitly stated by the USER.

USER:
${userMessage}

Create a NEW memory key for this fact.

Rules:
- Only remember facts about the USER.
- Do not guess.
- Do not infer.
- Do not remember temporary requests.
- Do not remember questions.
- Do not remember facts about other people.
- Create a concise snake_case key beginning with "user_".
- The key must describe the fact.
- The value must contain exactly what the user stated.
- The value must be a complete sentence beginning with "The user".
- Return exactly one memory.
- Return JSON only.

Example:

User:
I am building a new eLearning project.

Correct:
{"memories":[{"key":"user_building_elearning_project","value":"The user is building a new eLearning project."}]}

Return:
{"memories":[{"key":"user_example","value":"The user ..."}]}
`;
}


/* =====================================================
   CALL THE MODEL
===================================================== */

async function callOllama(prompt) {
    return askOllama(prompt);
}


/* =====================================================
   PARSE + VALIDATE MODEL RESPONSE
===================================================== */

function validateMemoryItem(content, existingMemories) {

    try {

        let cleanedContent =
            content.trim();

        cleanedContent =
            cleanedContent
                .replace(
                    /^```json\s*/i,
                    ""
                )
                .replace(
                    /^```\s*/i,
                    ""
                )
                .replace(
                    /\s*```$/,
                    ""
                )
                .trim();

        const result =
            JSON.parse(cleanedContent);

        if (
            !result.memories ||
            !Array.isArray(result.memories)
        ) {
            return null;
        }

        const item =
            result.memories[0];

        if (!item) {
            return null;
        }

        if (
            typeof item.key !== "string" ||
            typeof item.value !== "string"
        ) {
            return null;
        }

        const key =
            item.key
                .trim()
                .toLowerCase();

        const value =
            item.value.trim();

        if (!key || !value) {
            return null;
        }

        if (!key.startsWith("user_")) {
            console.log(
                "Memory rejected: invalid key."
            );

            return null;
        }

        if (
            !/^The user\b/i.test(value)
        ) {
            console.log(
                "Memory rejected: invalid value."
            );

            return null;
        }

        const existing =
            existingMemories.find(
                memoryItem =>
                    memoryItem.key === key
            );

        if (existing) {
            console.log(
                `Memory rejected: key already exists: ${key}`
            );

            return null;
        }

        return { key, value };

    } catch (error) {

        console.error(
            "Could not parse memory JSON."
        );

        return null;
    }
}


/* =====================================================
   EXTRACT MEMORIES
===================================================== */

async function extractMemories(userMessage) {

    /* -----------------------------------------
       QUESTIONS ARE NOT MEMORIES
    ----------------------------------------- */

    if (isLikelyQuestion(userMessage)) {

        console.log(
            "\nMemory filter: question detected."
        );

        return {
            memories: []
        };
    }


    /* -----------------------------------------
       REQUIRE EXPLICIT USER STATEMENT
    ----------------------------------------- */

    if (!isExplicitUserStatement(userMessage)) {

        console.log(
            "\nMemory filter: no explicit user statement detected."
        );

        return {
            memories: []
        };
    }


    /* -----------------------------------------
       LOAD EXISTING MEMORIES
    ----------------------------------------- */

    const existingMemories =
        memory.getAllMemories();


    /* -----------------------------------------
       DETECT KNOWN MEMORY CATEGORY
    ----------------------------------------- */

    const knownKey =
        detectKnownMemoryKey(userMessage);


    /* -----------------------------------------
       KNOWN CATEGORY
    ----------------------------------------- */

    if (knownKey) {

        const value =
            buildDeterministicMemoryValue(
                userMessage
            );


        console.log(
            "\nDeterministic memory extraction:"
        );

        console.log(
            `Key: ${knownKey}`
        );

        console.log(
            `Value: ${value}`
        );


        return {
            memories: [
                {
                    key: knownKey,
                    value: value
                }
            ]
        };
    }


    /* -----------------------------------------
       UNKNOWN CATEGORY
       
       Let the model create a NEW key.
    ----------------------------------------- */

    const prompt =
        buildExtractionPrompt(
            userMessage
        );


    const content =
        await callOllama(prompt);


    console.log(
        "\nRaw memory extraction:"
    );

    console.log(content);


    const item =
        validateMemoryItem(
            content,
            existingMemories
        );

    if (!item) {
        return {
            memories: []
        };
    }

    console.log(
        "\nNew memory detected:"
    );

    console.log(
        `Key: ${item.key}`
    );

    console.log(
        `Value: ${item.value}`
    );

    return {
        memories: [item]
    };
}


/* =====================================================
   EXPORT
===================================================== */

module.exports = {
    extractMemories
};