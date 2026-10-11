/*
Shared model helpers: a single one-shot
call wrapper and a tolerant JSON parser
used by agentCore and memoryExtractor.

The call goes through the provider gateway
(model router) instead of hard-coding a
provider or model, so agent internals stay
model-independent (master spec sections
18 and 56). The role defaults to "code"
(file/artifact generation); callers may
pass a different role.
*/

const gateway =
    require("./providers/gateway");

async function askOllama(prompt) {
    return gateway.chat([
        {
            role: "user",
            content: prompt
        }
    ]);
}

function parseJson(text) {
    let value =
        String(text || "").trim();

    value =
        value
            .replace(
                /^```(?:json)?\s*/i,
                ""
            )
            .replace(
                /\s*```$/i,
                ""
            )
            .trim();

    try {
        return JSON.parse(value);
    } catch { }

    const first =
        value.indexOf("{");

    const last =
        value.lastIndexOf("}");

    if (
        first >= 0 &&
        last > first
    ) {
        return JSON.parse(
            value.slice(first, last + 1)
        );
    }

    throw new Error(
        "The model did not return valid JSON."
    );
}

module.exports = {
    askOllama,
    parseJson
};
