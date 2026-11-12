"use strict";
// i18n-ignore-file: the words shown to people are in the catalogs (variables.*); what is written here are the names of flags and examples to copy.
// The options that are written in the TEXT of a command and are not options of its slash entry, so nobody can find them in the `/` menu: `--color` of `!quote`,
// `--reply` of `!autoresponder add`... The rest is generic: the prefix reads any option of any command as `--name value` (`--joined_after 30d`, `--duration 7d`), and
// `!variables <command>` lists those from the builder of the command, so they are not written here. Everything that `!variables` says about these comes from this list and
// from the catalogs `variables.flag.<id>`; scripts/check-variables.js fails when a flag that Petto reads from the text is not here.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/commandFlags.js, which is what the bot loads.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPECIAL_FLAGS = void 0;
exports.flagsFor = flagsFor;
exports.flagsNamed = flagsNamed;
exports.isListed = isListed;
exports.normalizeName = normalizeName;
const flag = (id, command, path, flags, takes, example) => ({ id, command, path, flags, takes, example });
exports.SPECIAL_FLAGS = [
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
function flagsFor(command, path = []) {
    return exports.SPECIAL_FLAGS.filter((entry) => entry.command === command && entry.path.every((word, index) => path[index] === word));
}
/** The flags that are written with this name (`color`, `--color`, `--not-strict`): the same name with or without the dashes, `-` or `_`. */
function flagsNamed(name) {
    const wanted = normalizeName(name);
    return exports.SPECIAL_FLAGS.filter((entry) => entry.flags.some((each) => normalizeName(each) === wanted));
}
/** Is the command one that everybody can be told about (`!variables`)? Not the ones for the Petto team, hidden ones or the ones of a private server. It only decides what is listed. */
function isListed(command) {
    return Boolean(command.data) && !command.teamOnly && !command.ownerOnly && !command.hiddenEverywhere && !command.hiddenFromHelp && !command.privateGuildId;
}
/** `--Not-Strict` and `not_strict` are the same name. */
function normalizeName(name) {
    return String(name).trim().toLowerCase().replace(/^-+/, '').replace(/-/g, '_');
}
