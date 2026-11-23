// i18n-ignore-file: the answers are codes; the editor of the website writes the words.
// What the editor of the shop of the team does besides badges: packs, banners and name fonts (made from scratch, with their file), and the changes to the badges of the code
// (their words, colour, rarity, price, picture and pack). Only the owner (the routes check it). Forgets what was read after each change so the shop shows it at once.
// Written in TypeScript: `npm run build:ts` compiles it over utils/shopAdmin.js.
const rules = require('./shopRules') as typeof import('./shopRules');
const badges = require('./profileBadges') as typeof import('./profileBadges');
const shopDb = require('../db/shop') as typeof import('../db/shop');
const customDb = require('../db/customBadges') as typeof import('../db/customBadges');
const badgeAdmin = require('./badgeAdmin') as typeof import('./badgeAdmin');
const registry = require('./badgeRegistry') as typeof import('./badgeRegistry');
const images = require('./shopImages') as typeof import('./shopImages');

const fail = (error: string) => ({ ok: false as const, error });
const err = (checked: unknown): string => (checked as { error: string }).error;

/** Everything the editor shows: the packs and the pieces in each, the banners and fonts, and the badges of the code with what the team changed in each. */
export async function list(now: Date = new Date()) {
  const [packRows, itemRows, overrideRows, owners, itemOwners, custom] = await Promise.all([shopDb.listPacks(), shopDb.listItems(), shopDb.listOverrides(), customDb.ownerCounts(), shopDb.itemOwnerCounts(), badgeAdmin.list(now)]);
  const changed = new Map(overrideRows.map((row) => [row.id, row]));
  // The badges of the code: the same ones the shop has (a change can reach any but the plans), each with what the code says and what the team set.
  const builtIn = badges.allBadges().filter((def) => !def.custom && def.unlock !== 'plan').map((def) => {
    const row = changed.get(def.id);
    return {
      id: def.id, region: def.region ?? null, language: def.language ?? null, unlock: def.unlock, color: def.color, rarity: def.rarity ?? null, price: badges.priceOf(def), names: def.names ?? null,
      pack: def.pack ?? null, hasImage: Boolean(row?.hasImage), changed: Boolean(row), retired: Boolean(def.retired), owners: owners[def.id] ?? 0,
    };
  });
  return {
    badges: custom.badges,
    builtIn,
    packs: packRows.map((pack) => ({ ...pack, status: packStatus(pack, now) })),
    items: itemRows.map((item) => ({ ...item, status: packStatus({ active: item.active, saleFrom: item.saleFrom, saleUntil: item.saleUntil }, now), owners: itemOwners[`${item.kind}:${item.id}`] ?? 0 })),
  };
}

/** How a pack or a piece stands at a moment: `live`, `scheduled`, `ended` or `retired`. */
export function packStatus(row: { active: boolean; saleFrom: string | null; saleUntil: string | null }, now: Date = new Date()): 'live' | 'scheduled' | 'ended' | 'retired' {
  if (!row.active) return 'retired';
  if (row.saleFrom && new Date(row.saleFrom).getTime() > now.getTime()) return 'scheduled';
  if (row.saleUntil && new Date(row.saleUntil).getTime() <= now.getTime()) return 'ended';
  return 'live';
}

export async function savePack(body: Record<string, unknown>) {
  const checked = rules.checkPackInput(body);
  if (!checked.ok) return fail(err(checked));
  const created = await shopDb.savePack(checked.value);
  registry.invalidate();
  return created === null ? fail('kind_locked') : { ok: true as const, created, id: checked.value.id };
}

export async function setPackActive(id: string, active: boolean) {
  const found = await shopDb.setPackActive(id, active);
  registry.invalidate();
  return found ? { ok: true as const } : fail('not_found');
}

export async function saveItem(userId: string, body: Record<string, unknown>) {
  const checked = rules.checkItemInput(body);
  if (!checked.ok) return fail(err(checked));
  const pack = checked.value.packId ? (await shopDb.listPacks()).find((each) => each.id === checked.value.packId) : null;
  if (checked.value.packId && (!pack || pack.kind !== checked.value.kind)) return fail('bad_pack');
  const created = await shopDb.saveItem(checked.value, userId);
  registry.invalidate();
  return { ok: true as const, created, id: checked.value.id };
}

export async function setItemFile(kind: string, id: string, bytes: Buffer) {
  if (kind !== 'banner' && kind !== 'font') return fail('bad_kind');
  const checked = kind === 'banner' ? rules.checkBanner(bytes) : rules.checkFont(bytes);
  if (!checked.ok) return fail(err(checked));
  let toSave = bytes, type = checked.type;
  if (kind === 'banner') { // every banner is cut to the same size, so the proportions are right everywhere
    const normalized = await images.normalizeBanner(bytes);
    if (!normalized.ok) return fail(normalized.error);
    toSave = normalized.bytes; type = normalized.type;
  }
  const found = await shopDb.setItemFile(kind, id, toSave, type);
  registry.invalidate();
  return found ? { ok: true as const } : fail('not_found');
}

export async function setItemActive(kind: string, id: string, active: boolean) {
  if (kind !== 'banner' && kind !== 'font') return fail('bad_kind');
  const found = await shopDb.setItemActive(kind, id, active);
  registry.invalidate();
  return found ? { ok: true as const } : fail('not_found');
}

export async function saveOverride(body: Record<string, unknown>) {
  const checked = rules.checkOverrideInput(body);
  if (!checked.ok) return fail(err(checked));
  if (checked.value.packId) {
    const pack = (await shopDb.listPacks()).find((each) => each.id === checked.value.packId);
    if (!pack || pack.kind !== 'badge') return fail('bad_pack');
  }
  await shopDb.saveOverride(checked.value);
  registry.invalidate();
  return { ok: true as const, id: checked.value.id };
}

export async function setOverrideImage(id: string, bytes: Buffer) {
  const asBadge = rules.checkOverrideInput({ id });
  if (!asBadge.ok) return fail(err(asBadge));
  const checked = (require('./customBadgeRules') as typeof import('./customBadgeRules')).checkImage(bytes);
  if (!checked.ok) return fail(err(checked));
  await shopDb.setOverrideImage(id, bytes, checked.type);
  registry.invalidate();
  return { ok: true as const };
}

export async function resetOverride(id: string) {
  const checked = rules.checkOverrideInput({ id });
  if (!checked.ok) return fail(err(checked));
  const found = await shopDb.resetOverride(id);
  registry.invalidate();
  return found ? { ok: true as const } : fail('not_found');
}
