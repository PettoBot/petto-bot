// `!variables` (alias `!vars`): where to find every variable and option. The words in braces of a message (`{user}`) have their list in `!embed vars` and the dashboard; the options of the
// commands (`--color`, `--duration 7d`) were only known by who wrote them, so this answers them: `!variables <command>` lists the options of a command from its own builder (in the language of
// the server), `!variables <option>` says where an option is used, and `!variables flags` lists the ones that are written only in the text (utils/commandFlags.ts).
// A slash command too (`/variables`), asked by the maintainer; the options it explains are written with the prefix (`!role all @Role --preview`), so its examples always use one. Written in TypeScript: `npm run build:ts` compiles it over src/commands/info/variables.js, which is what the bot loads.
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, ContainerBuilder } from 'discord.js';
import { SPECIAL_FLAGS, flagsFor, flagsNamed, isListed, normalizeName } from '../../utils/commandFlags';
import type { ListableCommand, SpecialFlag } from '../../utils/commandFlags';

interface LoadedCommand extends ListableCommand {
  data?: { name: string; toJSON(): OptionNode };
  category?: string;
}
interface OptionNode { name: string; description?: string; type?: number; required?: boolean; choices?: { name: string; value: string | number }[]; options?: OptionNode[] }
interface Catalog {
  t(lang: string, key: string, vars?: Record<string, unknown>): string;
  languageOf(interaction: unknown): Promise<string>;
  commandDescription(lang: string, command: LoadedCommand, path?: string[], option?: string | null, fallback?: string): string;
}

const { t, languageOf, commandDescription } = require('../../i18n') as Catalog;
const { textCard } = require('../../utils/caseCard') as { textCard: (text: string, color?: number | null) => ContainerBuilder };
const { EMOJI } = require('../../utils/emojis') as { EMOJI: Record<string, string> };

const SUBCOMMAND = 1;
const SUBGROUP = 2;
/** Names of the kinds of values, by the number Discord gives them. */
const TYPE_NAMES: Record<number, string> = { 3: 'string', 4: 'integer', 5: 'boolean', 6: 'user', 7: 'channel', 8: 'role', 9: 'mentionable', 10: 'number', 11: 'attachment' };
/** Lines of a list before it says "and N more": a message has a limit, and nobody reads more. */
const MAX_LINES = 14;
/** The parts of a command that has many (`role` has 35): more fit in a message than options, because each line is short. */
const MAX_PARTS = 30;
const MAX_TEXT = 3600;
const WIKI = 'https://wiki.petto.sbs';

