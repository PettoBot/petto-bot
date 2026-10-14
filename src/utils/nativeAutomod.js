const {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  PermissionFlagsBits,
} = require('discord.js');
const { TEMPLATES, PACKS, buildPatterns, toDiscordPattern } = require('./automodTemplates');
const logger = require('./logger');

/** The rules this makes carry this name so they can be told apart from the ones the server made and from Petto Official (`Petto • `). */
const PREFIX = 'Petto ◆ ';
const OFFICIAL_PREFIX = 'Petto • ';
const MAX_TIMEOUT_MINUTES = 40_320; // 28 days, Discord's limit
const LIMITS = { keyword: 6, spam: 1, preset: 1, mentions: 1 };

const NAMES = {
  links: 'All links', invites: 'Invite links', inline_links: 'Inline links', emails: 'Email addresses', scam: 'Scam text', ip_addresses: 'IP addresses',
  phone_numbers: 'Phone numbers', emojis: 'Emoji spam', zalgo: 'Zalgo text', headings: 'Headings', subtext: 'Subtext', caps: 'Shouting', repeated_characters: 'Repeated characters',
  spoilers: 'Spoiler spam', invisible_text: 'Invisible text', fake_pings: 'Fake pings',
};
const PACK_NAMES = { basic: 'Basic', clean_chat: 'Clean chat', anti_scam: 'Anti scam', strict: 'Strict' };
const PRESETS = { profanity: AutoModerationRuleKeywordPresetType.Profanity, sexual: AutoModerationRuleKeywordPresetType.SexualContent, slurs: AutoModerationRuleKeywordPresetType.Slurs };

function userError(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

function friendly(err) {
  const code = err?.code ?? err?.rawError?.code;
  if (code === 50013 || code === 50001) return userError('I need the Manage Server permission to make AutoMod rules.');
  if (code === 200000 || code === 50035) return userError(`Discord did not accept the rule${err?.rawError?.message ? ` (${String(err.rawError.message).slice(0, 120)})` : ''}.`);
  if (/maximum/i.test(String(err?.message))) return userError('Discord has no room for another rule of this kind. Remove one first.');
  return err;
}

function kindOf(rule) {
  switch (rule.triggerType) {
    case AutoModerationRuleTriggerType.Keyword: return 'keyword';
    case AutoModerationRuleTriggerType.Spam: return 'spam';
    case AutoModerationRuleTriggerType.KeywordPreset: return 'preset';
    case AutoModerationRuleTriggerType.MentionSpam: return 'mentions';
    default: return 'other';
  }
}

function describeActions(rule) {
  const out = { block: false, alertChannelId: null, timeoutMinutes: 0 };
  for (const action of rule.actions ?? []) {
    if (action.type === AutoModerationActionType.BlockMessage) out.block = true;
    if (action.type === AutoModerationActionType.SendAlertMessage) out.alertChannelId = action.metadata?.channelId ?? action.metadata?.channel ?? null;
    if (action.type === AutoModerationActionType.Timeout) out.timeoutMinutes = Math.round((action.metadata?.durationSeconds ?? 0) / 60);
  }
  return out;
}

/** The rules of the server as the dashboard lists them, with how many of each kind are used. */
async function listNative(guild) {
  const rules = await guild.autoModerationRules.fetch({ cache: false });
  const botId = guild.client.user.id;
  const list = [...rules.values()].map((rule) => ({
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    kind: kindOf(rule),
    patterns: rule.triggerMetadata?.regexPatterns?.length ?? 0,
    official: rule.creatorId === botId && rule.name.startsWith(OFFICIAL_PREFIX),
    mine: rule.creatorId === botId && rule.name.startsWith(PREFIX),
    ...describeActions(rule),
  }));
  const used = { keyword: 0, spam: 0, preset: 0, mentions: 0 };
  for (const rule of list) if (used[rule.kind] !== undefined) used[rule.kind] += 1;
  return { rules: list, used, limits: LIMITS };
}

function buildActions({ block = true, alertChannelId, timeoutMinutes, customMessage }) {
  const actions = [];
  if (block !== false) {
    const metadata = customMessage ? { customMessage: String(customMessage).slice(0, 150) } : undefined;
    actions.push({ type: AutoModerationActionType.BlockMessage, ...(metadata ? { metadata } : {}) });
  }
  if (alertChannelId) actions.push({ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannelId } });
  const minutes = Math.floor(Number(timeoutMinutes) || 0);
  if (minutes > 0) actions.push({ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: Math.min(minutes, MAX_TIMEOUT_MINUTES) * 60 } });
  // Discord needs at least one action; a rule with nothing else blocks.
  if (!actions.length) actions.push({ type: AutoModerationActionType.BlockMessage });
  return actions;
}

async function assertManage(guild) {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) throw userError('I need the Manage Server permission to make AutoMod rules.');
}

