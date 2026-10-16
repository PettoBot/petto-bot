// The commands of Vanity and Server Tag rules. `!vanity` and `!guildtag` are the same set of subcommands for two kinds of
// rule, built here once. They are prefix only (`!vanity add ...`).
const { MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../db/identity');
const { ensureGuild } = require('../../db/guilds');
const { textCard } = require('../caseCard');
const { EMOJI } = require('../emojis');
const { COLORS } = require('../colors');
const { getTemplate, listTemplates } = require('../../db/embedTemplates');
const rules = require('./rules');
const { memberIdentity } = require('./service');
const { matchVanity, matchGuildTag, vanityValue, vanitySourceKnown, VANITY_SOURCES, COMPARISONS, CONDITIONS } = require('./compare');
const { syncGuild } = require('./sync');
const { infoPayload, noticePayload } = require('../infoCard');
const { buildProgressBar } = require('../levelProgressBar');
const { t, tn, formatNumber, formatDecimal, currentLanguage, languageOf } = require('../../i18n');

const PINK = 0xf0a9c4;

const label = (value) => value.replace(/_/g, ' ');
const choices = (list) => list.map((value) => ({ name: label(value), value }));
const SOURCE_CHOICES = [
  { name: 'Custom Status (profile text)', value: 'custom_status' }, { name: 'Username', value: 'username' }, { name: 'Global name', value: 'global_name' },
  { name: 'Server nickname', value: 'guild_nickname' }, { name: 'Display name', value: 'display_name' },
];
const ACTION_CHOICES = [{ name: 'add the role', value: 'add_role' }, { name: 'remove the role', value: 'remove_role' }];
const PING_CHOICES = [{ name: 'ping the member', value: 'user' }, { name: 'do not ping', value: 'none' }];
const CONDITION_CHOICES = [
  { name: 'Server Tag is from server (ID)', value: 'is_guild_id' }, { name: 'Server Tag is not from server (ID)', value: 'is_not_guild_id' },
  { name: 'Shows a Server Tag', value: 'identity_enabled' }, { name: 'Does not show a Server Tag', value: 'identity_disabled' },
  { name: 'Server Tag text equals', value: 'tag_equals' }, { name: 'Server Tag text is not', value: 'tag_not_equals' },
];

/** The guild member an option points to. A typed command (the prefix) only gives the user, so the member is fetched from the server. */
async function memberOption(interaction, name) {
  const direct = interaction.options.getMember?.(name);
  if (direct) return direct;
  const user = interaction.options.getUser(name);
  if (!user) return null;
  return interaction.guild.members.cache.get(user.id) ?? interaction.guild.members.fetch(user.id).catch(() => null);
}

const reply = (interaction, text, color = COLORS.DEFAULT) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
const ok = (interaction, text) => reply(interaction, `${EMOJI.APPROVE}  ${text}`, COLORS.GREEN);
const bad = (interaction, text) => reply(interaction, text, COLORS.RED);

/** Adds the subcommands both commands share. `kind` is 'vanity' or 'guildtag'. */
function addSubcommands(builder, kind) {
  const vanity = kind === 'vanity';
  const thing = vanity ? 'Vanity' : 'Server Tag'; // i18n-ignore: builder descriptions stay in English
  return builder
    .addSubcommand((s) => {
      // i18n-ignore: builder description
      s.setName('add').setDescription(`Create a ${thing} rule that adds or removes a role.`)
        .addStringOption((o) => o.setName('name').setDescription('A short name for the rule, for example rep').setRequired(true).setMaxLength(40));
      if (vanity) {
        s.addStringOption((o) => o.setName('word').setDescription('The text to look for').setRequired(true).setMaxLength(200))
          .addRoleOption((o) => o.setName('role').setDescription('The role the rule manages').setRequired(true))
          .addStringOption((o) => o.setName('source').setDescription('Where to look (default: Custom Status)').addChoices(...SOURCE_CHOICES))
          .addStringOption((o) => o.setName('comparison').setDescription('How to compare (default: contains)').addChoices(...choices(COMPARISONS)));
      } else {
        s.addStringOption((o) => o.setName('condition').setDescription('What the Server Tag must be').setRequired(true).addChoices(...CONDITION_CHOICES))
          .addRoleOption((o) => o.setName('role').setDescription('The role the rule manages').setRequired(true))
          .addStringOption((o) => o.setName('value').setDescription('The server ID or tag text, when the condition needs one').setMaxLength(100));
      }
      return s.addStringOption((o) => o.setName('action').setDescription('Add the role when it matches, or remove it (default: add)').addChoices(...ACTION_CHOICES));
    })
    .addSubcommand((s) => {
      // i18n-ignore: builder description
      s.setName('edit').setDescription(`Change a ${thing} rule.`)
        .addStringOption((o) => o.setName('name').setDescription('The rule to change').setRequired(true).setMaxLength(40));
      if (vanity) {
        s.addStringOption((o) => o.setName('word').setDescription('New text to look for').setMaxLength(200))
          .addStringOption((o) => o.setName('source').setDescription('New place to look').addChoices(...SOURCE_CHOICES))
          .addStringOption((o) => o.setName('comparison').setDescription('New way to compare').addChoices(...choices(COMPARISONS)));
      } else {
        s.addStringOption((o) => o.setName('condition').setDescription('New condition').addChoices(...CONDITION_CHOICES))
          .addStringOption((o) => o.setName('value').setDescription('New server ID or tag text').setMaxLength(100));
      }
      return s.addRoleOption((o) => o.setName('role').setDescription('A different role'))
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the rule on or off'));
    })
    // i18n-ignore: builder descriptions (the next lines too)
    .addSubcommand((s) => s.setName('remove').setDescription(`Delete a ${thing} rule.`).addStringOption((o) => o.setName('name').setDescription('The rule to delete').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('list').setDescription(`Show the ${thing} rules of this server.`)) // i18n-ignore: builder description
    .addSubcommand((s) => s.setName('test').setDescription(`Check which ${thing} rules a member matches, without changing anything.`).addUserOption((o) => o.setName('user').setDescription('The member (default: you)'))) // i18n-ignore: builder description
    .addSubcommand((s) => s.setName('sync').setDescription(`Apply the ${thing} rules to everyone now, or to one member.`).addUserOption((o) => o.setName('user').setDescription('Only this member'))) // i18n-ignore: builder description
    // i18n-ignore: builder description
    .addSubcommand((s) => s.setName('notify').setDescription(`Thank members when they start matching a ${thing} rule.`)
      .addChannelOption((o) => o.setName('channel').setDescription('Where to send the message').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('embed').setDescription('A saved embed from Embeds (leave empty for the simple message)').setMaxLength(64).setAutocomplete(true))
      .addStringOption((o) => o.setName('ping').setDescription('Ping the member (default) or not').addChoices(...PING_CHOICES)))
    .addSubcommand((s) => s.setName('notify-off').setDescription(`Stop the ${thing} thank-you message.`)); // i18n-ignore: builder description
}

/** The saved embeds of the server that match what is being typed in the `embed` option: the list that Discord shows under it. */
async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'embed' || !interaction.guildId) return interaction.respond([]);
  const typed = String(focused.value ?? '').trim().toLowerCase();
  let rows = [];
  try { rows = await listTemplates(interaction.guildId); } catch { rows = []; }
  const choices = rows
    .filter((row) => row?.name && (!typed || String(row.name).toLowerCase().includes(typed)))
    .slice(0, 25)
    .map((row) => ({ name: String(row.name).slice(0, 100), value: String(row.name).slice(0, 100) }));
  return interaction.respond(choices);
}

