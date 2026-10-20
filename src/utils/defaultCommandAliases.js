/**
 * Short, prefix-only aliases for commands that are commonly typed often.
 * Explicit aliases on a command file still win; commandHandler skips collisions.
 * This never creates or deploys slash commands.
 */
const DEFAULT_COMMAND_ALIASES = {
  activity: ['act'], avatar: ['av', 'pfp'], banner: ['bnr'], botinfo: ['bi'], calc: ['c', 'calculate'], channelinfo: ['ci'],
  color: ['hexcolor'], emojiinfo: ['ei'], firstmessage: ['fm'], inviteinfo: ['ii'], invites: ['invs'],
  roleinfo: ['ri'], roles: ['rolelist'], serverinfo: ['si'], snipe: ['sniped'], snowflake: ['sf'], spotify: ['sp'], time: ['tz', 'clock'], uptime: ['up'], userinfo: ['ui'], wiki: ['wk'],
  autothread: ['at'], reaction: ['react'], reactionrole: ['rr'], stickymessage: ['sticky'], stickyroles: ['sr'], timer: ['tmr'], voicemaster: ['vm'],
  bumpreminder: ['bump'], embed: ['emb'], logs: ['log'], prefix: ['pfx'], giveaway: ['gw'], giveawaypreset: ['gwp'], counter: ['cnt'],
  ban: ['banish'], channel: ['ch'], kick: ['k'], mute: [], note: ['notes'], nuke: ['nuk'], pauseinvites: ['pause'], softban: ['sban'], voice: ['vcmod'], afk: ['away'],
};

