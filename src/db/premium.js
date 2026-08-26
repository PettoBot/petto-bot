const { Routes } = require('discord.js');
const supabase = require('./supabase');
const logger = require('../utils/logger');

const FREE_LIMITS = Object.freeze({
  customCommands: 25,
  autoResponders: 15,
  ticketCategories: 5,
  levelRewards: 10,
  giveawayPresets: 3,
  logRoutes: 8,
});

const PREMIUM_LIMITS = Object.freeze({
  customCommands: 100,
  autoResponders: 75,
  ticketCategories: 20,
  levelRewards: 40,
  giveawayPresets: 15,
  logRoutes: Number.POSITIVE_INFINITY,
});

/**
 * Premium is account-level but is activated on a guild through a selected slot.
 * This helper is intentionally fail-closed: a missing table, network error or
 * expired entitlement returns Free rather than granting paid access.
 */
async function getGuildPremium(guildId) {
  if (!guildId) return { active: false, userId: null, planKey: null, expiresAt: null };

  try {
    const { data: assignments, error: assignmentError } = await supabase
      .from('premium_slot_assignments')
      .select('entitlement_id,user_id')
      .eq('guild_id', String(guildId))
      .eq('status', 'active')
      .limit(1);
    if (assignmentError || !assignments?.[0]) return { active: false, userId: null, planKey: null, expiresAt: null };

    const assignment = assignments[0];
    const { data: entitlements, error: entitlementError } = await supabase
      .from('premium_entitlements')
      .select('user_id,plan_key,status,current_period_end')
      .eq('id', assignment.entitlement_id)
      .limit(1);
    if (entitlementError || !entitlements?.[0]) return { active: false, userId: null, planKey: null, expiresAt: null };

    const entitlement = entitlements[0];
    const notExpired = !entitlement.current_period_end || new Date(entitlement.current_period_end).getTime() > Date.now();
    // Premium is fail-closed: only an active entitlement with a valid period
    // unlocks paid limits. Past-due and canceled subscriptions use Free limits.
    const active = entitlement.status === 'active' && notExpired;
    return {
      active,
      userId: active ? entitlement.user_id : null,
      planKey: active ? entitlement.plan_key : null,
      expiresAt: active ? entitlement.current_period_end : null,
    };
  } catch {
    return { active: false, userId: null, planKey: null, expiresAt: null };
  }
}

function getGuildLimits(premium) {
  return premium?.active ? PREMIUM_LIMITS : FREE_LIMITS;
}

const ENTITLEMENT_COLUMNS = 'id,user_id,provider,provider_subscription_id,plan_key,status,slot_limit,current_period_end,metadata,created_at,updated_at';
const ASSIGNMENT_COLUMNS = 'id,entitlement_id,user_id,guild_id,status,assigned_at,released_at';

function isDiscordId(value) {
  return /^\d{15,25}$/.test(String(value ?? ''));
}

function isActiveEntitlement(entitlement) {
  if (!entitlement || entitlement.status !== 'active') return false;
  if (!entitlement.current_period_end) return true;
  const timestamp = new Date(entitlement.current_period_end).getTime();
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

async function listUserPremium(userId) {
  if (!isDiscordId(userId)) throw new Error('Invalid Discord user ID.');
  const { data, error } = await supabase
    .from('premium_entitlements')
    .select(ENTITLEMENT_COLUMNS)
    .eq('user_id', String(userId))
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) throw error;
  return data ?? [];
}

