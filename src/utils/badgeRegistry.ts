// i18n-ignore-file: loads the badges of the editor into the catalog; nothing here is shown as it is.
// The badges made in the editor of the team: read from the database (kept a minute, and forgotten at once when the team saves one), turned into the same kind of
// badge as the ones of utils/profileBadges.ts, with their pictures, and the rules that give a badge by itself (a voter, a booster).
// Written in TypeScript: `npm run build:ts` compiles it over utils/badgeRegistry.js.
import type { Image } from '@napi-rs/canvas';
import type { BadgeDef, BadgeCategory, Rarity, PlanKey } from './profileBadges';
const { loadImage } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
const rules = require('./profileBadges') as typeof import('./profileBadges');
const customDb = require('../db/customBadges') as typeof import('../db/customBadges');

const FRESH_MS = 60_000;
let loadedAt = 0;
let loading: Promise<void> | null = null;
const art = new Map<string, { updatedAt: string; image: Image | null }>();

function toDef(row: import('../db/customBadges').CustomRow): BadgeDef {
  return {
    id: row.id, custom: true, unlock: row.grantRule ? 'status' : 'shop', art: row.hasImage ? 'custom' : null, color: row.color, names: row.names, category: row.category as BadgeCategory,
    rarity: row.rarity as Rarity, price: row.grantRule ? 0 : row.price, saleFrom: row.saleFrom, saleUntil: row.saleUntil, planMin: (row.planMin as PlanKey | null) ?? null,
    grantRule: row.grantRule, retired: !row.active, version: row.updatedAt,
  };
}

/** Reads the badges of the editor now. A failed read leaves the ones that were there. */
export async function refresh(): Promise<void> {
  try {
    rules.setCustomBadges((await customDb.listCustomBadges()).map(toDef));
    loadedAt = Date.now();
  } catch { /* the database could not be read: the badges of the code and the last ones read stay */ }
}

/** Makes sure the badges of the editor are not older than a minute. Many calls at once share one read. */
export async function ensure(): Promise<void> {
  if (Date.now() - loadedAt < FRESH_MS) return;
  loading ??= refresh().finally(() => { loading = null; });
  await loading;
}

/** Forgets what was read: the next call reads again (the team just saved a badge). */
export function invalidate(): void { loadedAt = 0; }

/** The picture of a badge of the editor, or null. Kept until the badge changes. */
export async function customArt(def: BadgeDef): Promise<Image | null> {
  if (!def.custom) return null;
  const known = art.get(def.id);
  try {
    const stored = await customDb.getCustomImage(def.id);
    if (!stored) return null;
    if (known && known.updatedAt === stored.updatedAt) return known.image;
    const image = await loadImage(stored.bytes);
    if (art.size >= 200) art.delete(art.keys().next().value as string);
    art.set(def.id, { updatedAt: stored.updatedAt, image });
    return image;
  } catch { return known?.image ?? null; }
}

// What makes a person qualify for a badge that is given by itself. `voter` is read from the votes; the others need Discord, so the bot gives its own answer
// when it starts (`setGrantChecker`); until it does, or for a rule with no source yet (`partner`, `server_boost`), nobody qualifies.
type Checker = (rule: string, userId: string) => Promise<boolean>;
let checker: Checker | null = null;
export function setGrantChecker(fn: Checker | null): void { checker = fn; }

async function qualifies(rule: string, userId: string): Promise<boolean> {
  try {
    if (rule === 'voter') return await customDb.votedRecently(userId);
    return checker ? await checker(rule, userId) : false;
  } catch { return false; }
}

/** The badges of the editor that a person has by what they are right now (the ids). */
export async function grantedFor(userId: string): Promise<string[]> {
  const ruled = rules.allBadges().filter((def) => def.custom && def.grantRule && !def.retired);
  const out: string[] = [];
  for (const def of ruled) if (await qualifies(def.grantRule as string, userId)) out.push(def.id);
  return out;
}

/** Tells the registry how to ask Discord: a `booster` is somebody who boosts the support server. (`partner` and `server_boost` have no source yet: nobody qualifies.) */
export function useDiscord(client: { guilds: { cache: { get(id: string): { members: { fetch(id: string): Promise<{ premiumSinceTimestamp?: number | null } | null> } } | undefined } } }, supportGuildId: string | null): void {
  setGrantChecker(async (rule, userId) => {
    if (rule !== 'booster' || !supportGuildId) return false;
    const guild = client.guilds.cache.get(supportGuildId);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;
    return Boolean(member?.premiumSinceTimestamp);
  });
}