function ruleOptions(interaction, kind) {
  const o = interaction.options;
  const common = { role_id: o.getRole('role')?.id, enabled: o.getBoolean('enabled') ?? undefined, action: o.getString('action') ?? undefined };
  return kind === 'vanity'
    ? { ...common, word: o.getString('word') ?? undefined, source: o.getString('source') ?? undefined, comparison: o.getString('comparison') ?? undefined }
    : { ...common, condition: o.getString('condition') ?? undefined, value: o.getString('value') ?? undefined };
}

/** Where the thank-you message (or nothing) goes: the channel, the saved embed and whether the member is pinged. */
function notifyText(entry, lang = currentLanguage()) {
  return `<#${entry.channelId}>${entry.embedName ? t(lang, 'identity.notify.embed', { name: entry.embedName }) : ''}${entry.ping === 'none' ? t(lang, 'identity.notify.noPing') : ''}`;
}

async function listRules(interaction, kind, lang) {
  const all = kind === 'vanity' ? await db.listVanityRules(interaction.guild.id, { all: true }) : await db.listGuildTagRules(interaction.guild.id, { all: true });
  const notify = await db.getNotification(interaction.guild.id, kind);
  const on = all.filter((rule) => rule.enabled).length;
  await interaction.editReply(infoPayload({
    accent: PINK,
    title: t(lang, `identity.source.${kind}`),
    subtitle: [all.length ? tn(lang, 'identity.list.count', all.length, { count: all.length, on }) : t(lang, 'identity.list.empty')],
    thumbnail: interaction.guild.iconURL?.({ extension: 'png', size: 128 }) ?? null,
    sections: [
      { lines: all.length ? all.map((rule) => rules.describeRule(kind, rule, lang)) : [t(lang, 'identity.list.create', { kind })], limit: 2600 },
      { title: t(lang, 'identity.list.thanks'), lines: [notify ? notifyText(notify, lang) : t(lang, 'identity.list.thanksOff', { kind })] },
    ],
    footer: `!${kind} add · edit · remove · test · sync`, // i18n-ignore: command names
  }));
}

