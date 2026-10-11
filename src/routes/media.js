"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const config = require("../../lib/config");
const security = require("../../lib/security");
const imageGeneration = require("../agent/imageGeneration");
const workspaceTools = require("../agent/workspaceTools");

const IMAGE_EXTENSIONS = new Set([".png", ".webp", ".jpg", ".jpeg"]);

function previewUrl(relativePath) {
    return `/api/preview/${relativePath
        .split(/[\\/]/)
        .map(encodeURIComponent)
        .join("/")}`;
}

function listGeneratedImages(workspace = workspaceTools) {
    workspace.createFolder("generated");
    const entries = workspace.listFiles("generated").entries;

    return entries
        .filter(entry =>
            entry.type === "file" &&
            IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        )
        .map(entry => {
            const relativePath = `generated/${entry.name}`;
            const stats = fs.statSync(workspace.resolveWorkspacePath(relativePath));
            return {
                name: entry.name,
                path: relativePath,
                previewUrl: previewUrl(relativePath),
                size: stats.size,
                updatedAt: stats.mtime.toISOString()
            };
        })
        .sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt)
        )
        .slice(0, 100);
}

function routes(dependencies = {}) {
    const router = express.Router();
    const generateImage = dependencies.generateImage ||
        imageGeneration.generateImage;
    const workspace = dependencies.workspaceTools || workspaceTools;

    router.get(
        "/images",
        security.requireCapability("ADMIN"),
        (req, res, next) => {
            try {
                res.json({
                    available: Boolean(config.PROVIDERS.openai.apiKey),
                    model: process.env.NEXUS_IMAGE_MODEL || "gpt-image-2",
                    images: listGeneratedImages(workspace)
                });
            } catch (error) {
                next(error);
            }
        }
    );

    router.delete(
        "/images/:name",
        security.requireCapability("ADMIN"),
        (req, res, next) => {
            try {
                const name = String(req.params.name || "");
                if (
                    !name ||
                    name === "." ||
                    name === ".." ||
                    path.basename(name) !== name ||
                    !IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase())
                ) {
                    return res.status(400).json({
                        error: "The image filename is invalid."
                    });
                }

                const relativePath = `generated/${name}`;
                const absolutePath = workspace.resolveWorkspacePath(relativePath);
                if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
                    return res.status(404).json({
                        error: "Image not found."
                    });
                }

                workspace.deleteFile(relativePath);
                security.audit({
                    action: "image.delete",
                    actor: req.nexusUser?.username || "local",
                    target: relativePath
                });
                res.json({ success: true, path: relativePath });
            } catch (error) {
                next(error);
            }
        }
    );

    router.post(
        "/images/generate",
        security.requireCapability("ADMIN"),
        async (req, res) => {
            try {
                const prompt = String(req.body?.prompt || "").trim();
                if (!prompt) {
                    return res.status(400).json({
                        error: "Describe the image you want to create."
                    });
                }
                if (prompt.length > 32000) {
                    return res.status(400).json({
                        error: "The image prompt is too long."
                    });
                }

                const model = String(req.body?.model || "").trim();
                if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(model)) {
                    return res.status(400).json({
                        error: "The image model identifier is invalid."
                    });
                }
                const format = String(req.body?.format || "png").toLowerCase();
                const extension = format === "jpeg" ? "jpg" : format;
                const result = await generateImage({
                    prompt,
                    ...(model ? { model } : {}),
                    format,
                    size: req.body?.size,
                    quality: req.body?.quality,
                    outputPath: `generated/nexus-${Date.now()}-${randomUUID()}.${extension}`
                });

                security.audit({
                    action: "image.generate",
                    actor: req.nexusUser?.username || "local",
                    target: result.path,
                    detail: { model: result.model, format }
                });

                res.status(201).json({
                    ...result,
                    previewUrl: previewUrl(result.path)
                });
            } catch (error) {
                const invalidInput = error instanceof TypeError;
                res.status(invalidInput ? 400 : 502).json({
                    error: error?.message || "Image generation failed."
                });
            }
        }
    );

    return router;
}

module.exports = { routes, listGeneratedImages, previewUrl };
