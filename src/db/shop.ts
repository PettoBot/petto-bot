// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The shop of the profile that is not a badge of the code (tables `shop_packs`, `shop_items`, `user_items`, `badge_overrides` and the two columns of `user_profile`):
// packs, banners and name fonts with their files, the changes of the team to the badges of the code, what a person has and what they have on.
// Taking something off sale keeps the row, so whoever bought it keeps it.
// Written in TypeScript: `npm run build:ts` compiles it over db/shop.js.
import type { PackInput, ItemInput, OverrideInput } from '../utils/shopRules';
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

export type ItemKind = 'banner' | 'font';
export interface PackRow {
  id: string; kind: 'badge' | 'banner' | 'font'; names: Record<string, string>; color: string; price: number | null; free: boolean;
  saleFrom: string | null; saleUntil: string | null; planMin: string | null; active: boolean; updatedAt: string;
}
export interface ItemRow {
  kind: ItemKind; id: string; packId: string | null; names: Record<string, string>; rarity: string; price: number | null; hasFile: boolean;
  saleFrom: string | null; saleUntil: string | null; planMin: string | null; active: boolean; updatedAt: string;
}
export interface OverrideRow {
  id: string; names: Record<string, string> | null; color: string | null; rarity: string | null; price: number | null; hasImage: boolean; packId: string | null; active: boolean | null; updatedAt: string;
}

const iso = (value: unknown): string | null => (value ? new Date(String(value)).toISOString() : null);
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

export async function listPacks(): Promise<PackRow[]> {
  const { rows } = await getPrimaryPool().query('select id, kind, names, color, price, free, sale_from, sale_until, plan_min, active, updated_at from shop_packs order by created_at, id');
  return rows.map((row) => ({
    id: String(row.id), kind: String(row.kind) as PackRow['kind'], names: row.names as Record<string, string>, color: String(row.color), price: num(row.price), free: Boolean(row.free),
    saleFrom: iso(row.sale_from), saleUntil: iso(row.sale_until), planMin: text(row.plan_min), active: Boolean(row.active), updatedAt: iso(row.updated_at) ?? '',
  }));
}

/** Creates a pack or edits it (its kind never changes). Returns whether it was new, or null when the id is already used by a pack of another kind. */
export async function savePack(input: PackInput): Promise<boolean | null> {
  const pool = getPrimaryPool();
  const found = await pool.query('select kind from shop_packs where id = $1', [input.id]);
  if (found.rows[0] && String(found.rows[0].kind) !== input.kind) return null;
  const params = [input.id, JSON.stringify(input.names), input.color, input.price, input.free, input.saleFrom, input.saleUntil, input.planMin];
  if (found.rows[0]) {
    await pool.query('update shop_packs set names = $2::jsonb, color = $3, price = $4, free = $5, sale_from = $6, sale_until = $7, plan_min = $8, updated_at = now() where id = $1', params);
    return false;
  }
  await pool.query('insert into shop_packs (id, kind, names, color, price, free, sale_from, sale_until, plan_min) values ($1, $9, $2::jsonb, $3, $4, $5, $6, $7, $8)', [...params, input.kind]);
  return true;
}

export async function setPackActive(id: string, active: boolean): Promise<boolean> {
  const { rows } = await getPrimaryPool().query('update shop_packs set active = $2, updated_at = now() where id = $1 returning id', [id, active]);
  return rows.length > 0;
}

const ITEM_COLUMNS = 'kind, id, pack_id, names, rarity, price, (file is not null) as has_file, sale_from, sale_until, plan_min, active, updated_at';

export async function listItems(): Promise<ItemRow[]> {
  const { rows } = await getPrimaryPool().query(`select ${ITEM_COLUMNS} from shop_items order by created_at, id`);
  return rows.map((row) => ({
    kind: String(row.kind) as ItemKind, id: String(row.id), packId: text(row.pack_id), names: row.names as Record<string, string>, rarity: String(row.rarity), price: num(row.price),
    hasFile: Boolean(row.has_file), saleFrom: iso(row.sale_from), saleUntil: iso(row.sale_until), planMin: text(row.plan_min), active: Boolean(row.active), updatedAt: iso(row.updated_at) ?? '',
  }));
}

export async function getItemFile(kind: ItemKind, id: string): Promise<{ bytes: Buffer; type: string; updatedAt: string } | null> {
  const { rows } = await getPrimaryPool().query('select file, file_type, updated_at from shop_items where kind = $1 and id = $2 and file is not null', [kind, id]);
  if (!rows[0]) return null;
  return { bytes: rows[0].file as Buffer, type: String(rows[0].file_type), updatedAt: iso(rows[0].updated_at) ?? '' };
}

/** Creates a banner or font or edits it (the file is another request). Returns whether it was new. */
export async function saveItem(input: ItemInput, by: string): Promise<boolean> {
  const pool = getPrimaryPool();
  const params = [input.kind, input.id, input.packId, JSON.stringify(input.names), input.rarity, input.price, input.saleFrom, input.saleUntil, input.planMin];
  const updated = await pool.query(
    'update shop_items set pack_id = $3, names = $4::jsonb, rarity = $5, price = $6, sale_from = $7, sale_until = $8, plan_min = $9, updated_at = now() where kind = $1 and id = $2 returning id', params);
  if (updated.rows.length) return false;
  await pool.query('insert into shop_items (kind, id, pack_id, names, rarity, price, sale_from, sale_until, plan_min, created_by) values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10)', [...params, by]);
  return true;
}

