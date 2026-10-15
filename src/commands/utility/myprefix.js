const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const userPrefixes = require('../../db/userPrefixes');
const { userPrefixReasons } = require('../../utils/userPrefixAccess');
const { validateUserPrefix, reasonText, requirementLines, MAX_LENGTH } = require('../../utils/userPrefixRules');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const reply = (interaction, text, color = 0x4b4f59) => interaction.reply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
const requirementsText = (lang) => t(lang, 'utility.myprefix.requirements', { list: requirementLines(lang).map((line) => `- ${line}`).join('\n') });

module.exports = {
  aliases: ['userprefix', 'selfprefix', 'upfx'],
  prefixDefaultSubcommand: 'show',
  data: new SlashCommandBuilder()
    .setName('myprefix')
    .setDescription('Your own prefix. Get it by boosting the support server, with Premium, as a partner or in the team.')
    .addSubcommand((s) => s.setName('show').setDescription('See your prefix, and how to get one if you cannot have it yet.'))
    // i18n-ignore: builder description (translated in the cmd.utility catalog)
    .addSubcommand((s) => s.setName('set').setDescription('Choose your prefix.').addStringOption((o) => o.setName('prefix').setDescription(`Up to ${MAX_LENGTH} characters, with a symbol, for example p! or ,`).setMaxLength(10).setRequired(true)))
    .addSubcommand((s) => s.setName('reset').setDescription('Remove your prefix.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand(false) ?? 'show';
    const userId = interaction.user.id;

    if (sub === 'reset') {
      const removed = await userPrefixes.remove(userId);
      return reply(interaction, removed ? t(lang, 'utility.myprefix.removed', { emoji: EMOJI.APPROVE }) : t(lang, 'utility.myprefix.hadNone'), removed ? 0xa5ea7a : 0x4b4f59);
    }

    const reasons = await userPrefixReasons(interaction.client, userId, { force: true });
    const current = await userPrefixes.get(userId);

    if (sub === 'set') {
      if (!reasons.length) return reply(interaction, `${EMOJI.DENY}  ${requirementsText(lang)}`, 0xfe6465);
      const checked = validateUserPrefix(interaction.options.getString('prefix', true), lang);
      if (checked.error) return reply(interaction, `${EMOJI.WARNING}  ${checked.error}`, 0xfed53c);
      await userPrefixes.set(userId, checked.prefix);
      return reply(interaction, t(lang, 'utility.myprefix.set', { emoji: EMOJI.APPROVE, prefix: checked.prefix }), 0xa5ea7a);
    }

    const lines = [];
    if (!current) lines.push(t(lang, 'utility.myprefix.currentNone'));
    else lines.push(t(lang, reasons.length ? 'utility.myprefix.current' : 'utility.myprefix.currentInactive', { prefix: current }));
    lines.push(reasons.length ? t(lang, 'utility.myprefix.canHave', { reasons: reasons.map((reason) => reasonText(reason, lang)).join(` ${t(lang, 'common.and')} `) }) : requirementsText(lang));
    if (reasons.length && !current) lines.push(t(lang, 'utility.myprefix.howToSet'));
    return reply(interaction, lines.join('\n'));
  },
};
