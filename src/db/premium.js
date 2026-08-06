const supabase = require('./supabase');

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

module.exports = { FREE_LIMITS, PREMIUM_LIMITS, getGuildPremium, getGuildLimits };
