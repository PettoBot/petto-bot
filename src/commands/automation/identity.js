const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const db = require('../../db/identity');
const { ensureGuild } = require('../../db/guilds');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { evaluateMember } = require('../../utils/identity/service');
const { syncGuild } = require('../../utils/identity/sync');
const { memberOption } = require('../../utils/identity/commands');
const { LOG_EVENTS, EVENT_LABELS } = require('../../utils/identity/emit');
const { infoPayload } = require('../../utils/infoCard');

const EVENT_CHOICES = LOG_EVENTS.map((value) => ({ name: EVENT_LABELS[value], value }));

const reply = (interaction, text, color = COLORS.DEFAULT) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
const ok = (interaction, text) => reply(interaction, `${EMOJI.APPROVE}  ${text}`, COLORS.GREEN);

module.exports = {
  aliases: ['idlog'],
  // Only with the prefix: no slash command is registered for it.
  prefixOnly: true,
  data: new SlashCommandBuilder()
    .setName('identity')
    .setDescription('Vanity and Server Tag roles: apply everything, and the log of role changes.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('sync').setDescription('Apply all Vanity and Server Tag rules to everyone, or to one member.').addUserOption((o) => o.setName('user').setDescription('Only this member')))
    .addSubcommand((s) => s.setName('status').setDescription('Show the rules, the thank-you messages and the log of this server.'))
    .addSubcommand((s) => s.setName('logs').setDescription('Log every role the rules add or remove, in a channel.')
      .addChannelOption((o) => o.setName('channel').setDescription('Where to log').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('log-event').setDescription('Turn one kind of log entry on or off.')
      .addStringOption((o) => o.setName('event').setDescription('Which entries').setRequired(true).addChoices(...EVENT_CHOICES))
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('log-embed').setDescription('Use a saved embed for one kind of log entry.')
      .addStringOption((o) => o.setName('event').setDescription('Which entries').setRequired(true).addChoices(...EVENT_CHOICES))
      .addStringOption((o) => o.setName('embed').setDescription('A saved embed from Embeds; leave empty for the default card').setMaxLength(64)))
    .addSubcommand((s) => s.setName('logs-off').setDescription('Stop logging role changes.')),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const guild = interaction.guild;
    await ensureGuild(guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'sync') {
      const user = await memberOption(interaction, 'user');
      if (user) {
        const results = await evaluateMember(user);
        const changed = results.filter((result) => result.changed && !result.error).length;
        return ok(interaction, `Checked ${user}. ${changed ? `${changed} role change${changed === 1 ? '' : 's'}.` : 'Nothing to change.'}`);
      }
      await reply(interaction, '### Syncing rules\nReading the members…');
      let last = 0;
      const result = await syncGuild(guild, {
        onProgress: ({ processed, total }) => {
          if (Date.now() - last < 3000) return;
          last = Date.now();
          const percent = total ? Math.floor((processed / total) * 100) : 100;
          reply(interaction, `### Syncing rules\n${'▰'.repeat(Math.round(percent / 10))}${'▱'.repeat(10 - Math.round(percent / 10))} ${percent}%\n${processed} of ${total} members`).catch(() => {});
        },
      });
      return ok(interaction, `Done in ${Math.max(1, Math.round(result.durationMs / 1000))}s. ${result.processed} members checked · ${result.added} roles added · ${result.removed} removed${result.errors ? ` · ${result.errors} errors` : ''}.${result.skipped ? `\nOnly the first ${result.total} members were checked (limit).` : ''}`);
    }

    if (sub === 'status') {
      const [vanity, tags, notifyVanity, notifyTag, log] = await Promise.all([
        db.listVanityRules(guild.id, { all: true }), db.listGuildTagRules(guild.id, { all: true }),
        db.getNotification(guild.id, 'vanity'), db.getNotification(guild.id, 'guildtag'), db.getLogConfig(guild.id),
      ]);
      const notify = (entry) => (entry ? `<#${entry.channelId}>${entry.embedName ? ` · embed \`${entry.embedName}\`` : ''}${entry.ping === 'none' ? ' · no ping' : ''}` : 'off');
      const count = (list) => `${list.length} (${list.filter((rule) => rule.enabled).length} on)`;
      const events = log ? LOG_EVENTS.filter((event) => log.events?.[event]).map((event) => EVENT_LABELS[event]).join(', ') || 'none' : '';
      return interaction.editReply(infoPayload({
        accent: 0xf0a9c4,
        title: 'Vanity and Server Tag',
        subtitle: ['Roles by Custom Status, name or Server Tag'],
        thumbnail: guild.iconURL?.({ extension: 'png', size: 128 }) ?? null,
        sections: [
          { title: 'Rules', lines: [`**Vanity** ${count(vanity)}`, `**Server Tag** ${count(tags)}`] },
          { title: 'Thank-you messages', lines: [`**Vanity** ${notify(notifyVanity)}`, `**Server Tag** ${notify(notifyTag)}`] },
          { title: 'Log', lines: log ? [`<#${log.channelId}>`, events] : ['off'] },
        ],
        footer: '!vanity · !guildtag · !identity sync',
      }));
    }

    if (sub === 'logs') {
      const channel = interaction.options.getChannel('channel', true);
      const current = await db.getLogConfig(guild.id);
      const events = current?.events && Object.keys(current.events).length ? current.events : Object.fromEntries(LOG_EVENTS.map((event) => [event, true]));
      await db.setLogConfig(guild.id, { channelId: channel.id, events, embeds: current?.embeds ?? {} });
      return ok(interaction, `Role changes made by the rules are logged in ${channel}. Use \`!identity log-event\` to choose which entries.`);
    }

    const current = await db.getLogConfig(guild.id);
    if (sub === 'logs-off') {
      return (await db.clearLogConfig(guild.id)) ? ok(interaction, 'The log is off.') : reply(interaction, 'There was no log set up.');
    }
    if (!current) return reply(interaction, 'Set a log channel first with `!identity logs`.', COLORS.RED);
    const event = interaction.options.getString('event', true);
    if (sub === 'log-event') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await db.setLogConfig(guild.id, { channelId: current.channelId, events: { ...current.events, [event]: enabled }, embeds: current.embeds });
      return ok(interaction, `${EVENT_LABELS[event]} entries are ${enabled ? 'on' : 'off'}.`);
    }
    const embedName = (interaction.options.getString('embed') ?? '').trim().toLowerCase();
    if (embedName && !(await getTemplate(guild.id, embedName))) return reply(interaction, `There is no saved embed called \`${embedName}\`. Create it in Embeds first.`, COLORS.RED);
    const embeds = { ...current.embeds };
    if (embedName) embeds[event] = embedName; else delete embeds[event];
    await db.setLogConfig(guild.id, { channelId: current.channelId, events: current.events, embeds });
    return ok(interaction, embedName ? `${EVENT_LABELS[event]} entries use the embed \`${embedName}\`.` : `${EVENT_LABELS[event]} entries use the default card.`);
  },
};
