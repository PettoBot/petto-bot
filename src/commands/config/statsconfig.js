// `!statsconfig`: what this server lets Petto count for its statistics. Everything can be turned off, and what was counted can be deleted.
// Only counts are kept (never what is written); each person can also ask not to be counted with `!stats privacy`.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const statsRules = require('../../db/statsRules');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { PREFIX } = require('../../utils/statsPanels');
const { t, languageOf } = require('../../i18n');

const V2 = MessageFlags.IsComponentsV2;
const ON_OFF = [{ name: 'on', value: 'on' }, { name: 'off', value: 'off' }];
const ON = /^(on|yes|true|1|enable|enabled|activar|activado|si|sí|ligar|ligado)$/i;
const OFF = /^(off|no|false|0|disable|disabled|desactivar|desactivado|desligar|desligado)$/i;

const onOff = (value, lang) => t(lang, value ? 'info.statsConfig.on' : 'info.statsConfig.off');

module.exports = {
  aliases: ['statconfig', 'analyticsconfig'],
  prefixDefaultSubcommand: 'view',
  data: new SlashCommandBuilder()
    .setName('statsconfig')
    .setDescription('What this server counts for its statistics, and deleting what was counted.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('view').setDescription('See what is counted and what is kept.'))
    .addSubcommand((s) => s.setName('enable').setDescription('Count the activity of this server for its statistics.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Stop counting anything in this server.'))
    .addSubcommand((s) => s.setName('members').setDescription('Keep counts per member (rankings of members and !stats member).')
      .addStringOption((o) => o.setName('mode').setDescription('on or off').setRequired(true).addChoices(...ON_OFF)))
    .addSubcommand((s) => s.setName('content').setDescription('Count how many messages have a link, a file, a reply or a mention (never the text).')
      .addStringOption((o) => o.setName('mode').setDescription('on or off').setRequired(true).addChoices(...ON_OFF)))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete every counter of this server.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    const reply = (components, flags = V2) => interaction.reply({ components, flags });
    const done = (key, color = 0xa5ea7a) => reply([textCard(t(lang, key, { emoji: EMOJI.APPROVE }), color)]);

    if (sub === 'view') {
      const config = await statsRules.getConfig(guild.id);
      return reply([textCard(t(lang, 'info.statsConfig.view', { emoji: EMOJI.SAFETY, server: guild.name, enabled: onOff(config.enabled, lang), members: onOff(config.members, lang), content: onOff(config.content, lang) }), null)]);
    }
    if (sub === 'enable') { await statsRules.setConfig(guild.id, { enabled: true }); return done('info.statsConfig.enabled'); }
    if (sub === 'disable') { await statsRules.setConfig(guild.id, { enabled: false }); return done('info.statsConfig.disabled'); }
    if (sub === 'members' || sub === 'content') {
      const mode = String(interaction.options.getString('mode') ?? '').trim();
      const value = ON.test(mode) ? true : OFF.test(mode) ? false : null;
      if (value === null) return reply([textCard(t(lang, 'info.statsConfig.view', { emoji: EMOJI.SAFETY, server: guild.name, ...(await describe(guild.id, lang)) }), null)]);
      await statsRules.setConfig(guild.id, { [sub]: value });
      return done(`info.statsConfig.${sub}${value ? 'On' : 'Off'}`);
    }
    // delete: it asks first, with a button that only the person who asked can press.
    const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'info.statsConfig.delete.confirm', { emoji: EMOJI.ALERT })));
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${PREFIX}:purge:${guild.id}:${interaction.user.id}`).setLabel(t(lang, 'info.statsConfig.delete.button')).setStyle(ButtonStyle.Danger));
    return reply([container, row]);
  },
};

async function describe(guildId, lang) {
  const config = await statsRules.getConfig(guildId);
  return { enabled: onOff(config.enabled, lang), members: onOff(config.members, lang), content: onOff(config.content, lang) };
}