export async function setItemFile(kind: ItemKind, id: string, bytes: Buffer, type: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query('update shop_items set file = $3, file_type = $4, updated_at = now() where kind = $1 and id = $2 returning id', [kind, id, bytes, type]);
  return rows.length > 0;
}

export async function setItemActive(kind: ItemKind, id: string, active: boolean): Promise<boolean> {
  const { rows } = await getPrimaryPool().query('update shop_items set active = $3, updated_at = now() where kind = $1 and id = $2 returning id', [kind, id, active]);
  return rows.length > 0;
}

export async function listOverrides(): Promise<OverrideRow[]> {
  const { rows } = await getPrimaryPool().query('select id, names, color, rarity, price, (image is not null) as has_image, pack_id, active, updated_at from badge_overrides');
  return rows.map((row) => ({
    id: String(row.id), names: (row.names as Record<string, string> | null) ?? null, color: text(row.color), rarity: text(row.rarity), price: num(row.price),
    hasImage: Boolean(row.has_image), packId: text(row.pack_id), active: row.active === null ? null : Boolean(row.active), updatedAt: iso(row.updated_at) ?? '',
  }));
}

export async function getOverrideImage(id: string): Promise<{ bytes: Buffer; type: string; updatedAt: string } | null> {
  const { rows } = await getPrimaryPool().query('select image, image_type, updated_at from badge_overrides where id = $1 and image is not null', [id]);
  if (!rows[0]) return null;
  return { bytes: rows[0].image as Buffer, type: String(rows[0].image_type), updatedAt: iso(rows[0].updated_at) ?? '' };
}

/** Saves what the team changed in a badge of the code (the picture is another request). */
export async function saveOverride(input: OverrideInput): Promise<void> {
  await getPrimaryPool().query(
    `insert into badge_overrides (id, names, color, rarity, price, pack_id, active) values ($1, $2::jsonb, $3, $4, $5, $6, $7)
     on conflict (id) do update set names = excluded.names, color = excluded.color, rarity = excluded.rarity, price = excluded.price, pack_id = excluded.pack_id, active = excluded.active, updated_at = now()`,
    [input.id, input.names ? JSON.stringify(input.names) : null, input.color, input.rarity, input.price, input.packId, input.active]);
}

export async function setOverrideImage(id: string, bytes: Buffer, type: string): Promise<void> {
  await getPrimaryPool().query(
    `insert into badge_overrides (id, image, image_type) values ($1, $2, $3)
     on conflict (id) do update set image = excluded.image, image_type = excluded.image_type, updated_at = now()`, [id, bytes, type]);
}

/** Forgets every change of the team to a badge of the code: it is the one of the code again. */
export async function resetOverride(id: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query('delete from badge_overrides where id = $1 returning id', [id]);
  return rows.length > 0;
}

export async function getUserItems(userId: string): Promise<{ kind: ItemKind; id: string }[]> {
  const { rows } = await getPrimaryPool().query('select kind, item_id from user_items where user_id = $1 order by acquired_at', [userId]);
  return rows.map((row) => ({ kind: String(row.kind) as ItemKind, id: String(row.item_id) }));
}

/** Saves a banner or font for a person. Returns whether it was new. */
export async function addUserItem(userId: string, kind: ItemKind, itemId: string, source: 'shop' | 'pack' | 'free' | 'team'): Promise<boolean> {
  const { rows } = await getPrimaryPool().query(
    'insert into user_items (user_id, kind, item_id, source) values ($1, $2, $3, $4) on conflict (user_id, kind, item_id) do nothing returning item_id', [userId, kind, itemId, source]);
  return rows.length > 0;
}

export async function getActive(userId: string): Promise<{ banner: string | null; font: string | null }> {
  const { rows } = await getPrimaryPool().query('select banner_id, font_id from user_profile where user_id = $1', [userId]);
  return { banner: text(rows[0]?.banner_id), font: text(rows[0]?.font_id) };
}

/** Puts a banner or a font on (null takes it off). */
export async function setActive(userId: string, kind: ItemKind, itemId: string | null): Promise<void> {
  const column = kind === 'banner' ? 'banner_id' : 'font_id';
  await getPrimaryPool().query(
    `insert into user_profile (user_id, ${column}) values ($1, $2) on conflict (user_id) do update set ${column} = excluded.${column}, updated_at = now()`, [userId, itemId]);
}

/** How many people have each banner and font (`kind:id` is the key). The counts of badges come from user_badges. */
export async function itemOwnerCounts(): Promise<Record<string, number>> {
  const { rows } = await getPrimaryPool().query('select kind, item_id, count(*)::int as owners from user_items group by kind, item_id');
  return Object.fromEntries(rows.map((row) => [`${row.kind}:${row.item_id}`, Number(row.owners)]));
}

/** Puts a piece in the shop only if it is not there yet (the bot does it when it starts, so what the team edits afterwards is never overwritten). Returns whether it was added. */
export async function insertItemIfMissing(item: { kind: ItemKind; id: string; names: Record<string, string>; rarity: string; file: Buffer; fileType: string }): Promise<boolean> {
  const { rows } = await getPrimaryPool().query(
    `insert into shop_items (kind, id, names, rarity, file, file_type, created_by) values ($1, $2, $3::jsonb, $4, $5, $6, 'seed')
     on conflict (kind, id) do nothing returning id`, [item.kind, item.id, JSON.stringify(item.names), item.rarity, item.file, item.fileType]);
  return rows.length > 0;
}
