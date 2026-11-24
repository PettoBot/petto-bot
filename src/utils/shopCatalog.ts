// i18n-ignore-file: the catalog of banners and name fonts; the names come from the editor of the team, in each language.
// The banners and the name fonts of the shop of the profile (made in the editor of the team): which exist, what each one costs, and the rules of what is for sale.
// Pure rules with no database, so scripts/check-shop-packs.js tests the same code the shop runs. utils/badgeRegistry.ts fills it from the database.
// Written in TypeScript: `npm run build:ts` compiles it over utils/shopCatalog.js.
import type { Rarity, PlanKey, Sellable } from './profileBadges';
const badges = require('./profileBadges') as typeof import('./profileBadges');

export type ItemKind = 'banner' | 'font';
export interface ItemDef extends Sellable {
  kind: ItemKind; id: string; names: Record<string, string>; rarity: Rarity; price: number | null; hasFile: boolean; version: string; credit?: string | null;
}

let items: readonly ItemDef[] = [];
let byKey = new Map<string, ItemDef>();

/** Sets the banners and fonts (utils/badgeRegistry.ts reads them from the database). `pack` is the id of the pack it is in. */
export function setItems(list: readonly ItemDef[]): void {
  items = list;
  byKey = new Map(list.map((item) => [`${item.kind}:${item.id}`, item]));
}

export const allItems = (kind?: ItemKind): readonly ItemDef[] => (kind ? items.filter((item) => item.kind === kind) : items);
export const itemById = (kind: ItemKind, id: string): ItemDef | null => byKey.get(`${kind}:${id}`) ?? null;

/** What a piece costs: its own price, or the one of its rarity; nothing when it is in a free pack. */
export const priceOf = (item: ItemDef): number => (badges.packById(item.pack)?.free ? 0 : (item.price ?? badges.RARITY_PRICE[item.rarity]));

/** The name of a piece in a language (the editor keeps it in the three languages). */
export const itemName = (lang: string, item: ItemDef): string => item.names[lang] ?? item.names[lang.split('-')[0]] ?? item.names.en ?? item.id;

/** What a pack holds now and what it costs whole: the sum of the pieces, or its own price when the team set one (the whole pack is never dearer than the pieces). */
export function packSummary(packId: string, owned: ReadonlySet<string> = new Set(), plan: PlanKey | null = null, now: Date = new Date()): { pieces: string[]; missing: string[]; fullPrice: number; price: number } | null {
  const pack = badges.packById(packId);
  if (!pack) return null;
  const pieces: { key: string; price: number }[] = [];
  if (pack.kind === 'badge') {
    for (const def of badges.shopBadges()) if (def.pack === packId && badges.onSale(def, now) && badges.planAllows(def, plan)) pieces.push({ key: def.id, price: badges.priceOf(def) });
  } else {
    for (const item of items) if (item.pack === packId && item.kind === pack.kind && item.hasFile && badges.onSale(item, now) && badges.planAllows(item, plan)) pieces.push({ key: `${item.kind}:${item.id}`, price: priceOf(item) });
  }
  const missing = pieces.filter((piece) => !owned.has(piece.key));
  const fullPrice = missing.reduce((sum, piece) => sum + piece.price, 0);
  const price = pack.free ? 0 : pack.price === null ? fullPrice : Math.min(pack.price, fullPrice);
  return { pieces: pieces.map((piece) => piece.key), missing: missing.map((piece) => piece.key), fullPrice, price };
}

export type { PlanKey };
