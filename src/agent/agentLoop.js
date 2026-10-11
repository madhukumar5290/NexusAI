/*
Nexus AI — Agent Tool Loop (Stage 2 milestone)

The heart of the agent runtime (master spec sections
10, 13, 24, 25):

    understand -> plan -> ACT (tools) -> observe
    -> reason -> verify -> repair -> complete

Instead of the regex classifier deciding everything,
the MODEL sees the tool registry and decides which
tools to call, in how many steps, and when it is done.
Every tool call goes through the registry, which
enforces permissions and runs the verification
handler. Tool results are fed back to the model, so
it can repair its own failures within a bounded
number of steps (LIMITS.maxAgentSteps).

The loop is model-independent: it speaks only the
normalized provider protocol (lib/providers) and
never knows which vendor is behind a role.
*/

const config = require("../../lib/config");

const providers = require("../../lib/providers");

const toolRegistry = require("./toolRegistry");

const { collect } = require("../../lib/providers/base");

/*
Convert registry entries to provider tool specs.
Registry stores "schema"; providers expect
"parameters".
*/
function toProviderTools(names) {
    return names
        .map(name => toolRegistry.get(name))
        .filter(Boolean)
        .map(tool => ({
            name: tool.name,

            description: tool.description,

            parameters: tool.schema || {
                type: "object",
                properties: {}
            }
        }));
}

/*
Single model turn. Returns the collected turn:
{ text, toolCalls, finishReason }. Injectable
chatFn makes the loop testable without a live
model.
*/
async function modelTurn({
    system,
    messages,
    tools,
    chatFn,
    signal,
    provider,
    model,
    temperature,
    maxTokens
}) {
    const stream = await (chatFn || providers.chat)({
        role: "chat",

        provider,
        model,

        system,

        messages,

        tools,

        temperature,
        maxTokens,

        stream: false,

        signal
    });

    return collect(stream);
}

/*
Run one registry tool with activity + verification.
Returns a normalized tool result record.
*/
async function runTool(call, onActivity, imageModel) {
    const name = call.name;

    let shortArgs = JSON.stringify(
        call.arguments || {}
    );

    if (shortArgs.length > 160) {
        shortArgs =
            shortArgs.slice(0, 157) + "...";
    }

    onActivity &&
        onActivity({
            message: `Using tool ${name} ${shortArgs}`,
            status: "running"
        });

    const arguments_ = { ...(call.arguments || {}) };
    if (
        imageModel &&
        ["image_generate", "image_edit"].includes(name) &&
        !arguments_.model
    ) {
        arguments_.model = imageModel;
    }
    const outcome = await toolRegistry.run(name, arguments_);

    let resultText;

    if (outcome.ok) {
        const verification =
            outcome.verification || {};

        resultText = JSON.stringify({
            ok: true,

            result: outcome.result,

            verified:
                verification.verified !== false,

            note: verification.note || ""
        });
    } else {
        resultText = JSON.stringify({
            ok: false,

            error: outcome.error,

            permissionDenied:
                Boolean(outcome.permissionDenied)
        });
    }

    /*
    Cap tool output fed back to the model.
    */
    if (resultText.length > config.LIMITS.maxToolResultChars) {
        resultText =
            resultText.slice(
                0,
                config.LIMITS.maxToolResultChars
            ) + "...(truncated)";
    }

    onActivity &&
        onActivity({
            message: outcome.ok
                ? `${name} completed${
                      outcome.verification?.verified ===
                      false
                          ? " (verification failed)"
                          : " + verified"
                  }`
                : `${name} failed: ${outcome.error}`,
            status: outcome.ok ? "done" : "error"
        });

    return {
        ok: outcome.ok,

        permissionDenied: Boolean(
            outcome.permissionDenied
        ),

        content: resultText
    };
}

