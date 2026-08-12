const {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const { getLogConfig } = require('../db/logConfig');
const logger = require('./logger');

const MANAGED_PREFIX = 'Petto • ';
const USES_AUTOMOD_TARGET = 100;
const SYNC_CONCURRENCY = 2;
const TRIGGER_LIMITS = Object.freeze({
  [AutoModerationRuleTriggerType.Keyword]: 6,
  [AutoModerationRuleTriggerType.Spam]: 1,
  [AutoModerationRuleTriggerType.KeywordPreset]: 1,
  [AutoModerationRuleTriggerType.MentionSpam]: 1,
  [AutoModerationRuleTriggerType.MemberProfile]: 1,
});

const RULE_DEFINITIONS = Object.freeze([
  {
    key: 'mention-spam',
    name: `${MANAGED_PREFIX}Mention Spam`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.MentionSpam,
    triggerMetadata: { mentionTotalLimit: 5, mentionRaidProtectionEnabled: true },
  },
  {
    key: 'spam',
    name: `${MANAGED_PREFIX}Spam Protection`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Spam,
    triggerMetadata: {},
  },
  {
    key: 'harmful-content',
    name: `${MANAGED_PREFIX}Harmful Content`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.KeywordPreset,
    triggerMetadata: {
      presets: [
        AutoModerationRuleKeywordPresetType.Profanity,
        AutoModerationRuleKeywordPresetType.SexualContent,
        AutoModerationRuleKeywordPresetType.Slurs,
      ],
    },
  },
  {
    key: 'scam-links',
    name: `${MANAGED_PREFIX}Scam Links`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      keywordFilter: [
        '*free nitro*', '*nitro gift*', '*claim your nitro*', '*discordgift*', '*discord-gift*',
        '*steam gift*', '*free robux*', '*wallet connect*', '*verify your account*', '*crypto airdrop*',
      ],
      regexPatterns: ['discord(?:[- ]?gift|[- ]?nitro)', '(?:free|claim).{0,20}(?:nitro|robux|steam)'],
    },
  },
  {
    key: 'suspicious-promotions',
    name: `${MANAGED_PREFIX}Suspicious Promotions`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      keywordFilter: [
        '*double your money*', '*guaranteed profit*', '*limited slots*', '*buy followers*',
        '*cheap nitro*', '*free followers*', '*airdrop now*', '*click my bio*', '*dm me to invest*',
      ],
    },
  },
  {
    key: 'dangerous-downloads',
    name: `${MANAGED_PREFIX}Dangerous Downloads`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      keywordFilter: [
        '*keygen*', '*crack download*', '*cheat download*', '*free executor*', '*download and run*',
        '*password stealer*', '*token logger*', '*discord stealer*', '*trojan download*', '*injector download*',
      ],
      regexPatterns: ['(?i)download.{0,40}(?:\\.exe|\\.scr|\\.bat|\\.cmd)', '(?i)(?:run|open).{0,20}(?:\\.exe|\\.scr|\\.bat)'],
    },
  },
  {
    key: 'impersonation',
    name: `${MANAGED_PREFIX}Impersonation Protection`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      keywordFilter: [
        '*discord support*', '*discord security*', '*discord moderator*', '*petto support*',
        '*account recovery*', '*appeal your ban*', '*verify ownership*', '*staff application fee*',
      ],
    },
  },
  {
    key: 'invite-spam',
    name: `${MANAGED_PREFIX}Invite Spam`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      keywordFilter: ['*discord.gg/*', '*discord.com/invite/*', '*discordapp.com/invite/*', '*discord.gift/*'],
    },
  },
  {
    key: 'evasion-patterns',
    name: `${MANAGED_PREFIX}Evasion Patterns`,
    eventType: AutoModerationRuleEventType.MessageSend,
    triggerType: AutoModerationRuleTriggerType.Keyword,
    triggerMetadata: {
      keywordFilter: ['*fr33 nitro*', '*n1tro gift*', '*d1scord support*', '*free n1tro*', '*g1veaway*', '*v3rify account*'],
    },
  },
  {
    key: 'profile-protection',
    name: `${MANAGED_PREFIX}Profile Protection`,
    eventType: AutoModerationRuleEventType.MemberUpdate,
    triggerType: AutoModerationRuleTriggerType.MemberProfile,
    triggerMetadata: {
      keywordFilter: ['*discord support*', '*free nitro*', '*verify account*', '*account recovery*', '*dm for nitro*', '*steam gift*'],
    },
  },
]);

