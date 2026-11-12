// i18n-ignore-file: the words shown to people are in the catalogs (variables.*); what is written here are the names of flags and examples to copy.
// The options that are written in the TEXT of a command and are not options of its slash entry, so nobody can find them in the `/` menu: `--color` of `!quote`,
// `--reply` of `!autoresponder add`... The rest is generic: the prefix reads any option of any command as `--name value` (`--joined_after 30d`, `--duration 7d`), and
// `!variables <command>` lists those from the builder of the command, so they are not written here. Everything that `!variables` says about these comes from this list and
// from the catalogs `variables.flag.<id>`; scripts/check-variables.js fails when a flag that Petto reads from the text is not here.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/commandFlags.js, which is what the bot loads.

export interface SpecialFlag {
  /** The key of the text in the catalogs: `variables.flag.<id>`. */
  id: string;
  /** The name of the command (`data.name`) that reads it. */
  command: string;
  /** The words after the command that make it apply (`['add']` for `!autoresponder add`), empty for the whole command. */
  path: readonly string[];
  /** How it is written, the first one is the main name. */
  flags: readonly string[];
  /** `nothing`: written alone. `word`: followed by its value. */
  takes: 'nothing' | 'word';
  /** A command to copy, written without the prefix. */
  example: string;
}

const flag = (id: string, command: string, path: readonly string[], flags: readonly string[], takes: 'nothing' | 'word', example: string): SpecialFlag => ({ id, command, path, flags, takes, example });

export const SPECIAL_FLAGS: readonly SpecialFlag[] = [
  flag('quote.color', 'quote', [], ['--color', '--colour'], 'nothing', 'quote hello @member --color'),
  flag('quote.light', 'quote', [], ['--light', '--white'], 'nothing', 'quote hello @member --light'),
  flag('quote.bold', 'quote', [], ['--bold'], 'nothing', 'quote hello @member --bold'),
  flag('autoresponder.reply', 'autoresponder', [], ['--reply'], 'nothing', 'autoresponder add hi, Hello! --reply'),
  flag('autoresponder.delete', 'autoresponder', [], ['--delete'], 'nothing', 'autoresponder add hi, Hello! --delete'),
  flag('autoresponder.ping', 'autoresponder', [], ['--ping'], 'nothing', 'autoresponder add hi, Hello! --ping'),
  flag('autoresponder.previous', 'autoresponder', [], ['--previous'], 'nothing', 'autoresponder add hi, Hello! --previous'),
  flag('autoresponder.strict', 'autoresponder', [], ['--strict'], 'nothing', 'autoresponder add hi, Hello! --strict'),
  flag('autoresponder.notStrict', 'autoresponder', [], ['--not_strict'], 'nothing', 'autoresponder edit 3 --not_strict'),
  flag('autoresponder.mode', 'autoresponder', [], ['--mode'], 'word', 'autoresponder add hi, Hello! --mode startsWith'),
  flag('autoresponder.embedTemplate', 'autoresponder', [], ['--embed_template'], 'word', 'autoresponder add hi --embed_template welcome'),
  flag('counter.format', 'counter', ['create'], ['--format'], 'word', 'counter create members --format grouped'),
  flag('counter.channel', 'counter', ['create'], ['--channel'], 'word', 'counter create members --channel #my-channel'),
  flag('counter.kind', 'counter', ['create'], ['--kind'], 'word', 'counter create members --kind text'),
  flag('counter.role', 'counter', ['create'], ['--role'], 'word', 'counter create role --role @Member'),
  flag('counter.goal', 'counter', ['create'], ['--goal'], 'word', 'counter create goal --goal 500'),
  flag('counter.timezone', 'counter', ['create'], ['--timezone', '--tz'], 'word', 'counter create clock --timezone Europe/Madrid'),
  flag('counter.category', 'counter', ['create'], ['--category'], 'word', 'counter create members --category #stats'),
  flag('counter.interval', 'counter', ['create'], ['--interval'], 'word', 'counter create online --interval 300'),
  flag('pagination.private', 'pagination', ['create'], ['--private'], 'nothing', 'pagination create #info my-embed --private'),
  flag('pagination.message', 'pagination', ['delete'], ['--message'], 'nothing', 'pagination delete <message link> --message'),
  flag('role.bare', 'role', [], ['--preview'], 'nothing', 'role all @Member --preview'),
  flag('joinrole.bare', 'joinrole', [], ['--preview'], 'nothing', 'joinrole apply --preview'),
];

/** The flags of a command, and of the words after it when they are given (`['add']`): the ones for the whole command and the ones for those words. */
export function flagsFor(command: string, path: readonly string[] = []): SpecialFlag[] {
  return SPECIAL_FLAGS.filter((entry) => entry.command === command && entry.path.every((word, index) => path[index] === word));
}

/** The flags that are written with this name (`color`, `--color`, `--not-strict`): the same name with or without the dashes, `-` or `_`. */
export function flagsNamed(name: string): SpecialFlag[] {
  const wanted = normalizeName(name);
  return SPECIAL_FLAGS.filter((entry) => entry.flags.some((each) => normalizeName(each) === wanted));
}

/** `--Not-Strict` and `not_strict` are the same name. */
export function normalizeName(name: string): string {
  return String(name).trim().toLowerCase().replace(/^-+/, '').replace(/-/g, '_');
}