async function listUserAssignments(userId) {
  const { data, error } = await supabase
    .from('premium_slot_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('user_id', String(userId))
    .order('assigned_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Returns the current account-level Premium entitlement and its active slots. */
async function getUserPremium(userId) {
  const entitlements = await listUserPremium(userId);
  const assignments = await listUserAssignments(userId);
  const entitlement = entitlements.find(isActiveEntitlement) ?? null;
  const activeAssignments = entitlement
    ? assignments.filter((assignment) => assignment.status === 'active' && String(assignment.entitlement_id) === String(entitlement.id))
    : [];
  const latest = entitlements[0] ?? null;

  return {
    active: Boolean(entitlement),
    userId: String(userId),
    status: entitlement?.status ?? latest?.status ?? 'free',
    planKey: entitlement?.plan_key ?? latest?.plan_key ?? null,
    expiresAt: entitlement?.current_period_end ?? latest?.current_period_end ?? null,
    entitlement,
    entitlements,
    assignments: activeAssignments,
    slotsUsed: activeAssignments.length,
    slotsTotal: entitlement?.slot_limit ?? 0,
  };
}

async function activeAssignmentsForGuild(guildId) {
  const { data, error } = await supabase
    .from('premium_slot_assignments')
    .select(ASSIGNMENT_COLUMNS)
    .eq('guild_id', String(guildId))
    .eq('status', 'active')
    .limit(5);
  if (error) throw error;
  return data ?? [];
}

async function grantManualPremium(userId, slotLimit, grantedBy, guildId = null) {
  if (!isDiscordId(userId)) return { ok: false, code: 'invalid_user' };
  if (!Number.isInteger(slotLimit) || slotLimit < 1 || slotLimit > 1000) return { ok: false, code: 'invalid_slots' };
  if (guildId != null && !isDiscordId(guildId)) return { ok: false, code: 'invalid_guild' };

  const entitlements = await listUserPremium(userId);
  const paidActive = entitlements.find((entitlement) => entitlement.provider !== 'manual' && isActiveEntitlement(entitlement));
  if (paidActive) return { ok: false, code: 'paid_active', entitlement: paidActive };

  const existing = entitlements.find((entitlement) => entitlement.provider === 'manual' && entitlement.provider_subscription_id === `manual:user:${userId}`);
  if (existing) {
    const { data: existingAssignments, error: assignmentError } = await supabase
      .from('premium_slot_assignments')
      .select('id')
      .eq('entitlement_id', existing.id)
      .eq('status', 'active');
    if (assignmentError) throw assignmentError;
    if ((existingAssignments?.length ?? 0) > slotLimit) return { ok: false, code: 'slots_below_usage', used: existingAssignments.length };
  }

  const metadata = {
    ...(existing?.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}),
    permanent: true,
    granted_by: String(grantedBy),
    granted_at: existing?.metadata?.granted_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('premium_entitlements')
    .upsert({
      user_id: String(userId),
      provider: 'manual',
      provider_subscription_id: `manual:user:${userId}`,
      plan_key: `premium-manual-${slotLimit}`,
      status: 'active',
      slot_limit: slotLimit,
      current_period_end: null,
      metadata,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'provider_subscription_id' })
    .select(ENTITLEMENT_COLUMNS)
    .single();
  if (error) throw error;

  let assignment = null;
  if (guildId) {
    const result = await assignPremiumSlot(userId, guildId, data.id);
    if (!result.ok) return { ...result, entitlement: data };
    assignment = result.assignment;
  }
  return { ok: true, entitlement: data, assignment };
}

async function assignPremiumSlot(userId, guildId, entitlementId = null) {
  if (!isDiscordId(userId)) return { ok: false, code: 'invalid_user' };
  if (!isDiscordId(guildId)) return { ok: false, code: 'invalid_guild' };

  const entitlements = await listUserPremium(userId);
  const entitlement = entitlementId
    ? entitlements.find((candidate) => String(candidate.id) === String(entitlementId))
    : entitlements.find(isActiveEntitlement);
  if (!entitlement || !isActiveEntitlement(entitlement)) return { ok: false, code: 'no_active_entitlement' };

  const guildAssignments = await activeAssignmentsForGuild(guildId);
  const current = guildAssignments[0];
  if (current?.user_id !== String(userId)) return { ok: false, code: 'server_taken', assignment: current };
  if (current?.user_id === String(userId) && String(current.entitlement_id) === String(entitlement.id)) {
    return { ok: true, already: true, assignment: current };
  }

  // Moving a user's own server from an old entitlement should not hit the
  // one-active-owner index. Other users are rejected above.
  if (current?.user_id === String(userId)) {
    await supabase
      .from('premium_slot_assignments')
      .update({ status: 'released', released_at: new Date().toISOString() })
      .eq('id', current.id);
  }

  const { data: usedAssignments, error: usedError } = await supabase
    .from('premium_slot_assignments')
    .select('id')
    .eq('entitlement_id', entitlement.id)
    .eq('status', 'active');
  if (usedError) throw usedError;
  if ((usedAssignments?.length ?? 0) >= entitlement.slot_limit) return { ok: false, code: 'no_slots', used: usedAssignments?.length ?? 0, limit: entitlement.slot_limit };

  const { data: assignment, error } = await supabase
    .from('premium_slot_assignments')
    .upsert({
      entitlement_id: entitlement.id,
      user_id: String(userId),
      guild_id: String(guildId),
      status: 'active',
      released_at: null,
    }, { onConflict: 'entitlement_id,guild_id' })
    .select(ASSIGNMENT_COLUMNS)
    .single();
  if (error) throw error;

  await supabase
    .from('premium_slot_requests')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('user_id', String(userId))
    .eq('guild_id', String(guildId));

  return { ok: true, assignment };
}

async function resetGuildPremiumProfile(guildId, client = null) {
  if (!isDiscordId(guildId)) return;
  // Nicknames are free per-server identifiers; only Premium avatar, banner,
  // and bio overrides are cleared when a slot is released.
  const { error } = await supabase
    .from('guilds')
    .update({ bot_avatar_url: null, bot_banner_url: null, bot_description: null, updated_at: new Date().toISOString() })
    .eq('guild_id', String(guildId));
  if (error) throw error;

  // Clear the live per-server Discord profile as well as the saved dashboard
  // values. The database reset must remain successful even if Discord rejects
  // a stale guild, missing permission, or a temporary API request.
  if (!client?.rest?.patch) return;
  try {
    await client.rest.patch(Routes.guildMember(String(guildId), '@me'), {
      body: { avatar: null, banner: null, bio: null },
    });
  } catch (discordError) {
    logger.warn(`Premium profile reset could not be applied in Discord for guild ${guildId}:`, discordError?.message || discordError);
  }
}

async function unassignPremiumSlot(userId, guildId, client = null) {
  if (!isDiscordId(userId)) return { ok: false, code: 'invalid_user' };
  if (!isDiscordId(guildId)) return { ok: false, code: 'invalid_guild' };
  const { data, error } = await supabase
    .from('premium_slot_assignments')
    .update({ status: 'released', released_at: new Date().toISOString() })
    .eq('user_id', String(userId))
    .eq('guild_id', String(guildId))
    .eq('status', 'active')
    .select(ASSIGNMENT_COLUMNS);
  if (error) throw error;
  if (!data?.length) return { ok: false, code: 'no_assignment' };
  await resetGuildPremiumProfile(guildId, client);
  return { ok: true, assignments: data };
}

async function revokeManualPremium(userId, revokedBy, client = null) {
  if (!isDiscordId(userId)) return { ok: false, code: 'invalid_user' };
  const entitlements = (await listUserPremium(userId)).filter((entitlement) => entitlement.provider === 'manual' && entitlement.status !== 'expired');
  if (!entitlements.length) return { ok: false, code: 'no_manual' };

  const releasedGuildIds = new Set();
  for (const entitlement of entitlements) {
    const { data: assignments, error: assignmentError } = await supabase
      .from('premium_slot_assignments')
      .select('guild_id')
      .eq('entitlement_id', entitlement.id)
      .eq('status', 'active');
    if (assignmentError) throw assignmentError;
    for (const assignment of assignments ?? []) releasedGuildIds.add(assignment.guild_id);

    const metadata = {
      ...(entitlement.metadata && typeof entitlement.metadata === 'object' ? entitlement.metadata : {}),
      revoked_by: String(revokedBy),
      revoked_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('premium_entitlements')
      .update({ status: 'expired', metadata, updated_at: new Date().toISOString() })
      .eq('id', entitlement.id);
    if (error) throw error;
    const { error: releaseError } = await supabase
      .from('premium_slot_assignments')
      .update({ status: 'released', released_at: new Date().toISOString() })
      .eq('entitlement_id', entitlement.id)
      .eq('status', 'active');
    if (releaseError) throw releaseError;
  }

  for (const guildId of releasedGuildIds) await resetGuildPremiumProfile(guildId, client);
  return { ok: true, releasedGuildIds: [...releasedGuildIds], count: entitlements.length };
}

module.exports = {
  FREE_LIMITS,
  PREMIUM_LIMITS,
  getGuildPremium,
  getGuildLimits,
  listUserPremium,
  getUserPremium,
  grantManualPremium,
  assignPremiumSlot,
  unassignPremiumSlot,
  revokeManualPremium,
  resetGuildPremiumProfile,
};