const BLOCK_MESSAGE = 'Petto blocked this message with AutoMod.';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(error) {
  return error?.code ?? error?.rawError?.code ?? null;
}

function isRetryable(error) {
  const status = error?.status ?? error?.statusCode;
  return status === 429 || status >= 500;
}

function retryAfterMs(error, attempt) {
  const retryAfter = Number(error?.retryAfter ?? error?.rawError?.retry_after ?? 0);
  if (retryAfter > 0) return Math.min(retryAfter * 1000, 30_000);
  return Math.min(1_000 * (2 ** attempt), 8_000);
}

async function discordRequest(label, operation, { retries = 2 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      const delay = retryAfterMs(error, attempt);
      logger.warn(`[AutoMod] ${label} rate-limited or temporarily unavailable, retrying in ${delay}ms.`);
      await sleep(delay);
    }
  }
}

function normalizeArray(value) {
  return [...(value ?? [])].map(String).sort();
}

function normalizeMetadata(metadata = {}) {
  return {
    keywordFilter: normalizeArray(metadata.keywordFilter),
    regexPatterns: normalizeArray(metadata.regexPatterns),
    presets: normalizeArray(metadata.presets),
    allowList: normalizeArray(metadata.allowList),
    mentionTotalLimit: metadata.mentionTotalLimit ?? null,
    mentionRaidProtectionEnabled: Boolean(metadata.mentionRaidProtectionEnabled),
  };
}

function normalizeActions(actions = []) {
  return actions.map((action) => ({
    type: action.type,
    metadata: {
      channelId: action.metadata?.channelId ?? action.metadata?.channel ?? null,
      durationSeconds: action.metadata?.durationSeconds ?? null,
      customMessage: action.metadata?.customMessage ?? null,
    },
  })).sort((a, b) => a.type - b.type);
}

function buildActions(definition, alertChannelId) {
  const blockType = definition.triggerType === AutoModerationRuleTriggerType.MemberProfile
    ? AutoModerationActionType.BlockMemberInteraction
    : AutoModerationActionType.BlockMessage;
  const actions = [{ type: blockType }];
  if (blockType === AutoModerationActionType.BlockMessage) actions[0].metadata = { customMessage: BLOCK_MESSAGE };
  if (alertChannelId) actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannelId } });
  return actions;
}

function desiredRule(definition, alertChannelId) {
  return {
    ...definition,
    actions: buildActions(definition, alertChannelId),
    enabled: true,
  };
}

function ruleMatches(rule, desired) {
  return rule.name === desired.name
    && rule.eventType === desired.eventType
    && rule.triggerType === desired.triggerType
    && Boolean(rule.enabled) === desired.enabled
    && JSON.stringify(normalizeMetadata(rule.triggerMetadata)) === JSON.stringify(normalizeMetadata(desired.triggerMetadata))
    && JSON.stringify(normalizeActions(rule.actions)) === JSON.stringify(normalizeActions(desired.actions));
}

function isManagedRule(rule, botId) {
  return Boolean(rule && botId && rule.creatorId === botId && typeof rule.name === 'string' && rule.name.startsWith(MANAGED_PREFIX));
}

async function getBotMember(guild) {
  let botMember = guild.members?.me ?? null;
  if (!botMember && guild.client?.user?.id && guild.members?.fetch) {
    botMember = await guild.members.fetch(guild.client.user.id).catch(() => null);
  }
  return botMember;
}

async function hasPermission(guild, permission) {
  const botMember = await getBotMember(guild);
  return Boolean(botMember?.permissions?.has(permission));
}

async function hasManageGuild(guild) {
  return hasPermission(guild, PermissionFlagsBits.ManageGuild);
}

async function findAlertChannelId(guild) {
  const config = await getLogConfig(guild.id).catch((error) => {
    logger.warn(`[AutoMod] Could not read configured logs for guild ${guild.id}: ${error.message}`);
    return null;
  });
  const entry = config?.entries?.find((item) => item.event === 'automod');
  if (!entry) return null;
  const channel = guild.channels.cache.get(entry.channel_id) ?? await guild.channels.fetch(entry.channel_id).catch(() => null);
  if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) return null;
  return channel.id;
}