/*
==================================================
MAIN LOOP
==================================================
Returns:
{
  answer,        final assistant text
  steps,         model turns used
  toolRuns,      [{ name, ok, verified }]
  usedTools      boolean
}
Throws only on hard provider failures; tool
failures are reported to the model for repair.
*/
async function run({
    userMessage,

    system,

    messages,

    onActivity = null,

    onToken = null,

    chatFn = null,
    signal = null,
    provider = null,
    model = null,
    imageModel = null,
    maxSteps: requestedMaxSteps = null,
    toolNames = null,
    temperature = null,
    maxTokens = null
}) {
    toolRegistry; // tools must be registered by tools.ensureRegistered()

    const maxSteps = Math.min(
        config.LIMITS.maxAgentSteps,
        Math.max(1, Number(requestedMaxSteps) || config.LIMITS.maxAgentSteps)
    );

    const tools = toProviderTools(
        toolRegistry
            .list()
            .filter(tool => tool.runnable &&
                (!Array.isArray(toolNames) || toolNames.includes(tool.name)))
            .map(tool => tool.name)
    );

    const convo = [...(messages || [])];

    if (
        !convo.length ||
        convo[convo.length - 1]?.role !== "user"
    ) {
        convo.push({
            role: "user",

            content: userMessage
        });
    }

    const toolRuns = [];

    let steps = 0;

    let answer = "";

    let usedTools = false;

    onActivity &&
        onActivity({
            message: "Planning with tools",
            status: "running"
        });

    while (steps < maxSteps) {
        steps += 1;

        const turn = await modelTurn({
            system,

            messages: convo,

            tools,

            chatFn,
            signal,
            provider,
            model,
            temperature,
            maxTokens
        });

        /*
        ------------------------------------------
        NO TOOL CALLS -> final answer
        ------------------------------------------
        */

        if (!turn.toolCalls.length) {
            answer = (turn.text || "").trim();

            break;
        }

        /*
        ------------------------------------------
        TOOL CALLS -> execute + observe
        ------------------------------------------
        */

        usedTools = true;

        convo.push({
            role: "assistant",

            content: turn.text || "",

            toolCalls: turn.toolCalls.map(
                call => ({
                    id: call.id,

                    name: call.name,

                    arguments: call.arguments
                })
            )
        });

        for (const call of turn.toolCalls) {
            if (!call.name) {
                continue;
            }

            const result = await runTool(
                call,
                onActivity,
                imageModel
            );

            toolRuns.push({
                name: call.name,

                ok: result.ok,

                verified:
                    result.ok &&
                    !/verification failed/i.test(
                        result.content
                    )
            });

            convo.push({
                role: "tool",

                toolCallId: call.id,

                name: call.name,

                content: result.content
            });
        }

        /*
        Loop continues: the model observes the
        tool results and either repairs, calls
        more tools, or answers.
        */
    }

    /*
    ------------------------------------------
    STEP BUDGET EXHAUSTED -> forced answer
    ------------------------------------------
    */

    if (steps >= maxSteps && !answer) {
        onActivity &&
            onActivity({
                message:
                    "Step budget reached, finalizing",
                status: "done"
            });

        const finalTurn = await modelTurn({
            system,

            messages: convo,

            tools: [],

            chatFn,
            signal,
            provider,
            model
        });

        /*
        The forced-final turn exists to produce an
        answer, so any tool calls the model still
        emits are ignored, never executed.
        */
        answer = (finalTurn.text || "").trim();

        if (!answer) {
            answer =
                "I reached my step limit before " +
                "fully completing this task. Here " +
                "is where things stand: " +
                (toolRuns.length
                    ? `${toolRuns.length} tool call(s) ran, ` +
                      `${toolRuns.filter(r => r.ok).length} succeeded.`
                    : "no tool calls completed.");
        }
    }

    /*
    Surface the answer to a streaming listener
    in chunks so the UI sees token flow even
    though the loop ran buffered turns.
    */

    if (onToken && answer) {
        const size = 24;

        for (
            let i = 0;
            i < answer.length;
            i += size
        ) {
            onToken(answer.slice(i, i + size));
        }
    }

    onActivity &&
        onActivity({
            message: usedTools
                ? `Completed with ${toolRuns.length} tool call(s)`
                : "Completed without tools",
            status: "done"
        });

    return {
        answer,

        steps,

        usedTools,

        toolRuns
    };
}

module.exports = {
    run,

    toProviderTools
};
