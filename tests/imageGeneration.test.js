const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const imageGeneration = require("../src/agent/imageGeneration");
const workspaceTools = require("../src/agent/workspaceTools");

test("image generation validates output names without contacting a provider", () => {
    assert.throws(() => imageGeneration.outputPath("../escape.png", "png"), /inside the workspace/);
    assert.throws(() => imageGeneration.outputPath("image.webp", "png"), /end in .png/);
    assert.equal(imageGeneration.outputPath("generated/hero.png", "png"), "generated/hero.png");
});

test("image generation saves provider image bytes inside the workspace", async () => {
    const output = `generated/test-image-${Date.now()}.png`;
    const pngBytes = Buffer.from("fake-png").toString("base64");
    let request;
    const result = await imageGeneration.generateImage(
        { prompt: "A test image", outputPath: output },
        {
            apiKey: "test-key",
            baseUrl: "https://images.example/v1",
            fetch: async (url, options) => {
                request = { url, options };
                return { ok: true, json: async () => ({ data: [{ b64_json: pngBytes, revised_prompt: "A revised test image" }] }) };
            }
        }
    );

    assert.equal(request.url, "https://images.example/v1/images/generations");
    assert.equal(JSON.parse(request.options.body).model, "gpt-image-2");
    assert.equal(result.path, output);
    assert.equal(fs.readFileSync(workspaceTools.resolveWorkspacePath(output)).toString(), "fake-png");
    fs.unlinkSync(workspaceTools.resolveWorkspacePath(output));
});

test("image editing sends a workspace image and saves a separate result", async () => {
    const source = `generated/edit-source-${Date.now()}.png`;
    const output = `generated/edit-result-${Date.now()}.png`;
    workspaceTools.createFile(source, Buffer.from("source-image"));
    let form;
    const result = await imageGeneration.editImage(
        { sourcePath: source, outputPath: output, prompt: "Make it blue" },
        { apiKey: "test-key", fetch: async (url, options) => {
            assert.match(url, /\/images\/edits$/); form = options.body;
            return { ok: true, json: async () => ({ data: [{ b64_json: Buffer.from("edited-image").toString("base64") }] }) };
        } }
    );
    assert.equal(form.get("prompt"), "Make it blue");
    assert.equal(result.path, output);
    assert.equal(fs.readFileSync(workspaceTools.resolveWorkspacePath(output)).toString(), "edited-image");
    fs.unlinkSync(workspaceTools.resolveWorkspacePath(source));
    fs.unlinkSync(workspaceTools.resolveWorkspacePath(output));
});
