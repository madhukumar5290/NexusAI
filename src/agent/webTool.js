/*
Nexus AI — Web Tool (Stage 3: APIs / network)

Provides a controlled web_fetch capability:
- Only http/https URLs are allowed.
- Size-capped, timeout-capped HTML→text extraction.
- No code execution; output is text only.
*/

const MAX_BYTES = 400000;
const TIMEOUT_MS = 15000;

function htmlToText(html) {
    let text = String(html);

    // Strip scripts/styles entirely.
    text = text
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ");

    // Common block boundaries become line breaks.
    text = text.replace(
        /<\/(p|div|h[1-6]|li|tr|section|article|br)>/gi,
        "\n"
    );

    // Strip all remaining tags.
    text = text.replace(/<[^>]+>/g, " ");

    // Decode basic entities.
    text = text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");

    // Collapse whitespace.
    text = text
        .split("\n")
        .map(line => line.replace(/\s+/g, " ").trim())
        .filter(line => line.length > 0)
        .join("\n");

    return text;
}

async function fetchUrl(rawUrl) {
    if (typeof rawUrl !== "string") {
        throw new Error("url must be a string.");
    }

    const url = new URL(rawUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(
            "Only http and https URLs are allowed."
        );
    }

    const controller = new AbortController();

    const timer = setTimeout(
        () => controller.abort(),
        TIMEOUT_MS
    );

    try {
        const response = await fetch(url, {
            signal: controller.signal,

            headers: {
                "User-Agent": "NexusAI/1.0 (+web-fetch tool)"
            },

            redirect: "follow"
        });

        const contentType =
            response.headers.get("content-type") || "";

        const buffer = Buffer.from(
            await response.arrayBuffer()
        );

        const truncated = buffer.length > MAX_BYTES;

        const body = buffer
            .slice(0, MAX_BYTES)
            .toString("utf8");

        const isHtml = contentType.includes("text/html");

        return {
            ok: response.ok,

            status: response.status,

            finalUrl: response.url,

            contentType,

            truncated,

            content: isHtml ? htmlToText(body) : body
        };
    } finally {
        clearTimeout(timer);
    }
}

async function searchWeb(query, limit = 5) {
    if (typeof query !== "string" || !query.trim()) {
        throw new Error("query must be a non-empty string.");
    }

    const n = Math.max(1, Math.min(10, Number(limit) || 5));

    const response = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        {
            headers: { "User-Agent": "NexusAI/1.0 (+web-search tool)" },
            signal: AbortSignal.timeout(TIMEOUT_MS)
        }
    );

    if (!response.ok) {
        return {
            ok: false,
            error: `Search request failed with status ${response.status}.`
        };
    }

    const html = await response.text();
    const results = [];

    const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;

    while ((m = linkRe.exec(html)) && results.length < n) {
        let url = m[1];

        // DDG html wraps links through a redirect (/l/?uddg=...).
        const uddg = url.match(/[?&]uddg=([^&]+)/);

        if (uddg) {
            url = decodeURIComponent(uddg[1]);
        }

        try {
            const parsed = new URL(url, "https://duckduckgo.com");

            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                continue;
            }

            results.push({
                title: htmlToText(m[2]).trim(),
                url: parsed.href
            });
        } catch (e) {
            continue;
        }
    }

    return { ok: true, query, results };
}

module.exports = {
    fetchUrl,
    searchWeb
};
