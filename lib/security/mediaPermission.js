"use strict";

function allowsJarwisAudioPermission(permission, requestingUrl, appOrigin, mediaTypes) {
    const requestsAudio = Array.isArray(mediaTypes)
        ? mediaTypes.includes("audio") && !mediaTypes.includes("video")
        : mediaTypes === "audio";
    if (
        permission !== "media" ||
        !requestsAudio
    ) {
        return false;
    }

    try {
        const requestingOrigin = new URL(requestingUrl).origin;
        return requestingOrigin === appOrigin;
    } catch {
        return false;
    }
}

module.exports = { allowsJarwisAudioPermission };
