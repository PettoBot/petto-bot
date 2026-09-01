"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLEPLAY_BUTTON_PREFIX = void 0;
exports.getRoleplayLabel = getRoleplayLabel;
exports.getRoleplayResponseLabel = getRoleplayResponseLabel;
exports.getRoleplayResponseEmoji = getRoleplayResponseEmoji;
exports.getRoleplayCounterMessage = getRoleplayCounterMessage;
exports.buildRoleplayButtonRow = buildRoleplayButtonRow;
const discord_js_1 = require("discord.js");
exports.ROLEPLAY_BUTTON_PREFIX = 'rp:';
const LABELS = {
    airkiss: 'air kiss',
    angry: 'angry moment',
    angrystare: 'angry stare',
    bleh: 'bleh',
    blush: 'blush',
    boop: 'boop',
    brofist: 'brofist',
    bye: 'goodbye',
    cry: 'cry',
    cuddle: 'cuddle',
    dance: 'dance',
    glomp: 'glomp',
    handhold: 'hand hold',
    happy: 'happy moment',
    hi: 'hi',
    highfive: 'high five',
    hug: 'hug',
    kick: 'kick',
    kill: 'defeat',
    kiss: 'kiss',
    laugh: 'laugh',
    lick: 'lick',
    no: 'no',
    nom: 'nom',
    pat: 'pat',
    poke: 'poke',
    punch: 'punch',
    sad: 'sad moment',
    slap: 'slap',
    smile: 'smile',
    smug: 'smug look',
    tickle: 'tickle',
    wave: 'wave',
    wink: 'wink',
    yeet: 'yeet',
    yes: 'yes',
};
const COUNTER_NOUNS = {
    airkiss: ['air kiss', 'air kisses'],
    angry: ['angry moment', 'angry moments'],
    angrystare: ['angry stare', 'angry stares'],
    bite: ['bite', 'bites'],
    bleh: ['bleh', 'blehs'],
    blush: ['blush', 'blushes'],
    boop: ['boop', 'boops'],
    brofist: ['brofist', 'brofists'],
    bye: ['goodbye', 'goodbyes'],
    cry: ['cry', 'cries'],
    cuddle: ['cuddle', 'cuddles'],
    dance: ['dance', 'dances'],
    glomp: ['glomp', 'glomps'],
    handhold: ['hand hold', 'hand holds'],
    happy: ['happy moment', 'happy moments'],
    highfive: ['high five', 'high fives'],
    hi: ['hi', 'his'],
    hug: ['hug', 'hugs'],
    kick: ['kick', 'kicks'],
    kill: ['defeat', 'defeats'],
    kiss: ['kiss', 'kisses'],
    laugh: ['laugh', 'laughs'],
    lick: ['lick', 'licks'],
    nom: ['nom', 'noms'],
    no: ['no', 'nos'],
    pat: ['pat', 'pats'],
    poke: ['poke', 'pokes'],
    punch: ['punch', 'punches'],
    sad: ['sad moment', 'sad moments'],
    slap: ['slap', 'slaps'],
    smile: ['smile', 'smiles'],
    smug: ['smug look', 'smug looks'],
    tickle: ['tickle', 'tickles'],
    wave: ['wave', 'waves'],
    wink: ['wink', 'winks'],
    yes: ['yes', 'yeses'],
    yeet: ['yeet', 'yeets'],
};
const RESPONSE_LABELS = {
    airkiss: 'Air kiss back',
    angry: 'Get angry back',
    angrystare: 'Stare back',
    bite: 'Bite back',
    bleh: 'Bleh back',
    blush: 'Blush back',
    boop: 'Boop back',
    brofist: 'Brofist back',
    bye: 'Say goodbye back',
    cry: 'Cry together',
    cuddle: 'Cuddle back',
    dance: 'Dance back',
    glomp: 'Glomp back',
    handhold: 'Hold hands back',
    happy: 'Celebrate back',
    highfive: 'High-five back',
    hi: 'Say hi back',
    hug: 'Hug back',
    kick: 'Kick back',
    kill: 'Fight back',
    kiss: 'Kiss back',
    laugh: 'Laugh back',
    lick: 'Lick back',
    nom: 'Nom back',
    no: 'Say no back',
    pat: 'Pat back',
    poke: 'Boop back',
    punch: 'Punch back',
    sad: 'Cry together',
    slap: 'Slap back',
    smile: 'Smile back',
    smug: 'Smirk back',
    tickle: 'Tickle back',
    wave: 'Wave back',
    wink: 'Wink back',
    yes: 'Say yes back',
    yeet: 'Yeet back',
};
const RESPONSE_EMOJIS = {
    airkiss: '💋',
    angry: '😠',
    angrystare: '😤',
    bleh: '😛',
    blush: '😊',
    bite: '🦷',
    boop: '👉',
    brofist: '👊',
    cuddle: '🫂',
    cry: '😭',
    dance: '💃',
    glomp: '🫂',
    highfive: '🙌',
    hi: '👋',
    hug: '🤗',
    kiss: '💋',
    laugh: '😂',
    pat: '🫳',
    poke: '👉',
    punch: '🥊',
    sad: '😭',
    slap: '🖐️',
    smile: '😊',
    smug: '😏',
    wave: '👋',
    wink: '😉',
    yes: '✅',
    no: '❌',
};
function getRoleplayLabel(action) {
    return LABELS[action] ?? action.replaceAll('_', ' ');
}
function getRoleplayResponseLabel(action) {
    return RESPONSE_LABELS[action] ?? `${getRoleplayLabel(action)} back`;
}
function getRoleplayResponseEmoji(action) {
    return RESPONSE_EMOJIS[action] ?? '↩️';
}
function getRoleplayCounterMessage(action, count, recipient) {
    const [singular, plural] = COUNTER_NOUNS[action] ?? [getRoleplayLabel(action), `${getRoleplayLabel(action)}s`];
    const noun = count === 1 ? singular : plural;
    return `${recipient} has received ${count.toLocaleString('en-US')} ${noun}.`;
}
function buildRoleplayButtonRow(input, disabled = false) {
    const base = `${exports.ROLEPLAY_BUTTON_PREFIX}%s:${input.action}:${input.actorId}:${input.targetId}:${input.requestId}`;
    return new discord_js_1.ActionRowBuilder().addComponents(new discord_js_1.ButtonBuilder()
        .setCustomId(base.replace('%s', 'accept'))
        .setLabel(getRoleplayResponseLabel(input.action))
        .setEmoji(getRoleplayResponseEmoji(input.action))
        .setStyle(discord_js_1.ButtonStyle.Success)
        .setDisabled(disabled), new discord_js_1.ButtonBuilder()
        .setCustomId(base.replace('%s', 'reject'))
        .setLabel('Reject')
        .setEmoji('✋')
        .setStyle(discord_js_1.ButtonStyle.Danger)
        .setDisabled(disabled));
}
