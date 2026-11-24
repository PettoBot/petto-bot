// i18n-ignore-file: the answers are codes; the editor of the website writes the words.
// What the editor of badges of the team does: list the badges with how each one stands (on sale, planned, ended, off sale, given by a rule) and how many people have it,
// save one, put its picture, take it off sale or put it back. Only the owner (the routes check it). Forgets the read badges after each change so the shop shows it at once.
// Written in TypeScript: `npm run build:ts` compiles it over utils/badgeAdmin.js.
const check = require('./customBadgeRules') as typeof import('./customBadgeRules');
const customDb = require('../db/customBadges') as typeof import('../db/customBadges');
const registry = require('./badgeRegistry') as typeof import('./badgeRegistry');

export type SaleStatus = 'live' | 'scheduled' | 'ended' | 'retired' | 'rule';

/** How a badge of the editor stands at a moment. */
export function saleStatus(row: Pick<import('../db/customBadges').CustomRow, 'active' | 'grantRule' | 'saleFrom' | 'saleUntil'>, now: Date = new Date()): SaleStatus {
  if (!row.active) return 'retired';
  if (row.grantRule) return 'rule';
  if (row.saleFrom && new Date(row.saleFrom).getTime() > now.getTime()) return 'scheduled';
  if (row.saleUntil && new Date(row.saleUntil).getTime() <= now.getTime()) return 'ended';
  return 'live';
}

export async function list(now: Date = new Date()) {
  const [rows, owners] = await Promise.all([customDb.listCustomBadges(), customDb.ownerCounts()]);
  return { badges: rows.filter((row) => !row.id.startsWith('own-')).map((row) => ({ ...row, status: saleStatus(row, now), owners: owners[row.id] ?? 0 })) };
}

export async function save(userId: string, body: Record<string, unknown>) {
  const checked = check.checkBadgeInput(body);
  if (!checked.ok) return { ok: false as const, error: (checked as { error: string }).error };
  const created = await customDb.saveCustomBadge(checked.value, userId);
  registry.invalidate();
  return { ok: true as const, created, id: checked.value.id };
}

export async function setImage(id: string, bytes: Buffer) {
  const checked = check.checkImage(bytes);
  if (!checked.ok) return { ok: false as const, error: (checked as { error: string }).error };
  const found = await customDb.setCustomImage(id, bytes, checked.type);
  registry.invalidate();
  return found ? { ok: true as const } : { ok: false as const, error: 'not_found' };
}

export async function setActive(id: string, active: boolean) {
  const found = await customDb.setBadgeActive(id, active);
  registry.invalidate();
  return found ? { ok: true as const } : { ok: false as const, error: 'not_found' };
}
