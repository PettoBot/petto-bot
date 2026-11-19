// Members the server blocked from XP (`/levels manage block`, the Leveling page of the dashboard): they earn none by themselves (messages, voice, the
// starting bonus) and nobody can give them any by hand (`/levels manage xp` and `level`). Their old XP stays as it is; the block only stops what comes next.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/xpBlock.js, which is what the bot loads.

/** How many members a server can block (the list is read for every message, so it is kept short). */
export const MAX_BLOCKED = 100;

type ConfigWithBlocked = { no_xp_user_ids?: readonly string[] | null } | null | undefined;

/** The ids of the blocked members of a server's leveling settings. */
export function blockedIds(config: ConfigWithBlocked): string[] {
  const list = config?.no_xp_user_ids;
  return Array.isArray(list) ? list.map(String) : [];
}

/** Whether a member is blocked from XP. A missing id is never blocked. */
export function isXpBlocked(config: ConfigWithBlocked, userId: string | null | undefined): boolean {
  if (!userId) return false;
  const list = config?.no_xp_user_ids;
  return Array.isArray(list) && list.includes(String(userId));
}

/** The first of these members who is blocked, or null. */
export function firstBlocked(config: ConfigWithBlocked, userIds: ReadonlyArray<string | null | undefined>): string | null {
  return userIds.find((id) => isXpBlocked(config, id)) ?? null;
}

export type ToggleResult = { list: string[]; blocked: boolean; full: boolean };

/** Blocks a member who is not blocked and lets a blocked one go. `full` is true when the list is at its limit and the member was not added. */
export function toggleBlocked(config: ConfigWithBlocked, userId: string): ToggleResult {
  const id = String(userId);
  const list = blockedIds(config);
  if (list.includes(id)) return { list: list.filter((entry) => entry !== id), blocked: false, full: false };
  if (list.length >= MAX_BLOCKED) return { list, blocked: false, full: true };
  return { list: [...list, id], blocked: true, full: false };
}
