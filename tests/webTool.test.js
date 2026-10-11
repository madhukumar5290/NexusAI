/*
Tests for webTool.fetchUrl — uses a local HTTP server so no
external network is required.
*/

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { once } = require("events");

const { fetchUrl } = require("../src/agent/webTool");

let server;
let baseUrl;
let lastRequest = null;

test.before(async () => {
    server = http.createServer((req, res) => {
        lastRequest = req;

        if (req.url === "/html") {
            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8"
            });
            res.end(
                `<html><head><title>Test Page</title>` +
                `<style>.x{color:red}</style>` +
                `<script>alert("nope")</script></head>` +
                `<body><h1>Hello Nexus</h1>` +
                `<p>Some &amp; entities &lt;here&gt;</p>` +
                `</body></html>`
            );
        } else if (req.url === "/json") {
            res.writeHead(200, {
                "Content-Type": "application/json"
            });
            res.end(JSON.stringify({ ok: true, value: 42 }));
        } else if (req.url === "/missing") {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("not found");
        } else if (req.url === "/redirect") {
            res.writeHead(302, { Location: "/html" });
            res.end();
        } else {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("plain text");
        }
    });

    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
});

test.after(() => {
    if (server) server.close();
});

test("fetchUrl: rejects non-http(s) protocols", async () => {
    await assert.rejects(
        () => fetchUrl("ftp://example.com/file"),
        /Only http and https/
    );
});

test("fetchUrl: rejects non-string url", async () => {
    await assert.rejects(
        () => fetchUrl(12345),
        /must be a string/
    );
});

test("fetchUrl: extracts html to text, strips scripts/styles", async () => {
    const result = await fetchUrl(`${baseUrl}/html`);

    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
    assert.equal(result.contentType.includes("text/html"), true);

    const text = result.content;

    assert.equal(text.includes("Hello Nexus"), true);
    assert.equal(text.includes("Some & entities <here>"), true);

    // Scripts and styles must never leak into extracted text.
    assert.equal(text.includes("alert"), false);
    assert.equal(text.includes("color:red"), false);
});

test("fetchUrl: passes non-html content through untouched", async () => {
    const result = await fetchUrl(`${baseUrl}/json`);

    assert.equal(result.ok, true);

    const parsed = JSON.parse(result.content);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value, 42);
});

test("fetchUrl: follows redirects and reports finalUrl", async () => {
    const result = await fetchUrl(`${baseUrl}/redirect`);

    assert.equal(result.ok, true);
    assert.equal(result.finalUrl, `${baseUrl}/html`);
    assert.equal(result.content.includes("Hello Nexus"), true);
});

test("fetchUrl: returns ok:false with status for http errors", async () => {
    const result = await fetchUrl(`${baseUrl}/missing`);

    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.equal(result.content.includes("not found"), true);
});

test("fetchUrl: sends a Nexus user agent", async () => {
    await fetchUrl(`${baseUrl}/plain`);
    assert.equal(
        String(lastRequest.headers["user-agent"]).includes("NexusAI"),
        true
    );
});
