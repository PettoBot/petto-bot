// i18n-ignore-file: the rules and the codes of the errors of the editor of badges; the words are in the website.
// What the editor of badges accepts: an id, the words in each language, a tab, a rarity, a price, the days of the sale, a plan, a rule and a picture. Pure, so the same
// check runs in the route of the bot and in scripts/check-custom-badges.js.
// Written in TypeScript: `npm run build:ts` compiles it over utils/customBadgeRules.js.
import type { BadgeCategory, Rarity, PlanKey } from './profileBadges';

export const MAX_IMAGE_BYTES = 256 * 1024;
export const CATEGORIES: readonly BadgeCategory[] = ['special', 'status', 'fablo', 'country', 'language'];
export const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic', 'legendary'];
export const GRANT_RULES = ['voter', 'booster', 'partner', 'server_boost'] as const;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
const LANGS = ['en', 'es', 'pt-BR'] as const;
/** The ids of the badges of the code: a badge of the editor cannot take one of them or start like a country or a language. */
const RESERVED = /^(country-|lang-|plan-)/;
const BUILT_IN = new Set(['furro', 'boykisser', 'hetero', 'femboy']);

export interface BadgeInput {
  id: string; names: Record<string, string>; category: BadgeCategory; rarity: Rarity; price: number; color: string;
  saleFrom: string | null; saleUntil: string | null; planMin: PlanKey | null; grantRule: string | null; packId: string | null;
}
export type Checked = { ok: true; value: BadgeInput } | { ok: false; error: string };

/** The kind of picture from its first bytes (never from what the name or the sender says). */
export function imageTypeOf(bytes: Buffer): string | null {
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length > 6 && bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const date = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined || value === '') return null;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};

/** Checks what the editor sent (the picture comes in its own request: see `checkImage`). */
export function checkBadgeInput(body: Record<string, unknown>): Checked {
  const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(id) || RESERVED.test(id) || BUILT_IN.has(id)) return { ok: false, error: 'bad_id' };
  const rawNames = body.names && typeof body.names === 'object' ? body.names as Record<string, unknown> : {};
  const en = typeof rawNames.en === 'string' ? rawNames.en.trim() : '';
  if (!en || en.length > 40) return { ok: false, error: 'bad_name' };
  const names: Record<string, string> = { en };
  for (const lang of LANGS) {
    if (lang === 'en') continue;
    const text = typeof rawNames[lang] === 'string' ? (rawNames[lang] as string).trim() : '';
    if (text.length > 40) return { ok: false, error: 'bad_name' };
    names[lang] = text || en;
  }
  const category = (CATEGORIES as readonly string[]).includes(String(body.category)) ? String(body.category) as BadgeCategory : 'special';
  const rarity = (RARITIES as readonly string[]).includes(String(body.rarity)) ? String(body.rarity) as Rarity : 'common';
  const price = Number(body.price ?? 0);
  if (!Number.isInteger(price) || price < 0 || price > 100000) return { ok: false, error: 'bad_price' };
  const color = typeof body.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : '#8f7bd6';
  const saleFrom = date(body.saleFrom), saleUntil = date(body.saleUntil);
  if (saleFrom === undefined || saleUntil === undefined) return { ok: false, error: 'bad_date' };
  if (saleFrom && saleUntil && new Date(saleUntil) <= new Date(saleFrom)) return { ok: false, error: 'bad_dates' };
  const planMin = body.planMin === 'bronze' || body.planMin === 'silver' || body.planMin === 'gold' ? body.planMin : null;
  if (body.planMin && !planMin) return { ok: false, error: 'bad_plan' };
  const grantRule = body.grantRule ? String(body.grantRule) : null;
  if (grantRule && !(GRANT_RULES as readonly string[]).includes(grantRule)) return { ok: false, error: 'bad_rule' };
  if (grantRule && price > 0) return { ok: false, error: 'rule_and_price' };
  const packId = body.packId === null || body.packId === undefined || body.packId === '' ? null : typeof body.packId === 'string' && /^[a-z0-9][a-z0-9-]{2,39}$/.test(body.packId) ? body.packId : undefined;
  if (packId === undefined) return { ok: false, error: 'bad_pack' };
  return { ok: true, value: { id, names, category, rarity, price, color, saleFrom, saleUntil, planMin, grantRule, packId } };
}

/** Checks the picture of a badge: not empty, at most 256 KB, and really a PNG, JPEG, GIF or WebP by its first bytes. */
export function checkImage(bytes: Buffer): { ok: true; type: string } | { ok: false; error: string } {
  if (!bytes.length) return { ok: false, error: 'image_required' };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: 'image_too_big' };
  const type = imageTypeOf(bytes);
  return type ? { ok: true, type } : { ok: false, error: 'bad_image' };
}
