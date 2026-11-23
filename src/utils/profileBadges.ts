// i18n-ignore-file: the catalog of badges; the names a person reads are in the embeds catalog (`profile.badge.<id>`), nothing here is shown as it is.
// The badges of the profile of a person (the image of `/profile`): which exist, how each one is had and how many fit in the showcase.
// Pure rules with no database and no Discord, so scripts/check-profile-card.js tests the same code the command runs.
// Written in TypeScript: `npm run build:ts` compiles it over utils/profileBadges.js.

/** How a badge comes to a person: `plan` follows the plan they pay for (nobody picks it), `self` is turned on and off by the person (an identity badge: nobody gives it, nobody sees it unless they put it), `team` is given by hand, `shop` is bought once with ceramos and then stays, `status` is given by itself while the person is what it says (a voter, a booster). */
export type BadgeUnlock = 'plan' | 'self' | 'team' | 'shop' | 'status';
export type PlanKey = 'bronze' | 'silver' | 'gold';
/** How rare a badge is: it sets what it costs in the shop. */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
/** The tabs of the page of badges. */
export type BadgeCategory = 'plan' | 'fablo' | 'country' | 'language' | 'status' | 'special';
/** What each rarity costs in ceramos (a badge of the shop is bought once and kept). */
export const RARITY_PRICE: Readonly<Record<Rarity, number>> = { common: 20, rare: 50, epic: 120, legendary: 300 };

export interface BadgeDef {
  id: string;
  unlock: BadgeUnlock;
  /** The picture file of the badge in src/assets/badges (without folder), or null while the art is not there yet (it is drawn as a plain hexagon with `color`). */
  art: string | null;
  color: string;
  /** The pack of badges it belongs to (`fablo` is the free default one), or nothing. */
  pack?: 'fablo';
  /** A country (a region code) or a language (a language code): its name comes from the language of whoever reads it, and its code is drawn on the badge. */
  region?: string;
  language?: string;
  /** How rare it is (only the badges of the shop have a price). */
  rarity?: Rarity;
  /** A badge made in the editor of the team (the rest are in this file). Its picture is in the database, and its words come with it. */
  custom?: boolean;
  names?: Record<string, string>;
  /** The tab it is in (a badge of the editor picks one; the others follow from what they are). */
  category?: BadgeCategory;
  /** Its own price (0 is free), instead of the one of its rarity. */
  price?: number;
  /** The days it is on sale (ISO times; nothing means always). When the sale ends the ones who have it keep it for good. */
  saleFrom?: string | null;
  saleUntil?: string | null;
  /** Only people with this plan or a better one can get it. */
  planMin?: PlanKey | null;
  /** What makes it be given by itself (`voter`, `booster`, `partner`, `server_boost`): see utils/badgeRegistry.ts. */
  grantRule?: string | null;
  /** Taken off sale by the team: not in the shop any more, and whoever has it keeps it. */
  retired?: boolean;
  /** Changes when the badge is edited: the websites use it to know the picture is a new one. */
  version?: string;
}

export const PLAN_KEYS: readonly PlanKey[] = ['bronze', 'silver', 'gold'];

const BASE_BADGES: readonly BadgeDef[] = [
  { id: 'plan-bronze', unlock: 'plan', art: 'plan-bronze.png', color: '#b9792f' },
  { id: 'plan-silver', unlock: 'plan', art: 'plan-silver.png', color: '#b8bcc4' },
  { id: 'plan-gold', unlock: 'plan', art: 'plan-gold.png', color: '#f4cf3a' },
  // The Fablo pack: the free badges everybody can turn on.
  { id: 'furro', unlock: 'self', art: 'furro.png', color: '#8cc7ff', pack: 'fablo' },
  { id: 'boykisser', unlock: 'self', art: 'boykisser.png', color: '#b98cff', pack: 'fablo' },
  { id: 'hetero', unlock: 'self', art: 'hetero.png', color: '#6fb4ff', pack: 'fablo' },
  { id: 'femboy', unlock: 'self', art: 'femboy.png', color: '#ff8fc2', pack: 'fablo' },
];


