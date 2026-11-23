"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planOfUser = planOfUser;
exports.profileState = profileState;
exports.buildProfileImage = buildProfileImage;
const path = require('node:path');
const { loadImage } = require('@napi-rs/canvas');
const { loadImageFromLink } = require('./safeImage');
const { renderProfileImage } = require('./profileImage');
const badgesRules = require('./profileBadges');
const profileDb = require('../db/userProfile');
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
/** The plan a person pays for, or null. The plans of a person are not sold yet, so nobody has one until that table exists. */
async function planOfUser(_userId) {
    return null;
}
/** What a person has: their badges (saved plus the one of their plan), the places their plan gives and the list they put in the showcase. */
async function profileState(userId) {
    const [plan, saved, chosen] = await Promise.all([planOfUser(userId), profileDb.getSavedBadges(userId), profileDb.getShowcase(userId)]);
    const owned = badgesRules.ownedBadges(saved, plan);
    const slots = badgesRules.slotsFor(plan);
    return { plan, owned, slots, showcase: badgesRules.normalizeShowcase(chosen, owned, slots) };
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
    const [state, row] = await Promise.all([profileState(user.id), levelUsersDb.getUser(guildId, user.id).catch(() => null)]);
    const xp = Number(row?.xp ?? 0);
    const rank = xp > 0 ? await levelUsersDb.getRank(guildId, xp).catch(() => null) : null;
    const dash = '–';
    const [avatar, banner] = await Promise.all([
        picture((member ?? user).displayAvatarURL({ size: 256, extension: 'png' })),
        picture(user.bannerURL?.({ size: 1024, extension: 'png' })),
    ]);
    const planStar = state.plan ? await artOf(`plan-${state.plan}.png`) : null;
    const showcase = [];
    for (const id of state.showcase) {
        const def = badgesRules.badgeById(id);
        if (def)
            showcase.push({ id, art: await artOf(def.art), color: def.color });
    }
    return renderProfileImage({
        name: member?.displayName ?? user.username,
        avatar, banner, planStar,
        stats: [
            { label: t(lang, 'profiles.image.level'), value: row ? formatNumber(lang, Number(row.level ?? 0)) : dash },
            { label: t(lang, 'profiles.image.rank'), value: rank ? `#${formatNumber(lang, rank)}` : dash },
            { label: t(lang, 'profiles.image.messages'), value: row ? formatNumber(lang, Number(row.messages ?? 0)) : dash },
            { label: t(lang, 'profiles.image.voice'), value: row ? formatNumber(lang, Number(row.voice_level ?? 0)) : dash },
        ],
        showcase, slots: state.slots, showcaseTitle: t(lang, 'profiles.image.badges'),
    });
}
