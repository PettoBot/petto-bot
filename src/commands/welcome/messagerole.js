const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { rulesOf, addRule, removeRule, MAX_RULES, MAX_MESSAGES, MAX_PERIOD_DAYS } = require('../../utils/messageRoles');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

module.exports = {
  // Its own slash command (`/messagerole`): the `/role` command has no room for another group (Discord allows 25 subcommands or groups in a command).
  registerSlash: true,
  // Registered in each server (the second set of commands): the 100 global slots of Discord are nearly used (scripts/check-slash-structure.js).
  guildScoped: true,
  aliases: ['msgrole', 'messagerr'],
  data: new SlashCommandBuilder()
    .setName('messagerole')
    .setDescription('Roles given to members when they reach a number of messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Give a role to members when they reach a number of messages.')
        .addRoleOption((o) => o.setName('role').setDescription('Role to give').setRequired(true))
        .addIntegerOption((o) => o.setName('messages').setDescription('Number of messages').setMinValue(1).setMaxValue(MAX_MESSAGES).setRequired(true))
        .addIntegerOption((o) => o.setName('period_days').setDescription('Count only the messages of the last days (default: all of them, since the first rule)').setMinValue(1).setMaxValue(MAX_PERIOD_DAYS).setRequired(false))
        .addBooleanOption((o) => o.setName('remove_below').setDescription('With a period: take the role away when the member falls under the number').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Stop giving a role by messages.')
        .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true))
        .addIntegerOption((o) => o.setName('messages').setDescription('Only the rule with this number of messages (default: every rule of the role)').setMinValue(1).setMaxValue(MAX_MESSAGES).setRequired(false)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List the roles given by messages.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    return listCmd(interaction);
  },
};

const ruleText = (lang, rule) => t(lang, rule.mode === 'period' ? (rule.removeBelow ? 'messageroles.rule.periodRemove' : 'messageroles.rule.period') : 'messageroles.rule.total', { messages: rule.messages, days: rule.periodDays });

async function addCmd(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const messages = interaction.options.getInteger('messages', true);
  const periodDays = interaction.options.getInteger('period_days');
  const removeBelow = interaction.options.getBoolean('remove_below') ?? false;
  const me = interaction.guild.members.me;
  if (role.managed || role.id === interaction.guild.id) { await interaction.reply({ content: t(lang, 'messageroles.managed', { role: `${role}` }), flags: MessageFlags.Ephemeral }); return; }
  if (me && role.position >= me.roles.highest.position) { await interaction.reply({ content: t(lang, 'messageroles.aboveMe', { role: `${role}` }), flags: MessageFlags.Ephemeral }); return; }
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const result = await addRule(interaction.guild.id, { roleId: role.id, messages, mode: periodDays ? 'period' : 'total', periodDays, removeBelow });
  if (!result.ok) {
    await interaction.editReply({ components: [textCard(t(lang, `messageroles.problem.${result.reason}`, { max: MAX_RULES, maxMessages: MAX_MESSAGES, maxDays: MAX_PERIOD_DAYS }), 0)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const text = [t(lang, 'messageroles.added', { emoji: EMOJI.APPROVE, role: `${role}`, rule: ruleText(lang, result.rule) }), t(lang, 'messageroles.countsFromNow')].join('\n');
  await interaction.editReply({ components: [textCard(text)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function removeCmd(interaction) {
  const lang = await languageOf(interaction);
  const role = interaction.options.getRole('role', true);
  const messages = interaction.options.getInteger('messages');
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await removeRule(interaction.guild.id, role.id, messages);
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'messageroles.removed', { emoji: EMOJI.APPROVE, role: `${role}`, count: removed }) : t(lang, 'messageroles.notFound', { role: `${role}` }))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rules = await rulesOf(interaction.guild.id);
  if (!rules.length) { await interaction.editReply({ components: [textCard(t(lang, 'messageroles.empty'))], flags: MessageFlags.IsComponentsV2 }); return; }
  const lines = rules.map((r) => t(lang, 'messageroles.line', { role: `<@&${r.roleId}>`, rule: ruleText(lang, r), off: r.enabled ? '' : ` · ${t(lang, 'messageroles.off')}` }));
  await interaction.editReply({ components: [textCard([t(lang, 'messageroles.listTitle', { count: rules.length, max: MAX_RULES }), ...lines].join('\n').slice(0, 3900))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}
