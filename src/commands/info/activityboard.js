"use strict";
// `/activityboard`: the activity leaderboards of a server (chat and voice, each with a card for the day, the week and the month, edited every hour).
// `set` chooses the channel of one kind and writes the cards at once, `remove` takes them away, `status` says where they are and `refresh` writes them again now.
// Written in TypeScript: `npm run build:ts` compiles it over src/commands/info/activityboard.js, which is what the bot loads.
const discord_js_1 = require("discord.js");
const db = require("../../db/activityLeaderboards");
const activityLeaderboard_1 = require("../../utils/activityLeaderboard");
const { t, languageOf } = require('../../i18n');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const V2 = discord_js_1.MessageFlags.IsComponentsV2;
/** One `refresh` for each server in this time: it reads the database and edits up to six messages. */
const REFRESH_COOLDOWN_MS = 60_000;
const lastRefresh = new Map();
const kindOption = (required) => (option) => option
    .setName('type').setDescription('Which leaderboards').setRequired(required)
    .addChoices({ name: 'Chat (messages)', value: 'chat' }, { name: 'Voice (minutes)', value: 'voice' });
const command = {
    aliases: ['actlb'],
    // Also a slash command of its own (it is not inside an umbrella): the leaderboards are set with `/activityboard`, and with the prefix `!activityboard`.
    registerSlash: true,
    data: new discord_js_1.SlashCommandBuilder()
        .setName('activityboard')
        .setDescription('Leaderboards of the most active members, in a channel, updated every hour.')
        .setDMPermission(false)
        .setDefaultMemberPermissions(discord_js_1.PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) => sub.setName('set').setDescription('Post the daily, weekly and monthly leaderboards in a channel.')
        .addStringOption(kindOption(true))
        .addChannelOption((option) => option.setName('channel').setDescription('The channel where they are posted').addChannelTypes(discord_js_1.ChannelType.GuildText, discord_js_1.ChannelType.GuildAnnouncement).setRequired(true)))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Stop the leaderboards of a kind and delete their messages.').addStringOption(kindOption(true)))
        .addSubcommand((sub) => sub.setName('status').setDescription('See where the leaderboards are and when they were last updated.'))
        .addSubcommand((sub) => sub.setName('refresh').setDescription('Write the leaderboards again now.').addStringOption(kindOption(false))),
    async execute(interaction) {
        const lang = await languageOf(interaction);
        const guild = interaction.guild;
        if (!guild)
            return;
        const show = (text, ephemeral = false) => (interaction.deferred || interaction.replied
            ? interaction.editReply({ components: [textCard(text)], flags: V2, allowedMentions: { parse: [] } })
            : interaction.reply({ components: [textCard(text)], flags: ephemeral ? V2 | discord_js_1.MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } }));
        const reasonText = (reason) => t(lang, `leaderboards.error.${reason}`, { emoji: EMOJI.DENY });
        const reasonPlain = (reason) => t(lang, `leaderboards.error.${reason}`, { emoji: '' }).trim(); // inside another sentence, which has its own icon
        const kindName = (kind) => t(lang, `leaderboards.kind.${kind}`);
        // The types of discord.js only list Ephemeral for a deferral; Discord accepts the flag of a Components V2 message there, as the rest of the bot does.
        const defer = () => interaction.deferReply({ flags: V2 });
        if (!interaction.memberPermissions?.has(discord_js_1.PermissionFlagsBits.ManageGuild)) {
            await show(t(lang, 'leaderboards.needsManageServer', { emoji: EMOJI.DENY }), true);
            return;
        }
        const sub = interaction.options.getSubcommand();
        if (sub === 'set') {
            const kind = interaction.options.getString('type', true);
            const picked = interaction.options.getChannel('channel', true);
            const blocked = (0, activityLeaderboard_1.statsReason)(guild.id);
            if (blocked) {
                await show(reasonText(blocked), true);
                return;
            }
            const writable = (0, activityLeaderboard_1.writableChannel)(guild, await guild.channels.fetch(picked.id).catch(() => null));
            if ('reason' in writable) {
                await show(reasonText(writable.reason), true);
                return;
            }
            await defer();
            const row = await db.upsertBoard(guild.id, kind, writable.channel.id);
            const result = await (0, activityLeaderboard_1.refreshBoard)(interaction.client, row);
            await show(result.ok
                ? t(lang, 'leaderboards.set.done', { emoji: EMOJI.APPROVE, kind: kindName(kind), channel: `<#${writable.channel.id}>` })
                : t(lang, 'leaderboards.set.failed', { emoji: EMOJI.DENY, channel: `<#${writable.channel.id}>`, reason: reasonPlain(result.reason ?? 'error') }));
            return;
        }
        if (sub === 'remove') {
            const kind = interaction.options.getString('type', true);
            const row = await db.removeBoard(guild.id, kind);
            if (!row) {
                await show(t(lang, 'leaderboards.remove.none', { emoji: EMOJI.ALERT, kind: kindName(kind) }), true);
                return;
            }
            await defer();
            await (0, activityLeaderboard_1.deleteBoardMessages)(interaction.client, row);
            await show(t(lang, 'leaderboards.remove.done', { emoji: EMOJI.APPROVE, kind: kindName(kind) }));
            return;
        }
        if (sub === 'status') {
            const rows = await db.listBoards(guild.id);
            if (!rows.length) {
                await show(t(lang, 'leaderboards.status.none', { emoji: EMOJI.ALERT }), true);
                return;
            }
            const lines = rows.map((row) => {
                const when = row.last_refreshed_at ? ` · ${t(lang, 'leaderboards.status.updated', { when: `<t:${Math.floor(new Date(row.last_refreshed_at).getTime() / 1000)}:R>` })}` : ` · ${t(lang, 'leaderboards.status.waiting')}`;
                const problem = row.last_error ? ` · ${reasonPlain(row.last_error)}` : '';
                return `${t(lang, 'leaderboards.status.line', { kind: kindName(row.kind), channel: `<#${row.channel_id}>` })}${when}${problem}`;
            });
            await show(lines.join('\n'));
            return;
        }
        // refresh
        const asked = interaction.options.getString('type');
        const last = lastRefresh.get(guild.id) ?? 0;
        if (Date.now() - last < REFRESH_COOLDOWN_MS) {
            await show(t(lang, 'leaderboards.refresh.wait', { emoji: EMOJI.ALERT }), true);
            return;
        }
        const rows = (await db.listBoards(guild.id)).filter((row) => !asked || row.kind === asked);
        if (!rows.length) {
            await show(t(lang, 'leaderboards.status.none', { emoji: EMOJI.ALERT }), true);
            return;
        }
        lastRefresh.set(guild.id, Date.now());
        await defer();
        const results = await Promise.all(rows.map((row) => (0, activityLeaderboard_1.refreshBoard)(interaction.client, row)));
        const failed = results.find((result) => !result.ok);
        await show(failed
            ? t(lang, 'leaderboards.refresh.failed', { emoji: EMOJI.DENY, reason: reasonPlain(failed.reason ?? 'error') })
            : t(lang, 'leaderboards.refresh.done', { emoji: EMOJI.APPROVE }));
    },
};
module.exports = command;
