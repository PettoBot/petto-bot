"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIMITS = exports.CATEGORY_ORDER = exports.CATEGORIES = void 0;
exports.validateEntries = validateEntries;
exports.buildCards = buildCards;
exports.voteEmojis = voteEmojis;
exports.databaseStore = databaseStore;
exports.channelIdFromEnv = channelIdFromEnv;
exports.loadEntries = loadEntries;
exports.announceNewEntries = announceNewEntries;
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
const SETTING_KEY = 'currently_log.posted';
/** The ids kept; the oldest go first, an id is only needed while its entry is in the file. */
const KEEP_IDS = 1000;
/** The usual store: one row of `bot_settings` with the ids as JSON. */
function databaseStore() {
    const settings = require('../db/botSettings');
    return {
        async read() {
            const value = await settings.getSetting(SETTING_KEY);
            try {
                const parsed = value ? JSON.parse(value) : [];
                return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
            }
            catch {
                return [];
            }
        },
        async write(ids) {
            await settings.setSetting(SETTING_KEY, JSON.stringify(ids.slice(-KEEP_IDS)));
        },
    };
}
/** The ID of the channel: the `currently_log` variable. Null when it is not set. */
function channelIdFromEnv(env = process.env) {
    const value = String(env.currently_log ?? env.CURRENTLY_LOG ?? '').trim();
    return /^\d{15,25}$/.test(value) ? value : null;
}
/** The entries of the file, checked. */
function loadEntries() {
    return validateEntries(require('../data/currentlyLog.json').entries);
}
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
/**
 * Posts the entries that were not posted yet, in the channel of the `currently_log` variable. Each card is remembered before it is sent, so two bots
 * starting together do not post it twice; if Discord refuses a card, the entries of it and of the cards after it are forgotten and come again at
 * the next start. Never throws: a problem is said in the log and the bot goes on.
 */
async function announceNewEntries(client, options = {}) {
    const channelId = options.channelId === undefined ? channelIdFromEnv() : options.channelId;
    if (!channelId)
        return { cards: 0, entries: 0, skipped: 'no-channel' };
    try {
        const loaded = options.entries ? { entries: options.entries, problems: [] } : loadEntries();
        for (const problem of loaded.problems)
            logger.warn(`Currently log: ${problem}`);
        const store = options.store ?? databaseStore();
        const posted = new Set(await store.read());
        const fresh = loaded.entries.filter((entry) => !posted.has(entry.id));
        if (!fresh.length)
            return { cards: 0, entries: 0, skipped: 'nothing-new' };
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
            logger.warn(`Currently log: the channel ${channelId} is not a channel where Petto can post.`);
            return { cards: 0, entries: 0, skipped: 'channel-unavailable' };
        }
        const cards = buildCards(fresh, options.version ?? '');
        let sentCards = 0;
        let sentEntries = 0;
        const remembered = [...posted];
        for (const [index, card] of cards.entries()) {
            remembered.push(...card.ids);
            await store.write(remembered);
            try {
                const message = await channel.send(card.payload);
                sentCards += 1;
                sentEntries += card.ids.length;
                // The two votes of the feedback board, so people say whether they like the change with one click. A reaction that fails (the emoji of the server is gone) never stops the log.
                await addVotes(message);
            }
            catch (error) {
                // This card and the next ones are forgotten again: they are tried at the next start.
                const failed = new Set(cards.slice(index).flatMap((each) => each.ids));
                await store.write(remembered.filter((id) => !failed.has(id))).catch(() => undefined);
                logger.warn(`Currently log: could not post a card (${error?.message ?? error}); ${failed.size} change(s) wait for the next start.`);
                break;
            }
            if (index < cards.length - 1)
                await sleep(options.pauseMs ?? 2500);
        }
        if (sentCards)
            logger.info(`Currently log: posted ${sentEntries} change(s) in ${sentCards} card(s).`);
        return { cards: sentCards, entries: sentEntries };
    }
    catch (error) {
        logger.warn(`Currently log: ${error?.message ?? error}`);
        return { cards: 0, entries: 0, skipped: 'store-failed' };
    }
}
