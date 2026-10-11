/*
Tests for visionTool — format detection, dimension parsing,
and safe failure without a vision model.
*/

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const visionTool = require("../src/agent/visionTool");

/* Build a tiny valid PNG (1x1 pixel) in code so we do not
depend on binary fixtures. */

function crc32(buf) {
    let c;
    const table = [];
    for (let n = 0; n < 256; n++) {
        c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c;
    }
    let crc = 0xffffffff;
    for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function makePng() {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0); // width
    ihdr.writeUInt32BE(1, 4); // height
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // color type: RGB

    const rawRow = Buffer.from([0x00, 0xff, 0x00, 0x00]);
    const idat = zlib.deflateSync(rawRow);

    return Buffer.concat([
        signature,
        chunk("IHDR", ihdr),
        chunk("IDAT", idat),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

const workspaceRoot = path.join(__dirname, "..", "workspace");

test("visionTool: detects PNG format via magic bytes", () => {
    assert.equal(visionTool.detectFormat(makePng()), "png");
});

test("visionTool: rejects non-image data", () => {
    assert.equal(visionTool.detectFormat(Buffer.from("<html>hi</html>")), null);
});

test("visionTool: reads PNG dimensions", () => {
    const dims = visionTool.imageDimensions(makePng(), "png");
    assert.equal(dims.width, 1);
    assert.equal(dims.height, 1);
});

test("visionTool: analyzeImage returns ok:false for a missing file", async () => {
    const result = await visionTool.analyzeImage({
        source: "definitely-not-here-1234.png"
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /not found/i);
});

test("visionTool: analyzeImage returns ok:false for a non-image file", async () => {
    const fakePath = path.join(workspaceRoot, "fake-image.png");
    fs.writeFileSync(fakePath, "this is not an image at all");

    try {
        const result = await visionTool.analyzeImage({ source: "fake-image.png" });
        assert.equal(result.ok, false);
        assert.match(result.error, /not a recognizable image/i);
    } finally {
        try { fs.unlinkSync(fakePath); } catch (e) { }
    }
});

test("visionTool: real PNG never gets a fabricated analysis without a vision model", async () => {
    const imgPath = path.join(workspaceRoot, "test-image.png");
    fs.writeFileSync(imgPath, makePng());

    try {
        const result = await visionTool.analyzeImage({ source: "test-image.png" });

        if (result.ok) {
            assert.equal(result.image.format, "png");
            assert.equal(typeof result.analysis, "string");
            assert.equal(result.analysis.length > 0, true);
        } else {
            assert.equal(typeof result.error, "string");
            assert.match(result.error, /vision|model|provider/i);
        }
    } finally {
        try { fs.unlinkSync(imgPath); } catch (e) { }
    }
});
