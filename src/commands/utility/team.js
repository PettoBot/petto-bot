// i18n-ignore-file: Petto team operator command (English).
const { SlashCommandBuilder } = require('discord.js');
const { isTeam, teamReply } = require('../../utils/teamTools');
const { register, buildPage } = require('../../utils/pager');
const { languageOf } = require('../../i18n');
const { isCommonWord } = require('../../utils/commonWords');

/** Tools shown per page of `!team`; each entry is clipped (see `ENTRY_MAX`), so a page stays far below the 4000 characters of a message. */
const PER_PAGE = 5;
const ENTRY_MAX = 560;
const DETAIL_MAX = 3300;

/** The areas the tools are grouped in, in the order they are shown. A tool says its area in `team.area`; one without it goes to `other`. */
const AREAS = [
  ['servers', 'Servers'],
  ['bot', 'Bot status and the team'],
  ['premium', 'Premium'],
  ['moderation', 'Moderation tools'],
  ['switches', 'Quests, rollouts and feeds'],
  ['other', 'Other'],
];
const areaTitle = (area) => (AREAS.find(([key]) => key === area) ?? AREAS.at(-1))[1];
const areaIndex = (area) => { const at = AREAS.findIndex(([key]) => key === area); return at < 0 ? AREAS.length - 1 : at; };

