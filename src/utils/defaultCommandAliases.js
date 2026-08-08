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
  { alias: 'hide', command: 'channel', args: ['hide'], subcommand: 'hide' },
  { alias: 'unhide', command: 'channel', args: ['unhide'], subcommand: 'unhide' },
  { alias: 'lockall', command: 'channel', args: ['lock-all'], subcommand: 'lock-all' },
  { alias: 'unlockall', command: 'channel', args: ['unlock-all'], subcommand: 'unlock-all' },
  { alias: 'moveall', command: 'channel', args: ['move-all'], subcommand: 'move-all' },
];

function aliasesFor(commandName) {
  return DEFAULT_COMMAND_ALIASES[commandName] ?? [];
}

module.exports = { DEFAULT_COMMAND_ALIASES, DEFAULT_PREFIX_ROUTES, aliasesFor };
