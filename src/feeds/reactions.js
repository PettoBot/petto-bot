"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_REACTIONS = void 0;
exports.customIdOf = customIdOf;
exports.parseReactions = parseReactions;
exports.cleanReactions = cleanReactions;
exports.addReactions = addReactions;
exports.MAX_REACTIONS = 5;
/** `<:name:123>` or `<a:name:123>`: a custom emoji (animated or not). */
const CUSTOM = /<(a?):([A-Za-z0-9_]{2,32}):(\d{15,25})>/g;
const CUSTOM_ONE = /^<a?:[A-Za-z0-9_]{2,32}:\d{15,25}>$/;
/** One written emoji: a picture (with its skin tone, joiners and variation), a flag (two regional letters) or a keycap (`1️⃣`). */
const UNICODE_ONE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[0-9#*]️?⃣)/u;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
/** The emoji written as a custom one: its id, or null for the usual ones. */
function customIdOf(emoji) {
    const match = /^<a?:[A-Za-z0-9_]{2,32}:(\d{15,25})>$/.exec(emoji);
    return match ? match[1] : null;
}
const isUnicodeEmoji = (grapheme) => UNICODE_ONE.test(grapheme);
/** The emojis in a text, in order: `👍 👎 <:pe_ok:123>`. Spaces and commas between them are fine; anything else that is not an emoji is left out and reported. */
function parseReactions(text) {
    const source = String(text ?? '');
    const found = [];
    let ignored = false;
    const take = (chunk) => {
        for (const { segment } of segmenter.segment(chunk)) {
            if (/^[\s,;]+$/.test(segment) || segment === '️')
                continue;
            if (isUnicodeEmoji(segment))
                found.push(segment);
            else
                ignored = true;
        }
    };
    let last = 0;
    for (const match of source.matchAll(CUSTOM)) {
        take(source.slice(last, match.index));
        found.push(match[0]);
        last = (match.index ?? 0) + match[0].length;
    }
    take(source.slice(last));
    const unique = [...new Set(found)];
    return { emojis: unique.slice(0, exports.MAX_REACTIONS), tooMany: unique.length > exports.MAX_REACTIONS, ignored };
}
/** What a feed keeps as its reactions: a list of up to five emojis that are one emoji each, no repeats. Anything else is dropped. */
function cleanReactions(value) {
    if (!Array.isArray(value))
        return [];
    const out = [];
    for (const entry of value) {
        if (typeof entry !== 'string' || entry.length > 100)
            continue;
        const single = [...segmenter.segment(entry)];
        const ok = CUSTOM_ONE.test(entry) || (single.length === 1 && isUnicodeEmoji(single[0].segment));
        if (ok && !out.includes(entry))
            out.push(entry);
        if (out.length >= exports.MAX_REACTIONS)
            break;
    }
    return out;
}
/** An emoji that Petto cannot use (it was deleted, or Petto is not in its server): that one is skipped and the others go on. Any other error (no permission, the message gone, too many reactions) stops the rest. */
const SKIP_CODES = new Set([10014]);
const codeOf = (error) => {
    const code = error?.code;
    return typeof code === 'number' ? code : null;
};
/** Puts the reactions on a message, one after the other (Discord limits them), best effort. Never throws. */
async function addReactions(message, list) {
    const emojis = cleanReactions(list);
    let added = 0;
    for (const emoji of emojis) {
        try {
            await message.react(emoji);
            added += 1;
        }
        catch (error) {
            const code = codeOf(error);
            if (code !== null && SKIP_CODES.has(code))
                continue;
            return { added, stoppedBy: code ?? -1 };
        }
    }
    return { added, stoppedBy: null };
}
