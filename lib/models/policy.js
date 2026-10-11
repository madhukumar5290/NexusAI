"use strict";

function isKnownFreeTierCandidate(candidate) {
    return candidate.local === true ||
        candidate.provider === "groq" ||
        candidate.provider === "google" ||
        (candidate.provider === "openrouter" && /:free$/i.test(candidate.model));
}

function allowsPaidAutomatic(options = {}) {
    return options.allowPaid === true ||
        process.env.NEXUS_AUTO_ALLOW_PAID_API === "true";
}

function filterAutomaticCandidates(candidates, options = {}) {
    const allowPaid = allowsPaidAutomatic(options);
    return candidates.filter(candidate =>
        allowPaid || isKnownFreeTierCandidate(candidate)
    );
}

function isFallbackEligible(candidate, options = {}) {
    return isKnownFreeTierCandidate(candidate) ||
        options.allowPaidFallback === true ||
        process.env.NEXUS_AUTO_ALLOW_PAID_FALLBACK === "true";
}

module.exports = {
    isKnownFreeTierCandidate,
    allowsPaidAutomatic,
    filterAutomaticCandidates,
    isFallbackEligible
};