// Prefix-only shortcuts for high-frequency channel actions. These expand to the
// existing `channel` command, so the old `!channel ...` and `!ch ...` forms stay
// valid while common moderation actions can be typed directly.
const DEFAULT_PREFIX_ROUTES = [
  { alias: 'lock', command: 'channel', args: ['lock'], subcommand: 'lock' },
  { alias: 'unlock', command: 'channel', args: ['unlock'], subcommand: 'unlock' },
  { alias: 'slowmode', command: 'channel', args: ['slowmode'], subcommand: 'slowmode' },
  { alias: 'clear', command: 'channel', args: ['clear'], subcommand: 'clear' },
  { alias: 'avatars', command: 'profilehistory', args: ['avatars'], subcommand: 'avatars' },
  { alias: 'names', command: 'profilehistory', args: ['names'], subcommand: 'names' },
  { alias: 'nicknames', command: 'profilehistory', args: ['nicknames'], subcommand: 'nicknames' },
  { alias: 'nicks', command: 'profilehistory', args: ['nicknames'], subcommand: 'nicknames' },
  { alias: 'hide', command: 'channel', args: ['hide'], subcommand: 'hide' },
  { alias: 'unhide', command: 'channel', args: ['unhide'], subcommand: 'unhide' },
  { alias: 'lockall', command: 'channel', args: ['lock-all'], subcommand: 'lock-all' },
  { alias: 'unlockall', command: 'channel', args: ['unlock-all'], subcommand: 'unlock-all' },
  { alias: 'moveall', command: 'channel', args: ['move-all'], subcommand: 'move-all' },
  { alias: 'topic', command: 'channel', args: ['topic'], subcommand: 'topic' },
  { alias: 'nsfw', command: 'channel', args: ['nsfw'], subcommand: 'nsfw' },
  { alias: 'naughty', command: 'channel', args: ['nsfw'], subcommand: 'nsfw' },
  { alias: 'revokefiles', command: 'channel', args: ['files'], subcommand: 'files' },
  { alias: 'picperms', command: 'channel', args: ['files', 'on'], subcommand: 'files' },
  { alias: 'drag', command: 'voice', args: ['drag'], subcommand: 'drag' },
  { alias: 'jaillist', command: 'jail', args: ['list'], subcommand: 'list' },
  { alias: 'timeouts', command: 'mute', args: ['list'], subcommand: 'list' },
  { alias: 'modstats', command: 'case', args: ['stats'], subcommand: 'stats' },
  { alias: 'mhistory', command: 'case', args: ['search', '--moderator'], subcommand: 'search' },
  { alias: 'moderationhistory', command: 'case', args: ['search', '--moderator'], subcommand: 'search' },
  { alias: 'warnings', command: 'case', args: ['search', '--type', 'warn'], subcommand: 'search' },
  { alias: 'warns', command: 'case', args: ['search', '--type', 'warn'], subcommand: 'search' },
  { alias: 'caselog', command: 'case', args: ['view'], subcommand: 'view' },
  { alias: 'reason', command: 'case', args: ['edit'], subcommand: 'edit' },
  { alias: 'proof', command: 'case', args: ['evidence'], subcommand: 'evidence' },
  { alias: 'evidence', command: 'case', args: ['evidence'], subcommand: 'evidence' },
  { alias: 'iunmute', command: 'imute', args: ['remove'], subcommand: 'remove' },
  { alias: 'runmute', command: 'rmute', args: ['remove'], subcommand: 'remove' },
  { alias: 'newmembers', command: 'raid', args: ['list'], subcommand: 'list' },
  { alias: 'newusers', command: 'raid', args: ['list'], subcommand: 'list' },
  { alias: 'temprole', command: 'role', args: ['temp'], subcommand: 'temp', words: { list: { args: ['temp-list'] } } },
  { alias: 'forcenickname', command: 'nickname', args: ['force'], subcommand: 'force', words: { list: { args: ['forced'] }, view: { args: ['forced'] } } },
  { alias: 'forcenick', command: 'nickname', args: ['force'], subcommand: 'force', words: { list: { args: ['forced'] }, view: { args: ['forced'] } } },
  { alias: 'freezenick', command: 'nickname', args: ['force'], subcommand: 'force', words: { list: { args: ['forced'] }, view: { args: ['forced'] } } },
  { alias: 'fn', command: 'nickname', args: ['force'], subcommand: 'force', words: { list: { args: ['forced'] }, view: { args: ['forced'] } } },  // Image effects: `!invert`, `!blur 10 @member`, `!rotate 45 <link>`... are `!image <effect> ...` (the `!hex` of a picture is !color's).
  { alias: 'invert', command: 'image', args: ['invert'], subcommand: 'invert' },
  { alias: 'grayscale', command: 'image', args: ['grayscale'], subcommand: 'grayscale' },
  { alias: 'greyscale', command: 'image', args: ['grayscale'], subcommand: 'grayscale' },
  { alias: 'bw', command: 'image', args: ['grayscale'], subcommand: 'grayscale' },
  { alias: 'sepia', command: 'image', args: ['sepia'], subcommand: 'sepia' },
  { alias: 'blur', command: 'image', args: ['blur'], subcommand: 'blur' },
  { alias: 'pixelate', command: 'image', args: ['pixelate'], subcommand: 'pixelate' },
  { alias: 'rotate', command: 'image', args: ['rotate'], subcommand: 'rotate' },
  { alias: 'flip', command: 'image', args: ['flip'], subcommand: 'flip' },
  { alias: 'mirror', command: 'image', args: ['mirror'], subcommand: 'mirror' },
  { alias: 'circle', command: 'image', args: ['circle'], subcommand: 'circle' },
  { alias: 'deepfry', command: 'image', args: ['deepfry'], subcommand: 'deepfry' },
  { alias: 'compress', command: 'image', args: ['compress'], subcommand: 'compress' },
  { alias: 'dominant', command: 'image', args: ['hex'], subcommand: 'hex' },
  { alias: 'dominantcolor', command: 'image', args: ['hex'], subcommand: 'hex' },
];

function aliasesFor(commandName) {
  return DEFAULT_COMMAND_ALIASES[commandName] ?? [];
}

module.exports = { DEFAULT_COMMAND_ALIASES, DEFAULT_PREFIX_ROUTES, aliasesFor };
