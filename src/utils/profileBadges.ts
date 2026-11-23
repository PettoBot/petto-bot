// i18n-ignore-file: the catalog of badges; the names a person reads are in the embeds catalog (`profile.badge.<id>`), nothing here is shown as it is.
// The badges of the profile of a person (the image of `/profile`): which exist, how each one is had and how many fit in the showcase.
// Pure rules with no database and no Discord, so scripts/check-profile-card.js tests the same code the command runs.
// Written in TypeScript: `npm run build:ts` compiles it over utils/profileBadges.js.

/** How a badge comes to a person: `plan` follows the plan they pay for (nobody picks it), `self` is turned on and off by the person (an identity badge: nobody gives it, nobody sees it unless they put it), `team` is given by hand, `shop` is bought once with ceramos and then stays. */
export type BadgeUnlock = 'plan' | 'self' | 'team' | 'shop';
export type PlanKey = 'bronze' | 'silver' | 'gold';

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


// The shop: countries and languages, each bought once with ceramos (BADGE_PRICE of utils/ceramos.ts). They have no art yet: they are drawn with their code.
const COUNTRIES: [string, string][] = [['CO', '#f2c230'], ['MX', '#3fa66b'], ['ES', '#e0533d'], ['AR', '#6fb7e8'], ['CL', '#4a6fd1'], ['PE', '#d9483b'], ['BR', '#2f9e5b'], ['US', '#4f6bd8']];
const LANGUAGES: [string, string][] = [['es', '#e8794a'], ['en', '#5a8be0'], ['pt', '#3ea37a']];
const SHOP: BadgeDef[] = [
  ...COUNTRIES.map(([code, color]): BadgeDef => ({ id: `country-${code.toLowerCase()}`, unlock: 'shop', art: null, color, region: code })),
  ...LANGUAGES.map(([code, color]): BadgeDef => ({ id: `lang-${code}`, unlock: 'shop', art: null, color, language: code })),
];

export const BADGES: readonly BadgeDef[] = [...BASE_BADGES, ...SHOP];
export const SHOP_BADGES: readonly BadgeDef[] = SHOP;

const BY_ID = new Map(BADGES.map((badge) => [badge.id, badge]));

export const badgeById = (id: string): BadgeDef | null => BY_ID.get(id) ?? null;
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
  const owned = new Set(saved.filter((id) => BY_ID.has(id) && BY_ID.get(id)?.unlock !== 'plan'));
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

/** The text drawn on a badge that has no art: the code of its country or language. */
export const badgeLabel = (def: BadgeDef): string => (def.region ?? def.language ?? '').toUpperCase();

/** The name of a badge in a language: a country or a language by the name the language gives it, the rest from the catalog (`tr`). */
export function badgeName(lang: string, def: BadgeDef, tr: (key: string) => string): string {
  try {
    if (def.region) return new Intl.DisplayNames([lang], { type: 'region' }).of(def.region) ?? def.region;
    if (def.language) return new Intl.DisplayNames([lang], { type: 'language' }).of(def.language) ?? def.language;
  } catch { /* an old runtime without names: the code is shown */ }
  return tr(`profiles.badge.${def.id}`);
}
