// i18n-ignore-file: the answers are codes; the website writes the words.
// Own badges: with a plan a person makes their own badges (Bronze 1, Silver 2, Gold 4 — a name and a picture). They go through the same policy, block and detector as the own
// pictures and wait for the team; when one is approved it becomes a badge of the editor that is not for sale, and its maker gets it. Kept apart from the API of the pages so the checks can run it alone.
// Written in TypeScript: `npm run build:ts` compiles it over utils/ownBadgeActions.js.
const { createCanvas, loadImage } = require('@napi-rs/canvas') as typeof import('@napi-rs/canvas');
const ownDb = require('../db/userOwnBadges') as typeof import('../db/userOwnBadges');
const uploadsDb = require('../db/userUploads') as typeof import('../db/userUploads');
const plans = require('./userPlans') as typeof import('./userPlans');
const uploads = require('./uploadActions') as typeof import('./uploadActions');
const detector = require('./imageScreen') as typeof import('./imageScreen');
const gifs = require('../imgutils/gif') as typeof import('../imgutils/gif');
const registry = require('./badgeRegistry') as typeof import('./badgeRegistry');

export const MAX_SLOTS = 4;
export const MAX_BADGE_UPLOAD = 524_288;
export const BADGE_SIDE = 256;
export const MIN_BADGE_SIDE = 64;
const ID = /^\d{15,25}$/;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} _.'!&-]{1,23}$/u;

/** How many own badges the plan of a person lets them have. */
export async function slotsOf(userId: string): Promise<number> {
  const tier = await uploads.planTier(userId);
  return plans.PLAN_PERKS[tier]?.ownBadges ?? 0;
}

const slotOf = (value: unknown): number | null => { const n = Number(value); return Number.isInteger(n) && n >= 1 && n <= MAX_SLOTS ? n : null; };

export async function state(userId: string) {
  const [slots, version, blocked, approved, pending] = await Promise.all([slotsOf(userId), uploadsDb.policyVersionOf(userId), uploadsDb.isBlocked(userId), ownDb.approvedOf(userId), ownDb.pendingOf(userId)]);
  const items = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot += 1) {
    const have = approved.find((row) => row.slot === slot) ?? null;
    const waiting = pending.find((row) => row.slot === slot) ?? null;
    // A slot above what the plan allows now (the plan ended) is shown but cannot be changed.
    if (slot > slots && !have && !waiting) continue;
    items.push({ slot, locked: slot > slots, approved: have ? { id: have.id, name: have.name } : null, pending: waiting ? { name: waiting.name } : null });
  }
  return { ok: true as const, slots, policyAccepted: version >= uploads.POLICY_VERSION, policyVersion: uploads.POLICY_VERSION, blocked, items };
}

/** A picture made square (256 x 256) as a PNG, from a PNG, JPEG or WebP (a GIF is not accepted: the badges do not move). */
async function squareOf(bytes: Buffer): Promise<{ ok: true; png: Buffer } | { ok: false; error: 'bad_file' | 'file_too_small' | 'too_big' }> {
  if (gifs.isGif(bytes)) return { ok: false, error: 'bad_file' };
  let image;
  try { image = await loadImage(bytes); } catch { return { ok: false, error: 'bad_file' }; }
  if (image.width < MIN_BADGE_SIDE || image.height < MIN_BADGE_SIDE) return { ok: false, error: 'file_too_small' };
  const canvas = createCanvas(BADGE_SIDE, BADGE_SIDE);
  const side = Math.min(image.width, image.height);
  canvas.getContext('2d').drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, BADGE_SIDE, BADGE_SIDE);
  const png = canvas.toBuffer('image/png');
  return png.length > 262_144 ? { ok: false, error: 'too_big' } : { ok: true, png };
}