/** What every rule says about a member right now, without touching roles. */
async function testMember(interaction, kind, lang) {
  const target = (await memberOption(interaction, 'user')) ?? interaction.member;
  if (!target?.user) return bad(interaction, t(lang, 'identity.test.notMember'));
  const identity = memberIdentity(target);
  const list = kind === 'vanity' ? await db.listVanityRules(interaction.guild.id, { all: true }) : await db.listGuildTagRules(interaction.guild.id, { all: true });
  if (!list.length) return reply(interaction, t(lang, 'identity.test.noRules'));
  const hasRole = (rule) => t(lang, identity.roleIds.has(rule.role_id) ? 'identity.test.hasRole' : 'identity.test.lacksRole');
  const lines = list.map((rule) => {
    const off = rules.offMark(rule, lang);
    if (kind === 'vanity') {
      if (!vanitySourceKnown(identity, rule.source)) return t(lang, 'identity.test.unknown', { emoji: EMOJI.ALERT, name: rule.name, off });
      let matched;
      try { matched = matchVanity(rule, identity, lang); } catch (error) { return `${EMOJI.DENY} **${rule.name}**${off} · ${error.message}`; }
      const value = (vanityValue(identity, rule.source) || t(lang, 'identity.test.empty')).slice(0, 80);
      return t(lang, matched ? 'identity.test.vanity.match' : 'identity.test.vanity.noMatch', { emoji: matched ? EMOJI.APPROVE : EMOJI.DENY, name: rule.name, off, value, role: hasRole(rule) });
    }
    const matched = matchGuildTag(rule, identity.primaryGuild);
    return t(lang, matched ? 'identity.test.guildtag.match' : 'identity.test.guildtag.noMatch', { emoji: matched ? EMOJI.APPROVE : EMOJI.DENY, name: rule.name, off, role: hasRole(rule) });
  });
  const tag = identity.primaryGuild?.tag;
  const none = t(lang, 'identity.test.none');
  let subtitle;
  if (kind !== 'vanity') subtitle = t(lang, 'identity.test.tag', { tag: tag ? `\`${tag}\`` : none });
  else if (identity.unknownSources.has('custom_status')) subtitle = t(lang, 'identity.test.statusHidden');
  else subtitle = t(lang, 'identity.test.status', { status: identity.customStatus ? `\`${identity.customStatus.slice(0, 100)}\`` : none });
  await interaction.editReply(infoPayload({
    accent: PINK,
    title: t(lang, 'identity.test.title', { name: target.displayName }),
    subtitle: [subtitle],
    thumbnail: target.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? null,
    sections: [{ title: t(lang, 'identity.section.rules'), lines, limit: 2800 }],
    footer: t(lang, 'identity.test.footer'),
  }));
}

