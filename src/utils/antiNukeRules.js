/**
 * The protections of the anti-nuke. Each one watches one kind of action by one account and answers when the account
 * does too many of them too fast. `legacy` ones were counted together under the single switch before the server could
 * tune each protection, so they keep working that way until the server saves a row for them.
 */
const RULES = {
  ban:            { label: 'Anti Ban',            description: 'Mass bans',                         legacy: true,  threshold: 3, window: 10 },
  kick:           { label: 'Anti Kick',           description: 'Mass kicks',                        legacy: true,  threshold: 3, window: 10 },
  channel_create: { label: 'Anti Create Channels', description: 'Mass channel creation',            legacy: true,  threshold: 4, window: 10 },
  channel_delete: { label: 'Anti Delete Channels', description: 'Mass channel deletion',            legacy: true,  threshold: 2, window: 10 },
  role_create:    { label: 'Anti Create Roles',   description: 'Mass role creation',                legacy: true,  threshold: 4, window: 10 },
  role_delete:    { label: 'Anti Delete Roles',   description: 'Mass role deletion',                legacy: true,  threshold: 2, window: 10 },
  webhook:        { label: 'Anti Webhooks',       description: 'Mass webhook creation',             legacy: true,  threshold: 3, window: 10 },
  emoji_delete:   { label: 'Anti Delete Emojis',  description: 'Mass emoji deletion',               legacy: true,  threshold: 5, window: 10 },
  emoji_create:   { label: 'Anti Create Emojis',  description: 'Mass emoji creation',               legacy: true,  threshold: 8, window: 10 },
  bot_add:        { label: 'Anti Bots',           description: 'Adding bots without permission',    legacy: false, threshold: 1, window: 60 },
  role_assign:    { label: 'Anti Assign Roles',   description: 'Giving roles with dangerous permissions', legacy: false, threshold: 1, window: 10 },
  unban:          { label: 'Anti Unban',          description: 'Mass unbans',                       legacy: false, threshold: 5, window: 10 },
  guild_update:   { label: 'Anti Server Changes', description: 'Changing the name, icon or vanity of the server again and again', legacy: false, threshold: 3, window: 60 },
};

const RULE_IDS = Object.keys(RULES);
const ACTIONS = ['alert', 'quarantine', 'kick', 'ban'];

/**
 * What a protection does right now, from the saved row if there is one, else from the old single switch (the protections
 * that existed) or off (the new ones).
 */
function resolveRule(config, rows, ruleId) {
  const meta = RULES[ruleId];
  if (!meta) return null;
  const row = (rows ?? []).find((r) => r.rule === ruleId);
  const sharedUsers = config?.whitelist_ids ?? [];
  const sharedRoles = config?.whitelist_role_ids ?? [];
  if (row) {
    return {
      rule: ruleId,
      enabled: Boolean(row.enabled),
      threshold: row.threshold,
      windowSeconds: row.window_seconds,
      action: row.action,
      alertChannelId: row.alert_channel_id || config?.alert_channel_id || null,
      whitelistIds: [...new Set([...sharedUsers, ...(row.whitelist_ids ?? [])])],
      whitelistRoleIds: [...new Set([...sharedRoles, ...(row.whitelist_role_ids ?? [])])],
      counterKey: ruleId,
    };
  }
  if (meta.legacy && config?.enabled) {
    return {
      rule: ruleId,
      enabled: true,
      threshold: config.action_threshold,
      windowSeconds: config.window_seconds,
      action: 'quarantine',
      alertChannelId: config.alert_channel_id || null,
      whitelistIds: sharedUsers,
      whitelistRoleIds: sharedRoles,
      counterKey: 'legacy',
    };
  }
  return { rule: ruleId, enabled: false, threshold: meta.threshold, windowSeconds: meta.window, action: 'quarantine', alertChannelId: config?.alert_channel_id || null, whitelistIds: sharedUsers, whitelistRoleIds: sharedRoles, counterKey: ruleId };
}

module.exports = { RULES, RULE_IDS, ACTIONS, resolveRule };
