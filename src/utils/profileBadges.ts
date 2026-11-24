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
  /** The pack of badges it belongs to (`fablo` is the free default one), or nothing. A pack can be made in the editor of the team. */
  pack?: string;
  /** Its picture is kept in the database (a badge of the editor, or a badge of the code the team gave another picture). */
  dbArt?: boolean;
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

/** What the sale of a badge, a banner or a name font needs to be known: the days, the plan, whether it was taken off sale and the pack it is in. */
export interface Sellable { retired?: boolean; saleFrom?: string | null; saleUntil?: string | null; planMin?: PlanKey | null; pack?: string }
/** A pack: a named group that can be free, for a plan, for some days or sold whole. Its days and its plan count for every piece in it. */
export interface PackDef {
  id: string; kind: 'badge' | 'banner' | 'font'; names: Record<string, string>; color: string; price: number | null; free: boolean;
  saleFrom: string | null; saleUntil: string | null; planMin: PlanKey | null; retired: boolean;
}
/** What the team changed in a badge of the code: every field is optional, and what is not set stays as the code has it. */
export interface BadgeChange { names?: Record<string, string> | null; color?: string | null; rarity?: Rarity | null; price?: number | null; pack?: string | null; dbArt?: boolean; retired?: boolean | null; version?: string }

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

// The Bufis: six collectible badges of the shop (their pictures are not made yet: each is drawn as a plain hexagon of its color until the team gives it a picture in the editor of
// badges). Black Friday is only on sale for a few days; whoever buys it keeps it for good.
const BUFIS: BadgeDef[] = [
  { id: 'bufi-normal', unlock: 'shop', art: null, color: '#8a8f98', rarity: 'common', category: 'special' },
  { id: 'bufi-silver', unlock: 'shop', art: null, color: '#b8bcc4', rarity: 'rare', category: 'special' },
  { id: 'bufi-girl', unlock: 'shop', art: null, color: '#ff3d8f', rarity: 'rare', category: 'special' },
  { id: 'bufi-boy', unlock: 'shop', art: null, color: '#1e90ff', rarity: 'rare', category: 'special' },
  { id: 'bufi-bu', unlock: 'shop', art: null, color: '#f4cf3a', rarity: 'epic', category: 'special' },
  { id: 'bufi-black-friday', unlock: 'shop', art: null, color: '#2b2b30', rarity: 'epic', category: 'special', saleFrom: '2026-11-20T00:00:00Z', saleUntil: '2026-12-02T00:00:00Z' },
];
export const BADGES: readonly BadgeDef[] = [...BASE_BADGES, ...SHOP, ...BUFIS];
export const SHOP_BADGES: readonly BadgeDef[] = SHOP;

// What the team changes while the bot runs: the badges of the editor, the changes to the badges of the code, and the packs. Everything below reads the merged list.
let custom: readonly BadgeDef[] = [];
let changes: ReadonlyMap<string, BadgeChange> = new Map();
let packs: ReadonlyMap<string, PackDef> = new Map();
let merged: readonly BadgeDef[] = BADGES;
let mergedById = new Map<string, BadgeDef>(BADGES.map((badge) => [badge.id, badge]));

/** A badge of the code with the changes of the team put over it. The plans never change: their icons are the official ones. */
function withChange(def: BadgeDef): BadgeDef {
  const change = def.unlock === 'plan' ? undefined : changes.get(def.id);
  if (!change) return def;
  const out: BadgeDef = { ...def };
  if (change.names) out.names = change.names;
  if (change.color) out.color = change.color;
  if (change.rarity) out.rarity = change.rarity;
  if (change.price !== undefined && change.price !== null) out.price = change.price;
  if (change.pack !== undefined && change.pack !== null) out.pack = change.pack;
  if (change.dbArt) { out.dbArt = true; out.art = 'custom'; }
  if (change.retired) out.retired = true;
  if (change.version) out.version = change.version;
  return out;
}

function rebuild(): void {
  merged = [...BADGES.map(withChange), ...custom];
  mergedById = new Map(merged.map((badge) => [badge.id, badge]));
}

/** Sets the badges made in the editor (utils/badgeRegistry.ts reads them from the database). */
export function setCustomBadges(list: readonly BadgeDef[]): void {
  custom = list;
  rebuild();
}

/** Sets the changes of the team to the badges of the code, keyed by id. */
export function setBadgeChanges(map: ReadonlyMap<string, BadgeChange>): void {
  changes = map;
  rebuild();
}

/** Sets the packs (the Fablo pack and the ones of the editor). */
export function setPacks(list: readonly PackDef[]): void { packs = new Map(list.map((pack) => [pack.id, pack])); }
export const allPacks = (): readonly PackDef[] => [...packs.values()];
export const packById = (id: string | null | undefined): PackDef | null => (id ? packs.get(id) ?? null : null);

/** Every badge that exists: the ones of this file (with the changes of the team) and the ones of the editor. */
export const allBadges = (): readonly BadgeDef[] => merged;
/** The badges that can be bought: the countries and languages, and the ones of the editor that are for sale (even when the sale is not open now). */
export const shopBadges = (): readonly BadgeDef[] => merged.filter((badge) => badge.unlock === 'shop');

/** Whether the sale is open at a moment: not taken off sale, inside its days, and inside the days and the active state of its pack (nothing set is always on sale). */
export function onSale(def: Sellable, now: Date = new Date()): boolean {
  if (def.retired) return false;
  const pack = packById(def.pack);
  if (pack?.retired) return false;
  const at = now.getTime();
  for (const part of [def, pack]) {
    if (part?.saleFrom && new Date(part.saleFrom).getTime() > at) return false;
    if (part?.saleUntil && new Date(part.saleUntil).getTime() <= at) return false;
  }
  return true;
}

/** The plan a piece asks for: the stricter of its own and the one of its pack (null asks for none). */
export function planNeeded(def: Sellable): PlanKey | null {
  const own = def.planMin ?? null, fromPack = packById(def.pack)?.planMin ?? null;
  if (!own || !fromPack) return own ?? fromPack;
  return PLAN_KEYS.indexOf(own) >= PLAN_KEYS.indexOf(fromPack) ? own : fromPack;
}

/** Whether a plan is enough for a piece that asks for one (none asks for none). */
export function planAllows(def: Sellable, plan: PlanKey | null): boolean {
  const needed = planNeeded(def);
  if (!needed) return true;
  return plan !== null && PLAN_KEYS.indexOf(plan) >= PLAN_KEYS.indexOf(needed);
}

export const badgeById = (id: string): BadgeDef | null => mergedById.get(id) ?? null;
export const isSelfBadge = (id: string): boolean => mergedById.get(id)?.unlock === 'self';

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
  const owned = new Set(saved.filter((id) => mergedById.has(id) && badgeById(id)?.unlock !== 'plan'));
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
export const priceOf = (def: BadgeDef): number => (def.unlock === 'shop' && !packById(def.pack)?.free ? (def.price ?? RARITY_PRICE[def.rarity ?? 'common']) : 0);

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
  if (def.names) return def.names[lang] ?? def.names[lang.split('-')[0]] ?? def.names.en ?? def.id;
  try {
    if (def.region) return new Intl.DisplayNames([lang], { type: 'region' }).of(def.region) ?? def.region;
    if (def.language) return new Intl.DisplayNames([lang], { type: 'language' }).of(def.language) ?? def.language;
  } catch { /* an old runtime without names: the code is shown */ }
  return tr(`profiles.badge.${def.id}`);
}