function emptySyncResult(guildId) {
  return {
    guildId,
    success: false,
    created: 0,
    updated: 0,
    existing: 0,
    skipped: 0,
    failed: 0,
    managedRules: 0,
    duplicatesRemoved: 0,
    missingPermissions: false,
    missingModerateMembers: false,
    reason: null,
    skippedReasons: [],
    errors: [],
  };
}

function reasonForError(error) {
  const code = errorCode(error);
  if (code === 50013 || code === 50001) return 'missing_permissions';
  if (code === 10004) return 'unknown_guild';
  if (code === 50035) return 'invalid_automod_configuration';
  return error?.message || 'discord_api_error';
}

async function fetchRules(guild) {
  return discordRequest(`fetch rules for ${guild.id}`, () => guild.autoModerationRules.fetch({ cache: false }));
}

async function syncGuildAutoMod(guild) {
  const result = emptySyncResult(guild?.id);
  if (!guild?.available) {
    result.reason = 'guild_unavailable';
    return result;
  }
  if (!(await hasManageGuild(guild))) {
    result.reason = 'missing_permissions';
    result.missingPermissions = true;
    logger.warn(`[AutoMod] Skipping guild ${guild.id}: bot lacks Manage Guild.`);
    return result;
  }

  let rules;
  try {
    rules = await fetchRules(guild);
  } catch (error) {
    result.reason = reasonForError(error);
    result.missingPermissions = [50001, 50013].includes(errorCode(error));
    result.failed = 1;
    result.errors.push(result.reason);
    logger.error(`[AutoMod] Could not fetch rules for guild ${guild.id}:`, error);
    return result;
  }

  const allRules = [...rules.values()];
  const botId = guild.client.user?.id;
  const botCanModerateMembers = await hasPermission(guild, PermissionFlagsBits.ModerateMembers);
  const managed = allRules.filter((rule) => isManagedRule(rule, botId));
  result.managedRules = managed.length;
  const alertChannelId = await findAlertChannelId(guild);
  const desired = RULE_DEFINITIONS.map((definition) => desiredRule(definition, alertChannelId));
  const byName = new Map();
  for (const rule of managed) {
    if (!byName.has(rule.name)) byName.set(rule.name, []);
    byName.get(rule.name).push(rule);
  }

  const removedByTrigger = new Map();
  for (const [name, matches] of byName) {
    if (matches.length < 2) continue;
    for (const duplicate of matches.slice(1)) {
      try {
        await discordRequest(`delete duplicate ${duplicate.id} in ${guild.id}`, () => duplicate.delete('Remove duplicate Petto AutoMod rule'));
        result.duplicatesRemoved += 1;
        removedByTrigger.set(duplicate.triggerType, (removedByTrigger.get(duplicate.triggerType) ?? 0) + 1);
      } catch (error) {
        result.failed += 1;
        result.errors.push(`${name}: ${reasonForError(error)}`);
      }
    }
  }

  const triggerCounts = new Map();
  for (const rule of allRules) {
    const count = (triggerCounts.get(rule.triggerType) ?? 0) + 1;
    triggerCounts.set(rule.triggerType, count);
  }
  for (const [triggerType, removed] of removedByTrigger) triggerCounts.set(triggerType, Math.max(0, (triggerCounts.get(triggerType) ?? 0) - removed));

  for (const wanted of desired) {
    const existing = byName.get(wanted.name)?.[0] ?? null;
    const needsModerateMembers = wanted.triggerType === AutoModerationRuleTriggerType.MemberProfile && !botCanModerateMembers;
    if (needsModerateMembers) {
      if (existing && ruleMatches(existing, wanted)) {
        result.existing += 1;
      } else {
        result.skipped += 1;
        result.missingModerateMembers = true;
        result.skippedReasons.push(`${wanted.name}: bot needs Moderate Members`);
      }
      continue;
    }
    if (existing) {
      if (ruleMatches(existing, wanted)) {
        result.existing += 1;
        continue;
      }
      try {
        await discordRequest(`update ${existing.id} in ${guild.id}`, () => existing.edit({
          eventType: wanted.eventType,
          triggerMetadata: wanted.triggerMetadata,
          actions: wanted.actions,
          enabled: true,
          reason: 'Synchronize Petto official AutoMod rule',
        }));
        result.updated += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push(`${wanted.name}: ${reasonForError(error)}`);
        logger.error(`[AutoMod] Could not update ${wanted.name} in guild ${guild.id}:`, error);
      }
      continue;
    }

    const limit = TRIGGER_LIMITS[wanted.triggerType];
    if (limit && (triggerCounts.get(wanted.triggerType) ?? 0) >= limit) {
      result.skipped += 1;
      result.skippedReasons.push(`${wanted.name}: trigger limit reached`);
      continue;
    }

    try {
      await discordRequest(`create ${wanted.name} in ${guild.id}`, () => guild.autoModerationRules.create({
        name: wanted.name,
        eventType: wanted.eventType,
        triggerType: wanted.triggerType,
        triggerMetadata: Object.keys(wanted.triggerMetadata ?? {}).length ? wanted.triggerMetadata : undefined,
        actions: wanted.actions,
        enabled: true,
        reason: 'Create Petto official AutoMod rule',
      }));
      triggerCounts.set(wanted.triggerType, (triggerCounts.get(wanted.triggerType) ?? 0) + 1);
      result.created += 1;
    } catch (error) {
      const reason = reasonForError(error);
      if (reason === 'invalid_automod_configuration' || errorCode(error) === 40060) {
        result.skipped += 1;
        result.skippedReasons.push(`${wanted.name}: unsupported trigger or configuration`);
      } else {
        result.failed += 1;
        result.errors.push(`${wanted.name}: ${reason}`);
      }
      logger.warn(`[AutoMod] Could not create ${wanted.name} in guild ${guild.id}:`, error);
    }
  }

  result.managedRules = Math.max(0, managed.length - result.duplicatesRemoved + result.created);
  result.success = result.failed === 0;
  return result;
}

