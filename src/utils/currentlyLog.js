"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIMITS = exports.CATEGORY_ORDER = exports.CATEGORIES = void 0;
exports.validateEntries = validateEntries;
exports.buildCards = buildCards;
exports.voteEmojis = voteEmojis;
exports.databaseStore = databaseStore;
exports.channelIdFromEnv = channelIdFromEnv;
exports.loadEntries = loadEntries;
exports.imageReachable = imageReachable;
exports.announceNewEntries = announceNewEntries;
exports.startCurrentlyLog = startCurrentlyLog;
// i18n-ignore-file: the Currently log is written in English for the Petto community, it is not translated.
// The Currently log: the changes of Petto (like the releases of a GitHub project) posted to one channel, in colors by kind, with pictures.
// The channel is the `currently_log` variable (the ID of the channel). The changes are written in src/data/currentlyLog.json: when the bot starts it
// posts the ones it has not posted yet, once, and remembers them (so a restart posts nothing twice). Written in TypeScript: `npm run build:ts`
// compiles it over currentlyLog.js, which is what the bot loads.
const discord_js_1 = require("discord.js");
// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const logger = require('./logger');
/** The kinds of change, in the order their cards are posted (the most important first). */
exports.CATEGORIES = {
    security: { color: 0xe03131, dot: '🔴', one: 'Security fix', many: 'Security fixes' },
    feature: { color: 0xfcc419, dot: '🟡', one: 'New feature', many: 'New features' },
    addition: { color: 0x2f9e44, dot: '🟢', one: 'Added to a feature', many: 'Added to features' },
    improvement: { color: 0x1c7ed6, dot: '🔵', one: 'Improvement', many: 'Improvements' },
    fix: { color: 0xf76707, dot: '🟠', one: 'Fix', many: 'Fixes' },
    web: { color: 0x9c36b5, dot: '🟣', one: 'Web, dashboard and docs', many: 'Web, dashboard and docs' },
    removal: { color: 0x868e96, dot: '⚪', one: 'Removed from a feature', many: 'Removed from features' },
    'removed-feature': { color: 0x000000, dot: '⚫', one: 'Feature removed', many: 'Features removed' },
};
exports.CATEGORY_ORDER = Object.keys(exports.CATEGORIES);
exports.LIMITS = { title: 100, area: 80, summary: 700, images: 3, perCard: 5, id: 80 };
const isHttps = (value) => typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value) && value.length <= 500;
/** The entries that are well made, and what is wrong with the others (an entry with a problem is skipped, never posted half done). */
function validateEntries(raw) {
    const entries = [];
    const problems = [];
    const seen = new Set();
    const list = Array.isArray(raw) ? raw : [];
    if (!Array.isArray(raw))
        problems.push('the file has no list of entries');
    list.forEach((item, index) => {
        const name = `entry ${index + 1}${typeof item?.id === 'string' ? ` (${item.id})` : ''}`;
        const bad = (why) => { problems.push(`${name}: ${why}`); };
        if (!item || typeof item !== 'object')
            return bad('it is not an object');
        if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(item.id) || item.id.length > exports.LIMITS.id)
            return bad('the id must be lowercase letters, numbers and dashes');
        if (seen.has(item.id))
            return bad('the id is used twice');
        if (!(item.category in exports.CATEGORIES))
            return bad(`the category "${item.category}" is not one of ${exports.CATEGORY_ORDER.join(', ')}`);
        for (const [field, max] of [['title', exports.LIMITS.title], ['area', exports.LIMITS.area], ['summary', exports.LIMITS.summary]]) {
            const text = item[field];
            if (typeof text !== 'string' || !text.trim())
                return bad(`${field} is empty`);
            if (text.length > max)
                return bad(`${field} is longer than ${max} characters`);
        }
        if (item.images !== undefined && (!Array.isArray(item.images) || item.images.length > exports.LIMITS.images || !item.images.every(isHttps)))
            return bad(`images must be up to ${exports.LIMITS.images} https links`);
        if (item.docs !== undefined && !isHttps(item.docs))
            return bad('docs must be an https link');
        seen.add(item.id);
        entries.push({ id: item.id, category: item.category, title: item.title.trim(), area: item.area.trim(), summary: item.summary.trim(), ...(item.images?.length ? { images: item.images } : {}), ...(item.docs ? { docs: item.docs } : {}) });
    });
    return { entries, problems };
}
/** The text of one entry: the title, where it belongs, what it is, and the link. */
function entryText(entry) {
    return [`**${entry.title}**`, `-# ${entry.area}`, entry.summary, ...(entry.docs ? [`[Documentation](${entry.docs})`] : [])].join('\n');
}
/** The characters of text a card may hold: Discord allows 4000 in all the texts of a message, and the title and the version take some. */
const TEXT_BUDGET = 3600;
/** Splits the entries of one kind into the groups of a card: five at most, and as many as fit in the text a message allows. */
function chunksOf(entries) {
    const chunks = [];
    let current = [];
    let used = 0;
    for (const entry of entries) {
        const size = entryText(entry).length;
        if (current.length && (current.length >= exports.LIMITS.perCard || used + size > TEXT_BUDGET)) {
            chunks.push(current);
            current = [];
            used = 0;
        }
        current.push(entry);
        used += size;
    }
    if (current.length)
        chunks.push(current);
    return chunks;
}
/** The cards for some entries: one kind at a time, five entries in each card (fewer when they are long), each with its pictures. `version` is written at the bottom. */
function buildCards(entries, version = '') {
    const cards = [];
    for (const key of exports.CATEGORY_ORDER) {
        const own = entries.filter((entry) => entry.category === key);
        let from = 0;
        for (const chunk of chunksOf(own)) {
            const category = exports.CATEGORIES[key];
            const range = own.length > chunk.length ? ` (${from + 1}-${from + chunk.length} of ${own.length})` : own.length > 1 ? ` (${own.length})` : '';
            from += chunk.length;
            const container = new discord_js_1.ContainerBuilder().setAccentColor(category.color);
            container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(`### ${category.dot} ${own.length === 1 ? category.one : category.many}${range}`));
            chunk.forEach((entry) => {
                container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(discord_js_1.SeparatorSpacingSize.Small));
                container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(entryText(entry)));
                if (entry.images?.length)
                    container.addMediaGalleryComponents(new discord_js_1.MediaGalleryBuilder().addItems(...entry.images.slice(0, exports.LIMITS.images).map((url) => new discord_js_1.MediaGalleryItemBuilder().setURL(url).setDescription(entry.title.slice(0, 200)))));
            });
            if (version) {
                container.addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(false).setSpacing(discord_js_1.SeparatorSpacingSize.Small));
                container.addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(`-# Petto ${version}`));
            }
            cards.push({ category: key, ids: chunk.map((entry) => entry.id), payload: { components: [container], flags: discord_js_1.MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } } });
        }
    }
    return cards;
}
/** The emojis of the feedback board (like and dislike, of the Petto server): the same two the buttons of a feedback post use. */
function voteEmojis() {
    const { EMOJI } = require('../feedback/card');
    return [EMOJI.like, EMOJI.dislike].map((emoji) => `${emoji.name}:${emoji.id}`);
}
/** Puts the like and the dislike on a posted card, in that order. Never throws. */
async function addVotes(message) {
    const target = message;
    if (typeof target?.react !== 'function')
        return;
    for (const emoji of voteEmojis()) {
        try {
            await target.react(emoji);
        }
        catch (error) {
            logger.warn(`Currently log: could not react with ${emoji} (${error?.message ?? error}).`);
            return;
        }
    }
}
const STATE_KEY = 'currently_log.state';
/** The first version of the log kept only the ids of the entries (and no revision, and not the messages). */
const LEGACY_KEY = 'currently_log.posted';
/** The ids kept; the oldest go first, an id is only needed while its entry is in the file. */
const KEEP_IDS = 1000;
const textsOf = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
/** The usual store: one row of `bot_settings` with the state as JSON. */
function databaseStore() {
    const settings = require('../db/botSettings');
    const parse = (value) => { try {
        return value ? JSON.parse(value) : null;
    }
    catch {
        return null;
    } };
    return {
        async read() {
            const saved = parse(await settings.getSetting(STATE_KEY));
            if (saved && typeof saved === 'object')
                return { revision: Number(saved.revision) || 0, posted: textsOf(saved.posted), messages: textsOf(saved.messages) };
            return { revision: 0, posted: textsOf(parse(await settings.getSetting(LEGACY_KEY))), messages: [] };
        },
        async write(state) {
            await settings.setSetting(STATE_KEY, JSON.stringify({ revision: state.revision, posted: state.posted.slice(-KEEP_IDS), messages: state.messages.slice(-KEEP_IDS) }));
        },
    };
}
/** The ID of the channel: the `currently_log` variable. Null when it is not set. */
function channelIdFromEnv(env = process.env) {
    const value = String(env.currently_log ?? env.CURRENTLY_LOG ?? '').trim();
    return /^\d{15,25}$/.test(value) ? value : null;
}
/** The entries of the file, checked, and its revision: a higher number than the one that was posted deletes the log of the channel and posts all of it again. */
function loadEntries() {
    const file = require('../data/currentlyLog.json');
    return { ...validateEntries(file.entries), revision: Math.max(1, Math.floor(Number(file.revision)) || 1) };
}
/** Whether a picture can be read from its link as an image, the way Discord will read it. */
async function imageReachable(url) {
    try {
        const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8_000) });
        return response.ok && /^image\//i.test(response.headers.get('content-type') ?? '');
    }
    catch {
        return false;
    }
}
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/** The footer every card of the log ends with (`-# Petto 0.7.11`): what tells them apart from anything else the bot wrote in the channel. */
const FOOTER = '"-# Petto ';
/**
 * Deletes the cards of the log in the channel: the messages it remembers, and (for the posts of before it remembered them) the recent
 * messages of the bot that are Components V2 and end with the footer of the log. Answers how many went.
 */
