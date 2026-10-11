"use strict";

const IDENTITY_ANSWER =
    "Yes, I'm Jarwis, your personal AI assistant in this app. I can help with questions and tasks; which models or tools are available depends on your PC and connected services, not on who I am.";

function isIdentityQuestion(value) {
    const message = String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[’]/g, "'")
        .replace(/[.!?…]+$/g, "")
        .replace(/\s+/g, " ");

    return /^(?:(?:hey|hello),?\s+)?(?:are you|r u)\s+(?:(?:really|actually)\s+)?(?:jarwis|jarvis)$/.test(message) ||
        /^(?:who are you|what are you|what is your name|what's your name|whats your name|what is jarwis)$/.test(message);
}

module.exports = {
    IDENTITY_ANSWER,
    isIdentityQuestion
};
