/**
 * Short, prefix-only aliases for commands that are commonly typed often.
 * Explicit aliases on a command file still win; commandHandler skips collisions.
 * This never creates or deploys slash commands.
 */
const DEFAULT_COMMAND_ALIASES = {
  activity: ['act'], avatar: ['av', 'pfp'], banner: ['bnr'], botinfo: ['bi'], calc: ['c', 'calculate'], channelinfo: ['ci'],
  color: ['hexcolor'], emojiinfo: ['ei'], firstmessage: ['fm'], inviteinfo: ['ii'], invites: ['invs'],
  roleinfo: ['ri'], roles: ['rolelist'], serverinfo: ['si'], snipe: ['sniped'], snowflake: ['sf'], spotify: ['sp'], time: ['tz', 'clock'], uptime: ['up'], userinfo: ['ui'],
  autothread: ['at'], reaction: ['react'], reactionrole: ['rr'], stickymessage: ['sticky'], stickyroles: ['sr'], timer: ['tmr'], voicemaster: ['vm'],
  bumpreminder: ['bump'], embed: ['emb'], logs: ['log'], prefix: ['pfx'], giveaway: ['gw'], giveawaypreset: ['gwp'], counter: ['cnt'],
  ban: ['banish'], channel: ['ch'], kick: ['k'], mute: [], note: ['notes'], nuke: ['nuk'], pauseinvites: ['pause'], softban: ['sban'], voice: ['vcmod'], afk: ['away'],
};

function aliasesFor(commandName) {
  return DEFAULT_COMMAND_ALIASES[commandName] ?? [];
}

module.exports = { DEFAULT_COMMAND_ALIASES, aliasesFor };