async function removeOldCards(channel, known, botId) {
    const gone = new Set();
    const drop = async (id) => {
        if (gone.has(id))
            return;
        gone.add(id);
        await channel.messages?.delete(id).catch(() => undefined);
    };
    for (const id of known)
        await drop(id);
    if (botId && channel.messages) {
        const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
        for (const [id, item] of recent ? [...recent] : []) {
            const message = item;
            if (message.author?.id !== botId || !message.flags?.has(discord_js_1.MessageFlags.IsComponentsV2))
                continue;
            const json = JSON.stringify((message.components ?? []).map((part) => part?.toJSON?.() ?? part));
            if (json.includes(FOOTER))
                await drop(id);
        }
    }
    return gone.size;
}
/**
 * Posts the entries that were not posted yet, in the channel of the `currently_log` variable. Each card is remembered before it is sent, so two bots
 * starting together do not post it twice; if Discord refuses a card, the entries of it and of the cards after it are forgotten and come again at
 * the next start. An entry whose picture cannot be loaded waits (Discord keeps a picture that was not there when it looked, and shows it broken):
 * it is posted when the picture answers. When the file has a higher revision than the one posted, the old cards are deleted and all is posted
 * again. Never throws: a problem is said in the log and the bot goes on.
 */
async function announceNewEntries(client, options = {}) {
    const channelId = options.channelId === undefined ? channelIdFromEnv() : options.channelId;
    if (!channelId)
        return { cards: 0, entries: 0, skipped: 'no-channel' };
    try {
        const loaded = options.entries ? { entries: options.entries, problems: [], revision: options.revision ?? 1 } : loadEntries();
        for (const problem of loaded.problems)
            logger.warn(`Currently log: ${problem}`);
        const revision = options.revision ?? loaded.revision;
        const store = options.store ?? databaseStore();
        let state = await store.read();
        const again = state.revision < revision;
        if (!again && !loaded.entries.some((entry) => !state.posted.includes(entry.id)))
            return { cards: 0, entries: 0, skipped: 'nothing-new' };
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
            logger.warn(`Currently log: the channel ${channelId} is not a channel where Petto can post.`);
            return { cards: 0, entries: 0, skipped: 'channel-unavailable' };
        }
        let removed = 0;
        if (again) {
            removed = await removeOldCards(channel, state.messages, options.botId ?? null);
            state = { revision, posted: [], messages: [] };
            await store.write(state);
            logger.info(`Currently log: revision ${revision}: ${removed} old message(s) deleted, the log is posted again.`);
        }
        const fresh = loaded.entries.filter((entry) => !state.posted.includes(entry.id));
        // A picture that cannot be loaded now would stay broken in Discord for good: that entry waits for the next try.
        const reachable = options.reachable ?? imageReachable;
        const ready = [];
        let waiting = 0;
        for (const entry of fresh) {
            const loadable = !entry.images?.length || (await Promise.all(entry.images.map((url) => reachable(url)))).every(Boolean);
            if (loadable)
                ready.push(entry);
            else
                waiting += 1;
        }
        if (waiting)
            logger.warn(`Currently log: ${waiting} change(s) wait until their pictures can be loaded.`);
        const cards = buildCards(ready, options.version ?? '');
        let sentCards = 0;
        let sentEntries = 0;
        const posted = [...state.posted];
        const messages = [...state.messages];
        for (const [index, card] of cards.entries()) {
            posted.push(...card.ids);
            await store.write({ revision, posted, messages });
            try {
                const message = await channel.send(card.payload);
                sentCards += 1;
                sentEntries += card.ids.length;
                if (message?.id) {
                    messages.push(message.id);
                    await store.write({ revision, posted, messages });
                }
                // The two votes of the feedback board, so people say whether they like the change with one click. A reaction that fails (the emoji of the server is gone) never stops the log.
                await addVotes(message);
            }
            catch (error) {
                // This card and the next ones are forgotten again: they are tried at the next start.
                const failed = new Set(cards.slice(index).flatMap((each) => each.ids));
                await store.write({ revision, posted: posted.filter((id) => !failed.has(id)), messages }).catch(() => undefined);
                logger.warn(`Currently log: could not post a card (${error?.message ?? error}); ${failed.size} change(s) wait for the next start.`);
                break;
            }
            if (index < cards.length - 1)
                await sleep(options.pauseMs ?? 2500);
        }
        if (sentCards)
            logger.info(`Currently log: posted ${sentEntries} change(s) in ${sentCards} card(s).`);
        return { cards: sentCards, entries: sentEntries, ...(waiting ? { waiting } : {}), ...(removed ? { removed } : {}) };
    }
    catch (error) {
        logger.warn(`Currently log: ${error?.message ?? error}`);
        return { cards: 0, entries: 0, skipped: 'store-failed' };
    }
}
/** How often, and how many times, the entries that wait for a picture are tried again. */
const RETRY_EVERY_MS = 10 * 60_000;
const RETRIES = 6;
/** Posts the log and, while an entry waits for its pictures, tries again every ten minutes (an hour at most). */
async function startCurrentlyLog(client, options = {}, attempt = 1) {
    const result = await announceNewEntries(client, { botId: client.user?.id ?? null, ...options });
    if (result.waiting && attempt < RETRIES) {
        const timer = setTimeout(() => { void startCurrentlyLog(client, options, attempt + 1); }, options.pauseMs === undefined ? RETRY_EVERY_MS : Math.max(1, options.pauseMs));
        timer.unref?.();
    }
    return result;
}
