"use strict";

const path = require("path");
const fs = require("fs");
const config = require("../../lib/config");
const workspaceTools = require("./workspaceTools");

const ALLOWED_FORMATS = new Set(["png", "webp", "jpeg"]);
const ALLOWED_INPUT_EXTENSIONS = new Set([".png", ".webp", ".jpg", ".jpeg"]);
const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function cleanText(value, field, maxLength) {
    const text = typeof value === "string" ? value.trim() : "";
    if (!text) throw new TypeError(`${field} is required.`);
    if (text.length > maxLength) throw new TypeError(`${field} is too long.`);
    return text;
}

function extensionFor(format) {
    return format === "jpeg" ? "jpg" : format;
}

function outputPath(value, format) {
    const fallback = `generated/image-${Date.now()}.${extensionFor(format)}`;
    if (value == null || value === "") return fallback;
    const name = cleanText(value, "outputPath", 180).replace(/\\/g, "/");
    if (name.split("/").some(segment => segment === "" || segment === "." || segment === "..")) {
        throw new TypeError("outputPath must stay inside the workspace.");
    }
    if (!SAFE_NAME.test(path.posix.basename(name))) {
        throw new TypeError("outputPath must have a safe filename.");
    }
    if (path.posix.extname(name).toLowerCase() !== `.${extensionFor(format)}`) {
        throw new TypeError(`outputPath must end in .${extensionFor(format)}.`);
    }
    return name;
}

async function generateImage(input = {}, dependencies = {}) {
    const apiKey = dependencies.apiKey ?? config.PROVIDERS.openai.apiKey;
    if (!apiKey) {
        throw new Error("Image generation requires OPENAI_API_KEY in .env.");
    }

    const prompt = cleanText(input.prompt, "prompt", 32000);
    const format = String(input.format || "png").toLowerCase();
    if (!ALLOWED_FORMATS.has(format)) throw new TypeError("format must be png, webp, or jpeg.");

    const output = outputPath(input.outputPath, format);
    const body = {
        model: String(input.model || process.env.NEXUS_IMAGE_MODEL || "gpt-image-2"),
        prompt,
        size: String(input.size || "1024x1024"),
        quality: String(input.quality || "auto"),
        background: String(input.background || "auto"),
        output_format: format,
        n: 1
    };

    const fetch_ = dependencies.fetch || fetch;
    const baseUrl = dependencies.baseUrl ?? config.PROVIDERS.openai.baseUrl;
    const response = await fetch_(
        `${String(baseUrl).replace(/\/+$/, "")}/images/generations`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify(body),
            signal: dependencies.signal || AbortSignal.timeout(120000)
        }
    );

    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Image generation failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const data = await response.json();
    const image = data?.data?.[0];
    if (!image?.b64_json) throw new Error("Image provider returned no image data.");

    const file = workspaceTools.createFile(output, Buffer.from(image.b64_json, "base64"));
    return {
        ok: true,
        path: file.path,
        previewUrl: `/api/preview/${file.path.split("\\").join("/")}`,
        size: file.size,
        revisedPrompt: image.revised_prompt || null,
        model: body.model,
        format
    };
}

async function editImage(input = {}, dependencies = {}) {
    const apiKey = dependencies.apiKey ?? config.PROVIDERS.openai.apiKey;
    if (!apiKey) throw new Error("Image editing requires OPENAI_API_KEY in .env.");

    const prompt = cleanText(input.prompt, "prompt", 32000);
    const sourcePath = cleanText(input.sourcePath, "sourcePath", 180).replace(/\\/g, "/");
    if (sourcePath.split("/").some(segment => !segment || segment === "." || segment === "..")) {
        throw new TypeError("sourcePath must stay inside the workspace.");
    }
    const extension = path.posix.extname(sourcePath).toLowerCase();
    if (!ALLOWED_INPUT_EXTENSIONS.has(extension)) throw new TypeError("sourcePath must be a PNG, WebP, or JPEG image.");

    const format = String(input.format || "png").toLowerCase();
    if (!ALLOWED_FORMATS.has(format)) throw new TypeError("format must be png, webp, or jpeg.");
    const defaultOutput = `${sourcePath.slice(0, -extension.length)}-edited.${extensionFor(format)}`;
    const output = outputPath(input.outputPath || defaultOutput, format);
    const absoluteSource = workspaceTools.resolveWorkspacePath(sourcePath);
    const stats = fs.statSync(absoluteSource);
    if (!stats.isFile()) throw new TypeError("sourcePath must be a file.");
    if (stats.size > 10 * 1024 * 1024) throw new TypeError("source image exceeds the 10 MB limit.");

    const body = new FormData();
    body.set("model", String(input.model || process.env.NEXUS_IMAGE_MODEL || "gpt-image-2"));
    body.set("prompt", prompt);
    body.set("image", new Blob([fs.readFileSync(absoluteSource)]), path.posix.basename(sourcePath));
    body.set("size", String(input.size || "1024x1024"));
    body.set("quality", String(input.quality || "auto"));
    body.set("background", String(input.background || "auto"));
    body.set("output_format", format);

    const fetch_ = dependencies.fetch || fetch;
    const baseUrl = dependencies.baseUrl ?? config.PROVIDERS.openai.baseUrl;
    const response = await fetch_(`${String(baseUrl).replace(/\/+$/, "")}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body,
        signal: dependencies.signal || AbortSignal.timeout(120000)
    });
    if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Image edit failed (${response.status}): ${detail.slice(0, 500)}`);
    }
    const data = await response.json();
    const image = data?.data?.[0];
    if (!image?.b64_json) throw new Error("Image provider returned no image data.");
    const file = workspaceTools.createFile(output, Buffer.from(image.b64_json, "base64"));
    return { ok: true, sourcePath, path: file.path, previewUrl: `/api/preview/${file.path}`, size: file.size, revisedPrompt: image.revised_prompt || null, format };
}

module.exports = { generateImage, editImage, outputPath, extensionFor };
