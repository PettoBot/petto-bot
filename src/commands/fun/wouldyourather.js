const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { parseChoices } = require('../../utils/funGames');
const { pickPromptNumber, plainText, readTwoOptions } = require('../../utils/funPrompts');
const { noticePayload } = require('../../utils/infoCard');
const { commandRef } = require('../../utils/commandRef');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { t, languageOf } = require('../../i18n');

const MAX_OPTION = 150;
const VOTES = ['🅰️', '🅱️'];

module.exports = {
  aliases: ['wyr'],
  cooldownMs: 3_000,
  data: new SlashCommandBuilder()
    .setName('wouldyourather')
    .setDescription('Get a would you rather question, or write your own two options.')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('options').setDescription('Your two options, separated by a comma').setRequired(false).setMaxLength(2 * MAX_OPTION + 10)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const typed = (interaction.options.getString('options') ?? '').trim();
    let first;
    let second;
    if (typed) {
      const options = readTwoOptions([...new Set(parseChoices(typed))]);
      const notice = (key, vars) => interaction.reply({ ...noticePayload(t(lang, key, vars), COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [], repliedUser: false } });
      if (!options) return notice('fun.wyr.invalid', { command: commandRef(interaction, 'wouldyourather') });
      if (options.some((option) => option.length > MAX_OPTION)) return notice('fun.wyr.tooLong', { max: MAX_OPTION });
      [first, second] = options.map((option) => plainText(option, MAX_OPTION));
    } else {
      const number = pickPromptNumber('wyr');
      first = t(lang, `fun.wyr.${number}.a`);
      second = t(lang, `fun.wyr.${number}.b`);
    }
    await interaction.reply({
      content: `**${t(lang, 'fun.wyr.title')}**\n${VOTES[0]} ${first}\n${VOTES[1]} ${second}`,
      allowedMentions: { parse: [], repliedUser: false },
    });
    // The two reactions are the vote. Without the permission the question is still there.
    const sent = await interaction.fetchReply?.().catch(() => null);
    if (sent?.react) {
      try {
        await sent.react(VOTES[0]);
        await sent.react(VOTES[1]);
      } catch (err) {
        logger.warn(`Could not add the vote reactions of wouldyourather: ${err.message}`);
      }
    }
    return null;
  },
};
