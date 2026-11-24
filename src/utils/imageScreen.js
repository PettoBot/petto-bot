"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAnswer = readAnswer;
exports.screen = screen;
const ENDPOINT = 'https://api.openai.com/v1/moderations';
const TIMEOUT_MS = 10_000;
/** What the service says about one category, from its answer: `categories` are the yes or no, `category_scores` how sure. A score alone is not enough to block someone: only the yes counts. */
function readAnswer(answer) {
    const result = answer?.results?.[0];
    const categories = result?.categories;
    if (!categories || typeof categories !== 'object')
        return { checked: false };
    const reasons = [];
    if (categories.sexual)
        reasons.push('sexual');
    if (categories['violence/graphic'])
        reasons.push('violence');
    if (categories.hate || categories['hate/threatening'])
        reasons.push('hate');
    return { checked: true, minor: Boolean(categories['sexual/minors']), reasons };
}
/** Looks at a picture (webp bytes). Never throws: a failure is `{ checked: false }`. */
async function screen(bytes, fetcher = fetch) {
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key || process.env.PETTO_IMAGE_SCREEN === 'false')
        return { checked: false };
    try {
        const response = await fetcher(ENDPOINT, {
            method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'image_url', image_url: { url: `data:image/webp;base64,${bytes.toString('base64')}` } }] }),
        });
        if (!response.ok)
            return { checked: false };
        return readAnswer(await response.json().catch(() => null));
    }
    catch {
        return { checked: false };
    }
}
