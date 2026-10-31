// !wiki: finds a page of the wiki (with its picture and the pages next to it) and answers questions about the terms and conditions
// with the exact words of the pages of the website. The search and the downloads are in utils/wikiSearch.js and utils/wikiAnswer.js, the
// cards in utils/wikiCards.js. Turning the command off or restricting it is done by the usual command rules, before this runs.
const { SlashCommandBuilder } = require('discord.js');
const { languageOf } = require('../../i18n');
const guildPrefixes = require('../../utils/guildPrefixes');
const { ensureGuild } = require('../../db/guilds');
const { ack, answer: reply } = require('../../utils/interactionAck');
const logger = require('../../utils/logger');
const { answer, cleanQuery } = require('../../utils/wikiAnswer');
const { cardFor } = require('../../utils/wikiCards');
const { wordsOf } = require('../../utils/wikiSearch');

/** The category of the command that the first word names (`ban` is of `moderation`): it helps to find the page about it. */
function commandHints(client, query) {
  const first = wordsOf(query.split(/\s+/)[0] ?? '')[0];
  if (!first) return [];
  const name = client.commandAliases?.get(first) ?? client.commandRoutes?.get(first)?.command ?? first;
  const category = client.commands?.get(name)?.category;
  return category ? [category] : [];
}

async function prefixOf(interaction) {
  try {
    return guildPrefixes.primaryPrefix(await ensureGuild(interaction.guild.id));
  } catch {
    return '!';
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('wiki')
    .setDescription('Find a page of the Petto wiki or ask about the terms and conditions.')
    .addStringOption((option) => option.setName('query').setDescription('A feature, a command, or a question about the terms').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const query = cleanQuery(interaction.options.getString('query'));
    // Reading pages can take a few seconds: a slash command says an answer is coming (a prefix message has no deadline).
    if (!interaction.fromPrefix) await ack(interaction, { ephemeral: false });
    const prefix = await prefixOf(interaction);
    let result;
    try {
      result = await answer(query, lang, { hints: commandHints(interaction.client, query) });
    } catch (error) {
      logger.warn({ action: 'wiki' }, `The wiki answer failed: ${error.message}`);
      result = { kind: 'error', query };
    }
    await reply(interaction, cardFor(result, { lang, prefix }));
  },
};

