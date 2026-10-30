"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLEPLAY_BUTTON_PREFIX = void 0;
exports.getRoleplayLabel = getRoleplayLabel;
exports.getRoleplayResponseLabel = getRoleplayResponseLabel;
exports.getRoleplayResponseEmoji = getRoleplayResponseEmoji;
exports.getRoleplayResponseSentence = getRoleplayResponseSentence;
exports.getRoleplayCounterMessage = getRoleplayCounterMessage;
exports.buildRoleplayButtonRow = buildRoleplayButtonRow;
const discord_js_1 = require("discord.js");
const { CATALOGS, currentLanguage, t, tn } = require('../i18n');
exports.ROLEPLAY_BUTTON_PREFIX = 'rp:';
// The emoji of each action's response button lives with the actions of /act.
const { EMOJIS: RESPONSE_EMOJIS } = require('./actions');
// Actions with their own texts in the roleplay catalog; any other action (an old or hand-made button) gets the generic ones.
function hasTexts(action) {
    return Object.hasOwn(CATALOGS.en, `roleplay.${action}.accepted`);
}
function getRoleplayLabel(action) {
    return action.replaceAll('_', ' ');
}
function getRoleplayResponseLabel(action, lang = currentLanguage()) {
    return hasTexts(action)
        ? t(lang, `roleplay.${action}.reply.button`)
        : t(lang, 'roleplay.unknown.reply.button', { label: getRoleplayLabel(action) });
}
function getRoleplayResponseEmoji(action) {
    return RESPONSE_EMOJIS[action] ?? '↩️';
}
/** "**Ana** responds to **Bruno** with a hug." (`accepted`) or "**Ana** rejects the hug from **Bruno** and gives them a slap." */
function getRoleplayResponseSentence(action, accepted, target, actor, lang = currentLanguage()) {
    const shape = accepted ? 'accepted' : 'rejected';
    return hasTexts(action)
        ? t(lang, `roleplay.${action}.${shape}`, { target, actor })
        : t(lang, `roleplay.unknown.${shape}`, { target, actor, label: getRoleplayLabel(action) });
}
function getRoleplayCounterMessage(action, count, recipient, lang = currentLanguage()) {
    return hasTexts(action)
        ? tn(lang, `roleplay.${action}.count`, count, { recipient })
        : tn(lang, 'roleplay.unknown.count', count, { recipient, label: getRoleplayLabel(action) });
}
function buildRoleplayButtonRow(input, disabled = false, lang = currentLanguage()) {
    const base = `${exports.ROLEPLAY_BUTTON_PREFIX}%s:${input.action}:${input.actorId}:${input.targetId}:${input.requestId}`;
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(base.replace('%s', 'accept'))
        .setLabel(getRoleplayResponseLabel(input.action, lang))
        .setEmoji(getRoleplayResponseEmoji(input.action))
        .setStyle(discord_js_1.ButtonStyle.Success)
        .setDisabled(disabled), new discord_js_1.ButtonBuilder()
        .setCustomId(base.replace('%s', 'reject'))
        .setLabel(t(lang, 'roleplay.reject.button'))
        .setEmoji('✋')
        .setStyle(discord_js_1.ButtonStyle.Danger)
        .setDisabled(disabled));
}