async function syncAllGuildsAutoMod(client, { concurrency = SYNC_CONCURRENCY, guilds = client.guilds.cache.values() } = {}) {
  const list = [...guilds];
  const summary = {
    guildsChecked: list.length,
    guildsConfigured: 0,
    managedRules: 0,
    created: 0,
    updated: 0,
    existing: 0,
    skipped: 0,
    errors: 0,
    missingPermissions: 0,
    missingModerateMembers: 0,
    results: [],
  };
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const guild = list[cursor++];
      const result = await syncGuildAutoMod(guild);
      summary.results.push(result);
      summary.managedRules += result.managedRules;
      summary.created += result.created;
      summary.updated += result.updated;
      summary.existing += result.existing;
      summary.skipped += result.skipped;
      summary.errors += result.failed;
      if (result.missingPermissions) summary.missingPermissions += 1;
      if (result.missingModerateMembers) summary.missingModerateMembers += 1;
      if (result.created + result.updated + result.existing > 0) summary.guildsConfigured += 1;
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, list.length)) }, () => worker());
  await Promise.all(workers);
  logger.info(`[AutoMod] Synchronization complete: guilds=${summary.guildsChecked} configured=${summary.guildsConfigured} managed=${summary.managedRules} created=${summary.created} updated=${summary.updated} skipped=${summary.skipped} missing_permissions=${summary.missingPermissions} missing_moderate_members=${summary.missingModerateMembers} errors=${summary.errors}`);
  return summary;
}

async function getAutoModStats(client, { concurrency = SYNC_CONCURRENCY } = {}) {
  const list = [...client.guilds.cache.values()];
  const stats = {
    guilds: list.length,
    guildsWithAutoMod: 0,
    managedRules: 0,
    target: USES_AUTOMOD_TARGET,
    remaining: USES_AUTOMOD_TARGET,
    errors: 0,
    missingPermissions: 0,
  };
  let cursor = 0;
  const worker = async () => {
    while (cursor < list.length) {
      const guild = list[cursor++];
      if (!(await hasManageGuild(guild))) {
        stats.missingPermissions += 1;
        continue;
      }
      try {
        const rules = await fetchRules(guild);
        const count = [...rules.values()].filter((rule) => isManagedRule(rule, client.user?.id)).length;
        stats.managedRules += count;
        if (count > 0) stats.guildsWithAutoMod += 1;
      } catch (error) {
        stats.errors += 1;
        logger.warn(`[AutoMod] Could not read stats for guild ${guild.id}:`, error.message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, list.length)) }, () => worker()));
  stats.remaining = Math.max(0, stats.target - stats.managedRules);
  return stats;
}

module.exports = {
  MANAGED_PREFIX,
  USES_AUTOMOD_TARGET,
  TRIGGER_LIMITS,
  RULE_DEFINITIONS,
  buildActions,
  desiredRule,
  ruleMatches,
  isManagedRule,
  syncGuildAutoMod,
  syncAllGuildsAutoMod,
  getAutoModStats,
};
