const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const audio = require("../src/agent/audio");
const workspaceTools = require("../src/agent/workspaceTools");

test("speech synthesis saves returned audio in the workspace", async () => {
    const output = `generated/speech-${Date.now()}.mp3`;
    const result = await audio.synthesizeSpeech({ text: "Hello", outputPath: output }, { apiKey: "key", fetch: async (url, options) => {
        assert.match(url, /\/audio\/speech$/); assert.equal(JSON.parse(options.body).voice, "coral");
        return { ok: true, arrayBuffer: async () => new Uint8Array([97, 117, 100, 105, 111]).buffer };
    } });
    assert.equal(result.aiGenerated, true);
    assert.equal(fs.readFileSync(workspaceTools.resolveWorkspacePath(output)).toString(), "audio");
    fs.unlinkSync(workspaceTools.resolveWorkspacePath(output));
});

test("transcription sends a workspace audio file and returns text", async () => {
    const source = `generated/input-${Date.now()}.wav`;
    workspaceTools.createFile(source, Buffer.from("wave"));
    const result = await audio.transcribeAudio({ sourcePath: source }, { apiKey: "key", fetch: async (url, options) => {
        assert.match(url, /\/audio\/transcriptions$/); assert.equal(options.body.get("model"), "gpt-transcribe");
        return { ok: true, json: async () => ({ text: "Hello world", language: "en" }) };
    } });
    assert.equal(result.text, "Hello world");
    fs.unlinkSync(workspaceTools.resolveWorkspacePath(source));
});