// The keys of the cards of a sync: one per source, and one for both at once.
const sourceKey = (source) => (source === 'vanity' || source === 'guildtag' ? source : 'all');

/** The card shown while a sync runs: Petto's progress bar, the count, the speed and how long it should still take. */
function progressPayload(source, state, startedAt, lang = currentLanguage()) {
  const percent = state.total ? Math.min(100, Math.floor((state.processed / state.total) * 100)) : 0;
  const seconds = Math.max(1, (Date.now() - startedAt) / 1000);
  const rate = state.processed / seconds;
  const left = rate > 0 && state.total > state.processed ? Math.ceil((state.total - state.processed) / rate) : null;
  const speed = rate >= 10 ? formatNumber(lang, Math.round(rate)) : formatDecimal(lang, rate, 1);
  let subtitle = t(lang, 'identity.sync.reading');
  if (state.waiting) subtitle = t(lang, 'identity.sync.waiting', { seconds: state.waiting });
  else if (state.total) subtitle = t(lang, 'identity.sync.checking');
  return infoPayload({
    accent: PINK,
    title: t(lang, `identity.sync.title.${sourceKey(source)}`, { emoji: EMOJI.LOADING }),
    subtitle: [subtitle],
    sections: state.total ? [{ lines: [
      `${buildProgressBar(percent)} **${percent}%**`,
      t(lang, 'identity.sync.progress', { processed: formatNumber(lang, state.processed), total: formatNumber(lang, state.total) }),
      rate > 0 ? (left !== null ? t(lang, 'identity.sync.rateLeft', { rate: speed, left: formatSeconds(left) }) : t(lang, 'identity.sync.rate', { rate: speed })) : null,
    ] }] : [],
    footer: t(lang, 'identity.sync.footer'),
  });
}

