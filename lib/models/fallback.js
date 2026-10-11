"use strict";

async function runWithFallback(options) {
    const candidates = Array.isArray(options.candidates)
        ? options.candidates
        : [];
    let toolStarted = false;
    let lastError = null;

    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        options.onActivity?.({
            message: `Using ${candidate.provider} · ${candidate.model}`,
            status: "running"
        });

        try {
            const result = await options.run(candidate, event => {
                if (String(event?.message || "").startsWith("Using tool ")) {
                    toolStarted = true;
                }
                options.onActivity?.(event);
            });
            options.onOutcome?.("success", candidate);
            return { result, candidate };
        } catch (error) {
            lastError = error;
            options.onOutcome?.("failure", candidate);
            if (toolStarted) {
                if (error instanceof Error) error.toolStarted = true;
                throw error;
            }
            if (options.signal?.aborted || index === candidates.length - 1) {
                throw error;
            }
            options.onRetry?.({
                failedCandidate: candidate,
                nextCandidate: candidates[index + 1],
                error,
                index
            });
            options.onActivity?.({
                message: "That model is unavailable; trying the next available option.",
                status: "running"
            });
        }
    }

    throw lastError || new Error("No available model could handle this request.");
}

module.exports = { runWithFallback };