// The shop: countries (with the flag of each one) and languages, each bought once with ceramos. A language has no art: it is drawn with its code.
const COUNTRY_CODES = ["ad", "ae", "af", "ag", "ai", "al", "am", "ao", "aq", "ar", "as", "at", "au", "aw", "ax", "az", "ba", "bb", "bd", "be", "bf", "bg", "bh", "bi", "bj", "bl", "bm", "bn", "bo", "bq", "br", "bs", "bt", "bv", "bw", "by", "bz", "ca", "cc", "cd", "cf", "cg", "ch", "ci", "ck", "cl", "cm", "cn", "co", "cp", "cr", "cu", "cv", "cw", "cx", "cy", "cz", "de", "dg", "dj", "dk", "dm", "do", "dz", "ec", "ee", "eg", "eh", "er", "es", "et", "fi", "fj", "fk", "fm", "fo", "fr", "ga", "gb", "gd", "ge", "gf", "gg", "gh", "gi", "gl", "gm", "gn", "gp", "gq", "gr", "gs", "gt", "gu", "gw", "gy", "hk", "hm", "hn", "hr", "ht", "hu", "ic", "id", "ie", "il", "im", "in", "io", "iq", "ir", "is", "it", "je", "jm", "jo", "jp", "ke", "kg", "kh", "ki", "km", "kn", "kp", "kr", "kw", "ky", "kz", "la", "lb", "lc", "li", "lk", "lr", "ls", "lt", "lu", "lv", "ly", "ma", "mc", "md", "me", "mf", "mg", "mh", "mk", "ml", "mm", "mn", "mo", "mp", "mq", "mr", "ms", "mt", "mu", "mv", "mw", "mx", "my", "mz", "na", "nc", "ne", "nf", "ng", "ni", "nl", "no", "np", "nr", "nu", "nz", "om", "pa", "pe", "pf", "pg", "ph", "pk", "pl", "pm", "pn", "pr", "ps", "pt", "pw", "py", "qa", "re", "ro", "rs", "ru", "rw", "sa", "sb", "sc", "sd", "se", "sg", "sh", "si", "sj", "sk", "sl", "sm", "sn", "so", "sr", "ss", "st", "sv", "sx", "sy", "sz", "tc", "td", "tf", "tg", "th", "tj", "tk", "tl", "tm", "tn", "to", "tr", "tt", "tv", "tw", "tz", "ua", "ug", "um", "us", "uy", "uz", "va", "vc", "ve", "vg", "vi", "vn", "vu", "wf", "ws", "xk", "ye", "yt", "za", "zm", "zw"];
const LANGUAGE_CODES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'tr', 'nl', 'pl', 'sv', 'uk', 'id', 'vi', 'th'];
const PALETTE = ['#e8794a', '#5a8be0', '#3ea37a', '#c26bd6', '#d9a83a', '#d9483b', '#4fb3c8', '#7a6bd6'];
const colorOf = (code: string): string => PALETTE[(code.charCodeAt(0) * 31 + code.charCodeAt(1)) % PALETTE.length];
const SHOP: BadgeDef[] = [
  ...COUNTRY_CODES.map((code): BadgeDef => ({ id: `country-${code}`, unlock: 'shop', art: null, color: colorOf(code), region: code.toUpperCase(), rarity: 'common' })),
  ...LANGUAGE_CODES.map((code): BadgeDef => ({ id: `lang-${code}`, unlock: 'shop', art: null, color: colorOf(code), language: code, rarity: 'common' })),
];

export const BADGES: readonly BadgeDef[] = [...BASE_BADGES, ...SHOP];
export const SHOP_BADGES: readonly BadgeDef[] = SHOP;

const BY_ID = new Map(BADGES.map((badge) => [badge.id, badge]));
let custom: readonly BadgeDef[] = [];
let customById = new Map<string, BadgeDef>();

/** Sets the badges made in the editor (utils/badgeRegistry.ts reads them from the database). */
export function setCustomBadges(list: readonly BadgeDef[]): void {
  custom = list;
  customById = new Map(list.map((badge) => [badge.id, badge]));
}

/** Every badge that exists: the ones of this file and the ones of the editor. */
export const allBadges = (): readonly BadgeDef[] => (custom.length ? [...BADGES, ...custom] : BADGES);
/** The badges that can be bought: the countries and languages, and the ones of the editor that are for sale (even when the sale is not open now). */
export const shopBadges = (): readonly BadgeDef[] => (custom.length ? [...SHOP_BADGES, ...custom.filter((badge) => badge.unlock === 'shop')] : SHOP_BADGES);