const isPublic = (command: LoadedCommand): boolean => isListed(command);
const isBranch = (node: OptionNode): boolean => node.type === SUBCOMMAND || node.type === SUBGROUP;
const wikiPath = (lang: string): string => (lang === 'es' ? '/es' : lang === 'pt-BR' ? '/pt-br' : '');
const shorten = (text: string): string => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1).trimEnd()}…` : text);

/** The command a word names: its name or one of its aliases. */
function findCommand(client: { commands: Map<string, LoadedCommand>; commandAliases: Map<string, string> }, word: string): LoadedCommand | null {
  const key = word.toLowerCase();
  const command = client.commands.get(key) ?? client.commands.get(client.commandAliases.get(key) ?? '');
  return command && isPublic(command) ? command : null;
}

/** The node a list of words reaches inside a command, with the words that matched (`role all` is the subcommand `all`); the rest of the words are ignored. */
function walk(root: OptionNode, words: string[]): { node: OptionNode; path: string[] } {
  let node = root;
  const path: string[] = [];
  for (const word of words) {
    const next = (node.options ?? []).find((option) => isBranch(option) && normalizeName(option.name) === normalizeName(word));
    if (!next) break;
    node = next;
    path.push(next.name);
  }
  return { node, path };
}

/** Every leaf (a command or subcommand that takes the options) under a node, with the words that lead to it. */
function leavesOf(node: OptionNode, path: string[] = []): { path: string[]; node: OptionNode }[] {
  const branches = (node.options ?? []).filter(isBranch);
  if (!branches.length) return [{ path, node }];
  return branches.flatMap((branch) => leavesOf(branch, [...path, branch.name]));
}

export = {
  // A slash command of its own, and the prefix works as well (`!variables`, `!vars`).
  registerSlash: true,
  aliases: ['vars'],
  data: new SlashCommandBuilder()
    .setName('variables')
    .setDescription('Find the options of any command (--color, --duration 7d) and the variables of messages.')
    .setDMPermission(false)
    .addStringOption((option) => option.setName('query').setDescription('A command (quote, role all), an option (color, duration) or flags').setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = await languageOf(interaction);
    const typed = (interaction as unknown as { typedPrefix?: string }).typedPrefix;
    // How the command is called back (`/variables quote` or `!variables quote`), and the prefix of the examples: the options (`--name value`) are only written with a prefix.
    const self = String(typed ?? '/');
    const prefix = String(typed ?? '!');
    const client = interaction.client as unknown as { commands: Map<string, LoadedCommand>; commandAliases: Map<string, string> };
    const say = (text: string): Promise<unknown> => interaction.reply({ components: [textCard(shorten(text))], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    const vars = { prefix: self, url: `${WIKI}${wikiPath(lang)}/resources/scripting/variables` };
    const query = (interaction.options.getString('query') ?? '').trim();

    if (!query) { await say(t(lang, 'variables.overview', vars)); return; }
    const words = query.split(/\s+/);
    const first = normalizeName(words[0] ?? '');

    if (['flags', 'text', 'texto', 'banderas'].includes(first) && words.length === 1) { await say(flagsText(lang, prefix, self)); return; }
    if (['messages', 'message', 'embed', 'embeds', 'mensajes', 'mensagens'].includes(first) && words.length === 1) { await say(t(lang, 'variables.messages', vars)); return; }

    // A command (and the words after it that lead to one of its subcommands).
    const command = findCommand(client, words[0] ?? '');
    if (command?.data) {
      const { node, path } = walk(command.data.toJSON(), words.slice(1));
      await say(commandText(lang, prefix, self, command, node, path));
      return;
    }

    // The name of an option: where it is used.
    const wanted = normalizeName(query);
    const used: { path: string[]; command: LoadedCommand; option: OptionNode; leaf: OptionNode }[] = [];
    for (const each of client.commands.values()) {
      if (!isPublic(each) || !each.data) continue;
      const root = each.data.toJSON();
      for (const leaf of leavesOf(root, [root.name])) {
        const option = (leaf.node.options ?? []).find((candidate) => !isBranch(candidate) && normalizeName(candidate.name) === wanted);
        if (option) used.push({ path: leaf.path, command: each, option, leaf: leaf.node });
      }
    }
    const special = flagsNamed(query);
    if (used.length || special.length) { await say(optionText(lang, prefix, self, wanted, used, special)); return; }

    // Nothing: a few commands that start the same way, or how to look.
    const near = [...client.commands.values()].filter((each) => isPublic(each) && each.data && each.data.name.startsWith(words[0]?.toLowerCase() ?? '')).slice(0, 5).map((each) => `\`${self}variables ${each.data?.name}\``);
    await say([t(lang, 'variables.notFound', { emoji: EMOJI.DENY, query: query.slice(0, 60), prefix: self }), ...(near.length ? [t(lang, 'variables.didYouMean', { list: near.join(', ') })] : [])].join('\n'));
  },
};

/** One flag as a line: its names, how it is written, what it does and an example. */
function flagLine(lang: string, prefix: string, entry: SpecialFlag): string {
  const names = entry.flags.map((name) => `\`${name}\``).join(' / ');
  const takes = entry.takes === 'word' ? ` ${t(lang, 'variables.takesValue')}` : '';
  return `${names}${takes} — ${t(lang, `variables.flag.${entry.id}`)} \`${prefix}${entry.example}\``;
}

/** `!variables flags`: the options that are only written in the text, by command. */
function flagsText(lang: string, prefix: string, self: string): string {
  const byCommand = new Map<string, SpecialFlag[]>();
  for (const entry of SPECIAL_FLAGS) byCommand.set(entry.command, [...(byCommand.get(entry.command) ?? []), entry]);
  const blocks = [...byCommand.entries()].map(([name, entries]) => [`**${prefix}${name}**`, ...entries.map((entry) => flagLine(lang, prefix, entry))].join('\n'));
  return [t(lang, 'variables.flags.intro', { prefix: self }), '', ...blocks.flatMap((block) => [block, '']), t(lang, 'variables.footer', { prefix: self })].join('\n');
}

