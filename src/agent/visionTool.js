/*
Nexus AI — Vision Tool (Stage 4)

Gives the agent eyes on generated or provided images:

- Load an image from the workspace (or an http(s) URL).
- Verify the file is actually a decodable image.
- Run a structured analysis through a vision-capable model
  via the provider gateway (model-independent).
- Return dimensions, format and the model's observations.

No fake results: if no vision model/provider is available,
the tool returns ok:false with a clear reason instead of
inventing a description.
*/

const fs = require("fs");
const path = require("path");

const workspaceTools = require("./workspaceTools");
const gateway =
    require("../../lib/providers/gateway");
const modelRouter = require("./modelRouter");

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

const SUPPORTED_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp"
]);

/* ----------------------------------------------
Image format sniffing (magic bytes) — we never
trust the extension alone.
---------------------------------------------- */

function detectFormat(buffer) {
    if (buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47) {
        return "png";
    }

    if (buffer.length >= 3 &&
        buffer[0] === 0xff &&
        buffer[1] === 0xd8 &&
        buffer[2] === 0xff) {
        return "jpeg";
    }

    if (buffer.length >= 6 &&
        buffer.slice(0, 3).toString() === "GIF") {
        return "gif";
    }

    if (buffer.length >= 12 &&
        buffer.slice(0, 4).toString() === "RIFF" &&
        buffer.slice(8, 12).toString() === "WEBP") {
        return "webp";
    }

    if (buffer.length >= 2 &&
        buffer[0] === 0x42 &&
        buffer[1] === 0x4d) {
        return "bmp";
    }

    return null;
}

/* PNG / GIF / BMP header-based dimensions; JPEG parsed
by scanning markers. */

function pngSize(b) {
    if (b.length < 24) return null;
    return {
        width: b.readUInt32BE(16),
        height: b.readUInt32BE(20)
    };
}

function gifSize(b) {
    if (b.length < 10) return null;
    return {
        width: b.readUInt16LE(6),
        height: b.readUInt16LE(8)
    };
}

function bmpSize(b) {
    if (b.length < 26) return null;
    return {
        width: b.readInt32LE(18),
        height: Math.abs(b.readInt32LE(22))
    };
}

function jpegSize(b) {
    let offset = 2;

    while (offset < b.length) {
        if (b[offset] !== 0xff) {
            offset++;
            continue;
        }

        const marker = b[offset + 1];

        // Standalone markers without payload.
        if (marker === 0xd8 || marker === 0x01 ||
            (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }

        const length = b.readUInt16BE(offset + 2);

        // SOFn frames carry dimensions.
        if ((marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf)) {
            if (offset + 9 > b.length) return null;
            return {
                height: b.readUInt16BE(offset + 5),
                width: b.readUInt16BE(offset + 7)
            };
        }

        offset += 2 + length;
    }

    return null;
}

function imageDimensions(buffer, format) {
    try {
        if (format === "png") return pngSize(buffer);
        if (format === "gif") return gifSize(buffer);
        if (format === "bmp") return bmpSize(buffer);
        if (format === "jpeg") return jpegSize(buffer);
    } catch (e) {
        return null;
    }

    return null;
}

/* ----------------------------------------------
Loading
---------------------------------------------- */

async function loadImage(source) {
    if (typeof source !== "string" || !source) {
        throw new Error(
            "source must be a workspace-relative path or an http(s) URL."
        );
    }

    if (/^https?:\/\//i.test(source)) {
        const res = await fetch(source, {
            signal: AbortSignal.timeout(15000)
        });

        if (!res.ok) {
            return {
                ok: false,
                error: `Image download failed with status ${res.status}.`
            };
        }

        const buffer = Buffer.from(
            await res.arrayBuffer()
        );

        if (buffer.length > MAX_BYTES) {
            return {
                ok: false,
                error: "Image exceeds the 8 MB size cap."
            };
        }

        return { ok: true, buffer };
    }

    const resolved = path.resolve(
        workspaceTools.resolveWorkspacePath(source)
    );

    if (!fs.existsSync(resolved)) {
        return {
            ok: false,
            error: `Image not found in workspace: ${source}`
        };
    }

    const stat = fs.statSync(resolved);

    if (!stat.isFile()) {
        return {
            ok: false,
            error: `${source} is not a file.`
        };
    }

    if (stat.size > MAX_BYTES) {
        return {
            ok: false,
            error: "Image exceeds the 8 MB size cap."
        };
    }

    if (SUPPORTED_EXTENSIONS.has(
        path.extname(resolved).toLowerCase()
    ) === false) {
        return {
            ok: false,
            error:
                "Unsupported image type. Supported: png, jpg, jpeg, gif, webp, bmp."
        };
    }

    return {
        ok: true,
        buffer: fs.readFileSync(resolved)
    };
}

/* ----------------------------------------------
Gateway call
---------------------------------------------- */

function buildAnalysisPrompt(prompt) {
    return [
        "You are the Nexus vision analyzer.",
        "Describe the image factually and concisely:",
        "1) What the image shows overall.",
        "2) Any text visible in the image.",
        "3) Layout / structure (for UI screenshots: sections, colors, obvious issues).",
        "4) Anything broken, missing or inconsistent.",
        "Do not speculate about things you cannot see.",
        prompt ? `Additional focus from the caller: ${prompt}` : ""
    ].filter(Boolean).join("\n");
}

async function analyzeImage(input) {
    const source = input && input.source;
    const prompt = input && input.prompt;

    const loaded = await loadImage(source);

    if (!loaded.ok) {
        return loaded;
    }

    const buffer = loaded.buffer;
    const format = detectFormat(buffer);

    if (!format) {
        return {
            ok: false,
            error:
                "File is not a recognizable image (magic bytes check failed)."
        };
    }

    const dimensions = imageDimensions(
        buffer,
        format
    );

    const model = modelRouter.select({
        role: "vision"
    });

    if (!model) {
        return {
            ok: false,
            error:
                "No vision-capable model is available. Configure a vision provider to enable image analysis.",
            image: { format, dimensions, bytes: buffer.length }
        };
    }

    let analysis;

    try {
        const response = await gateway.complete({
            provider: model.provider,
            model: model.model,
            messages: [
                {
                    role: "user",
                    content: buildAnalysisPrompt(prompt)
                }
            ],
            imageBase64: buffer.toString("base64"),
            imageFormat: format
        });

        analysis =
            (response &&
                (response.text || response.content)) ||
            "";
    } catch (e) {
        return {
            ok: false,
            error: `Vision model call failed: ${e.message}`,
            image: { format, dimensions, bytes: buffer.length }
        };
    }

    return {
        ok: true,
        image: {
            source,
            format,
            dimensions,
            bytes: buffer.length
        },
        analysis,
        verified: true,
        note: "Image decoded and analyzed by vision model."
    };
}

module.exports = {
    analyzeImage,
    detectFormat,
    imageDimensions
};
