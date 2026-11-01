// /ai: the AI that answers questions, as two subcommands of one command (an umbrella with no old command behind it: both run code of their own).
//   /ai ask question:...   `!ask <question>`, `petto ask <question>`, `@Petto ask <question>` and the prefix of the server: it answers as a reply to the
//                          message (nobody is pinged). A reply to one of its answers, written by the member who asked it, is the next question of the
//                          conversation, with no command word (events/messageCreateCommands.js reads it).
//   /ai usage              how many questions the member has left today and when they come back (Premium and the team have no limit).
// The limits, the prompt and the cleaning are in utils/askAi.js; the count of the day is db/askUsage.js.
//
// PERMISSIONS: both are for every member (no permission), in servers only. The rules of a server apply as to any command: `!disablecommand ask`
// (also by channel), `!restrictcommand ask` and a permission level for `ask` reach `/ai ask`, `!ask`, `!ai ask` and the follow-up of a conversation;
// `ai` turns off both. `usage` is `askusage` for the rules.
//
// `ai` is also an everyday word (`petto ai is cool`), so a word prefix such as `petto` never starts it (`petto ask ...` does: `ask` is its own route).
const { ApplicationCommandOptionType, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { addSubcommands, ruleKeysOf } = require('../../utils/umbrella');
const askAi = require('../../utils/askAi');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

/** The text typed after the command, whole (line breaks and quotes included): `!ask what is "x"?` is the question `what is "x"?`; nothing typed is no question. */
const rawQuestion = (text) => (String(text ?? '').trim() ? { question: String(text).trim() } : {});

const NO_PINGS = Object.freeze({ parse: [], repliedUser: false });

/**
 * A private answer (a refusal, the count). On the slash command it is ephemeral, and when the command was already deferred (the thinking message is
 * public) that message is removed and the answer goes as a private follow-up; with the prefix it is a reply to the message.
 */
async function tell(interaction, content, { deferred = false } = {}) {
  const payload = { content, allowedMentions: NO_PINGS };
  if (interaction.fromPrefix) return interaction.reply(payload);
  if (deferred) {
    await interaction.deleteReply().catch(() => {});
    return interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

const resetOf = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

/** What each way a question can end (other than an answer) says. */
function refusal(lang, result) {
  switch (result.status) {
    case 'disabled': return t(lang, 'utility.ask.off');
    case 'not_configured': return t(lang, 'utility.ask.unavailable');
    case 'cooldown': return t(lang, 'utility.ask.cooldown', { seconds: result.seconds });
    case 'limit': return t(lang, 'utility.ask.limit', { limit: result.limit, reset: resetOf(result.resetAt) });
    case 'busy': return t(lang, 'utility.ask.busy');
    case 'db': return t(lang, 'utility.ask.db');
    default: return t(lang, 'utility.ask.failed');
  }
}

async function runAsk(interaction) {
  const lang = await languageOf(interaction);
  const fromPrefix = Boolean(interaction.fromPrefix);
  const question = askAi.cleanQuestion(interaction.options.getString('question', true));
  if (!askAi.isEnabled()) return tell(interaction, t(lang, 'utility.ask.off'));
  if (!askAi.isConfigured()) return tell(interaction, t(lang, 'utility.ask.unavailable'));
  // i18n-ignore: the name of the command
  if (!question) return tell(interaction, t(lang, 'utility.ask.empty', { command: `${interaction.typedPrefix ?? '/'}ask` }));
  if (question.length > askAi.MAX_QUESTION) return tell(interaction, t(lang, 'utility.ask.tooLong', { max: askAi.MAX_QUESTION }));

  // The slash command shows "thinking" (public) while the model works; with the prefix the channel shows that the bot is typing.
  if (!fromPrefix) await interaction.deferReply();
  const stopTyping = fromPrefix ? askAi.keepTyping(interaction.channel) : () => {};
  let result;
  try {
    const history = fromPrefix && interaction.rawMessage ? await askAi.historyFor(interaction.rawMessage) : [];
    result = await askAi.ask({ userId: interaction.user.id, guildId: interaction.guildId, question, history, lang });
  } finally {
    stopTyping();
  }
  if (result.status !== 'ok') return tell(interaction, refusal(lang, result), { deferred: !fromPrefix });

  let sent;
  try {
    sent = await interaction.editReply({ content: askAi.composeAnswer(result.text, { lang, remaining: result.remaining }), allowedMentions: NO_PINGS });
  } catch (error) {
    await result.refund(); // nobody got the answer: the question is not counted
    throw error;
  }
  if (fromPrefix) askAi.rememberAnswer(sent?.id, interaction.user.id);
  return sent;
}

async function runUsage(interaction) {
  const lang = await languageOf(interaction);
  let info;
  try {
    info = await askAi.remainingToday(interaction.user.id);
  } catch (error) {
    logger.warn(`[${askAi.TAG}] the questions of today could not be read (${error?.code ?? 'error'})`);
    return tell(interaction, t(lang, 'utility.ask.db'));
  }
  if (info.unlimited) return tell(interaction, t(lang, 'utility.ask.usage.unlimited'));
  if (info.left <= 0) return tell(interaction, t(lang, 'utility.ask.usage.none', { limit: info.limit, reset: resetOf(info.resetAt) }));
  return tell(interaction, tn(lang, 'utility.ask.usage.left', info.left, { limit: info.limit, reset: resetOf(info.resetAt) }));
}

const SUBCOMMANDS = [
  {
    name: 'ask',
    description: 'Ask the AI a question. It answers in the chat.',
    rule: 'ask',
    options: [{ type: ApplicationCommandOptionType.String, name: 'question', description: 'What you want to know', required: true, max_length: askAi.MAX_QUESTION }],
    run: runAsk,
  },
  { name: 'usage', description: 'See how many questions you have left today.', rule: 'askusage', run: runUsage },
];

module.exports = {
  // Also registered as a slash command; the prefix works too.
  registerSlash: true,
  umbrella: true,
  // `!ai` alone lists the subcommands.
  listSubcommandsWhenEmpty: true,
  // The words that stand for a subcommand (`!ai question ...`, `!ai left`).
  prefixSubcommandAliases: { question: 'ask', limit: 'usage', left: 'usage', remaining: 'usage' }, // i18n-ignore: command words
  // The question is read whole (line breaks and quotes kept), not word by word.
  prefixRawOptions: { ask: rawQuestion },
  // The rules of a server name `ask` or `askusage`; `ai` turns off both.
  rulesBySubcommand: true,
  ruleKeys: ruleKeysOf(SUBCOMMANDS),
  // Both subcommands are for everybody: nothing is asked of the member (what `!help ai ask` says is needed).
  permissionForSubcommand: () => null,
  data: addSubcommands(
    new SlashCommandBuilder().setName('ai').setDMPermission(false).setDescription('Ask the AI questions, with a daily limit for each member.'),
    SUBCOMMANDS,
    () => null,
  ),

  // The subcommands (read by the tests and by scripts/i18n-commands.js for the translations).
  subcommands: SUBCOMMANDS,
  async execute(interaction, client) {
    const own = SUBCOMMANDS.find((entry) => entry.name === interaction.options.getSubcommand());
    if (!own) throw new Error(`Unknown subcommand ${interaction.options.getSubcommand()}`); // i18n-ignore: internal error
    return own.run(interaction, client);
  },
};
