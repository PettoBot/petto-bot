// The card Petto answers with when a prefix command is typed wrong: a subcommand that does not exist, or an option that is
// missing. It shows what went wrong in one line, the way to write it, what each option is, and what the person probably meant.
const { ContainerBuilder, MessageFlags, TextDisplayBuilder } = require('discord.js');
const { EMOJI } = require('./emojis');
const { resolveSubcommandOptions, tokenize } = require('../handlers/prefixInteraction');

const ACCENT = 0xf5c26b;
const SUBCOMMAND = 1;
const GROUP = 2;
// How a person is told what an option holds.
const TYPE_HINT = { 3: 'text', 4: 'number', 5: 'yes or no', 6: 'a member', 7: 'a channel', 8: 'a role', 9: 'a member or a role', 10: 'number', 11: 'a file' };

const clip = (text, max) => (String(text).length > max ? `${String(text).slice(0, max - 1).trimEnd()}…` : String(text));

/** Every way to run a command: `create`, `admin set`... with what each one does. Hidden ones are left out. */
function listPaths(command) {
  const hidden = new Set(command.hiddenPrefixSubcommands ?? []);
  const paths = [];
  for (const option of command.data.toJSON().options ?? []) {
    if (option.type === SUBCOMMAND && !hidden.has(option.name)) paths.push({ path: option.name, description: option.description ?? '' });
    if (option.type === GROUP) {
      for (const child of option.options ?? []) {
        if (child.type === SUBCOMMAND && !hidden.has(`${option.name} ${child.name}`)) paths.push({ path: `${option.name} ${child.name}`, description: child.description ?? '' });
      }
    }
  }
  return paths;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/** The ways to run the command that look like what was typed: the same word inside a group, a start of it, or one slip. */
function suggest(paths, typed) {
  const word = String(typed ?? '').toLowerCase();
  if (!word) return [];
  const score = (path) => {
    const parts = path.split(' ');
    if (parts[parts.length - 1] === word || path === word) return 0;
    if (parts.some((part) => part.startsWith(word) || word.startsWith(part)) && word.length >= 2) return 1;
    const best = Math.min(...parts.map((part) => editDistance(part, word)));
    return best <= Math.max(1, Math.floor(word.length / 3)) ? 2 : null;
  };
  return paths.map((entry) => ({ ...entry, rank: score(entry.path) })).filter((entry) => entry.rank !== null).sort((a, b) => a.rank - b.rank).slice(0, 3);
}

/** The syntax of one way to run a command: required options in <angles>, optional ones in [brackets]. */
function syntaxOf(prefix, name, path, options) {
  const parts = (options ?? []).map((option) => (option.required ? `<${option.name}>` : `[${option.name}]`));
  return [`${prefix}${name}`, path, ...parts].filter(Boolean).join(' ');
}

function card(lines, accent = ACCENT) {
  const container = new ContainerBuilder().setAccentColor(accent);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.filter(Boolean).join('\n')));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { repliedUser: false, parse: [] } };
}

/** The first word of each way to run the command, without repeats: `create`, `color`, `admin`... */
function topWords(paths) {
  return [...new Set(paths.map((entry) => entry.path.split(' ')[0]))];
}

/**
 * The answer for a subcommand that does not exist. Small on purpose: what was typed, what was probably meant (or the first
 * options), and where the full guide is.
 */
function unknownSubcommandCard({ command, prefix, name, typed }) {
  const paths = listPaths(command);
  const guesses = suggest(paths, typed);
  const lines = [`${EMOJI.WARNING} \`${clip(typed || '(nothing)', 30)}\` is not part of \`${prefix}${name}\``];
  if (guesses.length) {
    lines.push(`Did you mean ${guesses.map((entry) => `\`${prefix}${name} ${entry.path}\``).join(' or ')}?`);
  } else {
    const words = topWords(paths);
    const shown = words.slice(0, 8).map((word) => `\`${word}\``).join(' ');
    lines.push(`Try ${shown}${words.length > 8 ? ` and ${words.length - 8} more` : ''}`);
  }
  lines.push(`-# \`${prefix}help ${name}\` shows everything it can do`);
  return card(lines);
}

/** What was typed, resolved to the way to run the command it was meant for (or the nearest one), to explain what it needs. */
function resolveTyped(command, argText) {
  const json = command.data.toJSON();
  const tokens = tokenize(argText ?? '');
  const aliases = command.prefixSubcommandAliases ?? {};
  const normalized = [...tokens];
  if (normalized[0]) normalized[0] = aliases[normalized[0].toLowerCase()] ?? normalized[0];
  const resolved = resolveSubcommandOptions(json, normalized) ?? (command.prefixDefaultSubcommand ? resolveSubcommandOptions(json, [command.prefixDefaultSubcommand, ...normalized]) : null);
  return resolved ? { path: [resolved.subcommandGroup, resolved.subcommand].filter(Boolean).join(' '), options: resolved.optionDefs } : null;
}

/**
 * The answer for a command that is missing an option, or was typed in a way that cannot be read. Small: the option that is
 * missing, the way to write the command, and one line about what that option is.
 */
function missingOptionCard({ command, prefix, name, argText, missing = null }) {
  const way = resolveTyped(command, argText);
  const options = way?.options ?? command.data.toJSON().options?.filter((option) => option.type !== SUBCOMMAND && option.type !== GROUP) ?? [];
  const path = way?.path ?? '';
  const lines = [
    missing
      ? `${EMOJI.WARNING} \`${missing}\` is missing`
      : `${EMOJI.WARNING} Check how you wrote \`${prefix}${name}${path ? ` ${path}` : ''}\``,
    `\`${syntaxOf(prefix, name, path, options)}\``,
  ];
  const detail = options.find((option) => option.name === missing);
  const hint = detail ? `\`${detail.name}\` is ${TYPE_HINT[detail.type] ?? 'text'}${detail.description ? `: ${clip(detail.description, 70)}` : ''}` : '';
  lines.push(`-# ${hint ? `${hint} · ` : ''}\`<needed>\` \`[optional]\` · \`${prefix}help ${name}\``);
  return card(lines);
}

module.exports = { unknownSubcommandCard, missingOptionCard, suggest, listPaths, syntaxOf, resolveTyped };
