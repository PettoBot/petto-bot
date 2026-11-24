"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readAnswer = readAnswer;
exports.screen = screen;
// i18n-ignore-file: answers are codes; the website writes the words.
// The detector of pictures: before an own picture goes to the team, the moderation service of OpenAI (model omni-moderation-latest, which reads pictures, free to call) looks at it.
// What it finds is kept apart: a picture with a minor in a sexual way is never kept (the person is blocked and the team can undo it), a picture it flags as sexual, graphically violent or hateful
// is not accepted, and a picture it finds nothing in goes to the team marked as checked. The detector helps, it does not replace the team: every picture is still looked at by a person.
// It is off without `OPENAI_API_KEY` or with `PETTO_IMAGE_SCREEN=false`, and when the service does not answer the picture goes to the team as not checked (it never blocks a person by a failure).
// Written in TypeScript: `npm run build:ts` compiles it over imageScreen.js.
const fallback_1 = require("./fallback");
const ENDPOINT = 'https://api.openai.com/v1/moderations';
const TIMEOUT_MS = 10_000;
/** What the service says, from its answer: `categories` are the yes or no, `category_scores` how sure. A score alone is not enough to block someone: only the yes counts. An answer holds one result for each
 *  picture sent (an animation sends a few of its frames): a yes in any of them counts, and one that cannot be read leaves the whole answer as not checked. */
function readAnswer(answer, expected = 1) {
    const results = answer?.results;
    if (!Array.isArray(results) || results.length < expected || results.length === 0)
        return { checked: false };
    const reasons = new Set();
    let minor = false;
    for (const result of results) {
        const categories = result?.categories;
        if (!categories || typeof categories !== 'object')
            return { checked: false };
        if (categories.sexual)
            reasons.add('sexual');
        if (categories['violence/graphic'])
            reasons.add('violence');
        if (categories.hate || categories['hate/threatening'])
            reasons.add('hate');
        if (categories['sexual/minors'])
            minor = true;
    }
    return { checked: true, minor, reasons: ['sexual', 'violence', 'hate'].filter((reason) => reasons.has(reason)) };
}
/** Looks at a picture (webp bytes, or another type when `mime` says so), or at several at once (the frames of an animation). Never throws: a failure is `{ checked: false }`. */
async function screen(pictures, fetcher = fetch, mime = 'image/webp') {
    const list = (Array.isArray(pictures) ? pictures : [pictures]).slice(0, 8);
    if (!list.length)
        return { checked: false };
    const key = process.env.OPENAI_API_KEY?.trim();
    if (!key || process.env.PETTO_IMAGE_SCREEN === 'false')
        return { checked: false };
    // A rate limit (429) is waited for once and tried again; a service that keeps failing rests in the quarantine (utils/quarantine.ts) and the pictures go to the team as not checked meanwhile.
    const call = async () => {
        const response = await fetcher(ENDPOINT, {
            method: 'POST', signal: AbortSignal.timeout(TIMEOUT_MS),
            headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'omni-moderation-latest', input: list.map((bytes) => ({ type: 'image_url', image_url: { url: `data:${mime};base64,${bytes.toString('base64')}` } })) }),
        });
        if (response.status === 429 || response.status >= 500)
            throw Object.assign(new Error(`the detector answered ${response.status}`), { status: response.status, headers: response.headers });
        // Another refusal (a picture the service cannot read, a wrong key) is about this picture or the setup, not a failing service: it does not count against the quarantine.
        if (!response.ok)
            return { checked: false };
        return readAnswer(await response.json().catch(() => null), list.length);
    };
    return (0, fallback_1.withFallback)(call, { key: 'call:openai-moderation', quarantine: require('./eventQuarantine'), fallback: () => ({ checked: false }) });
}