/** The options of a command or of the subcommand that its words reach. */
function commandText(lang: string, prefix: string, self: string, command: LoadedCommand, node: OptionNode, path: string[]): string {
  const name = command.data?.name ?? '';
  const shown = [name, ...path].join(' ');
  const description = commandDescription(lang, command, path, null, node.description ?? '');
  const heading = `**${prefix}${shown}**${description ? ` — ${description}` : ''}`;
  const branches = (node.options ?? []).filter(isBranch);
  const extra = (path.length ? flagsFor(name, path) : SPECIAL_FLAGS.filter((entry) => entry.command === name)).map((entry) => flagLine(lang, prefix, entry));
  if (branches.length) {
    // The commands inside, to ask for one of them.
    const all = leavesOf(node, path);
    const leaves = all.slice(0, MAX_PARTS);
    const total = all.length;
    const lines = leaves.map((leaf) => `\`${self}variables ${[name, ...leaf.path].join(' ')}\` — ${commandDescription(lang, command, leaf.path, null, leaf.node.description ?? '')}`);
    return [heading, '', t(lang, 'variables.command.parts'), ...lines, ...(total > leaves.length ? [t(lang, 'variables.more', { count: total - leaves.length })] : []), ...(extra.length ? ['', t(lang, 'variables.command.flags'), ...extra] : [])].join('\n');
  }
  const options = (node.options ?? []).filter((option) => !isBranch(option));
  const lines = options.map((option) => {
    const kind = t(lang, `variables.type.${TYPE_NAMES[option.type ?? 3] ?? 'string'}`);
    const required = option.required ? ` · ${t(lang, 'variables.required')}` : '';
    const choices = option.choices?.length ? ` (${option.choices.map((choice) => `\`${choice.value}\``).join(', ')})` : '';
    const text = commandDescription(lang, command, path, option.name, option.description ?? '');
    return `\`--${option.name}\` (${kind}${required}) — ${text}${choices}`;
  });
  return [
    heading,
    '',
    ...(lines.length ? lines.slice(0, MAX_LINES) : [t(lang, 'variables.command.none', { path: `${prefix}${shown}` })]),
    ...(lines.length > MAX_LINES ? [t(lang, 'variables.more', { count: lines.length - MAX_LINES })] : []),
    ...(extra.length ? ['', t(lang, 'variables.command.flags'), ...extra] : []),
    '',
    t(lang, 'variables.footer', { prefix: self }),
  ].join('\n');
}

/** Where an option is used (`!variables duration`): the commands that have it, and the flags that are written in the text with that name. */
function optionText(lang: string, prefix: string, self: string, name: string, used: { path: string[]; command: LoadedCommand; option: OptionNode }[], special: SpecialFlag[]): string {
  const kinds = new Set(used.map((entry) => entry.option.type ?? 3));
  const kindText = kinds.size === 1 ? ` (${t(lang, `variables.type.${TYPE_NAMES[[...kinds][0] ?? 3] ?? 'string'}`)})` : '';
  const lines = used.slice(0, MAX_LINES).map((entry) => `\`${prefix}${entry.path.join(' ')} --${entry.option.name}\` — ${commandDescription(lang, entry.command, entry.path.slice(1), entry.option.name, entry.option.description ?? '')}`);
  return [
    t(lang, 'variables.option.title', { name, kind: kindText }),
    ...(special.length ? ['', t(lang, 'variables.command.flags'), ...special.map((entry) => flagLine(lang, prefix, entry))] : []),
    ...(lines.length ? ['', t(lang, 'variables.option.used', { count: used.length }), ...lines] : []),
    ...(used.length > MAX_LINES ? [t(lang, 'variables.more', { count: used.length - MAX_LINES })] : []),
    '',
    t(lang, 'variables.footer', { prefix: self }),
  ].join('\n');
}