function formatSeconds(total) {
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return minutes < 60 ? `${minutes}m ${total % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** The card when a sync is done: what was checked and what changed. */
function resultPayload(source, result, guild, lang = currentLanguage()) {
  const changed = result.added + result.removed;
  return infoPayload({
    accent: result.errors ? 0xfed53c : 0xa5ea7a,
    title: t(lang, `identity.result.title.${sourceKey(source)}`, { emoji: EMOJI.APPROVE }),
    subtitle: [tn(lang, 'identity.result.checked', result.processed, { time: formatSeconds(Math.max(1, Math.round(result.durationMs / 1000))) })],
    thumbnail: guild.iconURL?.({ extension: 'png', size: 128 }) ?? null,
    sections: [
      { title: t(lang, 'identity.result.roles'), lines: [
        t(lang, 'identity.result.added', { count: formatNumber(lang, result.added) }),
        t(lang, 'identity.result.removed', { count: formatNumber(lang, result.removed) }),
        result.errors ? t(lang, 'identity.result.errors', { emoji: EMOJI.ALERT, count: formatNumber(lang, result.errors) }) : null,
      ] },
      result.skipped ? { lines: [t(lang, 'identity.result.skipped', { emoji: EMOJI.WARNING, count: formatNumber(lang, result.total) })] } : null,
      result.complete === false ? { lines: [t(lang, 'identity.result.incomplete', { emoji: EMOJI.WARNING })] } : null,
      !changed && !result.errors ? { lines: [t(lang, 'identity.result.nothing')] } : null,
    ].filter(Boolean),
    footer: t(lang, 'identity.result.footer'),
  });
}

/** What checking one member changed: `Checked @member. 2 role changes.` */
function memberChecked(user, results, lang = currentLanguage()) {
  const changed = results.filter((result) => result.changed && !result.error).length;
  return changed ? tn(lang, 'identity.checked.changes', changed, { count: changed, user: `${user}` }) : t(lang, 'identity.checked.nothing', { user: `${user}` });
}

async function syncRules(interaction, kind, lang) {
  const user = await memberOption(interaction, 'user');
  if (user) {
    const { evaluateMember } = require('./service');
    return ok(interaction, memberChecked(user, await evaluateMember(user, { source: kind }), lang));
  }
  return runSync(interaction, kind, lang);
}

/** The sync of the whole server with its cards. A problem with a message of its own (Discord's limit, a sync already running) is told, not logged as a crash. */
async function runSync(interaction, kind, lang) {
  lang ??= await languageOf(interaction);
  const startedAt = Date.now();
  await interaction.editReply(progressPayload(kind, { processed: 0, total: 0 }, startedAt, lang));
  let last = 0;
  try {
    const result = await syncGuild(interaction.guild, {
      source: kind,
      lang,
      onWait: (seconds) => interaction.editReply(progressPayload(kind, { processed: 0, total: 0, waiting: Math.ceil(seconds) }, startedAt, lang)).catch(() => {}),
      onProgress: (state) => {
        if (Date.now() - last < 3000) return;
        last = Date.now();
        interaction.editReply(progressPayload(kind, state, startedAt, lang)).catch(() => {});
      },
    });
    await interaction.editReply(resultPayload(kind, result, interaction.guild, lang));
  } catch (error) {
    if (!error?.friendly) throw error;
    await interaction.editReply(noticePayload(`${EMOJI.ALERT}  ${error.message}`, COLORS.RED));
  }
}

async function setNotify(interaction, kind, lang) {
  const channel = interaction.options.getChannel('channel', true);
  const embedName = (interaction.options.getString('embed') ?? '').trim().toLowerCase();
  if (embedName && !(await getTemplate(interaction.guild.id, embedName))) return bad(interaction, t(lang, 'identity.noEmbed', { name: embedName }));
  await db.setNotification(interaction.guild.id, kind, { channelId: channel.id, embedName, ping: interaction.options.getString('ping') ?? 'user' });
  await ok(interaction, t(lang, `identity.notify.set.${kind}${embedName ? 'Embed' : ''}`, { channel: `${channel}`, name: embedName }));
}

/** The handler of `!vanity` and `!guildtag`. */
async function execute(interaction, kind) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const lang = await languageOf(interaction);
  const sub = interaction.options.getSubcommand();
  await ensureGuild(interaction.guild.id);
  if (sub === 'list') return listRules(interaction, kind, lang);
  if (sub === 'test') return testMember(interaction, kind, lang);
  if (sub === 'sync') return syncRules(interaction, kind, lang);
  if (sub === 'notify') return setNotify(interaction, kind, lang);
  if (sub === 'notify-off') {
    const removed = await db.clearNotification(interaction.guild.id, kind);
    return removed ? ok(interaction, t(lang, 'identity.notify.off')) : reply(interaction, t(lang, 'identity.notify.none'));
  }
  const name = interaction.options.getString('name', true);
  let result;
  if (sub === 'add') {
    const input = ruleOptions(interaction, kind);
    result = await rules.createRule(interaction.guild, kind, { name, ...input, source: input.source ?? 'custom_status', comparison: input.comparison ?? 'contains', action: input.action ?? 'add_role' }, interaction.member, interaction.user.id, lang);
  } else if (sub === 'edit') {
    result = await rules.updateRule(interaction.guild, kind, name, ruleOptions(interaction, kind), interaction.member, lang);
  } else {
    result = await rules.removeRule(interaction.guild, kind, name, lang);
  }
  if (!result.ok) return bad(interaction, result.message);
  if (result.unchanged) return reply(interaction, t(lang, 'identity.rule.unchanged'));
  const done = { add: 'created', edit: 'updated', remove: 'deleted' }[sub];
  await ok(interaction, t(lang, `identity.rule.${done}`, { name: rules.cleanName(name), kind }));
}

const PERMISSION = PermissionFlagsBits.ManageGuild;

module.exports = { addSubcommands, autocomplete, execute, memberOption, memberChecked, notifyText, progressPayload, resultPayload, runSync, PERMISSION, SOURCE_CHOICES, ACTION_CHOICES, VANITY_SOURCES, CONDITIONS };
