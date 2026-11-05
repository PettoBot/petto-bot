// The lists where members vote for the bot: their names and the pages where they vote.
const config = require('../config');

const LISTS = {
  topgg: { name: 'top.gg' }, // i18n-ignore: the name of a website
  omniplex: { name: 'omniplex.gg' }, // i18n-ignore: the name of a website
};

/** The page where a member votes for the bot on a list. The omniplex path is a guess unless OMNIPLEX_VOTE_URL says otherwise. */
function voteUrl(source, botId) {
  if (source === 'omniplex') return config.omniplexVoteUrl ?? `https://omniplex.gg/bots/${botId}`;
  return `https://top.gg/bot/${botId}/vote`;
}

function listName(source) {
  return LISTS[source]?.name ?? String(source);
}

/** Every list with its name and vote link, in the order they are shown. */
function voteLists(botId) {
  return Object.keys(LISTS).map((source) => ({ source, name: listName(source), url: voteUrl(source, botId) }));
}

module.exports = { voteUrl, listName, voteLists };
