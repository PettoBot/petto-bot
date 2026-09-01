"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLEPLAY_BUTTON_PREFIX = void 0;
exports.getRoleplayLabel = getRoleplayLabel;
exports.getRoleplayCounterLabel = getRoleplayCounterLabel;
exports.buildRoleplayCounterField = buildRoleplayCounterField;
exports.buildRoleplayButtonRow = buildRoleplayButtonRow;
const discord_js_1 = require("discord.js");
exports.ROLEPLAY_BUTTON_PREFIX = 'rp:';
const LABELS = {
    airkiss: 'air kiss',
    angrystare: 'angry stare',
    brofist: 'brofist',
    bye: 'goodbye',
    highfive: 'high five',
    handhold: 'hand hold',
};
const COUNTER_LABELS = {
    airkiss: 'air kissed',
    angrystare: 'angrily stared at',
    bite: 'bitten',
    boop: 'booped',
    brofist: 'brofisted',
    bye: 'said goodbye to',
    cuddle: 'cuddled',
    dance: 'danced with',
    handhold: 'held hands with',
    highfive: 'high-fived',
    hug: 'hugged',
    hi: 'said hi to',
    kick: 'kicked',
    kill: 'defeated',
    kiss: 'kissed',
    laugh: 'laughed with',
    lick: 'licked',
    no: 'said no to',
    nom: 'nommed',
    pat: 'patted',
    poke: 'poked',
    punch: 'punched',
    sad: 'felt sad with',
    slap: 'slapped',
    smile: 'smiled at',
    tickle: 'tickled',
    wave: 'waved at',
    wink: 'winked at',
    yes: 'said yes to',
    yeet: 'yeeted',
};
function getRoleplayLabel(action) {
    return LABELS[action] ?? action.replaceAll('_', ' ');
}
function getRoleplayCounterLabel(action) {
    return COUNTER_LABELS[action] ?? getRoleplayLabel(action);
}
function buildRoleplayCounterField(action, count) {
    return {
        name: 'Roleplay stats',
        value: `Times ${getRoleplayCounterLabel(action)}: ${count.toLocaleString('en-US')}`,
        inline: true,
    };
}
function buildRoleplayButtonRow(input, disabled = false) {
    const base = `${exports.ROLEPLAY_BUTTON_PREFIX}%s:${input.action}:${input.actorId}:${input.targetId}:${input.requestId}`;
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(base.replace('%s', 'accept'))
        .setLabel('Respond')
        .setEmoji('↩️')
        .setStyle(discord_js_1.ButtonStyle.Success)
        .setDisabled(disabled), new discord_js_1.ButtonBuilder()
        .setCustomId(base.replace('%s', 'reject'))
        .setLabel('Reject')
        .setEmoji('✋')
        .setStyle(discord_js_1.ButtonStyle.Danger)
        .setDisabled(disabled));
}
