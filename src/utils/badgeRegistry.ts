// i18n-ignore-file: loads the badges of the editor into the catalog; nothing here is shown as it is.
// What the team keeps in the editor: the badges it made, the changes to the badges of the code, the packs, and the banners and name fonts. Read from the database (kept a
// minute, and forgotten at once when the team saves), turned into the same kind of badge as the ones of utils/profileBadges.ts, with their pictures, the files of the
// banners and fonts, and the rules that give a badge by itself (a voter, a booster).
// Written in TypeScript: `npm run build:ts` compiles it over utils/badgeRegistry.js.
import type { Image } from '@napi-rs/canvas';
import type { BadgeDef, BadgeCategory, Rarity, PlanKey } from './profileBadges';
const { loadImage, GlobalFonts } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
const rules = require('./profileBadges') as typeof import('./profileBadges');
const customDb = require('../db/customBadges') as typeof import('../db/customBadges');
const shopDb = require('../db/shop') as typeof import('../db/shop');
const catalog = require('./shopCatalog') as typeof import('./shopCatalog');

const FRESH_MS = 60_000;
let loadedAt = 0;
let loading: Promise<void> | null = null;
const art = new Map<string, { updatedAt: string; image: Image | null }>();

function toDef(row: import('../db/customBadges').CustomRow): BadgeDef {
  return {
    id: row.id, custom: true, unlock: row.grantRule ? 'status' : 'shop', art: row.hasImage ? 'custom' : null, color: row.color, names: row.names, category: row.category as BadgeCategory,
    rarity: row.rarity as Rarity, price: row.grantRule ? 0 : row.price, saleFrom: row.saleFrom, saleUntil: row.saleUntil, planMin: (row.planMin as PlanKey | null) ?? null,
    grantRule: row.grantRule, retired: !row.active, version: row.updatedAt, pack: row.packId ?? undefined, dbArt: row.hasImage,
  };
}

/** Reads the badges of the editor now. A failed read leaves the ones that were there. */
export async function refresh(): Promise<void> {
  try {
    const [badgeRows, overrides, packRows, itemRows] = await Promise.all([customDb.listCustomBadges(), shopDb.listOverrides(), shopDb.listPacks(), shopDb.listItems()]);
    rules.setPacks(packRows.map((pack): import('./profileBadges').PackDef => ({
      id: pack.id, kind: pack.kind, names: pack.names, color: pack.color, price: pack.price, free: pack.free, saleFrom: pack.saleFrom, saleUntil: pack.saleUntil,
      planMin: (pack.planMin as PlanKey | null) ?? null, retired: !pack.active,
    })));
    rules.setBadgeChanges(new Map(overrides.map((row): [string, import('./profileBadges').BadgeChange] => [row.id, {
      names: row.names, color: row.color, rarity: row.rarity as Rarity | null, price: row.price, pack: row.packId, dbArt: row.hasImage, retired: row.active === false ? true : null, version: row.updatedAt,
    }])));
    rules.setCustomBadges(badgeRows.map(toDef));
    catalog.setItems(itemRows.map((row): import('./shopCatalog').ItemDef => ({
      kind: row.kind, id: row.id, names: row.names, rarity: row.rarity as Rarity, price: row.price, hasFile: row.hasFile, version: row.updatedAt, credit: row.credit,
      saleFrom: row.saleFrom, saleUntil: row.saleUntil, planMin: (row.planMin as PlanKey | null) ?? null, retired: !row.active, pack: row.packId ?? undefined,
    })));
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
  if (!def.custom && !def.dbArt) return null;
  const known = art.get(def.id);
  try {
    const stored = def.custom ? await customDb.getCustomImage(def.id) : await shopDb.getOverrideImage(def.id);
    if (!stored) return null;
    if (known && known.updatedAt === stored.updatedAt) return known.image;
    const image = await loadImage(stored.bytes);
    if (art.size >= 200) art.delete(art.keys().next().value as string);
    art.set(def.id, { updatedAt: stored.updatedAt, image });
    return image;
  } catch { return known?.image ?? null; }
}

const pictures = new Map<string, { updatedAt: string; image: Image }>();
const fonts = new Map<string, { updatedAt: string; family: string | null; key: ReturnType<typeof GlobalFonts.register> }>();

/** The picture of a banner of the shop, or null. Kept until the banner changes. */
export async function bannerImage(id: string): Promise<Image | null> {
  const known = pictures.get(id);
  try {
    const stored = await shopDb.getItemFile('banner', id);
    if (!stored) return null;
    if (known && known.updatedAt === stored.updatedAt) return known.image;
    const image = await loadImage(stored.bytes);
    if (pictures.size >= 30) pictures.delete(pictures.keys().next().value as string);
    pictures.set(id, { updatedAt: stored.updatedAt, image });
    return image;
  } catch { return known?.image ?? null; }
}

/** Makes a name font of the shop ready to draw with and gives the name of its family, or null when the file cannot be used. Registered once until the font changes. */
export async function fontFamily(id: string): Promise<string | null> {
  const known = fonts.get(id);
  try {
    const stored = await shopDb.getItemFile('font', id);
    if (!stored) return null;
    if (known && known.updatedAt === stored.updatedAt) return known.family;
    if (known?.key) GlobalFonts.remove(known.key);
    const family = `petto-shop-${id}`;
    const key = GlobalFonts.register(stored.bytes, family);
    if (fonts.size >= 60) fonts.delete(fonts.keys().next().value as string);
    fonts.set(id, { updatedAt: stored.updatedAt, family: key ? family : null, key });
    return key ? family : null;
  } catch { return known?.family ?? null; }
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
