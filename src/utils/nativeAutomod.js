const {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  PermissionFlagsBits,
} = require('discord.js');
const { TEMPLATES, PACKS, buildPatterns, toDiscordPattern } = require('./automodTemplates');
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');

/** The rules this makes carry this name so they can be told apart from the ones the server made and from Petto Official (`Petto • `). */
const PREFIX = 'Petto ◆ ';
const OFFICIAL_PREFIX = 'Petto • ';
const MAX_TIMEOUT_MINUTES = 40_320; // 28 days, Discord's limit
const LIMITS = { keyword: 6, spam: 1, preset: 1, mentions: 1 };

// The names stay in English: they name the rules in Discord (found again by name), the slash choices and the filters saved in
// the database. What members read goes through templateName() / filterName().
const NAMES = {
  links: 'All links', invites: 'Invite links', inline_links: 'Inline links', emails: 'Email addresses', scam: 'Scam text', ip_addresses: 'IP addresses', // i18n-ignore: rule names, see above
  phone_numbers: 'Phone numbers', emojis: 'Emoji spam', zalgo: 'Zalgo text', headings: 'Headings', subtext: 'Subtext', caps: 'Shouting', repeated_characters: 'Repeated characters', // i18n-ignore: rule names, see above
  spoilers: 'Spoiler spam', invisible_text: 'Invisible text', fake_pings: 'Fake pings', // i18n-ignore: rule names, see above
};
const PACK_NAMES = { basic: 'Basic', clean_chat: 'Clean chat', anti_scam: 'Anti scam', strict: 'Strict' }; // i18n-ignore: rule names, see above
const PRESETS = { profanity: AutoModerationRuleKeywordPresetType.Profanity, sexual: AutoModerationRuleKeywordPresetType.SexualContent, slurs: AutoModerationRuleKeywordPresetType.Slurs };

/** The name of a template in the language of the server (`inline_links` -> `security.template.name.inlineLinks`). */
function templateName(id, lang = currentLanguage()) {
  if (!NAMES[id]) return id;
  return t(lang, `security.template.name.${id.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())}`);
}

/** The name of a filter saved in the database: the template's name translated, or the name the server gave it. */
function filterName(row, lang = currentLanguage()) {
  return row.name === NAMES[row.template] ? templateName(row.template, lang) : row.name;
}

function userError(message) {
  const err = new Error(message);
  err.userFacing = true;
  return err;
}

function friendly(err, lang) {
  const code = err?.code ?? err?.rawError?.code;
  if (code === 50013 || code === 50001) return userError(t(lang, 'security.native.error.manageServer'));
  if (code === 200000 || code === 50035) {
    return userError(err?.rawError?.message
      ? t(lang, 'security.native.error.rejectedWhy', { why: String(err.rawError.message).slice(0, 120) })
      : t(lang, 'security.native.error.rejected'));
  }
  if (/maximum/i.test(String(err?.message))) return userError(t(lang, 'security.native.error.noRoom'));
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

async function assertManage(guild, lang) {
  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionFlagsBits.ManageGuild)) throw userError(t(lang, 'security.native.error.manageServer'));
}

async function assertRoom(guild, kind, lang) {
  const { used } = await listNative(guild);
  if (used[kind] >= LIMITS[kind]) {
    throw userError(kind === 'keyword'
      ? t(lang, 'security.native.error.keywordFull', { limit: LIMITS.keyword })
      : t(lang, 'security.native.error.kindFull'));
  }
}

/**
 * Makes one rule in Discord's AutoMod from a template, a pack of templates, or one of the kinds Discord has by itself
 * (spam, mention limit, word presets). Answers the rule that was made.
 */
