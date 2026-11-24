// i18n-ignore-file: the answers are codes; the website writes the words.
// Own pictures (a background of the rank card made by the person): the plan that allows it, the policy they accept first, the picture waiting for review, and what the team does
// with it (approve, reject, take down, block). Only an approved picture is drawn. Kept apart from the API of the pages so the checks can run it alone.
// Written in TypeScript: `npm run build:ts` compiles it over utils/uploadActions.js.
const uploadsDb = require('../db/userUploads') as typeof import('../db/userUploads');
const plansDb = require('../db/userPlans') as typeof import('../db/userPlans');
const plans = require('./userPlans') as typeof import('./userPlans');
const images = require('./shopImages') as typeof import('./shopImages');

/** The version of the policy of the user. A new one is asked again to everybody who accepted an older one. */
export const POLICY_VERSION = 1;
export const MAX_UPLOAD_BYTES = 1_048_576;
const ID = /^\d{15,25}$/;
const REASONS = ['sexual', 'minor', 'violence', 'hate', 'illegal', 'private', 'copyright', 'quality', 'other'] as const;
export type Reason = (typeof REASONS)[number];

/** What the plan of a person allows for an own picture: none, a still one or an animated one (animated pictures are not supported yet, so they are still too). */
async function perkOf(userId: string): Promise<'none' | 'still' | 'animated'> {
  const row = await plansDb.getPlan(userId).catch(() => null);
  const tier = row && row.active ? row.plan : 'free';
  return plans.PLAN_PERKS[tier as keyof typeof plans.PLAN_PERKS]?.ownBackground ?? 'none';
}

export async function state(userId: string) {
  const [perk, version, blocked, upload] = await Promise.all([perkOf(userId), uploadsDb.policyVersionOf(userId), uploadsDb.isBlocked(userId), uploadsDb.getState(userId)]);
  return { ok: true as const, allowed: perk !== 'none', perk, policyAccepted: version >= POLICY_VERSION, policyVersion: POLICY_VERSION, blocked, upload };
}

export async function acceptPolicy(userId: string) {
  await uploadsDb.acceptPolicy(userId, POLICY_VERSION);
  return { ok: true as const };
}

/** Receives a picture: it waits for review (nobody sees it until it is approved). */
export async function submit(userId: string, bytes: unknown) {
  if (await uploadsDb.isBlocked(userId)) return { ok: false as const, error: 'blocked' as const };
  if (await perkOf(userId) === 'none') return { ok: false as const, error: 'premium_required' as const };
  if ((await uploadsDb.policyVersionOf(userId)) < POLICY_VERSION) return { ok: false as const, error: 'policy_required' as const };
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { ok: false as const, error: 'bad_file' as const };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false as const, error: 'too_big' as const };
  const done = await images.normalizeBanner(bytes);
  if (!done.ok) return { ok: false as const, error: (done as { error: 'bad_file' | 'file_too_small' }).error };
  await uploadsDb.setPending(userId, done.bytes);
  return { ok: true as const };
}

/** The picture that is drawn for a person: the approved one, or null. */
export const approvedImage = (userId: string) => uploadsDb.approvedBytes(userId);

// ---- the team (the routes check that the person is the owner)
export async function queue() {
  const [pending, blocked] = await Promise.all([uploadsDb.listPending(30), uploadsDb.listBlocked(50)]);
  return { ok: true as const, pending, blocked };
}
export async function pendingFile(userId: string) { return ID.test(userId) ? uploadsDb.pendingBytes(userId) : null; }

/** `action`: approve, reject (with a reason; `block` also stops the person), takedown (removes what they have, with a reason; `block` also stops them) or unblock. */
export async function review(adminId: string, body: Record<string, unknown>) {
  const person = typeof body.person === 'string' && ID.test(body.person) ? body.person : null;
  if (!person) return { ok: false as const, error: 'bad_person' as const };
  const action = body.action;
  const reason = (REASONS as readonly string[]).includes(body.reason as string) ? (body.reason as Reason) : 'other';
  if (action === 'approve') return (await uploadsDb.approve(person)) ? { ok: true as const } : { ok: false as const, error: 'nothing_pending' as const };
  if (action === 'unblock') return (await uploadsDb.unblock(person)) ? { ok: true as const } : { ok: false as const, error: 'not_blocked' as const };
  if (action === 'reject' || action === 'takedown') {
    // A picture with a minor is never kept: it is removed, the person is blocked, and the team has to report it as the law asks (nothing here sends it anywhere).
    const must = reason === 'minor';
    const did = action === 'reject' ? await uploadsDb.reject(person, reason) : await uploadsDb.takedown(person, reason);
    if (!did) return { ok: false as const, error: action === 'reject' ? ('nothing_pending' as const) : ('nothing_to_remove' as const) };
    if (must) await uploadsDb.takedown(person, reason);
    if (must || body.block === true) await uploadsDb.block(person, reason, adminId);
    return { ok: true as const, blocked: must || body.block === true };
  }
  return { ok: false as const, error: 'bad_request' as const };
}
