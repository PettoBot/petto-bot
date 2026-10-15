const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const afkDb = require('../../db/afk');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['away'],
  // Prefix usage can be `!afk <reason>`; `!afk set <reason>` remains valid.
  prefixDefaultSubcommand: 'set',
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Set an AFK status, or view mentions you got while away.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('set').setDescription('Mark yourself AFK.').addStringOption((o) => o.setName('reason').setDescription('Why you\'re away (default: "AFK")').setRequired(false)))
    .addSubcommand((s) => s.setName('mentions').setDescription('See who mentioned you in the last 3 days while you were AFK.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'mentions') return mentionsCmd(interaction);
    return setCmd(interaction);
  },
};

async function setCmd(interaction) {
  const lang = await languageOf(interaction);
  // The default reason is saved and shown to others; "AFK" reads the same in every language.
  const reason = interaction.options.getString('reason') || 'AFK';
  await afkDb.setStatus(interaction.guild.id, interaction.user.id, reason);
  await interaction.reply({ components: [textCard(t(lang, 'utility.afk.set', { emoji: EMOJI.STAR, user: `${interaction.user}`, reason }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function mentionsCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const mentions = await afkDb.listRecentMentions(interaction.guild.id, interaction.user.id);
  if (!mentions.length) {
    await interaction.editReply({ content: t(lang, 'utility.afk.noMentions') });
    return;
  }

  const lines = mentions.map((m) => {
    const ts = `<t:${Math.floor(new Date(m.created_at).getTime() / 1000)}:R>`;
    const text = m.content ? `\n> ${m.content.slice(0, 80)}${m.content.length > 80 ? '…' : ''}` : '';
    return `${t(lang, 'utility.afk.mentionLine', { user: `<@${m.mentioned_by}>`, channel: `<#${m.channel_id}>`, time: ts })}${text}`;
  });

  await interaction.editReply({ content: `${t(lang, 'utility.afk.mentionsTitle', { count: mentions.length })}\n\n${lines.join('\n\n')}` });
}
