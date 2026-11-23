// i18n-ignore-file: the rules and the codes of the errors of the editor of the shop; the words are in the website.
// What the editor of the shop accepts besides badges: a pack (a named group of badges, banners or name fonts), a banner or a name font with its file, and the changes
// to a badge of the code. Pure, so the same check runs in the routes of the bot and in scripts/check-shop-packs.js.
// Written in TypeScript: `npm run build:ts` compiles it over utils/shopRules.js.
import type { Rarity, PlanKey } from './profileBadges';
const badgeRules = require('./customBadgeRules') as typeof import('./customBadgeRules');

export const MAX_BANNER_BYTES = 768 * 1024;
export const MAX_FONT_BYTES = 768 * 1024;
export const PACK_KINDS = ['badge', 'banner', 'font'] as const;
export type PackKind = (typeof PACK_KINDS)[number];
export const ITEM_KINDS = ['banner', 'font'] as const;
export type ItemKindName = (typeof ITEM_KINDS)[number];
const LANGS = ['en', 'es', 'pt-BR'] as const;
const ID = /^[a-z0-9][a-z0-9-]{2,39}$/;
/** The badges of the code are named by the ids of the code: countries, languages, the Fablo ones and the plans. A change can reach any of them but the plans. */
const CHANGEABLE = /^(country-[a-z]{2}|lang-[a-z]{2}|furro|boykisser|hetero|femboy)$/;

export interface PackInput {
  id: string; kind: PackKind; names: Record<string, string>; color: string; price: number | null; free: boolean;
  saleFrom: string | null; saleUntil: string | null; planMin: PlanKey | null;
}
export interface ItemInput {
  kind: ItemKindName; id: string; packId: string | null; names: Record<string, string>; rarity: Rarity;
  price: number | null; saleFrom: string | null; saleUntil: string | null; planMin: PlanKey | null;
}
export interface OverrideInput {
  id: string; names: Record<string, string> | null; color: string | null; rarity: Rarity | null; price: number | null; packId: string | null; active: boolean | null;
}
export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

function namesOf(raw: unknown, required: boolean): Record<string, string> | null | undefined {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const en = typeof source.en === 'string' ? source.en.trim() : '';
  if (!en) return required ? undefined : null;
  if (en.length > 40) return undefined;
  const names: Record<string, string> = { en };
  for (const lang of LANGS) {
    if (lang === 'en') continue;
    const value = typeof source[lang] === 'string' ? (source[lang] as string).trim() : '';
    if (value.length > 40) return undefined;
    names[lang] = value || en;
  }
  return names;
}

const dateOf = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined || value === '') return null;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};
const planOf = (value: unknown): PlanKey | null | undefined => (value === 'bronze' || value === 'silver' || value === 'gold' ? value : value ? undefined : null);
const rarityOf = (value: unknown): Rarity | null | undefined => ((badgeRules.RARITIES as readonly string[]).includes(String(value)) ? String(value) as Rarity : value ? undefined : null);
const colorOf = (value: unknown): string => (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#8f7bd6');
/** A price that may be left empty (the pack or the rarity decides): null for empty, undefined for a bad one. */
const priceOf = (value: unknown, max: number): number | null | undefined => {
  if (value === null || value === undefined || value === '') return null;
  const price = Number(value);
  return Number.isInteger(price) && price >= 0 && price <= max ? price : undefined;
};
const packIdOf = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' && ID.test(value) ? value : undefined;
};

export function checkPackInput(body: Record<string, unknown>): Checked<PackInput> {
  const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
  if (!ID.test(id)) return { ok: false, error: 'bad_id' };
  const kind = (PACK_KINDS as readonly string[]).includes(String(body.kind)) ? String(body.kind) as PackKind : null;
  if (!kind) return { ok: false, error: 'bad_kind' };
  const names = namesOf(body.names, true);
  if (!names) return { ok: false, error: 'bad_name' };
  const price = priceOf(body.price, 1_000_000);
  if (price === undefined) return { ok: false, error: 'bad_price' };
  const free = body.free === true;
  if (free && price) return { ok: false, error: 'free_and_price' };
  const saleFrom = dateOf(body.saleFrom), saleUntil = dateOf(body.saleUntil);
  if (saleFrom === undefined || saleUntil === undefined) return { ok: false, error: 'bad_date' };
  if (saleFrom && saleUntil && new Date(saleUntil) <= new Date(saleFrom)) return { ok: false, error: 'bad_dates' };
  const planMin = planOf(body.planMin);
  if (planMin === undefined) return { ok: false, error: 'bad_plan' };
  return { ok: true, value: { id, kind, names, color: colorOf(body.color), price: free ? null : price, free, saleFrom, saleUntil, planMin } };
}

