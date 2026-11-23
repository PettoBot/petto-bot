// i18n-ignore-file: database layer, nothing here is shown to anyone.
// The badges made in the editor of the team (table `custom_badges`). Taking one off sale keeps the row, so whoever bought it keeps it.
// Written in TypeScript: `npm run build:ts` compiles it over db/customBadges.js.
import type { BadgeInput } from '../utils/customBadgeRules';
interface Pool { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> }
const { getPrimaryPool } = require('./postgres') as { getPrimaryPool: () => Pool };

export interface CustomRow {
  id: string; names: Record<string, string>; category: string; rarity: string; price: number; color: string; hasImage: boolean;
  saleFrom: string | null; saleUntil: string | null; planMin: string | null; grantRule: string | null; active: boolean; updatedAt: string; packId: string | null;
}

const iso = (value: unknown): string | null => (value ? new Date(String(value)).toISOString() : null);
const COLUMNS = 'id, names, category, rarity, price, color, (image is not null) as has_image, sale_from, sale_until, plan_min, grant_rule, active, updated_at, pack_id';

export async function listCustomBadges(): Promise<CustomRow[]> {
  const { rows } = await getPrimaryPool().query(`select ${COLUMNS} from custom_badges order by created_at`);
  return rows.map((row) => ({
    id: String(row.id), names: row.names as Record<string, string>, category: String(row.category), rarity: String(row.rarity), price: Number(row.price), color: String(row.color),
    hasImage: Boolean(row.has_image), saleFrom: iso(row.sale_from), saleUntil: iso(row.sale_until), planMin: (row.plan_min as string | null) ?? null,
    grantRule: (row.grant_rule as string | null) ?? null, active: Boolean(row.active), updatedAt: iso(row.updated_at) ?? '', packId: (row.pack_id as string | null) ?? null,
  }));
}

export async function getCustomImage(id: string): Promise<{ bytes: Buffer; type: string; updatedAt: string } | null> {
  const { rows } = await getPrimaryPool().query('select image, image_type, updated_at from custom_badges where id = $1 and image is not null', [id]);
  if (!rows[0]) return null;
  return { bytes: rows[0].image as Buffer, type: String(rows[0].image_type), updatedAt: iso(rows[0].updated_at) ?? '' };
}

/** Creates a badge, or edits it (the picture is another request). Returns whether it was new. */
export async function saveCustomBadge(input: BadgeInput, by: string): Promise<boolean> {
  const pool = getPrimaryPool();
  const params = [input.id, JSON.stringify(input.names), input.category, input.rarity, input.price, input.color, input.saleFrom, input.saleUntil, input.planMin, input.grantRule, input.packId];
  const updated = await pool.query(
    `update custom_badges set names = $2::jsonb, category = $3, rarity = $4, price = $5, color = $6, sale_from = $7, sale_until = $8, plan_min = $9, grant_rule = $10, pack_id = $11, updated_at = now() where id = $1 returning id`, params);
  if (updated.rows.length) return false;
  await pool.query(
    `insert into custom_badges (id, names, category, rarity, price, color, sale_from, sale_until, plan_min, grant_rule, pack_id, created_by) values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`, [...params, by]);
  return true;
}

/** Saves the picture of a badge. Returns whether the badge exists. */
export async function setCustomImage(id: string, bytes: Buffer, type: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query('update custom_badges set image = $2, image_type = $3, updated_at = now() where id = $1 returning id', [id, bytes, type]);
  return rows.length > 0;
}

/** Puts a badge on sale again or takes it off (whoever has it keeps it). Returns whether it exists. */
export async function setBadgeActive(id: string, active: boolean): Promise<boolean> {
  const { rows } = await getPrimaryPool().query('update custom_badges set active = $2, updated_at = now() where id = $1 returning id', [id, active]);
  return rows.length > 0;
}

/** Whether a person voted for the bot in the last 30 days (the rule `voter`). */
export async function votedRecently(userId: string): Promise<boolean> {
  const { rows } = await getPrimaryPool().query("select 1 from bot_votes where user_id = $1 and voted_at > now() - interval '30 days' limit 1", [userId]);
  return rows.length > 0;
}

/** How many people have each badge (the ids of the badges are the keys). */
export async function ownerCounts(): Promise<Record<string, number>> {
  const { rows } = await getPrimaryPool().query('select badge_id, count(*)::int as owners from user_badges group by badge_id');
  return Object.fromEntries(rows.map((row) => [String(row.badge_id), Number(row.owners)]));
}