async function createNative(guild, { template, pack, kind, options = {}, presets, mentionLimit, block, alertChannelId, timeoutMinutes, customMessage, exemptRoleIds = [], exemptChannelIds = [], lang = currentLanguage() }) {
  await assertManage(guild, lang);
  const base = {
    eventType: AutoModerationRuleEventType.MessageSend,
    actions: buildActions({ block, alertChannelId, timeoutMinutes, customMessage }),
    enabled: true,
    exemptRoles: exemptRoleIds.filter((id) => guild.roles.cache.has(id)).slice(0, 20),
    exemptChannels: exemptChannelIds.filter((id) => guild.channels.cache.has(id)).slice(0, 50),
    reason: t(lang, 'security.native.audit.template'),
  };

  let payload;
  let slot;
  if (kind === 'spam') {
    slot = 'spam';
    payload = { ...base, name: `${PREFIX}Spam`, triggerType: AutoModerationRuleTriggerType.Spam };
  } else if (kind === 'mentions') {
    slot = 'mentions';
    const limit = Math.max(1, Math.min(50, Math.floor(Number(mentionLimit)) || 5));
    payload = { ...base, name: `${PREFIX}Mention limit`, triggerType: AutoModerationRuleTriggerType.MentionSpam, triggerMetadata: { mentionTotalLimit: limit, mentionRaidProtectionEnabled: true } }; // i18n-ignore: rule name in Discord, found again by name
  } else if (kind === 'presets') {
    slot = 'preset';
    const chosen = (presets ?? []).filter((p) => PRESETS[p]).map((p) => PRESETS[p]);
    if (!chosen.length) throw userError(t(lang, 'security.native.error.noPresets'));
    payload = { ...base, name: `${PREFIX}Word lists`, triggerType: AutoModerationRuleTriggerType.KeywordPreset, triggerMetadata: { presets: chosen } }; // i18n-ignore: rule name in Discord, found again by name
  } else {
    slot = 'keyword';
    let patterns;
    let name;
    if (pack) {
      if (!PACKS[pack]) throw userError(t(lang, 'security.native.error.unknownPack'));
      patterns = PACKS[pack].templates.flatMap(([id, opts]) => buildPatterns(id, opts));
      name = `${PREFIX}Pack · ${PACK_NAMES[pack]}`; // i18n-ignore: rule name in Discord, found again by name
    } else {
      if (!TEMPLATES[template]) throw userError(t(lang, 'security.native.error.unknownTemplate'));
      patterns = buildPatterns(template, options);
      name = `${PREFIX}${NAMES[template]}`;
    }
    if (!patterns.length || patterns.length > 10) throw userError(t(lang, 'security.native.error.tooBig'));
    payload = { ...base, name, triggerType: AutoModerationRuleTriggerType.Keyword, triggerMetadata: { regexPatterns: patterns.map(toDiscordPattern) } };
  }

  const existing = await guild.autoModerationRules.fetch({ cache: false });
  if ([...existing.values()].some((rule) => rule.name === payload.name && rule.creatorId === guild.client.user.id)) throw userError(t(lang, 'security.native.error.exists', { name: payload.name }));
  await assertRoom(guild, slot, lang);
  try {
    const rule = await guild.autoModerationRules.create(payload);
    return { id: rule.id, name: rule.name };
  } catch (err) {
    logger.warn(`Native AutoMod rule failed in ${guild.id}: ${err.message}`);
    throw friendly(err, lang);
  }
}

/** Only the rules Petto made with a template can be changed from here; Petto Official and the server's own are left alone. */
async function ownRule(guild, id, lang) {
  const rule = await guild.autoModerationRules.fetch({ autoModerationRule: id, cache: false }).catch(() => null);
  if (!rule) throw userError(t(lang, 'security.native.error.unknownRule'));
  if (!(rule.creatorId === guild.client.user.id && rule.name.startsWith(PREFIX))) throw userError(t(lang, 'security.native.error.notOwn'));
  return rule;
}

async function setNativeEnabled(guild, id, enabled, lang = currentLanguage()) {
  await assertManage(guild, lang);
  const rule = await ownRule(guild, id, lang);
  await rule.edit({ enabled: Boolean(enabled), reason: t(lang, 'security.native.audit.template') }).catch((err) => { throw friendly(err, lang); });
}

async function deleteNative(guild, id, lang = currentLanguage()) {
  await assertManage(guild, lang);
  const rule = await ownRule(guild, id, lang);
  await rule.delete(t(lang, 'security.native.audit.removed')).catch((err) => { throw friendly(err, lang); });
}

module.exports = { PREFIX, OFFICIAL_PREFIX, LIMITS, NAMES, PACK_NAMES, templateName, filterName, listNative, createNative, setNativeEnabled, deleteNative };
