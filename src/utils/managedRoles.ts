// i18n-ignore-file: only role ids and plan names; nothing here is shown to anyone.
// Which roles of the support server a person has to have because of what they pay: the role of their Premium (1, 3 or 5 servers), the role of their plan
// (Bronze, Silver or Gold), the "Supporter" role and the "Priority Support" role. Pure, so the job that gives them and scripts/check-managed-roles.js read the same rules.
// Written in TypeScript: `npm run build:ts` compiles it over utils/managedRoles.js.

export interface ManagedRoleIds {
  premium: Record<number, string | null | undefined>;
  plan: Record<string, string | null | undefined>;
  supporter: string | null | undefined;
  priority: string | null | undefined;
}

/** The role of the Premium of a server that matches the slots (the highest it reaches), or null. */
export function premiumRoleFor(ids: ManagedRoleIds, slots: number): string | null {
  const count = Number(slots) || 0;
  if (count >= 5) return ids.premium[5] || null;
  if (count >= 3) return ids.premium[3] || null;
  if (count >= 1) return ids.premium[1] || null;
  return null;
}

/**
 * The roles a person has to have now: with Premium, the role of its slots and "Priority Support"; with a plan, the role of the plan, "Supporter" and "Priority Support".
 * Both together give each role once. A role that is not set is left out.
 */
export function desiredRoles(ids: ManagedRoleIds, slots: number, plan: string | null): string[] {
  const wanted = new Set<string>();
  const premium = premiumRoleFor(ids, slots);
  if (premium) wanted.add(premium);
  const planRole = plan ? ids.plan[plan] : null;
  if (planRole) wanted.add(planRole);
  const paying = Boolean(premium) || Boolean(plan);
  if (plan && ids.supporter) wanted.add(ids.supporter);
  if (paying && ids.priority) wanted.add(ids.priority);
  return [...wanted];
}

/** Every role that payments manage: the ones the job takes away from whoever does not have to have them. */
export function managedRoles(ids: ManagedRoleIds): string[] {
  const all = [...Object.values(ids.premium), ...Object.values(ids.plan), ids.supporter, ids.priority];
  return [...new Set(all.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

/** What changes for a person: the roles to take away and the ones to give, given the roles they have now. */
export function roleChanges(ids: ManagedRoleIds, slots: number, plan: string | null, has: (roleId: string) => boolean): { add: string[]; remove: string[] } {
  const wanted = desiredRoles(ids, slots, plan);
  return {
    add: wanted.filter((id) => !has(id)),
    remove: managedRoles(ids).filter((id) => !wanted.includes(id) && has(id)),
  };
}