/** Whether the sale is open at a moment (a badge with no dates is always on sale). */
export function onSale(def: BadgeDef, now: Date = new Date()): boolean {
  if (def.retired) return false;
  const at = now.getTime();
  if (def.saleFrom && new Date(def.saleFrom).getTime() > at) return false;
  if (def.saleUntil && new Date(def.saleUntil).getTime() <= at) return false;
  return true;
}

/** Whether a plan is enough for a badge that asks for one (none asks for none). */
export function planAllows(def: BadgeDef, plan: PlanKey | null): boolean {
  if (!def.planMin) return true;
  return plan !== null && PLAN_KEYS.indexOf(plan) >= PLAN_KEYS.indexOf(def.planMin);
}

export const badgeById = (id: string): BadgeDef | null => BY_ID.get(id) ?? customById.get(id) ?? null;
export const isSelfBadge = (id: string): boolean => BY_ID.get(id)?.unlock === 'self';

/** How many badges the showcase of the profile holds, by plan: one with no plan, then 2, 4 and 6. */
export const SHOWCASE_SLOTS: Readonly<Record<PlanKey | 'none', number>> = { none: 1, bronze: 2, silver: 4, gold: 6 };
export const MAX_SLOTS = 6;

/** The plan a `plan_key` of the database stands for, or null when it is not one of the three plans of a person (the Premium of a server is another thing). */
export function planOf(planKey: string | null | undefined): PlanKey | null {
  const key = String(planKey ?? '').toLowerCase();
  return (PLAN_KEYS as readonly string[]).includes(key) ? (key as PlanKey) : null;
}

export const slotsFor = (plan: PlanKey | null): number => SHOWCASE_SLOTS[plan ?? 'none'];

/** The badge of a plan, which is always owned while the plan is active. */
export const planBadgeId = (plan: PlanKey): string => `plan-${plan}`;

/** What a person owns: what they have saved plus the badge of their plan. */
export function ownedBadges(saved: readonly string[], plan: PlanKey | null): string[] {
  const owned = new Set(saved.filter((id) => (BY_ID.has(id) || customById.has(id)) && badgeById(id)?.unlock !== 'plan'));
  if (plan) owned.add(planBadgeId(plan));
  return [...owned];
}

/** The list a person chose, cut to what they own and what fits: no repeats, no badge they do not have, at most `slots`. */
export function normalizeShowcase(chosen: readonly string[], owned: readonly string[], slots: number): string[] {
  const have = new Set(owned);
  const out: string[] = [];
  for (const id of chosen) {
    if (out.length >= Math.max(0, Math.min(slots, MAX_SLOTS))) break;
    if (have.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** What a badge of the shop costs (0 for a badge that is not for sale). */
export const priceOf = (def: BadgeDef): number => (def.unlock === 'shop' ? (def.price ?? RARITY_PRICE[def.rarity ?? 'common']) : 0);

/** The tab a badge belongs to. */
export function categoryOf(def: BadgeDef): BadgeCategory {
  if (def.category) return def.category;
  if (def.unlock === 'plan') return 'plan';
  if (def.region) return 'country';
  if (def.language) return 'language';
  return def.pack === 'fablo' ? 'fablo' : 'status';
}

/** The text drawn on a badge that has no art: the code of its country or language. */
export const badgeLabel = (def: BadgeDef): string => (def.region ?? def.language ?? '').toUpperCase();

/** The name of a badge in a language: a country or a language by the name the language gives it, the rest from the catalog (`tr`). */
export function badgeName(lang: string, def: BadgeDef, tr: (key: string) => string): string {
  try {
    if (def.region) return new Intl.DisplayNames([lang], { type: 'region' }).of(def.region) ?? def.region;
    if (def.language) return new Intl.DisplayNames([lang], { type: 'language' }).of(def.language) ?? def.language;
  } catch { /* an old runtime without names: the code is shown */ }
  if (def.names) return def.names[lang] ?? def.names[lang.split('-')[0]] ?? def.names.en ?? def.id;
  return tr(`profiles.badge.${def.id}`);
}
