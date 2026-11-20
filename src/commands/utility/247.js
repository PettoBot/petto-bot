"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// i18n-ignore-file: the texts are in the catalogs (stayvoice.*); the builder holds the English descriptions that scripts/i18n-commands.js copies.
// /247 (and `!247`): Petto stays in a voice channel of the server for good, with a status on the channel ("Watching the server 24/7" by default). The row is in db/stayVoice.ts,
// the work is in utils/stayVoice.ts and the job that brings Petto back after a restart is jobs/stayVoiceJob.ts. Written in TypeScript: compiled over 247.js.
const discord_js_1 = require("discord.js");
const stayVoice_1 = require("../../db/stayVoice");
const stayVoice_2 = require("../../utils/stayVoice");
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');
const { COLORS } = require('../../utils/colors');
const GREEN = COLORS?.GREEN ?? 0xa5ea7a;
const RED = COLORS?.RED ?? 0xfe6465;
const FLAGS = discord_js_1.MessageFlags.IsComponentsV2;
const card = (text, color = null, privateReply = false) => ({ components: [textCard(text, color)], flags: privateReply ? FLAGS | discord_js_1.MessageFlags.Ephemeral : FLAGS, allowedMentions: { parse: [] } });
module.exports = {
    // A command of its own in the `/` menu, in the second set (registered in each server): the 100 global slots of Discord are nearly used (scripts/check-slash-structure.js).
    registerSlash: true,
    guildScoped: true,
    aliases: ['stayvoice'],
    data: new discord_js_1.SlashCommandBuilder()
        .setName('247')
        .setDescription('Keep Petto in a voice channel for good, with a status on the channel.')
        .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((s) => s
        .setName('set')
        .setDescription('Pick the voice channel Petto stays in.')
        .addChannelOption((o) => o.setName('channel').setDescription('The voice channel').addChannelTypes(discord_js_1.ChannelType.GuildVoice).setRequired(true))
        .addStringOption((o) => o.setName('status').setDescription('The status of the channel (default: Watching the server 24/7)').setMaxLength(stayVoice_1.MAX_STATUS).setRequired(false))
        .addBooleanOption((o) => o.setName('deaf').setDescription('Join with the sound off (default: yes)').setRequired(false)))
        .addSubcommand((s) => s.setName('off').setDescription('Leave the voice channel and stop coming back.'))
        .addSubcommand((s) => s
        .setName('status')
        .setDescription('Change the status of the voice channel.')
        .addStringOption((o) => o.setName('text').setDescription('The status; "default" for Watching the server 24/7').setMaxLength(stayVoice_1.MAX_STATUS).setRequired(true)))
        .addSubcommand((s) => s.setName('info').setDescription('See where Petto stays and with what status.')),
    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const lang = await languageOf(interaction);
        if (!interaction.guild) {
            await interaction.reply(card(t(lang, 'stayvoice.guildOnly'), RED, true));
            return;
        }
        if (sub === 'set')
            return setCmd(interaction, lang);
        if (sub === 'off')
            return offCmd(interaction, lang);
        if (sub === 'status')
            return statusCmd(interaction, lang);
        return infoCmd(interaction, lang);
    },
};
const channelText = (id) => `<#${id}>`;
const problemText = (lang, problem, channelId) => t(lang, `stayvoice.problem.${problem}`, { channel: channelText(channelId) });
/** What to tell after Petto was asked to be in the channel: where it is and how the status went. */
function resultText(lang, row, outcome) {
    const channel = channelText(row.channelId);
    if (!outcome.ok) {
        if (outcome.reason === 'music')
            return { text: t(lang, 'stayvoice.music', { channel }), color: GREEN };
        if (outcome.reason === 'notThere')
            return { text: t(lang, 'stayvoice.notThere', { channel }), color: RED };
        return { text: problemText(lang, outcome.reason, row.channelId), color: RED };
    }
    const lines = [t(lang, 'stayvoice.joined', { emoji: EMOJI.APPROVE, channel, status: (0, stayVoice_2.statusText)(row, lang) })];
    if (outcome.status === 'noPermission')
        lines.push(t(lang, 'stayvoice.noStatusPermission', { channel }));
    return { text: lines.join('\n'), color: GREEN };
}
async function setCmd(interaction, lang) {
    const guild = interaction.guild;
    const channel = interaction.options.getChannel('channel', true);
    const status = interaction.options.getString('status');
    const deaf = interaction.options.getBoolean('deaf');
    const problem = (0, stayVoice_2.problemWith)(channel, guild);
    if (problem) {
        await interaction.reply(card(problemText(lang, problem, channel.id), RED, true));
        return;
    }
    await interaction.deferReply();
    const row = await (0, stayVoice_1.saveStay)(guild.id, { channelId: channel.id, enabled: true, ...(status !== null ? { status } : {}), ...(deaf !== null ? { deaf } : {}) }, interaction.user.id);
    if (!row) {
        await interaction.editReply(card(t(lang, 'stayvoice.saveFailed'), RED));
        return;
    }
    const outcome = await (0, stayVoice_2.ensure)(interaction.client, row);
    const shown = resultText(lang, row, outcome);
    await interaction.editReply(card(shown.text, shown.color));
}
async function offCmd(interaction, lang) {
    const guild = interaction.guild;
    const row = await (0, stayVoice_1.getStay)(guild.id);
    if (!row?.enabled) {
        await interaction.reply(card(t(lang, 'stayvoice.offNone'), null, true));
        return;
    }
    await interaction.deferReply();
    await (0, stayVoice_1.saveStay)(guild.id, { enabled: false }, interaction.user.id);
    await (0, stayVoice_2.release)(interaction.client, guild.id, row.channelId);
    await interaction.editReply(card(t(lang, 'stayvoice.off', { emoji: EMOJI.APPROVE, channel: channelText(row.channelId) }), GREEN));
}
async function statusCmd(interaction, lang) {
    const guild = interaction.guild;
    const row = await (0, stayVoice_1.getStay)(guild.id);
    if (!row) {
        await interaction.reply(card(t(lang, 'stayvoice.needChannel'), RED, true));
        return;
    }
    await interaction.deferReply();
    const saved = await (0, stayVoice_1.saveStay)(guild.id, { status: (0, stayVoice_1.cleanStatus)(interaction.options.getString('text', true)) }, interaction.user.id);
    if (!saved) {
        await interaction.editReply(card(t(lang, 'stayvoice.saveFailed'), RED));
        return;
    }
    const channel = guild.channels.cache.get(saved.channelId);
    const lines = [t(lang, 'stayvoice.statusSet', { emoji: EMOJI.APPROVE, channel: channelText(saved.channelId), status: (0, stayVoice_2.statusText)(saved, lang) })];
    if (!saved.enabled)
        lines.push(t(lang, 'stayvoice.statusWhenOn'));
    else {
        const outcome = await (0, stayVoice_2.ensure)(interaction.client, saved);
        if (!outcome.ok && outcome.reason !== 'music')
            lines.push(resultText(lang, saved, outcome).text);
        else if (outcome.ok && outcome.status === 'noPermission' && channel)
            lines.push(t(lang, 'stayvoice.noStatusPermission', { channel: channelText(saved.channelId) }));
    }
    await interaction.editReply(card(lines.join('\n'), GREEN));
}
async function infoCmd(interaction, lang) {
    const guild = interaction.guild;
    const row = await (0, stayVoice_1.getStay)(guild.id);
    if (!row) {
        await interaction.reply(card(t(lang, 'stayvoice.info.none'), null, true));
        return;
    }
    const channel = guild.channels.cache.get(row.channelId);
    const here = guild.members.me?.voice.channelId === row.channelId;
    const lines = [
        t(lang, row.enabled ? 'stayvoice.info.on' : 'stayvoice.info.off'),
        t(lang, 'stayvoice.info.channel', { channel: channelText(row.channelId) }),
        t(lang, 'stayvoice.info.status', { status: (0, stayVoice_2.statusText)(row, lang) }),
        t(lang, row.deaf ? 'stayvoice.info.soundOff' : 'stayvoice.info.soundOn'),
    ];
    if (row.enabled)
        lines.push(t(lang, here ? 'stayvoice.info.here' : 'stayvoice.info.notHere'));
    if (row.enabled && channel && !(0, stayVoice_2.canSetStatus)(channel, guild))
        lines.push(t(lang, 'stayvoice.noStatusPermission', { channel: channelText(row.channelId) }));
    await interaction.reply(card(lines.join('\n'), row.enabled ? GREEN : null, true));
}
