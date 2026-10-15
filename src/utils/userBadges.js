// The badges shown in `!userinfo`: the ones Discord tells the bot about (the flags of the account), plus the server booster
// badge and Nitro, which Discord does not hand to bots, so they are worked out from what is public.
const { t, currentLanguage } = require('../i18n');

const BADGE_EMOJI = {
  balance: '<:Badge_Balance:1556776236544434328>',
  bravery: '<:Badge_Bravery:1556776241355427850>',
  brilliance: '<:Badge_Brilliance:1556776242647142450>',
  booster: '<:Boosting_1_Month:1556776253002879096>',
  verifiedApp: '<:VerifiedApp:1556776256463306813>',
  nitro: '<:nitro:1556776254777200791>',
  staff: '<:Badge_Staff:1556778102464585748>',
  partner: '<:Badge_Partner:1556778108206448690>',
  bugHunter1: '<:Badge_Bug_Hunter_Level_1:1556778096407879680>',
  bugHunter2: '<:Badge_Bug_Hunter_Level_2:1556778098366611527>',
  earlySupporter: '<:Badge_Early_Supporter:1556778112434569236>',
  moderatorAlumni: '<:Badge_Moderator_Programs_Alumni:1556778107036246126>',
  activeDeveloper: '<:Badge_Active_Developer:1556778110178041948>',
  supportsCommands: '<:Badge_Supports_Commands:1556778105543331911>',
  hypeSquadEvents: '<:Badge_HypeSquad_Events:1556781528476942346>',
  earlyVerifiedDeveloper: '<:Badge_Early_VerifiedBotDeveloper:1556781527159799909>',
};

// Account flags (the names discord.js gives) and how each one is shown (`key` is the catalog key of its name,
// `info.badge.<key>`). The ones without an emoji show their name only.
const FLAG_BADGES = {
  Staff: { key: 'staff', emoji: BADGE_EMOJI.staff },
  Partner: { key: 'partner', emoji: BADGE_EMOJI.partner },
  Hypesquad: { key: 'hypeSquadEvents', emoji: BADGE_EMOJI.hypeSquadEvents },
  BugHunterLevel1: { key: 'bugHunter', emoji: BADGE_EMOJI.bugHunter1 },
  BugHunterLevel2: { key: 'bugHunterGold', emoji: BADGE_EMOJI.bugHunter2 },
  HypeSquadOnlineHouse1: { key: 'bravery', emoji: BADGE_EMOJI.bravery },
  HypeSquadOnlineHouse2: { key: 'brilliance', emoji: BADGE_EMOJI.brilliance },
  HypeSquadOnlineHouse3: { key: 'balance', emoji: BADGE_EMOJI.balance },
  PremiumEarlySupporter: { key: 'earlySupporter', emoji: BADGE_EMOJI.earlySupporter },
  VerifiedDeveloper: { key: 'earlyVerifiedDeveloper', emoji: BADGE_EMOJI.earlyVerifiedDeveloper },
  VerifiedBot: { key: 'verifiedApp', emoji: BADGE_EMOJI.verifiedApp },
  CertifiedModerator: { key: 'moderatorAlumni', emoji: BADGE_EMOJI.moderatorAlumni },
  ActiveDeveloper: { key: 'activeDeveloper', emoji: BADGE_EMOJI.activeDeveloper },
  BotHTTPInteractions: { key: 'supportsCommands', emoji: BADGE_EMOJI.supportsCommands },
};

/**
 * The badges of a person. A badge with an icon is only the icon (its name is what Discord shows when you hover it, and a bot
 * cannot do that), and one without an icon is its name. Nitro is shown when a person (not an app) has something only Nitro
 * gives, an animated avatar or a banner, because Discord does not tell bots who has Nitro; apps can have both without it.
 */
function badgeList(user, member = null, lang = currentLanguage()) {
  const out = [];
  const show = (badge) => out.push({ icon: badge.emoji ?? null, name: badge.key ? t(lang, `info.badge.${badge.key}`) : badge.name });
  // A flag Petto does not know yet shows its discord.js name, as it is.
  for (const flag of user?.flags?.toArray?.() ?? []) show(FLAG_BADGES[flag] ?? { name: flag });
  const animatedAvatar = typeof user?.avatar === 'string' && user.avatar.startsWith('a_');
  if (!user?.bot && (animatedAvatar || user?.banner)) show({ name: 'Nitro', emoji: BADGE_EMOJI.nitro }); // i18n-ignore: a product name
  if (member?.premiumSinceTimestamp) show({ key: 'booster', emoji: BADGE_EMOJI.booster });
  return out;
}

/** The badges as one line: the icons together first, then the names of the ones that have no icon. */
function badgeText(badges) {
  const icons = badges.filter((badge) => badge.icon).map((badge) => badge.icon);
  const names = badges.filter((badge) => !badge.icon).map((badge) => badge.name);
  return [icons.join(' '), names.join(' · ')].filter(Boolean).join('  ');
}

module.exports = { badgeList, badgeText, BADGE_EMOJI };
