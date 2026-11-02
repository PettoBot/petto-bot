// i18n-ignore-file: Petto team operator command (English).
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isTeam, teamReply } = require('../../utils/teamTools');
const { textCard } = require('../../utils/caseCard');

const CHUNK = 3000;

/**
 * Every team tool, read from the commands themselves: a command that has `team: { summary, usage, who }` is a tool of the team, and a command that has
 * `teamParts: [{ usage, summary, who }]` has parts of it only the team (or the testers) can use. Nothing is written here by hand, so this list cannot go stale:
 * a new tool appears in it as soon as it carries its metadata (scripts/check-guild-blacklist.js asserts that every command flagged `teamOnly` does).
 */
function teamEntries(client) {
  const commands = [...client.commands.values()];
  const tools = commands.filter((command) => command.team).map((command) => ({ name: command.data.name, ...command.team, aliases: command.aliases ?? [] }));
  const parts = commands.filter((command) => Array.isArray(command.teamParts)).flatMap((command) => command.teamParts.map((part) => ({ command: command.data.name, ...part })));
  const byName = (a, b) => (a.name ?? a.command).localeCompare(b.name ?? b.command);
  return { tools: tools.sort(byName), parts: parts.sort(byName) };
}

/** The text of `!team`, in pieces that each fit one message. */
function teamText(client) {
  const { tools, parts } = teamEntries(client);
  const blocks = [`### Petto team tools (${tools.length})`, '-# Only the owner and the developers can use them; for anybody else these words are not commands.'];
  for (const tool of tools) {
    blocks.push(`**\`${tool.name}\`**${tool.aliases.length ? ` (also ${tool.aliases.map((alias) => `\`!${alias}\``).join(', ')})` : ''} · ${tool.who}\n${tool.summary}\n${tool.usage.map((line) => `\`${line}\``).join('\n')}`);
  }
  if (parts.length) {
    blocks.push('### Parts of other commands that are for the team');
    for (const part of parts) blocks.push(`\`${part.usage}\` · ${part.who}\n${part.summary}`);
  }
  const pieces = [];
  let current = '';
  for (const block of blocks) {
    if (current && current.length + block.length + 1 > CHUNK) { pieces.push(current); current = ''; }
    current += `${current ? '\n' : ''}${block}`;
  }
  if (current) pieces.push(current);
  return pieces;
}

/** `!team` (`!teamhelp`): the list of the private tools of the team. Prefix only, hidden everywhere, and nobody outside the team gets an answer. */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  hiddenEverywhere: true,
  teamOnly: true,
  aliases: ['teamhelp'],
  team: { summary: 'Lists every team tool with what it does and how to type it (read from the commands themselves).', usage: ['!team'], who: 'owner and developers' },
  teamEntries,
  teamText,
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Private control: the tools of the Petto team.')
    .setDMPermission(false),

  async execute(interaction) {
    if (!isTeam(interaction.user?.id)) return undefined;
    const pieces = teamText(interaction.client);
    await teamReply(interaction, pieces[0], null);
    for (const piece of pieces.slice(1)) {
      await interaction.followUp?.({ components: [textCard(piece, null)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    }
    return undefined;
  },
};