export function checkItemInput(body: Record<string, unknown>): Checked<ItemInput> {
  const kind = (ITEM_KINDS as readonly string[]).includes(String(body.kind)) ? String(body.kind) as ItemKindName : null;
  if (!kind) return { ok: false, error: 'bad_kind' };
  const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
  if (!ID.test(id)) return { ok: false, error: 'bad_id' };
  const names = namesOf(body.names, true);
  if (!names) return { ok: false, error: 'bad_name' };
  const rarity = rarityOf(body.rarity) ?? 'common';
  const price = priceOf(body.price, 100_000);
  if (price === undefined) return { ok: false, error: 'bad_price' };
  const packId = packIdOf(body.packId);
  if (packId === undefined) return { ok: false, error: 'bad_pack' };
  const saleFrom = dateOf(body.saleFrom), saleUntil = dateOf(body.saleUntil);
  if (saleFrom === undefined || saleUntil === undefined) return { ok: false, error: 'bad_date' };
  if (saleFrom && saleUntil && new Date(saleUntil) <= new Date(saleFrom)) return { ok: false, error: 'bad_dates' };
  const planMin = planOf(body.planMin);
  if (planMin === undefined) return { ok: false, error: 'bad_plan' };
  return { ok: true, value: { kind, id, packId, names, rarity, price, saleFrom, saleUntil, planMin } };
}

/** What the team changes in a badge of the code. Every field is optional: what is left empty stays as the code has it. */
export function checkOverrideInput(body: Record<string, unknown>): Checked<OverrideInput> {
  const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
  if (!CHANGEABLE.test(id)) return { ok: false, error: 'bad_id' };
  const names = namesOf(body.names, false);
  if (names === undefined) return { ok: false, error: 'bad_name' };
  const rarity = rarityOf(body.rarity);
  if (rarity === undefined) return { ok: false, error: 'bad_rarity' };
  const price = priceOf(body.price, 100_000);
  if (price === undefined) return { ok: false, error: 'bad_price' };
  const packId = packIdOf(body.packId);
  if (packId === undefined) return { ok: false, error: 'bad_pack' };
  const color = typeof body.color === 'string' && body.color ? (/^#[0-9a-fA-F]{6}$/.test(body.color) ? body.color : undefined) : null;
  if (color === undefined) return { ok: false, error: 'bad_color' };
  const active = typeof body.active === 'boolean' ? body.active : null;
  return { ok: true, value: { id, names, color, rarity, price, packId, active } };
}

/** The picture of a banner: not empty, at most 768 KB, a PNG, JPEG or WebP by its first bytes (a GIF is not accepted: the banner of the profile is not animated). */
export function checkBanner(bytes: Buffer): { ok: true; type: string } | { ok: false; error: string } {
  if (!bytes.length) return { ok: false, error: 'file_required' };
  if (bytes.length > MAX_BANNER_BYTES) return { ok: false, error: 'file_too_big' };
  const type = badgeRules.imageTypeOf(bytes);
  return type && type !== 'image/gif' ? { ok: true, type } : { ok: false, error: 'bad_file' };
}

/** The kind of font file from its first bytes: TrueType (`00 01 00 00` or `true`), OpenType with outlines (`OTTO`) or WOFF2 (`wOF2`). Never from the name the sender gives it. */
export function fontTypeOf(bytes: Buffer): string | null {
  if (bytes.length < 12) return null;
  const tag = bytes.subarray(0, 4);
  if (tag.equals(Buffer.from([0x00, 0x01, 0x00, 0x00])) || tag.toString('latin1') === 'true') return 'font/ttf';
  if (tag.toString('latin1') === 'OTTO') return 'font/otf';
  if (tag.toString('latin1') === 'wOF2') return 'font/woff2';
  return null;
}

export function checkFont(bytes: Buffer): { ok: true; type: string } | { ok: false; error: string } {
  if (!bytes.length) return { ok: false, error: 'file_required' };
  if (bytes.length > MAX_FONT_BYTES) return { ok: false, error: 'file_too_big' };
  const type = fontTypeOf(bytes);
  return type ? { ok: true, type } : { ok: false, error: 'bad_file' };
}
