"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chooseIndex = chooseIndex;
exports.pickMessage = pickMessage;
// i18n-ignore-file: no text is shown to anyone here (it picks a message).
// More than one message for the welcome, the goodbye and the boost announcement. The first message of each is the one saved in `member_events_config`; the others are rows of
// `member_event_variants` (db/messageVariants.ts, at most 24, so 25 with the first). Each time the event happens `pickMessage` picks one of them at random and never the same
// one twice in a row. Written in TypeScript: `npm run build:ts` compiles it over src/utils/messageVariants.js, which is what the bot loads.
const messageVariants_1 = require("../db/messageVariants");
__exportStar(require("../db/messageVariants"), exports);
const filled = (m) => Boolean(m && ((m.message && m.message.trim()) || (m.template && m.template.trim())));
/**
 * Which of `count` messages to use: one at random, never `last` (when there is more than one). `random` is `Math.random` (given so it can be checked).
 */
function chooseIndex(count, last, random = Math.random) {
    if (count <= 1)
        return 0;
    if (last === null || last < 0 || last >= count)
        return Math.min(count - 1, Math.floor(random() * count));
    const pick = Math.min(count - 2, Math.floor(random() * (count - 1)));
    return pick >= last ? pick + 1 : pick;
}
const lastPick = new Map(); // `${guild}:${kind}` -> the index used last
const REMEMBER = 5000;
/** The message to send now: the first one (`main`) and the others of the kind are the pool, and one is picked. With no other message, `main` is returned as it is. */
async function pickMessage(guildId, kind, main, random = Math.random) {
    const extra = (await (0, messageVariants_1.variantsOf)(guildId, kind).catch(() => [])).filter(filled);
    if (!extra.length)
        return main;
    const pool = [...(filled(main) ? [main] : []), ...extra.map((v) => ({ message: v.message, template: v.template }))];
    if (pool.length === 1)
        return pool[0];
    const key = `${guildId}:${kind}`;
    const index = chooseIndex(pool.length, lastPick.has(key) ? lastPick.get(key) : null, random);
    if (lastPick.size >= REMEMBER)
        lastPick.clear();
    lastPick.set(key, index);
    return pool[index];
}