/** Receives a badge: `slot`, `name` and the picture. It waits for review (nobody sees it until it is approved). */
export async function submit(userId: string, input: { slot?: unknown; name?: unknown }, bytes: unknown) {
  if (await uploadsDb.isBlocked(userId)) return { ok: false as const, error: 'blocked' as const };
  const slot = slotOf(input.slot);
  if (!slot) return { ok: false as const, error: 'bad_slot' as const };
  const allowed = await slotsOf(userId);
  if (allowed === 0) return { ok: false as const, error: 'premium_required' as const };
  if (slot > allowed) return { ok: false as const, error: 'slot_locked' as const };
  if ((await uploadsDb.policyVersionOf(userId)) < uploads.POLICY_VERSION) return { ok: false as const, error: 'policy_required' as const };
  const name = typeof input.name === 'string' ? input.name.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  if (!NAME.test(name)) return { ok: false as const, error: 'bad_name' as const };
  const file = (require('./customBadgeRules') as typeof import('./customBadgeRules')).asBytes(bytes);
  if (!file || file.length === 0) return { ok: false as const, error: 'bad_file' as const };
  if (file.length > MAX_BADGE_UPLOAD) return { ok: false as const, error: 'too_big' as const };
  const done = await squareOf(file);
  if (!done.ok) return { ok: false as const, error: (done as { error: 'bad_file' | 'file_too_small' | 'too_big' }).error };
  const png = (done as { png: Buffer }).png;
  const verdict = await detector.screen(png, fetch, 'image/png');
  if (verdict.checked && verdict.minor) { await uploadsDb.block(userId, 'minor', 'detector'); return { ok: false as const, error: 'blocked' as const }; }
  if (verdict.checked && verdict.reasons.length) return { ok: false as const, error: 'detector' as const, reasons: verdict.reasons };
  await ownDb.setPending(userId, slot, name, png, verdict.checked);
  return { ok: true as const };
}

/** The person takes a badge of theirs away (the waiting one, the approved one, or both). */
export async function remove(userId: string, input: { slot?: unknown }) {
  const slot = slotOf(input.slot);
  if (!slot) return { ok: false as const, error: 'bad_slot' as const };
  const [waiting, had] = [await ownDb.removePending(userId, slot), await ownDb.removeApproved(userId, slot)];
  if (had) registry.invalidate();
  return waiting || had ? { ok: true as const } : { ok: false as const, error: 'nothing_to_remove' as const };
}

// ---- the team (the routes check that the person is the owner)
export async function queue() { return { ok: true as const, pending: await ownDb.listPending(30) }; }
export async function pendingFile(userId: string, slot: unknown) { const n = slotOf(slot); return ID.test(userId) && n ? ownDb.pendingImage(userId, n) : null; }

/** `action`: approve, reject (with a reason; `block` also stops the person) or takedown (removes the approved badge, with a reason; `block` also stops them). */
export async function review(adminId: string, body: Record<string, unknown>) {
  const person = typeof body.person === 'string' && ID.test(body.person) ? body.person : null;
  const slot = slotOf(body.slot);
  if (!person || !slot) return { ok: false as const, error: 'bad_person' as const };
  const reason = (uploads.REASONS as readonly string[]).includes(body.reason as string) ? (body.reason as string) : 'other';
  if (body.action === 'approve') {
    const waiting = await ownDb.take(person, slot);
    if (!waiting) return { ok: false as const, error: 'nothing_pending' as const };
    await ownDb.approve(person, slot, waiting.name, waiting.image);
    registry.invalidate();
    return { ok: true as const };
  }
  if (body.action === 'reject' || body.action === 'takedown') {
    const must = reason === 'minor';
    const did = body.action === 'reject' ? Boolean(await ownDb.take(person, slot)) : await ownDb.removeApproved(person, slot);
    if (!did) return { ok: false as const, error: body.action === 'reject' ? ('nothing_pending' as const) : ('nothing_to_remove' as const) };
    if (body.action === 'takedown') registry.invalidate();
    if (must || body.block === true) await uploadsDb.block(person, reason, adminId);
    return { ok: true as const, blocked: must || body.block === true };
  }
  return { ok: false as const, error: 'bad_request' as const };
}
