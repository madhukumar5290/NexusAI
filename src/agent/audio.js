"use strict";

const fs = require("fs");
const path = require("path");
const config = require("../../lib/config");
const workspaceTools = require("./workspaceTools");

const AUDIO_FORMATS = new Set(["mp3", "opus", "aac", "flac", "wav", "pcm"]);
const INPUT_EXTENSIONS = new Set([".flac", ".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".ogg", ".wav", ".webm"]);

function requiredText(value, field, limit) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) throw new TypeError(`${field} is required.`);
    if (text.length > limit) throw new TypeError(`${field} is too long.`);
    return text;
}

function safeWorkspacePath(value, field) {
    const candidate = requiredText(value, field, 180).replace(/\\/g, "/");
    if (candidate.split("/").some(part => !part || part === "." || part === "..")) {
        throw new TypeError(`${field} must stay inside the workspace.`);
    }
    return candidate;
}

function api(dependencies) {
    const apiKey = dependencies.apiKey ?? config.PROVIDERS.openai.apiKey;
    if (!apiKey) throw new Error("Audio tools require OPENAI_API_KEY in .env.");
    return { apiKey, baseUrl: String(dependencies.baseUrl ?? config.PROVIDERS.openai.baseUrl).replace(/\/+$/, ""), fetch_: dependencies.fetch || fetch };
}

async function synthesizeSpeech(input = {}, dependencies = {}) {
    const text = requiredText(input.text, "text", 4096);
    const format = String(input.format || "mp3").toLowerCase();
    if (!AUDIO_FORMATS.has(format)) throw new TypeError("Unsupported audio format.");
    const outputPath = safeWorkspacePath(input.outputPath || `generated/speech-${Date.now()}.${format}`, "outputPath");
    if (path.posix.extname(outputPath).toLowerCase() !== `.${format}`) throw new TypeError(`outputPath must end in .${format}.`);
    const { apiKey, baseUrl, fetch_ } = api(dependencies);
    const response = await fetch_(`${baseUrl}/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: input.model || process.env.NEXUS_TTS_MODEL || "gpt-4o-mini-tts", input: text, voice: input.voice || "coral", instructions: input.instructions || undefined, response_format: format, speed: input.speed || undefined }),
        signal: dependencies.signal || AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`Speech synthesis failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const file = workspaceTools.createFile(outputPath, Buffer.from(await response.arrayBuffer()));
    return { ok: true, path: file.path, previewUrl: `/api/preview/${file.path}`, size: file.size, format, aiGenerated: true };
}

async function transcribeAudio(input = {}, dependencies = {}) {
    const sourcePath = safeWorkspacePath(input.sourcePath, "sourcePath");
    const absolute = workspaceTools.resolveWorkspacePath(sourcePath);
    const ext = path.posix.extname(sourcePath).toLowerCase();
    if (!INPUT_EXTENSIONS.has(ext)) throw new TypeError("Unsupported audio input format.");
    const stats = fs.statSync(absolute);
    if (!stats.isFile() || stats.size > 25 * 1024 * 1024) throw new TypeError("Audio input must be a file under 25 MB.");
    const { apiKey, baseUrl, fetch_ } = api(dependencies);
    const body = new FormData();
    body.set("model", input.model || process.env.NEXUS_TRANSCRIBE_MODEL || "gpt-transcribe");
    body.set("file", new Blob([fs.readFileSync(absolute)]), path.posix.basename(sourcePath));
    if (input.language) body.set("language", String(input.language));
    if (input.prompt) body.set("prompt", String(input.prompt));
    const response = await fetch_(`${baseUrl}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body, signal: dependencies.signal || AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Transcription failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    const data = await response.json();
    if (!data?.text) throw new Error("Transcription provider returned no text.");
    return { ok: true, sourcePath, text: data.text, language: data.language || null };
}

module.exports = { synthesizeSpeech, transcribeAudio, safeWorkspacePath };
