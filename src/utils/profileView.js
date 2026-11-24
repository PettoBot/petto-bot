"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.artOf = artOf;
exports.frameOf = frameOf;
exports.artOfBadge = artOfBadge;
exports.formatVoice = formatVoice;
exports.planOfUser = planOfUser;
exports.profileState = profileState;
exports.buildProfileImage = buildProfileImage;
const path = require('node:path');
const { loadImage } = require('@napi-rs/canvas');
const { loadImageFromLink } = require('./safeImage');
const { renderProfileImage } = require('./profileImage');
const badgesRules = require('./profileBadges');
const registry = require('./badgeRegistry');
const profileDb = require('../db/userProfile');
const shopDb = require('../db/shop');
const plansDb = require('../db/userPlans');
const levelUsersDb = require('../db/levelUsers');
const { t, formatNumber } = require('../i18n');
const ART_DIR = path.join(__dirname, '..', 'assets', 'badges');
const artCache = new Map();
async function artOf(file) {
    if (!file)
        return null;
    const cached = artCache.get(file);
    if (cached)
        return cached;
    try {
        const image = await loadImage(path.join(ART_DIR, file));
        artCache.set(file, image);
        return image;
    }
    catch {
        return null;
    }
}
const FRAMES_DIR = path.join(__dirname, '..', 'assets', 'frames');
const frameCache = new Map();
/** The picture of a frame of the badges (`normal` iron, `bright` gold, `divine` mithril), or null when the file is not there: a plain ring is drawn then. */
async function frameOf(id) {
    const name = id === 'bright' || id === 'divine' ? id : 'normal';
    if (frameCache.has(name))
        return frameCache.get(name) ?? null;
    try {
        const image = await loadImage(path.join(FRAMES_DIR, `${name}.png`));
        frameCache.set(name, image);
        return image;
    }
    catch {
        frameCache.set(name, null);
        return null;
    }
}
const flagCache = new Map();
const FLAGS_DIR = (() => { try {
    return path.join(path.dirname(require.resolve('flag-icons/package.json')), 'flags', '1x1');
}
catch {
    return null;
} })();
/** The flag of a country (the open `flag-icons` package, square), or null when it is not there: the badge is then drawn with its code. */
async function flagOf(region) {
    const code = region.toLowerCase();
    if (!FLAGS_DIR || !/^[a-z]{2}$/.test(code))
        return null;
    if (flagCache.has(code))
        return flagCache.get(code) ?? null;
    try {
        const image = await loadImage(await require('node:fs/promises').readFile(path.join(FLAGS_DIR, `${code}.svg`)));
        if (flagCache.size >= 300)
            flagCache.delete(flagCache.keys().next().value);
        flagCache.set(code, image);
        return image;
    }
    catch {
        flagCache.set(code, null);
        return null;
    }
}
/** The picture of a badge: the flag of its country, or its art file, or nothing (it is drawn with its colour and its code). */
async function artOfBadge(def) {
    if (def.region)
        return flagOf(def.region);
    if (def.flag)
        return flagOf(def.flag);
    if (def.custom)
        return registry.customArt(def);
    return artOf(def.art);
}
/** A voice time with its unit, short: `45 min`, `5 h 20 m`, `12 h`, `3 d 4 h`. Never a bare number. */
function formatVoice(seconds) {
    const minutes = Math.floor(Math.max(0, seconds) / 60);
    if (minutes < 60)
        return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 10)
        return minutes % 60 ? `${hours} h ${minutes % 60} m` : `${hours} h`;
    if (hours < 24)
        return `${hours} h`;
    const days = Math.floor(hours / 24);
    return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
}
/** The plan a person has right now (given by the team or paid), or null. A plan past its end is not one. A read that fails is no plan: the person is never given more than they have. */
async function planOfUser(userId) {
    try {
        const row = await plansDb.getPlan(userId);
        return row?.active ? badgesRules.planOf(row.plan) : null;
    }
    catch {
        return null;
    }
}
/** What a person has: their badges (saved plus the one of their plan), the places their plan gives and the list they put in the showcase. */
async function profileState(userId) {
    await registry.ensure();
    const [plan, saved, chosen, granted, items, active] = await Promise.all([planOfUser(userId), profileDb.getBadgeRows(userId), profileDb.getShowcase(userId), registry.grantedFor(userId), shopDb.getUserItems(userId), shopDb.getActive(userId)]);
    // A badge that is given by itself is had while the person is what it says: it is saved when they first are (so it can have a frame) and left out when they stop.
    const ruled = new Set(badgesRules.allBadges().filter((def) => def.custom && def.grantRule).map((def) => def.id));
    const rows = [...saved];
    for (const id of granted) {
        if (rows.some((row) => row.id === id))
            continue;
        await profileDb.addBadge(userId, id, 'status').catch(() => false);
        rows.push({ id, frame: 'normal', shown: null, source: 'status' });
    }
    const effective = rows.filter((row) => !(ruled.has(row.id) && !granted.includes(row.id)));
    const owned = badgesRules.ownedBadges(effective.map((row) => row.id), plan);
    // The frame each badge shows (the one the person chose, or the best it has) and the best it has (what the next purchase builds on).
    const frames = Object.fromEntries(effective.map((row) => [row.id, row.shown ?? row.frame]));
    const unlocked = Object.fromEntries(effective.map((row) => [row.id, row.frame]));
    const slots = badgesRules.slotsFor(plan);
    return { plan, owned, slots, showcase: badgesRules.normalizeShowcase(chosen, owned, slots), frames, unlocked, items, active };
}
async function picture(url) {
    if (!url)
        return null;
    try {
        return await loadImageFromLink(url);
    }
    catch {
        return null;
    }
}
/** The PNG of the profile of `user` in a server. `member` gives the nickname and the avatar of the server when they have them. */
async function buildProfileImage(opts) {
    const { guildId, user, member, lang } = opts;
    const [state, row, voiceSeconds] = await Promise.all([profileState(user.id), levelUsersDb.getUser(guildId, user.id).catch(() => null), profileDb.getVoiceSeconds(guildId, user.id).catch(() => 0)]);
    const xp = Number(row?.xp ?? 0);
    const rank = xp > 0 ? await levelUsersDb.getRank(guildId, xp).catch(() => null) : null;
    const dash = '–';
    // A banner of the shop that the person put on goes over the banner of their Discord; a name font of the shop changes how their name is drawn.
    const ownsItem = (kind, id) => Boolean(id) && state.items.some((item) => item.kind === kind && item.id === id);
    const [avatar, banner, shopBanner, nameFont] = await Promise.all([
        picture((member ?? user).displayAvatarURL({ size: 256, extension: 'png' })),
        picture(user.bannerURL?.({ size: 1024, extension: 'png' })),
        ownsItem('banner', state.active.banner) ? registry.bannerImage(state.active.banner) : Promise.resolve(null),
        ownsItem('font', state.active.font) ? registry.fontFamily(state.active.font) : Promise.resolve(null),
    ]);
    const planStar = state.plan ? await artOf(`plan-${state.plan}.png`) : null;
    const showcase = [];
    for (const id of state.showcase) {
        const def = badgesRules.badgeById(id);
        if (def) {
            const frame = state.frames[id] ?? 'normal';
            showcase.push({ id, art: await artOfBadge(def), color: def.color, label: badgesRules.badgeLabel(def) || undefined, frame, frameArt: await frameOf(frame) });
        }
    }
    return renderProfileImage({
        name: member?.displayName ?? user.username,
        avatar, banner: shopBanner ?? banner ?? await artOf('profile-default.webp'), planStar, nameFont,
        stats: [
            { label: t(lang, 'profiles.image.level'), value: row ? formatNumber(lang, Number(row.level ?? 0)) : dash },
            { label: t(lang, 'profiles.image.rank'), value: rank ? `#${formatNumber(lang, rank)}` : dash },
            { label: t(lang, 'profiles.image.messages'), value: row ? formatNumber(lang, Number(row.messages ?? 0)) : dash },
            { label: t(lang, 'profiles.image.voice'), value: voiceSeconds > 0 ? formatVoice(voiceSeconds) : dash },
        ],
        showcase, slots: state.slots, showcaseTitle: t(lang, 'profiles.image.badges'),
    });
}