const clip = (text, max) => { const value = String(text ?? ''); return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value; };
const firstSentence = (text) => String(text ?? '').split(/(?<=[.!?])\s+(?=[A-Z`])/)[0];

/** The words of other commands that send their first word to a tool (`!premium grant ...` is `!premiumadmin grant ...`), read from the commands. */
function redirectsTo(client, toolName) {
  const out = [];
  for (const command of client.commands.values()) {
    for (const [word, route] of Object.entries(command.prefixWords ?? {})) {
      if (route?.command === toolName && command.data?.name) out.push({ command: command.data.name, aliases: command.aliases ?? [], word });
    }
  }
  return out;
}

/**
 * Every team tool, read from the commands themselves: a command that has `team: { summary, usage, who, area?, examples?, answers?, dangers? }` is a tool of the team, and a
 * command that has `teamParts: [{ usage, summary, who, area? }]` has parts of it only the team (or the testers) can use. Nothing is written here by hand, so this list cannot go
 * stale: a new tool appears in it as soon as it carries its metadata (scripts/check-guild-blacklist.js asserts that every command flagged `teamOnly` does).
 * `viaPetto`: whether the word also works after the word prefix (`petto blacklist ...`); an everyday word such as `am` does not.
 */
function teamEntries(client) {
  const commands = [...client.commands.values()];
  const tools = commands.filter((command) => command.team).map((command) => {
    const name = command.data.name;
    const aliases = command.aliases ?? [];
    return {
      name, ...command.team, aliases, area: command.team.area ?? 'other', examples: command.team.examples ?? [], ownerOnly: Boolean(command.ownerOnly),
      redirects: redirectsTo(client, name), viaPetto: !isCommonWord(name), aliasesViaPetto: aliases.filter((alias) => !isCommonWord(alias)),
    };
  });
  const parts = commands.filter((command) => Array.isArray(command.teamParts)).flatMap((command) => command.teamParts.map((part) => ({
    command: command.data.name, aliases: command.aliases ?? [], area: part.area ?? 'moderation', viaPetto: !isCommonWord(command.data.name), ...part,
  })));
  const byName = (a, b) => areaIndex(a.area) - areaIndex(b.area) || (a.name ?? a.command).localeCompare(b.name ?? b.command);
  return { tools: tools.sort(byName), parts: parts.sort(byName) };
}

/** The line that says how a tool is reached with the word prefix. */
function pettoLine(entry) {
  const word = entry.name ?? entry.command;
  if (entry.viaPetto) return `\`petto ${word}\` works too`;
  const other = (entry.aliasesViaPetto ?? []).find(Boolean);
  return other ? `\`petto ${other}\` works, \`petto ${word}\` does not (an everyday word): type \`!${word}\`` : `only with the symbol: \`!${word}\` (\`petto ${word}\` is chat)`;
}

/** One entry of the list of `!team`: a tool or a part of another command, short enough that five of them fit one page. */
function entryText(entry, header) {
  const isTool = Boolean(entry.name);
  const word = entry.name ?? entry.command;
  const usage = (isTool ? entry.usage : [entry.usage]).slice(0, 4).map((line) => `\`${line}\``).join(' · ');
  const text = [
    header ? `### ${header}` : null,
    `**\`!${word}\`**${entry.aliases?.length ? ` (also ${entry.aliases.slice(0, 3).map((alias) => `\`!${alias}\``).join(', ')})` : ''} · ${entry.who}${isTool ? '' : ' · part of a command'}`,
    clip(firstSentence(entry.summary), 190),
    clip(usage, 200),
    `-# ${pettoLine(entry)}`,
  ].filter(Boolean).join('\n');
  return clip(text, ENTRY_MAX);
}

/** The entries of the list in order, with the title of an area before its first entry, as the texts of the pages: `teamItems(client)[n]` is one entry. */
function teamItems(client) {
  const { tools, parts } = teamEntries(client);
  const all = [...tools, ...parts].sort((a, b) => areaIndex(a.area) - areaIndex(b.area) || Number(Boolean(b.name)) - Number(Boolean(a.name)) || (a.name ?? a.command).localeCompare(b.name ?? b.command));
  let last = null;
  return all.map((entry) => { const header = entry.area !== last ? areaTitle(entry.area) : null; last = entry.area; return entryText(entry, header); });
}

/** The whole text of `!team` in pieces (every page of the list), for the tests and for anything that needs the text and not the card. */
function teamText(client) {
  const { tools } = teamEntries(client);
  const items = teamItems(client);
  const pieces = [];
  for (let at = 0; at < items.length; at += PER_PAGE) pieces.push(items.slice(at, at + PER_PAGE).join('\n'));
  return [`### Petto team tools (${tools.length})\nNone of these is a slash command.`, ...pieces];
}

/** The tool (or the parts of a command) a typed word means: its name, its alias, or a command that sends its first word to a tool (`premium`). */
function findEntry(client, query) {
  const word = String(query ?? '').toLowerCase().replace(/^petto\s+/, '').replace(/^[^a-z0-9]+/, '').split(/\s+/)[0];
  if (!word) return null;
  const { tools, parts } = teamEntries(client);
  const tool = tools.find((entry) => entry.name === word || entry.aliases.includes(word))
    ?? tools.find((entry) => entry.redirects.some((route) => route.command === word || route.aliases.includes(word)));
  if (tool) return { tool };
  const partsOf = parts.filter((part) => part.command === word || part.aliases.includes(word));
  return partsOf.length ? { parts: partsOf } : null;
}

/** The card of one tool: usage, examples, what it answers, dangers, who, its words and whether it is a slash command (it never is). */
function detailText(entry) {
  if (entry.parts) {
    const first = entry.parts[0];
    return clip([
      `### Team parts of \`!${first.command}\``,
      '-# Not a tool of its own: the rest of this command is for everybody. None of these is a slash command (it is not in the `/` menu).',
      ...entry.parts.map((part) => `**\`${part.usage}\`** · ${part.who}\n${part.summary}`),
      `Typed with the prefix${first.aliases.length ? ` (also ${first.aliases.map((alias) => `\`!${alias}\``).join(', ')})` : ''}; ${pettoLine(first)}.`,
    ].join('\n'), DETAIL_MAX);
  }
  const tool = entry.tool;
  const lines = [
    `### \`!${tool.name}\``,
    tool.summary,
    '',
    `**Usage**\n${tool.usage.map((line) => `\`${line}\``).join('\n')}`,
    tool.examples.length ? `**Examples**\n${tool.examples.map((line) => `\`${line}\``).join('\n')}` : null,
    tool.answers ? `**It answers**\n${tool.answers}` : null,
    tool.dangers ? `**Careful**\n${tool.dangers}` : null,
    `**Who can use it**\n${tool.who}. For everybody else it is not a command at all: no reply, no typing, no suggestion.${tool.ownerOnly ? ' A developer who is not the owner gets no answer either.' : ''}`,
    `**Its words**\n\`!${tool.name}\`${tool.aliases.length ? `, ${tool.aliases.map((alias) => `\`!${alias}\``).join(', ')}` : ''}${tool.redirects.length ? `, and the old way \`!${tool.redirects[0].command} ${tool.redirects.map((route) => route.word).join('|')}\`` : ''} · ${pettoLine(tool)}`,
    '**Slash command**\nNo: it is not in the `/` menu of any server.',
  ];
  return clip(lines.filter((line) => line !== null).join('\n'), DETAIL_MAX);
}

let activeClient = null;
register('team', {
  perPage: PER_PAGE,
  accent: null,
  async load(guild) {
    const client = guild?.client ?? activeClient;
    const items = teamItems(client);
    return {
      title: `Petto team tools (${teamEntries(client).tools.length})`,
      subtitle: ['None of these is a slash command: nobody sees them in the `/` menu, and for anybody outside the team these words are not commands at all.', '-# `!team <command>` shows one tool in detail.'],
      items,
    };
  },
});

/** `!team` (`!teamhelp`): the private tools of the team by area, or one tool in detail with `!team <command>`. Prefix only, hidden everywhere, and nobody outside the team gets an answer. */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  hiddenEverywhere: true,
  teamOnly: true,
  aliases: ['teamhelp'],
  prefixRawOptions: { _: (text) => ({ command: String(text ?? '') }) },
  team: {
    summary: 'Lists every team tool by area with what it does and how to type it (read from the commands themselves), or one tool in detail: `!team <command>`.',
    usage: ['!team', '!team <command>'],
    who: 'owner and developers',
    area: 'bot',
    examples: ['!team', '!team blacklist', '!team premiumadmin'],
    answers: 'a card with the tools grouped by area (turn the pages with the buttons, only you can press them), or the details of one tool',
  },
  teamEntries,
  teamItems,
  teamText,
  findEntry,
  detailText,
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Private control: the tools of the Petto team.')
    .setDMPermission(false)
    .addStringOption((option) => option.setName('command').setDescription('A team tool to see in detail').setRequired(false)),

  async execute(interaction) {
    if (!isTeam(interaction.user?.id)) return undefined;
    activeClient = interaction.client;
    const wanted = String(interaction.options?.getString?.('command') ?? '').trim();
    if (wanted) {
      const found = findEntry(interaction.client, wanted);
      return teamReply(interaction, found ? detailText(found) : `No team tool is called **${wanted.replace(/[`\r\n@]/g, '').slice(0, 40)}**. \`!team\` lists them.`, null);
    }
    const lang = await languageOf(interaction);
    const payload = await buildPage('team', { guild: interaction.guild, userId: interaction.user.id, lang });
    return interaction.reply({ ...payload, allowedMentions: { parse: [] } });
  },
};
