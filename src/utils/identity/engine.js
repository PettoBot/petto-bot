// Decides which roles a member should have from the Vanity and Server Tag rules, and puts them on or takes them off.
// Ported from the Vanity bot; the safety rules are the same:
//  - a role stays while at least one add rule matches and no remove rule does (a remove rule wins);
//  - the bot only takes a role away when its own record says the bot put it there, so a role given by hand is never touched;
//  - bots are never evaluated;
//  - a source that could not be read right now (Custom Status in a sweep without presence) leaves its grants as they are.
const db = require('../../db/identity');
const { matchVanity, matchGuildTag, vanityValue, vanitySourceKnown } = require('./compare');

/** `rules.vanity` / `rules.guildtag`: `null` means "this source was not evaluated"; an empty list means "evaluated, no active rules", which clears its old grants. */
async function evaluate(member, rules, { roles, onAction, onNotify } = {}) {
  if (member.isBot) return [];
  if (!roles) throw new Error('The identity engine needs a role client.');
  const { vanity, guildtag } = rules;

  if (vanity) await db.invalidateStaleGrants(member.guildId, member.userId, 'vanity', scopes(vanity));
  if (guildtag) await db.invalidateStaleGrants(member.guildId, member.userId, 'guildtag', scopes(guildtag));

  const roleIds = new Set();
  const roleContexts = new Map();
  const removeContexts = new Map();
  const matching = new Map();
  const pending = new Map();
  const push = (map, roleId, value) => map.set(roleId, [...(map.get(roleId) ?? []), value]);

  const track = async (rule, source, matched, context, evaluationError) => {
    if (!roleContexts.has(rule.role_id) || matched) roleContexts.set(rule.role_id, context);
    if (matched && rule.action === 'remove_role') removeContexts.set(rule.role_id, context);
    const transition = await db.recordGrant(
      { guildId: member.guildId, userId: member.userId, roleId: rule.role_id, ruleId: rule.id, source, action: rule.action, matched },
      {
        eventType: 'identity_role_intent', dedupeKey: `grant:${member.guildId}:${member.userId}:${rule.role_id}:${rule.id}:${matched}`,
        guildId: member.guildId, userId: member.userId, roleId: rule.role_id, ruleId: rule.id, source, action: rule.action, result: 'evaluated',
        metadata: { matched: String(matched), value: source === 'vanity' ? rule.word : rule.value, ...(evaluationError ? { evaluation_error: evaluationError } : {}) },
      },
    );
    if (matched && rule.action === 'add_role') {
      push(matching, rule.role_id, context);
      if (!transition.hadPrevious || !transition.previousMatched) push(pending, rule.role_id, context);
    }
  };

  for (const rule of vanity ?? []) {
    if (!rule.enabled || !rule.role_id) continue;
    roleIds.add(rule.role_id);
    // Unknown is not empty: until the value is known, the rule's grant is left as it was.
    if (!vanitySourceKnown(member, rule.source)) continue;
    let matched = false;
    let evaluationError = null;
    try { matched = matchVanity(rule, member); } catch (error) { evaluationError = error.message; }
    const value = vanityValue(member, rule.source);
    const context = {
      guildId: member.guildId, userId: member.userId, userName: member.username, userDisplayName: member.displayName, userAvatar: member.avatarUrl,
      roleId: rule.role_id, ruleId: rule.id, ruleName: rule.name, ruleCondition: rule.comparison, matchField: rule.source, matchedValue: value,
      source: 'vanity', action: rule.action, value: rule.word,
      reason: matched ? `Matched ${rule.source} condition for value ${value}` : `No longer matched ${rule.source} condition for value ${value}`,
    };
    await track(rule, 'vanity', matched, context, evaluationError);
  }

  for (const rule of guildtag ?? []) {
    if (!rule.enabled || !rule.role_id) continue;
    const matched = matchGuildTag(rule, member.primaryGuild);
    roleIds.add(rule.role_id);
    const primary = member.primaryGuild;
    const context = {
      guildId: member.guildId, userId: member.userId, userName: member.username, userDisplayName: member.displayName, userAvatar: member.avatarUrl,
      roleId: rule.role_id, ruleId: rule.id, ruleName: rule.name, ruleCondition: rule.condition, matchedValue: rule.value,
      tag: primary?.tag ?? '', tagGuildId: primary?.identityGuildId ?? '', tagEnabled: primary?.identityEnabled == null ? '' : String(primary.identityEnabled), tagBadge: primary?.badge ?? '',
      source: 'guildtag', action: rule.action, value: rule.value,
      reason: matched ? `Matched ${rule.condition} condition for value ${rule.value}` : `No longer matched ${rule.condition} condition for value ${rule.value}`,
    };
    await track(rule, 'guildtag', matched, context, null);
  }

  for (const roleId of await db.managedRolesOfMember(member.guildId, member.userId)) roleIds.add(roleId);

  const contextFor = (map, roleId, action) => map.get(roleId) ?? {
    guildId: member.guildId, userId: member.userId, userName: member.username, userDisplayName: member.displayName, userAvatar: member.avatarUrl,
    roleId, action, reason: 'Role no longer justified by an active matching rule',
  };
  const notify = (contexts) => { for (const context of contexts ?? []) onNotify?.({ ...context, action: 'add_role', result: 'completed', error: null }); };
  const audit = (roleId, action, result, suffix, error) => ({
    eventType: `identity_role_${action}`, dedupeKey: `${suffix}:${member.guildId}:${member.userId}:${roleId}${error ? ':error' : ''}`,
    guildId: member.guildId, userId: member.userId, roleId, action, result, error: error?.message, metadata: { source: 'shared-role-ledger' },
  });

  const results = [];
  for (const roleId of [...roleIds].filter(Boolean).sort()) {
    const present = Boolean(member.roleIds?.has(roleId));
    await db.observeRolePresence(member.guildId, member.userId, roleId, present);
    const activeAdds = await db.activeCount(member.guildId, member.userId, roleId, 'add_role');
    const activeRemovals = await db.activeCount(member.guildId, member.userId, roleId, 'remove_role');
    const state = await db.getRoleState(member.guildId, member.userId, roleId);
    const desired = activeAdds > 0 && activeRemovals === 0;
    const result = { guildId: member.guildId, userId: member.userId, roleId, activeSources: activeAdds, activeRemovals, desired, changed: false, ownedByBot: state.botAddedRole, manualMarked: state.manualMarked, error: null };

    if (desired && !present) {
      result.changed = true;
      await db.recordAudit(audit(roleId, 'add_role', 'requested', 'role-add'));
      try {
        await roles.add(member.guildId, member.userId, roleId);
      } catch (error) {
        result.error = error;
        await db.recordAudit(audit(roleId, 'add_role', 'error', 'role-add', error));
        onAction?.({ ...contextFor(roleContexts, roleId, 'add_role'), action: 'add_role', result: 'error', error });
        results.push(result);
        continue;
      }
      await db.markBotAdded(member.guildId, member.userId, roleId);
      await db.recordAudit(audit(roleId, 'add_role', 'completed', 'role-add-completed'));
      onAction?.({ ...contextFor(roleContexts, roleId, 'add_role'), action: 'add_role', result: 'completed', error: null });
      notify(matching.get(roleId));
    } else if (desired && present) {
      notify(pending.get(roleId));
    } else if (!desired && present && state.botAddedRole && !state.manualMarked) {
      result.changed = true;
      await db.recordAudit(audit(roleId, 'remove_role', 'requested', 'role-remove'));
      const context = activeRemovals > 0 ? contextFor(removeContexts, roleId, 'remove_role') : contextFor(roleContexts, roleId, 'remove_role');
      try {
        await roles.remove(member.guildId, member.userId, roleId);
      } catch (error) {
        result.error = error;
        await db.recordAudit(audit(roleId, 'remove_role', 'error', 'role-remove', error));
        onAction?.({ ...context, action: 'remove_role', result: 'error', error });
        results.push(result);
        continue;
      }
      await db.markBotRemoved(member.guildId, member.userId, roleId);
      await db.recordAudit(audit(roleId, 'remove_role', 'completed', 'role-remove-completed'));
      onAction?.({ ...context, action: 'remove_role', result: 'completed', error: null });
    } else if (!desired && !present && state.botAddedRole) {
      // The role went away outside this evaluation (an admin took it off): forget the bot's ownership, so a later manual re-add is never mistaken for a role the bot manages.
      await db.markBotRemoved(member.guildId, member.userId, roleId);
    }
    results.push(result);
  }
  return results;
}

function scopes(rules) {
  return rules.filter((rule) => rule.enabled && rule.id && rule.role_id).map((rule) => ({ ruleId: rule.id, roleId: rule.role_id, action: rule.action }));
}

module.exports = { evaluate };
