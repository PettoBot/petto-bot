// Petto's custom application emojis. IDs are fixed — these render in any
// message/embed the bot sends regardless of which server it's posted in.
const EMOJI = {
  LOADING: '<a:petto_loading:1541481906468814880>',
  LOAD: '<a:peto_load:1527894241290883152>',
  STAR: '<:peto_star:1527894282135146516>',
  ALERT: '<:petto_alert:1527894204926267483>',
  APPROVE: '<:petto_approve:1527894552277549066>',
  DENY: '<:petto_deny:1527894509579665458>',
  HAMMER: '<:petto_hammer:1527894325432815817>',
  QUESTION: '<:petto_question:1527894162542825546>',
  WARNING: '<:petto_warning:1527894476616630433>',
  REPORT: '<:pe_report:1541889748526694531>',
  REPORT_IMPORTANT: '<:pe_reportimportan:1541889795285061652>',
  // Release center set — kept here so the catalog and its buttons share the
  // same application emojis as the rest of Petto's interactive panels.
  RELEASE_SETTINGS: '<:pe_tuerca:1542053997815533649>',
  RELEASE_ROCKET: '<:pe_rocket:1542053984628375602>',
  RELEASE_LINK: '<:pe_link:1542053994321682444>',
  RELEASE_LOCKED: '<:pe_locked:1542053999178682399>',
  RELEASE_MAGIC: '<:pe_magic:1542054179391152208>',
  RELEASE_MINUS: '<:pe_minus:1542053987094761552>',
  RELEASE_MORE: '<:pe_more:1542053988646649956>',
  RELEASE_NOTE: '<:pe_note:1542048566657155153>',
  RELEASE_PC: '<:pe_pc:1542053996028633108>',
  RELEASE_RELOAD: '<:pe_reload:1542053990282567752>',
  RELEASE_EYES: '<:pe_eyes:1542053991981121556>',
  RELEASE_EXPERIENCE: '<:pe_exp:1542054001363648532>',
  RELEASE_DENIED: '<:pe_denied:1542048568804769842>',
  RELEASE_METAL: '<:pe_cosademetal:1542054016563945643>',
  RELEASE_CHANGELOG: '<:pe_cl:1542054021416751174>',
  RELEASE_BUG: '<:pe_bug:1542055053764861992>',
  RELEASE_APPROVED: '<:pe_aproved:1542048556352016475>',
  RELEASE_ALERT: '<:pe_alert:1542048558365286531>',
  // Level progress bar: start/middle/end × full/half/empty.
  BAR_START_FULL: '<:petto_iniciolleno:1534705766370381885>',
  BAR_START_HALF: '<:petto_iniciomediolleno:1534705752692883486>',
  BAR_START_EMPTY: '<:petto_iniciovavio:1534705756496990259>',
  BAR_MID_FULL: '<:petto_lleno:1534705778613682378>',
  BAR_MID_HALF: '<:petto_mediolleno:1534705751220555777>',
  BAR_MID_EMPTY: '<:petto_vacio:1534705753850380348>',
  BAR_END_FULL: '<:petto_finallleno:1534705777099673822>',
  BAR_END_HALF: '<:petto_finalmediolleno:1534705779540627568>',
  BAR_END_EMPTY: '<:petto_finalvacio:1534705754852819014>',
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
