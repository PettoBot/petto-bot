const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { ensureConfig, upsertConfig } = require('../../db/bumpReminders');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { templateHint } = require('../../utils/templateHint');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['bump'],
  data: new SlashCommandBuilder()
    .setName('bumpreminder')
    .setDescription('Reminds the server to /bump on DISBOARD every 2 hours.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('channel').setDescription('Set the DISBOARD bump channel.').addChannelOption((o) => o.setName('channel').setDescription('Bump channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('message').setDescription('Set the reminder message (sent when the cooldown ends).').addStringOption((o) => o.setName('text').setDescription('Supports {user.mention} and other /embed variables').setRequired(true)))
    .addSubcommand((s) => s.setName('thankyou').setDescription('Set the thank-you message (sent right after a successful bump).').addStringOption((o) => o.setName('text').setDescription('Supports {user.mention}, {nextBump}, and other /embed variables').setRequired(true)))
    .addSubcommand((s) => s.setName('template').setDescription('Use a saved embed for the reminder or the thank-you, or none to go back to the text.')
      .addStringOption((o) => o.setName('which').setDescription('Which message').setRequired(true).addChoices({ name: 'reminder', value: 'reminder' }, { name: 'thankyou', value: 'thankyou' }))
      .addStringOption((o) => o.setName('template').setDescription('Saved embed name, or none. Leave it empty to see what is in use and the saved embeds').setRequired(false)))
    .addSubcommand((s) => s.setName('pingable').setDescription('Whether the reminder message can actually ping.').addBooleanOption((o) => o.setName('enabled').setDescription('Enable?').setRequired(true)))
    .addSubcommand((s) => s.setName('autolock').setDescription('Lock the bump channel (deny Send Messages) between bumps.').addBooleanOption((o) => o.setName('enabled').setDescription('Enable?').setRequired(true)))
    .addSubcommand((s) => s.setName('autoclean').setDescription('Delete non-bump chatter in the bump channel.').addBooleanOption((o) => o.setName('enabled').setDescription('Enable?').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Show the current bump reminder configuration.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') return status(interaction);
    return update(interaction, sub);
  },
};

async function update(interaction, sub) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await ensureConfig(interaction.guild.id);

  const patch = {};
  let confirmLine;

  if (sub === 'channel') {
    const channel = interaction.options.getChannel('channel', true);
    patch.channel_id = channel.id;
    confirmLine = t(lang, 'welcome.bump.channelSet', { channel: `${channel}` });
  } else if (sub === 'message') {
    patch.message = interaction.options.getString('text', true);
    confirmLine = t(lang, 'welcome.bump.messageUpdated');
  } else if (sub === 'thankyou') {
    patch.thankyou = interaction.options.getString('text', true);
    confirmLine = t(lang, 'welcome.bump.thankyouUpdated');
  } else if (sub === 'template') {
    const which = interaction.options.getString('which', true).trim().toLowerCase();
    if (!['reminder', 'thankyou'].includes(which)) return interaction.editReply({ components: [textCard(t(lang, 'welcome.bump.chooseWhich'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    const column = `${which}_embed_template`;
    const name = String(interaction.options.getString('template') ?? '').trim();
    if (!name) {
      const current = await ensureConfig(interaction.guild.id);
      return interaction.editReply({ components: [textCard(await templateHint(interaction.guild.id, { current: current[column] ?? null, usage: `bumpreminder template ${which} <name>`, what: t(lang, `welcome.bump.what.${which}`), lang }))], flags: MessageFlags.IsComponentsV2 });
    }
    if (name.toLowerCase() === 'none') {
      patch[column] = null;
      confirmLine = t(lang, `welcome.bump.templateCleared.${which}`);
    } else {
      const doc = await getTemplate(interaction.guild.id, name).catch(() => null);
      if (!doc) return interaction.editReply({ components: [textCard(t(lang, 'welcome.bump.templateMissing', { name }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      patch[column] = doc.name;
      confirmLine = t(lang, `welcome.bump.templateSet.${which}`, { name: doc.name });
    }
  } else if (sub === 'pingable') {
    patch.pingable = interaction.options.getBoolean('enabled', true);
    confirmLine = t(lang, patch.pingable ? 'welcome.bump.pingable.on' : 'welcome.bump.pingable.off');
  } else if (sub === 'autolock') {
    patch.autolock = interaction.options.getBoolean('enabled', true);
    confirmLine = t(lang, patch.autolock ? 'welcome.bump.autolock.on' : 'welcome.bump.autolock.off');
  } else if (sub === 'autoclean') {
    patch.autoclean = interaction.options.getBoolean('enabled', true);
    confirmLine = t(lang, patch.autoclean ? 'welcome.bump.autoclean.on' : 'welcome.bump.autoclean.off');
  }

  await upsertConfig(interaction.guild.id, patch);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${confirmLine}`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

// The texts a server did not write are stored in English (the column defaults); they are shown in the server's language, the
// way utils/bumpHandler.js sends them.
function shownText(which, text, lang) {
  const key = `welcome.bump.default.${which}`;
  return text === t('en', key) ? t(lang, key) : text;
}

async function status(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const config = await ensureConfig(interaction.guild.id);

  const ready = !config.next_bump_at || new Date(config.next_bump_at) <= new Date();
  const lines = [
    t(lang, 'welcome.common.status.channel', { value: config.channel_id ? `<#${config.channel_id}>` : t(lang, 'welcome.common.notSet') }),
    t(lang, config.pingable ? 'welcome.bump.status.pingable.on' : 'welcome.bump.status.pingable.off'),
    t(lang, config.autolock ? 'welcome.bump.status.autolock.on' : 'welcome.bump.status.autolock.off'),
    t(lang, config.autoclean ? 'welcome.bump.status.autoclean.on' : 'welcome.bump.status.autoclean.off'),
    ready ? t(lang, 'welcome.bump.status.ready', { emoji: EMOJI.APPROVE }) : t(lang, 'welcome.bump.status.next', { time: `<t:${Math.floor(new Date(config.next_bump_at).getTime() / 1000)}:R>` }),
    t(lang, 'welcome.bump.status.reminder', { text: shownText('reminder', config.message, lang) }),
    t(lang, 'welcome.bump.status.thankyou', { text: shownText('thankyou', config.thankyou, lang) }),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
}
