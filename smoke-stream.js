/*
Streaming smoke test for /api/chat (NDJSON).
Run: node smoke-stream.js [message]
*/
const BASE = "http://localhost:3000";

async function main() {
    const message = process.argv[2] || "Count from 1 to 5, then say done.";

    const res = await fetch(`${BASE}/api/chat`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/x-ndjson"
        },
        body: JSON.stringify({
            chatId: "stream-smoke-" + Date.now(),
            message
        })
    });

    if (!res.ok) {
        const text = await res.text();
        console.error(`HTTP ${res.status}: ${text}`);
        process.exit(1);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let chunks = 0;
    let answer = "";
    let provider = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, idx).trim();
            buffer = buffer.slice(idx + 1);
            if (!line) continue;

            let evt;
            try { evt = JSON.parse(line); } catch { continue; }

            if (evt.type === "meta") {
                provider = evt.provider || "";
                console.log(`[meta] provider=${evt.provider} model=${evt.model || ""}`);
            } else if (evt.type === "chunk") {
                chunks++;
                answer += evt.content || "";
            } else if (evt.type === "done") {
                answer = evt.answer || answer;
            } else if (evt.type === "error") {
                console.error(`[error] ${evt.message}`);
                process.exit(1);
            }
        }
    }

    console.log(`chunks=${chunks} provider=${provider}`);
    console.log(`answer: ${answer}`);
    if (chunks === 0) {
        console.error("FAIL: no chunks streamed");
        process.exit(1);
    }
    console.log("STREAMING OK");
}

main().catch((err) => {
    console.error(err && err.message ? err.message : err);
    process.exit(1);
});
