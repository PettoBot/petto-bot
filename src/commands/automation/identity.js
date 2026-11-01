const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const db = require('../../db/identity');
const { ensureGuild } = require('../../db/guilds');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { evaluateMember } = require('../../utils/identity/service');
const { memberOption, memberChecked, notifyText, runSync } = require('../../utils/identity/commands');
const { LOG_EVENTS, EVENT_LABELS, eventLabel } = require('../../utils/identity/emit');
const { infoPayload } = require('../../utils/infoCard');
const { t, languageOf } = require('../../i18n');

const EVENT_CHOICES = LOG_EVENTS.map((value) => ({ name: EVENT_LABELS[value], value }));

const reply = (interaction, text, color = COLORS.DEFAULT) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
const ok = (interaction, text) => reply(interaction, `${EMOJI.APPROVE}  ${text}`, COLORS.GREEN);

module.exports = {
  // Also registered as a slash command (it already has subcommands, so it needs no umbrella); the prefix keeps working.
  registerSlash: true,
  aliases: ['idlog'],
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
    const lang = await languageOf(interaction);
    const guild = interaction.guild;
    await ensureGuild(guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'sync') {
      const user = await memberOption(interaction, 'user');
      if (user) return ok(interaction, memberChecked(user, await evaluateMember(user), lang));
      return runSync(interaction, null, lang);
    }

    if (sub === 'status') {
      const [vanity, tags, notifyVanity, notifyTag, log] = await Promise.all([
        db.listVanityRules(guild.id, { all: true }), db.listGuildTagRules(guild.id, { all: true }),
        db.getNotification(guild.id, 'vanity'), db.getNotification(guild.id, 'guildtag'), db.getLogConfig(guild.id),
      ]);
      const off = t(lang, 'identity.status.off');
      const notify = (entry) => (entry ? notifyText(entry, lang) : off);
      const count = (list) => t(lang, 'identity.status.count', { count: list.length, on: list.filter((rule) => rule.enabled).length });
      const events = log ? LOG_EVENTS.filter((event) => log.events?.[event]).map((event) => eventLabel(event, lang)).join(', ') || t(lang, 'identity.status.none') : '';
      return interaction.editReply(infoPayload({
        accent: 0xf0a9c4,
        title: t(lang, 'identity.status.title'),
        subtitle: [t(lang, 'identity.status.subtitle')],
        thumbnail: guild.iconURL?.({ extension: 'png', size: 128 }) ?? null,
        sections: [
          // i18n-ignore: product names (Vanity, Server Tag) in front of a number
          { title: t(lang, 'identity.section.rules'), lines: [`**Vanity** ${count(vanity)}`, `**Server Tag** ${count(tags)}`] },
          // i18n-ignore: product names (Vanity, Server Tag) in front of a channel
          { title: t(lang, 'identity.status.thanks'), lines: [`**Vanity** ${notify(notifyVanity)}`, `**Server Tag** ${notify(notifyTag)}`] },
          { title: t(lang, 'identity.status.log'), lines: log ? [`<#${log.channelId}>`, events] : [off] },
        ],
        footer: '!vanity · !guildtag · !identity sync', // i18n-ignore: command names
      }));
    }

    if (sub === 'logs') {
      const channel = interaction.options.getChannel('channel', true);
      const current = await db.getLogConfig(guild.id);
      const events = current?.events && Object.keys(current.events).length ? current.events : Object.fromEntries(LOG_EVENTS.map((event) => [event, true]));
      await db.setLogConfig(guild.id, { channelId: channel.id, events, embeds: current?.embeds ?? {} });
      return ok(interaction, t(lang, 'identity.logs.set', { channel: `${channel}` }));
    }

    const current = await db.getLogConfig(guild.id);
    if (sub === 'logs-off') {
      return (await db.clearLogConfig(guild.id)) ? ok(interaction, t(lang, 'identity.logs.off')) : reply(interaction, t(lang, 'identity.logs.none'));
    }
    if (!current) return reply(interaction, t(lang, 'identity.logs.first'), COLORS.RED);
    const event = interaction.options.getString('event', true);
    const label = eventLabel(event, lang);
    if (sub === 'log-event') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await db.setLogConfig(guild.id, { channelId: current.channelId, events: { ...current.events, [event]: enabled }, embeds: current.embeds });
      return ok(interaction, t(lang, enabled ? 'identity.logs.eventOn' : 'identity.logs.eventOff', { event: label }));
    }
    const embedName = (interaction.options.getString('embed') ?? '').trim().toLowerCase();
    if (embedName && !(await getTemplate(guild.id, embedName))) return reply(interaction, t(lang, 'identity.noEmbed', { name: embedName }), COLORS.RED);
    const embeds = { ...current.embeds };
    if (embedName) embeds[event] = embedName; else delete embeds[event];
    await db.setLogConfig(guild.id, { channelId: current.channelId, events: current.events, embeds });
    return ok(interaction, embedName ? t(lang, 'identity.logs.embed', { event: label, name: embedName }) : t(lang, 'identity.logs.defaultCard', { event: label }));
  },
};
