"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOG_URL = exports.LIMITS = exports.CATEGORY_ORDER = exports.CATEGORIES = void 0;
exports.validateEntries = validateEntries;
exports.buildCards = buildCards;
exports.voteEmojis = voteEmojis;
exports.databaseStore = databaseStore;
exports.channelIdFromEnv = channelIdFromEnv;
exports.parseLog = parseLog;
exports.fetchLog = fetchLog;
exports.lastLogProblem = lastLogProblem;
exports.looksLikeImage = looksLikeImage;
exports.imageReachable = imageReachable;
exports.announceNewEntries = announceNewEntries;
exports.startCurrentlyLog = startCurrentlyLog;
// i18n-ignore-file: the Currently log is written in English for the Petto community, it is not translated.
// The Currently log: the changes of Petto (like the releases of a GitHub project) posted to one channel, in colors by kind, with pictures.
// The channel is the `currently_log` variable (the ID of the channel). The changes are written in the web repo (`src/data/currentlyLog.json`, served at
// petto.sbs/api/currently-log): the bot looks at it when it starts and every two minutes, posts the ones it has not posted yet, once each, and remembers
// them (so a restart posts nothing twice). A change of the web or of the bot reaches the channel when the web is deployed, with no change to the bot.
// Written in TypeScript: `npm run build:ts` compiles it over currentlyLog.js, which is what the bot loads.
const discord_js_1 = require("discord.js");
// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const logger = require('./logger');
// The flat gray emojis of Petto (the same ones its panels use), one for each kind of change.
const { EMOJI } = require('./emojis');
/** The kinds of change, in the order their cards are posted (the most important first). */
exports.CATEGORIES = {
    security: { color: 0xfe6465, dot: EMOJI.SAFETY, one: 'Security fix', many: 'Security fixes' },
    feature: { color: 0xfed53c, dot: EMOJI.RELEASE_ROCKET, one: 'New feature', many: 'New features' },
    addition: { color: 0xa5ea7a, dot: EMOJI.VOICE_PERMIT, one: 'Added to a feature', many: 'Added to features' },
    improvement: { color: 0x74c0fc, dot: EMOJI.ROLLOUT_UP, one: 'Improvement', many: 'Improvements' },
    fix: { color: 0xffa45c, dot: EMOJI.RELEASE_SETTINGS, one: 'Fix', many: 'Fixes' },
    web: { color: 0xc4a3ff, dot: EMOJI.ROLLOUT_PLATFORMS, one: 'Web, dashboard and docs', many: 'Web, dashboard and docs' },
    removal: { color: 0xc3c7cf, dot: EMOJI.VOICE_DENY, one: 'Removed from a feature', many: 'Removed from features' },
    'removed-feature': { color: 0x4b4f59, dot: EMOJI.TICKET_DELETE, one: 'Feature removed', many: 'Features removed' },
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
/** Where the log is read from: the file of the web (`src/data/currentlyLog.json` of the web repo, served by the site). `CURRENTLY_LOG_URL` changes it. */
exports.LOG_URL = 'https://petto.sbs/api/currently-log';
/** The log as the file says it, checked (an entry with a problem is left out and said). */
function parseLog(file) {
    const data = (file && typeof file === 'object' ? file : {});
    const version = typeof data.version === 'string' && /^\d+\.\d+\.\d+$/.test(data.version) ? data.version : '';
    return { ...validateEntries(data.entries), revision: Math.max(1, Math.floor(Number(data.revision)) || 1), version };
}
/**
 * Reads the log from the web. Null when it cannot be read (the site is down or being deployed, or what it answers is not a log): nothing is posted
 * then and it is tried again at the next look, so the log is never posted half, and a bad file of the web cannot hurt the bot.
 */
async function fetchLog(url = process.env.CURRENTLY_LOG_URL || exports.LOG_URL, doFetch = fetch) {
    // The reason is kept, not said: while the web is being deployed it answers 404 for a minute, and that is not a warning for the team. `startCurrentlyLog`
    // says it once when the web has not answered for a while.
    try {
        const response = await doFetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) {
            lastProblem = `${url} answered ${response.status}`;
            return null;
        }
        const body = await response.json();
        if (!body || typeof body !== 'object' || !Array.isArray(body.entries)) {
            lastProblem = `${url} is not a log`;
            return null;
        }
        lastProblem = '';
        return parseLog(body);
    }
    catch (error) {
        lastProblem = `could not read ${url} (${error?.message ?? error})`;
        return null;
    }
}
/** Why the last reading of the log of the web failed (empty when it worked). */
let lastProblem = '';
function lastLogProblem() { return lastProblem; }
/** The bytes a picture file starts with, by kind: PNG, JPEG, GIF and WebP (a `RIFF` header with `WEBP` after it). */
function looksLikeImage(bytes) {
    const starts = (...head) => head.every((byte, index) => bytes[index] === byte);
    return starts(0x89, 0x50, 0x4e, 0x47) || starts(0xff, 0xd8, 0xff) || starts(0x47, 0x49, 0x46, 0x38)
        || (starts(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50);
}
/** The biggest picture Discord takes in a message. */
const MAX_PICTURE_BYTES = 8 * 1024 * 1024;
/**
 * Whether a picture can be shown by Discord: it is asked the way Discord asks, the whole file is read, and it has to answer, be an image of a
 * size Discord takes and really start like one (a page that says it is an image, or a file cut in half, is not). Reading all of it, and not
 * only the header, is on purpose: the first time a picture is asked the web's cache may have to go and get it, and Discord, which looks at
 * the three pictures of a change at the same time and does not wait long, would show one of them broken for good. After this the cache has
 * it, so Discord is answered at once. A second try after a short wait covers a file that is just being put in place.
 */
async function imageReachable(url, doFetch = fetch, retryAfterMs = 1500) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const response = await doFetch(url, { method: 'GET', redirect: 'follow', headers: { Accept: 'image/*', 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)' }, signal: AbortSignal.timeout(15_000) });
            if (response.ok && /^image\//i.test(response.headers.get('content-type') ?? '')) {
                const bytes = new Uint8Array(await response.arrayBuffer());
                if (bytes.length > 0 && bytes.length <= MAX_PICTURE_BYTES && looksLikeImage(bytes))
                    return true;
            }
        }
        catch {
            // not reachable now: tried once more below
        }
        if (attempt === 0 && retryAfterMs > 0)
            await sleep(retryAfterMs);
    }
    return false;
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
        const loaded = options.entries ? { entries: options.entries, problems: [], revision: options.revision ?? 1, version: '' } : await (options.load ?? (() => fetchLog()))();
        if (!loaded)
            return { cards: 0, entries: 0, skipped: 'log-unavailable' };
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
        const cards = buildCards(ready, options.version ?? loaded.version);
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
/** How often the log of the web is looked at: a change of the web or of the bot is in the channel within this time of the web being deployed. */
const POLL_EVERY_MS = 2 * 60_000;
/** When the web cannot be read (it is being deployed, most of the time) the bot asks again after these waits, and then every two minutes. */
const RETRY_AFTER_MS = [20_000, 60_000, 120_000, 300_000];
/**
 * Posts the log and keeps looking at the web every two minutes (`pollMs`): what is new is posted, and what waits for a picture (the web is still being
 * deployed) is posted when the picture answers. When the web cannot be read (the bot starts while the web is being deployed) it asks again after 20 s,
 * 1 min, 2 min and 5 min (`retryMs`) without a warning; only when it still cannot be read after all of them is it said once in the log of the team.
 * Answers the first result and a function that stops the looking.
 */
async function startCurrentlyLog(client, options = {}) {
    const { pollMs, retryMs = RETRY_AFTER_MS, ...announce } = options;
    let running = false;
    let stopped = false;
    let failures = 0;
    let retryTimer;
    let waiting = false;
    const look = async () => {
        if (running)
            return null;
        running = true;
        try {
            return await announceNewEntries(client, { botId: client.user?.id ?? null, ...announce });
        }
        finally {
            running = false;
        }
    };
    const afterLook = (result) => {
        if (!result || stopped)
            return;
        if (result.skipped !== 'log-unavailable') {
            failures = 0;
            return;
        }
        failures += 1;
        const wait = retryMs[failures - 1];
        if (wait === undefined) {
            if (failures === retryMs.length + 1)
                logger.warn(`Currently log: the web has not given the log for a while (${lastProblem || 'no answer'}); it is still tried every two minutes.`);
            return;
        }
        waiting = true;
        retryTimer = setTimeout(() => {
            waiting = false;
            look().then(afterLook).catch((error) => logger.warn(`Currently log: ${error?.message ?? error}`));
        }, wait);
        retryTimer.unref?.();
    };
    const first = await look();
    const result = first ?? { cards: 0, entries: 0, skipped: 'nothing-new' };
    afterLook(first);
    // The look of every two minutes leaves the quick retries alone while they are going on.
    const timer = setInterval(() => {
        if (waiting)
            return;
        look().then(afterLook).catch((error) => logger.warn(`Currently log: ${error?.message ?? error}`));
    }, pollMs ?? POLL_EVERY_MS);
    timer.unref?.();
    return { result, stop: () => { stopped = true; clearInterval(timer); if (retryTimer)
            clearTimeout(retryTimer); } };
}
