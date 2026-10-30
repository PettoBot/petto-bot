// i18n-ignore-file: command and subcommand names people type, never translated
/**
 * Short, prefix-only words for the subcommands of the commands people type most: `!is` is `!image sepia`, `!tko` is `!ticket open`.
 * Each one is a normal prefix route (see defaultCommandAliases.js), so it runs the real command and subcommand with the same
 * permissions, `!disablecommand` and `!restrictcommand` rules as the long form. No word here is the name or the alias of another command.
 *
 * How the words are made: the initials of the command and of the subcommand (`is` = image sepia). Where those are already taken by
 * something else (`ir` is `!inrole`), the first letters of the subcommand are used (`iro`), or a fixed short word of the command
 * (`tk` for ticket, `xp` for level). A word that is also a common word (`if`, `is`) works with a symbol prefix (`!is`) but never after a
 * word prefix (`petto is the best` is chat): see commonWords.js.
 */
const SHORT_ALIAS_TABLE = [
  // [alias, command, subcommand]
  // image: the effects of a picture
  ['inv', 'image', 'invert'], ['ig', 'image', 'grayscale'], ['is', 'image', 'sepia'], ['ib', 'image', 'blur'],
  ['ip', 'image', 'pixelate'], ['iro', 'image', 'rotate'], ['if', 'image', 'flip'], ['im', 'image', 'mirror'],
  ['ic', 'image', 'circle'], ['idf', 'image', 'deepfry'], ['icp', 'image', 'compress'], ['ih', 'image', 'hex'],
  // ticket
  ['tksu', 'ticket', 'setup'], ['tko', 'ticket', 'open'], ['tkc', 'ticket', 'close'], ['tkro', 'ticket', 'reopen'],
  ['tkd', 'ticket', 'delete'], ['tkcl', 'ticket', 'claim'], ['tkuc', 'ticket', 'unclaim'], ['tka', 'ticket', 'add'],
  ['tkr', 'ticket', 'remove'], ['tkrn', 'ticket', 'rename'], ['tkt', 'ticket', 'transcript'], ['tki', 'ticket', 'info'],
  ['tks', 'ticket', 'stats'], ['tkp', 'ticket', 'priority'], ['tkx', 'ticket', 'transfer'], ['tkn', 'ticket', 'note'],
  ['tkrc', 'ticket', 'request-close'],
  // timer
  ['tma', 'timer', 'add'], ['tml', 'timer', 'list'], ['tmv', 'timer', 'view'], ['tmrm', 'timer', 'remove'],
  ['tmrun', 'timer', 'run'], ['tme', 'timer', 'edit'], ['tmm', 'timer', 'message'], ['tmc', 'timer', 'channel'],
  ['tmp', 'timer', 'pause'], ['tmrs', 'timer', 'resume'],
  // feed
  ['fda', 'feed', 'add'], ['fdl', 'feed', 'list'], ['fdr', 'feed', 'remove'], ['fdt', 'feed', 'test'],
  ['fdp', 'feed', 'pause'], ['fdrs', 'feed', 'resume'], ['fdm', 'feed', 'message'], ['fdpg', 'feed', 'ping'],
  // giveaway (`gwp` and `gwt` are the presets and the templates)
  ['gwq', 'giveaway', 'quick'], ['gws', 'giveaway', 'start'], ['gwr', 'giveaway', 'reroll'], ['gwe', 'giveaway', 'end'],
  ['gwed', 'giveaway', 'edit'],
  // welcome
  ['wcs', 'welcome', 'setup'], ['wcst', 'welcome', 'status'], ['wct', 'welcome', 'test'], ['wcd', 'welcome', 'disable'],
  // backup
  ['bkp', 'backup', 'panel'], ['bkc', 'backup', 'create'], ['bkl', 'backup', 'list'], ['bke', 'backup', 'export'],
  ['bkr', 'backup', 'restore'], ['bkd', 'backup', 'delete'], ['bks', 'backup', 'schedule'], ['bka', 'backup', 'audit'],
  // automod
  ['aml', 'automod', 'link'], ['ams', 'automod', 'spam'], ['amst', 'automod', 'strikes'], ['amr', 'automod', 'raid'],
  ['ama', 'automod', 'anti-alt'], ['amna', 'automod', 'no-avatar'], ['amc', 'automod', 'control'],
  ['amtl', 'automod', 'template list'], ['amnl', 'automod', 'native list'], ['amwa', 'automod', 'word-filter add'],
  ['amwl', 'automod', 'word-filter list'],
  // counter (`cnt` is the alias of the command)
  ['cnc', 'counter', 'create'], ['cns', 'counter', 'setup'], ['cnl', 'counter', 'list'], ['cnty', 'counter', 'types'],
  ['cne', 'counter', 'edit'], ['cnd', 'counter', 'delete'], ['cnr', 'counter', 'refresh'], ['cna', 'counter', 'announce'],
  // snipe
  ['sn', 'snipe', 'deleted'], ['sne', 'snipe', 'edited'], ['snr', 'snipe', 'reactions'], ['snc', 'snipe', 'clear'],
  // afk
  ['afs', 'afk', 'set'], ['afm', 'afk', 'mentions'],
  // remind
  ['rma', 'remind', 'add'], ['rml', 'remind', 'list'], ['rmc', 'remind', 'cancel'],
  // birthday
  ['bds', 'birthday', 'set'], ['bdr', 'birthday', 'remove'], ['bdv', 'birthday', 'view'], ['bdu', 'birthday', 'upcoming'],
  ['bdc', 'birthday', 'config'],
  // level
  ['xpe', 'level', 'enable'], ['xps', 'level', 'status'], ['xpr', 'level', 'reset'], ['xpcd', 'level', 'cooldown'],
  ['xpn', 'level', 'notify'], ['xpi', 'level', 'ignore'], ['xpra', 'level', 'reward add'], ['xprr', 'level', 'reward remove'],
  ['xprl', 'level', 'reward list'], ['xpml', 'level', 'multiplier list'], ['xpel', 'level', 'event list'],
  // starboard
  ['stbe', 'starboard', 'enable'], ['stbd', 'starboard', 'disable'], ['stbs', 'starboard', 'set'], ['stbt', 'starboard', 'threshold'],
  ['stbem', 'starboard', 'emoji'], ['stbv', 'starboard', 'view'], ['stbi', 'starboard', 'ignore'], ['stbu', 'starboard', 'unignore'],
  // suggestion
  ['sgs', 'suggestion', 'setup'], ['sge', 'suggestion', 'enable'], ['sgd', 'suggestion', 'disable'], ['sgc', 'suggestion', 'config'],
  ['sga', 'suggestion', 'approve'], ['sgdn', 'suggestion', 'deny'], ['sgi', 'suggestion', 'implement'], ['sgv', 'suggestion', 'view'],
  ['sgl', 'suggestion', 'list'], ['sgp', 'suggestion', 'panel'], ['sgb', 'suggestion', 'block'], ['sgub', 'suggestion', 'unblock'],
  // verify
  ['vfs', 'verify', 'setup'], ['vft', 'verify', 'template'], ['vfc', 'verify', 'channel'], ['vfst', 'verify', 'status'], ['vfsd', 'verify', 'send'],
];

/** The routes of the table, in the shape of DEFAULT_PREFIX_ROUTES (`short: true` marks them for the checks and the docs). */
function shortAliasRoutes() {
  return SHORT_ALIAS_TABLE.map(([alias, command, subcommand]) => ({ alias, command, args: subcommand.split(' '), subcommand, short: true }));
}

module.exports = { SHORT_ALIAS_TABLE, shortAliasRoutes };
