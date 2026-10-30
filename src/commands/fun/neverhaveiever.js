const { SlashCommandBuilder } = require('discord.js');
const { pickPromptNumber } = require('../../utils/funPrompts');
const logger = require('../../utils/logger');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['nhie'],
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('neverhaveiever')
    .setDescription('Get a never have I ever statement for the channel.')
    .setDMPermission(false),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const number = pickPromptNumber('nhie');
    await interaction.reply({
      content: `**${t(lang, 'fun.nhie.title')}**\n${t(lang, `fun.nhie.${number}`)}\n-# ${t(lang, 'fun.nhie.hint')}`,
      allowedMentions: { parse: [], repliedUser: false },
    });
    const sent = await interaction.fetchReply?.().catch(() => null);
    if (sent?.react) {
      try {
        await sent.react('✅');
        await sent.react('❌');
      } catch (err) {
        logger.warn(`Could not add the reactions of neverhaveiever: ${err.message}`);
      }
    }
  },
};