async function assertRoom(guild, kind) {
  const { used } = await listNative(guild);
  if (used[kind] >= LIMITS[kind]) {
    throw userError(kind === 'keyword'
      ? `Discord allows ${LIMITS.keyword} keyword rules per server and all are used. Remove one you do not need, or use Petto's own filter, which has no such limit.`
      : 'Discord allows only one rule of this kind and it already exists.');
  }
}

/**
 * Makes one rule in Discord's AutoMod from a template, a pack of templates, or one of the kinds Discord has by itself
 * (spam, mention limit, word presets). Answers the rule that was made.
 */
async function createNative(guild, { template, pack, kind, options = {}, presets, mentionLimit, block, alertChannelId, timeoutMinutes, customMessage, exemptRoleIds = [], exemptChannelIds = [] }) {
  await assertManage(guild);
  const base = {
    eventType: AutoModerationRuleEventType.MessageSend,
    actions: buildActions({ block, alertChannelId, timeoutMinutes, customMessage }),
    enabled: true,
    exemptRoles: exemptRoleIds.filter((id) => guild.roles.cache.has(id)).slice(0, 20),
    exemptChannels: exemptChannelIds.filter((id) => guild.channels.cache.has(id)).slice(0, 50),
    reason: 'Petto AutoMod template',
  };

  let payload;
  let slot;
  if (kind === 'spam') {
    slot = 'spam';
    payload = { ...base, name: `${PREFIX}Spam`, triggerType: AutoModerationRuleTriggerType.Spam };
  } else if (kind === 'mentions') {
    slot = 'mentions';
    const limit = Math.max(1, Math.min(50, Math.floor(Number(mentionLimit)) || 5));
    payload = { ...base, name: `${PREFIX}Mention limit`, triggerType: AutoModerationRuleTriggerType.MentionSpam, triggerMetadata: { mentionTotalLimit: limit, mentionRaidProtectionEnabled: true } };
  } else if (kind === 'presets') {
    slot = 'preset';
    const chosen = (presets ?? []).filter((p) => PRESETS[p]).map((p) => PRESETS[p]);
    if (!chosen.length) throw userError('Pick at least one list of words.');
    payload = { ...base, name: `${PREFIX}Word lists`, triggerType: AutoModerationRuleTriggerType.KeywordPreset, triggerMetadata: { presets: chosen } };
  } else {
    slot = 'keyword';
    let patterns;
    let name;
    if (pack) {
      if (!PACKS[pack]) throw userError('That pack does not exist.');
      patterns = PACKS[pack].templates.flatMap(([id, opts]) => buildPatterns(id, opts));
      name = `${PREFIX}Pack · ${PACK_NAMES[pack]}`;
    } else {
      if (!TEMPLATES[template]) throw userError('That template does not exist.');
      patterns = buildPatterns(template, options);
      name = `${PREFIX}${NAMES[template]}`;
    }
    if (!patterns.length || patterns.length > 10) throw userError('That template does not fit in one rule.');
    payload = { ...base, name, triggerType: AutoModerationRuleTriggerType.Keyword, triggerMetadata: { regexPatterns: patterns.map(toDiscordPattern) } };
  }

  const existing = await guild.autoModerationRules.fetch({ cache: false });
  if ([...existing.values()].some((rule) => rule.name === payload.name && rule.creatorId === guild.client.user.id)) throw userError(`The rule "${payload.name}" already exists.`);
  await assertRoom(guild, slot);
  try {
    const rule = await guild.autoModerationRules.create(payload);
    return { id: rule.id, name: rule.name };
  } catch (err) {
    logger.warn(`Native AutoMod rule failed in ${guild.id}: ${err.message}`);
    throw friendly(err);
  }
}

/** Only the rules Petto made with a template can be changed from here; Petto Official and the server's own are left alone. */
async function ownRule(guild, id) {
  const rule = await guild.autoModerationRules.fetch({ autoModerationRule: id, cache: false }).catch(() => null);
  if (!rule) throw userError('That rule does not exist.');
  if (!(rule.creatorId === guild.client.user.id && rule.name.startsWith(PREFIX))) throw userError('Only the rules made from these templates can be changed here.');
  return rule;
}

async function setNativeEnabled(guild, id, enabled) {
  await assertManage(guild);
  const rule = await ownRule(guild, id);
  await rule.edit({ enabled: Boolean(enabled), reason: 'Petto AutoMod template' }).catch((err) => { throw friendly(err); });
}

async function deleteNative(guild, id) {
  await assertManage(guild);
  const rule = await ownRule(guild, id);
  await rule.delete('Petto AutoMod template removed').catch((err) => { throw friendly(err); });
}

module.exports = { PREFIX, OFFICIAL_PREFIX, LIMITS, NAMES, PACK_NAMES, listNative, createNative, setNativeEnabled, deleteNative };
