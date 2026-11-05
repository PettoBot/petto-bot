const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../../db/confessions');
const { submit, MAX_CONTENT } = require('../../utils/confessions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');
const { sendDm } = require('../../utils/dmOrigin');
const { addSubcommands, runWrapped, loadByName, ruleKeysOf } = require('../../utils/umbrella');

const V2 = MessageFlags.IsComponentsV2;
const reply = (interaction, text, color = 0x4b4f59, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });

// What `/confess` holds besides `send`: the subcommands of `!confession` (the setup and the moderation of the staff), each running the code of that command.
const STAFF = ['setup', 'enable', 'disable', 'config', 'set', 'panel', 'approve', 'reject', 'reveal', 'delete', 'list', 'block', 'unblock'];
const SUBCOMMANDS = [
  {
    name: 'send',
    description: 'Confess something without anyone knowing it was you.',
    rule: 'confess',
    options: [
      { type: 3, name: 'text', description: 'What you want to say (a link to a picture can go inside it)', required: true, max_length: MAX_CONTENT },
      { type: 11, name: 'image', description: 'A picture to go with it (optional)', required: false },
    ],
  },
  ...STAFF.map((name) => ({ name, wraps: 'confession', sub: name })),
];

module.exports = {
  // Also a slash command, with the subcommands of `!confession` next to `send`: `/confess send`, `/confess approve`, `/confess setup`.
  registerSlash: true,
  aliases: ['confession-send'],
  // `!confess <text>` is `!confess send <text>`; `!confess approve 3` is `!confession approve 3` (and the rules of both apply). It used to be `/community confess`.
  prefixDefaultSubcommand: 'send',
  prefixWords: Object.fromEntries(STAFF.map((name) => [name, { command: 'confession', args: [name] }])),
  rulesViaWords: true,
  rulesBySubcommand: true,
  ruleKeys: ruleKeysOf(SUBCOMMANDS),
  legacyRuleNames: ['community'], // i18n-ignore: a rule key, never shown
  subcommands: SUBCOMMANDS,
  data: addSubcommands(new SlashCommandBuilder().setName('confess').setDescription('Confess something without anyone knowing it was you, and set confessions up.').setDMPermission(false), SUBCOMMANDS, loadByName),

  async execute(interaction, client) {
    // Everything but `send` is the old `!confession`: it asks for what that command asks for and answers as it does.
    const sub = interaction.options.getSubcommand(false);
    if (sub && sub !== 'send') return runWrapped(interaction, client, 'confession');
    const lang = await languageOf(interaction);
    const config = await db.getConfig(interaction.guild.id);
    if (!config.enabled || !config.channel_id) return reply(interaction, `${EMOJI.DENY}  ${t(lang, 'confessions.error.off')}`, 0xff6b6b, true);
    if (!config.allow_command) return reply(interaction, t(lang, 'confessions.confess.byPanel', { emoji: EMOJI.DENY }), 0xff6b6b, true);
    // The answer is only for the member, so nobody sees who used the command.
    if (typeof interaction.deferReply === 'function' && !interaction.deferred && !interaction.replied && interaction.isChatInputCommand?.() && !interaction.rawMessage) await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
    const attachments = interaction.rawMessage ? [...interaction.rawMessage.attachments.values()] : [interaction.options.getAttachment?.('image')].filter(Boolean);
    const result = await submit({ guild: interaction.guild, user: interaction.user, text: interaction.options.getString('text', true), attachments });
    // Written with the prefix, the message of the member is in the channel: it goes away so nobody sees who confessed.
    if (interaction.rawMessage?.deletable) await interaction.rawMessage.delete().catch(() => {});
    const done = result.review ? t(lang, 'confessions.sentToStaff') : result.message?.url ? t(lang, 'confessions.posted.link', { link: result.message.url }) : t(lang, 'confessions.posted.plain');
    const text = result.error ? `${EMOJI.DENY}  ${result.error}` : `${EMOJI.APPROVE}  ${done}`;
    if (interaction.rawMessage) {
      // A reply in the channel would show who confessed, so the answer goes to their DMs.
      await sendDm(interaction.user, { components: [textCard(text, result.error ? 0xff6b6b : 0xa5ea7a)], flags: V2 }, { guild: interaction.guild, kind: 'confession' }).catch(() => {});
      return undefined;
    }
    const payload = { components: [textCard(text, result.error ? 0xff6b6b : 0xa5ea7a)], flags: V2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
    return interaction.deferred ? interaction.editReply({ components: payload.components, flags: V2 }) : interaction.reply(payload);
  },
};
