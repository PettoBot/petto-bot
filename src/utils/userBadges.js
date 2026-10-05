// The badges shown in `!userinfo`: the ones Discord tells the bot about (the flags of the account), plus the server booster
// badge and Nitro, which Discord does not hand to bots, so they are worked out from what is public.

const BADGE_EMOJI = {
  balance: '<:Badge_Balance:1556776236544434328>',
  bravery: '<:Badge_Bravery:1556776241355427850>',
  brilliance: '<:Badge_Brilliance:1556776242647142450>',
  booster: '<:Boosting_1_Month:1556776253002879096>',
  verifiedApp: '<:VerifiedApp:1556776256463306813>',
  nitro: '<:nitro:1556776254777200791>',
};

// Account flags (the names discord.js gives) and how each one is shown. The ones without an emoji show their name only.
const FLAG_BADGES = {
  Staff: { name: 'Discord Staff' },
  Partner: { name: 'Partner' },
  Hypesquad: { name: 'HypeSquad Events' },
  BugHunterLevel1: { name: 'Bug Hunter' },
  BugHunterLevel2: { name: 'Bug Hunter (Gold)' },
  HypeSquadOnlineHouse1: { name: 'HypeSquad Bravery', emoji: BADGE_EMOJI.bravery },
  HypeSquadOnlineHouse2: { name: 'HypeSquad Brilliance', emoji: BADGE_EMOJI.brilliance },
  HypeSquadOnlineHouse3: { name: 'HypeSquad Balance', emoji: BADGE_EMOJI.balance },
  PremiumEarlySupporter: { name: 'Early Supporter' },
  VerifiedDeveloper: { name: 'Early Verified Bot Developer' },
  VerifiedBot: { name: 'Verified App', emoji: BADGE_EMOJI.verifiedApp },
  CertifiedModerator: { name: 'Certified Moderator' },
  ActiveDeveloper: { name: 'Active Developer' },
};

/**
 * The badges of a person, as `emoji name` texts. Nitro is shown when the account has something only Nitro gives (an animated
 * avatar or a banner), and the booster badge when the person boosts this server.
 */
function badgeList(user, member = null) {
  const out = [];
  const show = (badge) => out.push(badge.emoji ? `${badge.emoji} ${badge.name}` : badge.name);
  for (const flag of user?.flags?.toArray?.() ?? []) show(FLAG_BADGES[flag] ?? { name: flag });
  const animatedAvatar = typeof user?.avatar === 'string' && user.avatar.startsWith('a_');
  if (animatedAvatar || user?.banner) show({ name: 'Nitro', emoji: BADGE_EMOJI.nitro });
  if (member?.premiumSinceTimestamp) show({ name: 'Server Booster', emoji: BADGE_EMOJI.booster });
  return out;
}

module.exports = { badgeList, BADGE_EMOJI };
