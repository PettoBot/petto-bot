/**
 * The protections of the anti-nuke. Each one watches one kind of action by one account and answers when the account
 * does too many of them too fast. `legacy` ones were counted together under the single switch before the server could
 * tune each protection, so they keep working that way until the server saves a row for them.
 * `label` stays in English for the slash choices; what members read comes from ruleLabel(). `description` is a note for
 * the code and is not shown anywhere.
 */
const { t, currentLanguage } = require('../i18n');

const RULES = {
  ban:            { label: 'Anti Ban',            description: 'Mass bans',                         legacy: true,  threshold: 3, window: 10 }, // i18n-ignore: not shown, see above
  kick:           { label: 'Anti Kick',           description: 'Mass kicks',                        legacy: true,  threshold: 3, window: 10 }, // i18n-ignore: not shown, see above
  channel_create: { label: 'Anti Create Channels', description: 'Mass channel creation',            legacy: true,  threshold: 4, window: 10 }, // i18n-ignore: not shown, see above
  channel_delete: { label: 'Anti Delete Channels', description: 'Mass channel deletion',            legacy: true,  threshold: 2, window: 10 }, // i18n-ignore: not shown, see above
  role_create:    { label: 'Anti Create Roles',   description: 'Mass role creation',                legacy: true,  threshold: 4, window: 10 }, // i18n-ignore: not shown, see above
  role_delete:    { label: 'Anti Delete Roles',   description: 'Mass role deletion',                legacy: true,  threshold: 2, window: 10 }, // i18n-ignore: not shown, see above
  webhook:        { label: 'Anti Webhooks',       description: 'Mass webhook creation',             legacy: true,  threshold: 3, window: 10 }, // i18n-ignore: not shown, see above
  emoji_delete:   { label: 'Anti Delete Emojis',  description: 'Mass emoji deletion',               legacy: true,  threshold: 5, window: 10 }, // i18n-ignore: not shown, see above
  emoji_create:   { label: 'Anti Create Emojis',  description: 'Mass emoji creation',               legacy: true,  threshold: 8, window: 10 }, // i18n-ignore: not shown, see above
  bot_add:        { label: 'Anti Bots',           description: 'Adding bots without permission',    legacy: false, threshold: 1, window: 60 }, // i18n-ignore: not shown, see above
  role_assign:    { label: 'Anti Assign Roles',   description: 'Giving roles with dangerous permissions', legacy: false, threshold: 1, window: 10 }, // i18n-ignore: not shown, see above
  unban:          { label: 'Anti Unban',          description: 'Mass unbans',                       legacy: false, threshold: 5, window: 10 }, // i18n-ignore: not shown, see above
  guild_update:   { label: 'Anti Server Changes', description: 'Changing the name, icon or vanity of the server again and again', legacy: false, threshold: 3, window: 60 }, // i18n-ignore: not shown, see above
  role_update:    { label: 'Anti Role Changes',   description: 'Editing roles in a row, or giving a role dangerous permissions (that one answers at once)', legacy: false, threshold: 3, window: 10 }, // i18n-ignore: not shown, see above
  channel_update: { label: 'Anti Channel Changes', description: 'Editing channels in a row, or opening a channel to @everyone with dangerous permissions (at once)', legacy: false, threshold: 4, window: 10 }, // i18n-ignore: not shown, see above
  mention_everyone: { label: 'Anti Mass Mention', description: 'Pinging @everyone or @here again and again', legacy: false, threshold: 2, window: 30 }, // i18n-ignore: not shown, see above
  webhook_spam:   { label: 'Anti Webhook Spam',   description: 'A webhook flooding messages', legacy: false, threshold: 8, window: 10 }, // i18n-ignore: not shown, see above
  prune:          { label: 'Anti Prune',          description: 'Pruning members (a mass kick in one go)', legacy: false, threshold: 1, window: 60 }, // i18n-ignore: not shown, see above
};

const RULE_IDS = Object.keys(RULES);

/** The name of a protection in `lang` (`channel_create` -> `security.antinuke.protection.channelCreate`). */
function ruleLabel(ruleId, lang = currentLanguage()) {
  if (!RULES[ruleId]) return ruleId;
  return t(lang, `security.antinuke.protection.${ruleId.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())}`);
}
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

module.exports = { RULES, RULE_IDS, ACTIONS, resolveRule, ruleLabel };
