function chunkText(text, chunkSize = 1000, overlap = 200) {
    const chunks = [];

    const cleanText = text
        .replace(/\r\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    let start = 0;

    while (start < cleanText.length) {
        let end = start + chunkSize;

        if (end < cleanText.length) {
            const paragraphBreak = cleanText.lastIndexOf("\n\n", end);

            if (paragraphBreak > start + 500) {
                end = paragraphBreak;
            }
        }

        const chunk = cleanText.slice(start, end).trim();

        if (chunk) {
            chunks.push(chunk);
        }

        start = end - overlap;

        if (start < 0) {
            start = 0;
        }
    }

    return chunks;
}

module.exports = {
    chunkText
};