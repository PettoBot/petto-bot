const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../db/suggestions');
const { submit, MAX_CONTENT } = require('../../utils/suggestions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');
const { addSubcommands, runWrapped, loadByName, ruleKeysOf } = require('../../utils/umbrella');

const V2 = MessageFlags.IsComponentsV2;
const reply = (interaction, text, color = 0x4b4f59, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });

// What `/suggest` holds besides `send`: the subcommands of `!suggestion` (the setup and the answers of the staff), each running the code of that command.
const STAFF = ['setup', 'enable', 'disable', 'config', 'set', 'approve', 'deny', 'consider', 'implement', 'reopen', 'delete', 'view', 'votes', 'list', 'block', 'unblock', 'panel'];
const SUBCOMMANDS = [
  { name: 'send', wraps: 'suggestion', sub: 'submit' }, // the old `!suggest`: the text of `!suggestion submit`, answered here
  ...STAFF.map((name) => ({ name, wraps: 'suggestion', sub: name })),
];

module.exports = {
  // Also a slash command, with the subcommands of `!suggestion` next to `send`: `/suggest send`, `/suggest approve`, `/suggest setup`.
  registerSlash: true,
  aliases: ['sug'],
  // `!suggest <text>` is `!suggest send <text>`; `!suggest approve 3` is `!suggestion approve 3` (and the rules of both apply). It used to be `/community suggestion ...`.
  prefixDefaultSubcommand: 'send',
  prefixSubcommandAliases: { submit: 'send' },
  prefixWords: Object.fromEntries(STAFF.map((name) => [name, { command: 'suggestion', args: [name] }])),
  rulesViaWords: true,
  rulesBySubcommand: true,
  ruleKeys: { ...ruleKeysOf(SUBCOMMANDS), send: 'suggest' },
  legacyRuleNames: ['community'], // i18n-ignore: a rule key, never shown
  subcommands: SUBCOMMANDS,
  data: addSubcommands(new SlashCommandBuilder().setName('suggest').setDescription('Make a suggestion for this server and manage them. The server votes on it.').setDMPermission(false), SUBCOMMANDS, loadByName),

  async execute(interaction, client) {
    // Everything but `send` is the old `!suggestion`: it asks for what that command asks for and answers as it does.
    const sub = interaction.options.getSubcommand(false);
    if (sub && sub !== 'send' && sub !== 'submit') return runWrapped(interaction, client, 'suggestion');
    const lang = await languageOf(interaction);
    const config = await db.getConfig(interaction.guild.id);
    if (!config.enabled || !config.channel_id) return reply(interaction, `${EMOJI.DENY}  ${t(lang, 'suggestions.error.off')}`, 0xff6b6b, true);
    if (!config.allow_command) return reply(interaction, config.listen_channel ? t(lang, 'suggestions.suggest.byWriting', { emoji: EMOJI.DENY, channel: `<#${config.channel_id}>` }) : t(lang, 'suggestions.suggest.byPanel', { emoji: EMOJI.DENY }), 0xff6b6b, true);
    // A suggestion can take a moment (the message, the thread); a slash command has to answer first.
    if (typeof interaction.deferReply === 'function' && !interaction.deferred && !interaction.replied && interaction.isChatInputCommand?.() && !interaction.rawMessage) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const attachments = interaction.rawMessage ? [...interaction.rawMessage.attachments.values()] : [];
    const result = await submit({ guild: interaction.guild, user: interaction.user, text: interaction.options.getString('text', true), attachments });
    const posted = result.message?.url ? t(lang, 'suggestions.posted.link', { link: result.message.url }) : t(lang, 'suggestions.posted.plain');
    const text = result.error ? `${EMOJI.DENY}  ${result.error}` : `${EMOJI.APPROVE}  ${posted}`;
    const payload = { components: [textCard(text, result.error ? 0xff6b6b : 0xa5ea7a)], flags: V2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
    return interaction.deferred ? interaction.editReply({ components: payload.components, flags: V2 }) : interaction.reply(payload);
  },
};
