// Petto's custom application emojis. IDs are fixed — these render in any
// message/embed the bot sends regardless of which server it's posted in.
const EMOJI = {
  LOAD: '<a:peto_load:1527894241290883152>',
  STAR: '<:peto_star:1527894282135146516>',
  ALERT: '<:petto_alert:1527894204926267483>',
  APPROVE: '<:petto_approve:1527894552277549066>',
  DENY: '<:petto_deny:1527894509579665458>',
  HAMMER: '<:petto_hammer:1527894325432815817>',
  QUESTION: '<:petto_question:1527894162542825546>',
  WARNING: '<:petto_warning:1527894476616630433>',
  // Pagination/navigation set — used by !help's paged command lookup.
  PAGES: '<:43:1529270169002836038>',
  PREV: '<:42:1529270178985148579>',
  NEXT: '<:41:1529270176070107187>',
  CLOSE: '<:40:1529270174086336747>',
  SEARCH: '<:39:1529270171573682266>',
  CHECK: '<:38:1529270147464954097>',
};

// Which emoji represents each mod_actions.type, for DMs and case embeds.
const TYPE_EMOJI = {
  ban: EMOJI.HAMMER,
  tempban: EMOJI.HAMMER,
  softban: EMOJI.HAMMER,
  unban: EMOJI.APPROVE,
  kick: EMOJI.HAMMER,
  mute: EMOJI.ALERT,
  tempmute: EMOJI.ALERT,
  unmute: EMOJI.APPROVE,
  warn: EMOJI.WARNING,
};

module.exports = { EMOJI, TYPE_EMOJI };
