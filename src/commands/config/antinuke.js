const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/antinuke');
const { RULES, RULE_IDS, ACTIONS, resolveRule, ruleLabel } = require('../../utils/antiNukeRules');
const { restoreEvent, canRestore } = require('../../utils/antiNukeRestore');
const { panicSettings } = require('../../utils/antiNukePanic');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf, formatList } = require('../../i18n');

const GREEN = 0xa5ea7a;
const GREY = 0x4b4f59;
const RED = 0xff6b6b;
const ruleChoices = RULE_IDS.map((id) => ({ name: RULES[id].label, value: id }));
const actionChoices = ACTIONS.map((a) => ({ name: a, value: a }));

/** A saved action value (alert, quarantine, kick, ban) as the replies name it; an unknown value as it is. */
function actionWord(value, lang) {
  const key = `security.action.${value}`;
  const text = t(lang, key);
  return text === key ? String(value) : text;
}

const reply = (interaction, text, color = GREEN) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

module.exports = {
  // Also registered as a slash command (it already has subcommands, so it needs no umbrella); the prefix keeps working.
  registerSlash: true,
  aliases: ['an'],
  prefixDefaultSubcommand: 'status',
  prefixSubcommandAliases: { list: 'status', config: 'status', configuration: 'status' },
  data: new SlashCommandBuilder()
    .setName('antinuke')
    .setDescription('Protect the server from accounts that delete, ban or change too much too fast.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('status').setDescription('See every protection: on or off, its limit and what it does.'))
    .addSubcommand((sub) =>
      sub
        .setName('rule')
        .setDescription('Turn a protection on or off and tune it.')
        .addStringOption((o) => o.setName('protection').setDescription('Which protection').addChoices(...ruleChoices).setRequired(true))
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn it on or off'))
        .addIntegerOption((o) => o.setName('limit').setDescription('How many actions in the window count as an attack').setMinValue(1).setMaxValue(50))
        .addIntegerOption((o) => o.setName('window_seconds').setDescription('The window in seconds').setMinValue(2).setMaxValue(600))
        .addStringOption((o) => o.setName('action').setDescription('What to do to the account').addChoices(...actionChoices))
        .addChannelOption((o) => o.setName('alert_channel').setDescription('Where the alert goes').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('whitelist')
        .setDescription('Accounts and roles the protections never touch.')
        .addSubcommand((sub) => sub.setName('add').setDescription('Trust an account or a role.').addUserOption((o) => o.setName('user').setDescription('Account or bot')).addRoleOption((o) => o.setName('role').setDescription('Role')))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Stop trusting an account or a role.').addUserOption((o) => o.setName('user').setDescription('Account or bot')).addRoleOption((o) => o.setName('role').setDescription('Role')))
        .addSubcommand((sub) => sub.setName('list').setDescription('See who is trusted.')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('panic')
        .setDescription('Lock the server down by itself when several protections act or a raid starts.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn panic mode on or off'))
        .addIntegerOption((o) => o.setName('incidents').setDescription('How many protections acting in the window start it (default 2)').setMinValue(1).setMaxValue(20))
        .addIntegerOption((o) => o.setName('window_minutes').setDescription('The window in minutes (default 10)').setMinValue(1).setMaxValue(120))
        .addIntegerOption((o) => o.setName('lockdown_minutes').setDescription('Minutes until the lockdown ends by itself (default 30)').setMinValue(1).setMaxValue(1440))
        .addBooleanOption((o) => o.setName('on_raid').setDescription('Also start it when Anti Raid sees a raid (default on)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('settings')
        .setDescription('Who can change the anti-nuke and who hears about an attack.')
        .addBooleanOption((o) => o.setName('dm_owner').setDescription('Send the owner a DM when a protection acts (default on)'))
        .addBooleanOption((o) => o.setName('owner_only').setDescription('Only the owner and the trusted admins can change the anti-nuke (owner only)')),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('admins')
        .setDescription('Trusted admins: they can change the anti-nuke and are never touched (owner only).')
        .addSubcommand((sub) => sub.setName('add').setDescription('Make an account a trusted admin.').addUserOption((o) => o.setName('user').setDescription('Account').setRequired(true)))
        .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a trusted admin.').addUserOption((o) => o.setName('user').setDescription('Account').setRequired(true)))
        .addSubcommand((sub) => sub.setName('list').setDescription('See the trusted admins.')),
    )
    .addSubcommand((sub) => sub.setName('log').setDescription('The last times a protection acted.'))
    .addSubcommand((sub) => sub.setName('restore').setDescription('Put back what a protection stopped (channels, roles, bans, roles taken away).').addIntegerOption((o) => o.setName('event').setDescription('The event number shown in the alert or in the log').setMinValue(1).setRequired(true))),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    const config = await db.getConfig(interaction.guild.id);
    // Reading is for everyone who can run the command; changing follows "owner only", and the trusted admins are the owner's.
    const changes = group === 'whitelist' ? sub !== 'list' : group === 'admins' ? sub !== 'list' : ['rule', 'panic', 'settings', 'restore'].includes(sub);
    if (group === 'admins' && sub !== 'list' && interaction.user.id !== interaction.guild.ownerId) return reply(interaction, t(lang, 'security.antinuke.ownerOnly.adminsOwner'), RED);
    if (changes && !canRestore(interaction.member, config)) return reply(interaction, t(lang, 'security.antinuke.ownerOnly.blocked'), RED);
    if (group === 'whitelist') return whitelist(interaction, sub, lang);
    if (group === 'admins') return admins(interaction, sub, config, lang);
    if (sub === 'panic') return panic(interaction, config, lang);
    if (sub === 'settings') return settings(interaction, config, lang);
    if (sub === 'rule') return rule(interaction, lang);
    if (sub === 'log') return log(interaction, lang);
    if (sub === 'restore') return restore(interaction, lang);
    return status(interaction, lang);
  },
};

async function status(interaction, lang) {
  const [config, rows] = await Promise.all([db.getConfig(interaction.guild.id), db.getRules(interaction.guild.id)]);
  const lines = RULE_IDS.map((id) => {
    const eff = resolveRule(config, rows, id);
    return t(lang, 'security.antinuke.status.line', { status: eff.enabled ? EMOJI.APPROVE : '▫️', rule: ruleLabel(id, lang), threshold: eff.threshold, seconds: eff.windowSeconds, action: actionWord(eff.action, lang) });
  });
  const on = RULE_IDS.filter((id) => resolveRule(config, rows, id).enabled).length;
  const p = panicSettings(config);
  const extra = [
    p.enabled ? t(lang, 'security.antinuke.status.panicOn', { count: p.threshold, window: p.windowMinutes, minutes: p.lockdownMinutes }) : t(lang, 'security.antinuke.status.panicOff'),
    t(lang, config?.dm_owner === false ? 'security.antinuke.status.dmOff' : 'security.antinuke.status.dmOn'),
    t(lang, config?.owner_only ? 'security.antinuke.status.ownerOnlyOn' : 'security.antinuke.status.ownerOnlyOff'),
  ];
  await reply(interaction, [t(lang, 'security.antinuke.status.title', { on, total: RULE_IDS.length }), ...lines, ...extra, t(lang, 'security.antinuke.status.footer')].join('\n'), on ? GREEN : GREY);
}

async function rule(interaction, lang) {
  const id = interaction.options.getString('protection', true);
  const enabled = interaction.options.getBoolean('enabled');
  const limit = interaction.options.getInteger('limit');
  const windowSeconds = interaction.options.getInteger('window_seconds');
  const action = interaction.options.getString('action');
  const channel = interaction.options.getChannel('alert_channel');

  const [config, rows] = await Promise.all([db.getConfig(interaction.guild.id), db.getRules(interaction.guild.id)]);
  const current = resolveRule(config, rows, id);
  const patch = {
    enabled: enabled ?? current.enabled,
    threshold: limit ?? current.threshold,
    window_seconds: windowSeconds ?? current.windowSeconds,
    action: action ?? current.action,
    alert_channel_id: channel ? channel.id : (rows.find((r) => r.rule === id)?.alert_channel_id ?? null),
  };
  const saved = await db.upsertRule(interaction.guild.id, id, patch);
  const vars = { emoji: EMOJI.APPROVE, rule: ruleLabel(id, lang), threshold: saved.threshold, seconds: saved.window_seconds, action: actionWord(saved.action, lang) };
  const text = t(lang, saved.enabled ? 'security.antinuke.saved.on' : 'security.antinuke.saved.off', vars);
  await reply(interaction, `${text}${saved.alert_channel_id ? t(lang, 'security.antinuke.saved.alerts', { channel: `<#${saved.alert_channel_id}>` }) : ''}`);
}

async function panic(interaction, config, lang) {
  const current = panicSettings(config);
  const o = interaction.options;
  const saved = await db.upsertConfig(interaction.guild.id, {
    panic_enabled: o.getBoolean('enabled') ?? current.enabled,
    panic_threshold: o.getInteger('incidents') ?? current.threshold,
    panic_window_minutes: o.getInteger('window_minutes') ?? current.windowMinutes,
    panic_lockdown_minutes: o.getInteger('lockdown_minutes') ?? current.lockdownMinutes,
    panic_on_raid: o.getBoolean('on_raid') ?? current.onRaid,
  });
  const p = panicSettings(saved);
  const text = p.enabled
    ? t(lang, 'security.antinuke.panic.savedOn', { emoji: EMOJI.APPROVE, count: p.threshold, window: p.windowMinutes, minutes: p.lockdownMinutes })
    : t(lang, 'security.antinuke.panic.savedOff', { emoji: EMOJI.APPROVE });
  await reply(interaction, `${text}${p.enabled && p.onRaid ? t(lang, 'security.antinuke.panic.savedRaid') : ''}`);
}

async function settings(interaction, config, lang) {
  const dmOwner = interaction.options.getBoolean('dm_owner');
  const ownerOnly = interaction.options.getBoolean('owner_only');
  if (ownerOnly !== null && interaction.user.id !== interaction.guild.ownerId) return reply(interaction, t(lang, 'security.antinuke.ownerOnly.switchOwner'), RED);
  const saved = await db.upsertConfig(interaction.guild.id, {
    dm_owner: dmOwner ?? (config?.dm_owner !== false),
    owner_only: ownerOnly ?? Boolean(config?.owner_only),
  });
  await reply(interaction, [
    t(lang, 'security.antinuke.settings.saved', { emoji: EMOJI.APPROVE }),
    t(lang, saved.dm_owner === false ? 'security.antinuke.status.dmOff' : 'security.antinuke.status.dmOn'),
    t(lang, saved.owner_only ? 'security.antinuke.status.ownerOnlyOn' : 'security.antinuke.status.ownerOnlyOff'),
  ].join('\n'));
}

async function admins(interaction, sub, config, lang) {
  const guildId = interaction.guild.id;
  const current = config?.admin_ids ?? [];
  if (sub === 'list') {
    await reply(interaction, [
      t(lang, 'security.antinuke.admins.title'),
      current.length ? current.map((id) => `<@${id}>`).join(' ') : t(lang, 'security.antinuke.admins.none'),
      t(lang, 'security.antinuke.admins.footer'),
    ].join('\n'), GREY);
    return;
  }
  const user = interaction.options.getUser('user', true);
  const next = sub === 'add' ? [...new Set([...current, user.id])].slice(0, 25) : current.filter((id) => id !== user.id);
  await db.upsertConfig(guildId, { admin_ids: next });
  await reply(interaction, t(lang, sub === 'add' ? 'security.antinuke.admins.added' : 'security.antinuke.admins.removed', { emoji: EMOJI.APPROVE, user: `<@${user.id}>` }));
}

async function whitelist(interaction, sub, lang) {
  const guildId = interaction.guild.id;
  if (sub === 'list') {
    const config = await db.getConfig(guildId);
    const users = (config?.whitelist_ids ?? []).map((id) => `<@${id}>`);
    const roles = (config?.whitelist_role_ids ?? []).map((id) => `<@&${id}>`);
    await reply(interaction, [
      t(lang, 'security.antinuke.whitelist.title'),
      users.length ? t(lang, 'security.antinuke.whitelist.accounts', { list: users.join(' ') }) : t(lang, 'security.antinuke.whitelist.accountsNone'),
      roles.length ? t(lang, 'security.list.roles', { list: roles.join(' ') }) : t(lang, 'security.list.rolesNone'),
      t(lang, 'security.antinuke.whitelist.footer'),
    ].join('\n'), GREY);
    return;
  }
  const user = interaction.options.getUser('user');
  const role = interaction.options.getRole('role');
  if (!user && !role) {
    await reply(interaction, t(lang, 'security.antinuke.whitelist.pick'), RED);
    return;
  }
  if (user) await (sub === 'add' ? db.addWhitelist(guildId, user.id) : db.removeWhitelist(guildId, user.id));
  if (role) await (sub === 'add' ? db.addWhitelistRole(guildId, role.id) : db.removeWhitelistRole(guildId, role.id));
  const who = formatList(lang, [user && `<@${user.id}>`, role && `<@&${role.id}>`].filter(Boolean));
  await reply(interaction, t(lang, sub === 'add' ? 'security.antinuke.whitelist.added' : 'security.antinuke.whitelist.removed', { emoji: EMOJI.APPROVE, who }));
}

async function log(interaction, lang) {
  const events = await db.listEvents(interaction.guild.id, 8);
  if (!events.length) {
    await reply(interaction, t(lang, 'security.antinuke.log.empty'), GREY);
    return;
  }
  const lineKey = (e) => {
    if (e.restored_at) return 'security.antinuke.log.lineRestored';
    return (e.restorable?.length || e.previous_roles?.length) ? 'security.antinuke.log.lineCanRestore' : 'security.antinuke.log.line';
  };
  const lines = events.map((e) => t(lang, lineKey(e), {
    id: e.id,
    rule: RULES[e.rule] ? ruleLabel(e.rule, lang) : e.rule,
    user: `<@${e.executor_id}>`,
    count: e.action_count,
    action: actionWord(e.action, lang),
    time: `<t:${Math.floor(new Date(e.created_at).getTime() / 1000)}:R>`,
  }));
  await reply(interaction, [t(lang, 'security.antinuke.log.title'), ...lines].join('\n'), GREY);
}

async function restore(interaction, lang) {
  if (!canRestore(interaction.member, await db.getConfig(interaction.guild.id))) {
    await reply(interaction, t(lang, 'security.antinuke.restore.notAllowed'), RED);
    return;
  }
  const event = await db.getEvent(interaction.guild.id, interaction.options.getInteger('event', true));
  if (!event) return reply(interaction, t(lang, 'security.antinuke.restore.missing'), RED);
  if (event.restored_at) return reply(interaction, t(lang, 'security.antinuke.restore.already'), GREY);
  const { done, failed } = await restoreEvent(interaction.guild, event, lang);
  if (!failed.length) await db.markRestored(interaction.guild.id, event.id).catch(() => {});
  const lines = [...done, ...failed].map((l) => `• ${l}`);
  await reply(interaction, lines.length ? lines.join('\n').slice(0, 3500) : t(lang, 'security.antinuke.restore.nothing'), failed.length ? RED : GREEN);
}
