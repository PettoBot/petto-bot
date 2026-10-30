const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { pickPromptNumber, plainText, readTruthOrDare } = require('../../utils/funPrompts');
const { pickRandom } = require('../../utils/funGames');
const { noticePayload } = require('../../utils/infoCard');
const { commandRef } = require('../../utils/commandRef');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['tod'],
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('truthordare')
    .setDescription('Get a truth or a dare to play with friends.')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('type').setDescription('truth or dare (random if left out)').setRequired(false).setMaxLength(20)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const typed = (interaction.options.getString('type') ?? '').trim();
    const kind = typed ? readTruthOrDare(typed) : pickRandom(['truth', 'dare']);
    if (!kind) {
      await interaction.reply({ ...noticePayload(t(lang, 'fun.tod.usage', { command: commandRef(interaction, 'truthordare') }), COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const label = t(lang, `fun.tod.${kind}`);
    const name = plainText(interaction.member?.displayName ?? interaction.user.globalName ?? interaction.user.username, 60);
    await interaction.reply({
      content: `🎲 **${label}** · ${name}\n${t(lang, `fun.${kind}.${pickPromptNumber(kind)}`)}`,
      allowedMentions: { parse: [], repliedUser: false },
    });
  },
};
