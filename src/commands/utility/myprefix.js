const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const userPrefixes = require('../../db/userPrefixes');
const { userPrefixReasons } = require('../../utils/userPrefixAccess');
const { validateUserPrefix, REASON_TEXT, REQUIREMENTS, MAX_LENGTH } = require('../../utils/userPrefixRules');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const reply = (interaction, text, color = 0x4b4f59) => interaction.reply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
const requirementsText = () => `To have a prefix of your own you need to be one of these:\n${REQUIREMENTS.map((line) => `- ${line}`).join('\n')}`;

module.exports = {
  aliases: ['userprefix', 'selfprefix', 'upfx'],
  prefixDefaultSubcommand: 'show',
  data: new SlashCommandBuilder()
    .setName('myprefix')
    .setDescription('Your own prefix for Petto, in every server (boosters, Premium, partners and the team).')
    .addSubcommand((s) => s.setName('show').setDescription('See your prefix and whether you can have one.'))
    .addSubcommand((s) => s.setName('set').setDescription('Choose your prefix.').addStringOption((o) => o.setName('prefix').setDescription(`Up to ${MAX_LENGTH} characters, with a symbol, for example p! or ,`).setMaxLength(10).setRequired(true)))
    .addSubcommand((s) => s.setName('reset').setDescription('Remove your prefix.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand(false) ?? 'show';
    const userId = interaction.user.id;

    if (sub === 'reset') {
      const removed = await userPrefixes.remove(userId);
      return reply(interaction, removed ? `${EMOJI.APPROVE}  Your prefix was removed. The prefix of each server still works.` : 'You had no prefix of your own.', removed ? 0xa5ea7a : 0x4b4f59);
    }

    const reasons = await userPrefixReasons(interaction.client, userId, { force: true });
    const current = await userPrefixes.get(userId);

    if (sub === 'set') {
      if (!reasons.length) return reply(interaction, `${EMOJI.DENY}  ${requirementsText()}`, 0xfe6465);
      const checked = validateUserPrefix(interaction.options.getString('prefix', true));
      if (checked.error) return reply(interaction, `${EMOJI.WARNING}  ${checked.error}`, 0xfed53c);
      await userPrefixes.set(userId, checked.prefix);
      return reply(interaction, `${EMOJI.APPROVE}  Your prefix is \`${checked.prefix}\` now. It works in every server where Petto is, next to the server's own prefix (try \`${checked.prefix}help\`).`, 0xa5ea7a);
    }

    const lines = [];
    lines.push(current ? `**Your prefix:** \`${current}\`${reasons.length ? '' : ' (not active: you no longer meet a requirement)'}` : '**Your prefix:** none yet');
    lines.push(reasons.length ? `**You can have one** because ${reasons.map((reason) => REASON_TEXT[reason]).join(' and ')}.` : requirementsText());
    if (reasons.length && !current) lines.push('Use `myprefix set <prefix>` to choose it.');
    return reply(interaction, lines.join('\n'));
  },
};
