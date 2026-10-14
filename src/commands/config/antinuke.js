const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/antinuke');
const { RULES, RULE_IDS, ACTIONS, resolveRule } = require('../../utils/antiNukeRules');
const { restoreEvent, canRestore } = require('../../utils/antiNukeRestore');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const GREEN = 0xa5ea7a;
const GREY = 0x4b4f59;
const RED = 0xff6b6b;
const ruleChoices = RULE_IDS.map((id) => ({ name: RULES[id].label, value: id }));
const actionChoices = ACTIONS.map((a) => ({ name: a, value: a }));

const reply = (interaction, text, color = GREEN) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

module.exports = {
  aliases: ['an'],
  prefixDefaultSubcommand: 'status',
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
    .addSubcommand((sub) => sub.setName('log').setDescription('The last times a protection acted.'))
    .addSubcommand((sub) => sub.setName('restore').setDescription('Put back what a protection stopped (channels, roles, bans, roles taken away).').addIntegerOption((o) => o.setName('event').setDescription('The event number shown in the alert or in the log').setMinValue(1).setRequired(true))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand();
    if (group === 'whitelist') return whitelist(interaction, sub);
    if (sub === 'rule') return rule(interaction);
    if (sub === 'log') return log(interaction);
    if (sub === 'restore') return restore(interaction);
    return status(interaction);
  },
};

async function status(interaction) {
  const [config, rows] = await Promise.all([db.getConfig(interaction.guild.id), db.getRules(interaction.guild.id)]);
  const lines = RULE_IDS.map((id) => {
    const eff = resolveRule(config, rows, id);
    return `${eff.enabled ? EMOJI.APPROVE : '▫️'} **${RULES[id].label}** · ${eff.threshold} in ${eff.windowSeconds}s · ${eff.action}`;
  });
  const on = RULE_IDS.filter((id) => resolveRule(config, rows, id).enabled).length;
  await reply(interaction, [`### Anti-nuke · ${on} of ${RULE_IDS.length} active`, ...lines, '-# Tune one with antinuke rule. Everything new starts off.'].join('\n'), on ? GREEN : GREY);
}

async function rule(interaction) {
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
  await reply(interaction, `${EMOJI.APPROVE} **${RULES[id].label}** is ${saved.enabled ? 'on' : 'off'}: ${saved.threshold} in ${saved.window_seconds}s, then **${saved.action}**.${saved.alert_channel_id ? ` Alerts in <#${saved.alert_channel_id}>.` : ''}`);
}

async function whitelist(interaction, sub) {
  const guildId = interaction.guild.id;
  if (sub === 'list') {
    const config = await db.getConfig(guildId);
    const users = (config?.whitelist_ids ?? []).map((id) => `<@${id}>`);
    const roles = (config?.whitelist_role_ids ?? []).map((id) => `<@&${id}>`);
    await reply(interaction, [`### Trusted`, users.length ? `**Accounts:** ${users.join(' ')}` : '**Accounts:** nobody', roles.length ? `**Roles:** ${roles.join(' ')}` : '**Roles:** none', '-# The owner and Petto are always trusted.'].join('\n'), GREY);
    return;
  }
  const user = interaction.options.getUser('user');
  const role = interaction.options.getRole('role');
  if (!user && !role) {
    await reply(interaction, 'Pick an account or a role.', RED);
    return;
  }
  if (user) await (sub === 'add' ? db.addWhitelist(guildId, user.id) : db.removeWhitelist(guildId, user.id));
  if (role) await (sub === 'add' ? db.addWhitelistRole(guildId, role.id) : db.removeWhitelistRole(guildId, role.id));
  await reply(interaction, `${EMOJI.APPROVE} ${[user && `<@${user.id}>`, role && `<@&${role.id}>`].filter(Boolean).join(' and ')} ${sub === 'add' ? 'will not be touched by the protections' : 'is no longer trusted'}.`);
}

async function log(interaction) {
  const events = await db.listEvents(interaction.guild.id, 8);
  if (!events.length) {
    await reply(interaction, 'No protection has acted yet.', GREY);
    return;
  }
  const lines = events.map((e) => `**#${e.id}** · ${RULES[e.rule]?.label ?? e.rule} · <@${e.executor_id}> · ${e.action_count}× · ${e.action}${e.restored_at ? ' · restored' : (e.restorable?.length || e.previous_roles?.length) ? ' · can restore' : ''} · <t:${Math.floor(new Date(e.created_at).getTime() / 1000)}:R>`);
  await reply(interaction, ['### Anti-nuke log', ...lines].join('\n'), GREY);
}

async function restore(interaction) {
  if (!canRestore(interaction.member)) {
    await reply(interaction, 'Only the server owner and administrators can restore this.', RED);
    return;
  }
  const event = await db.getEvent(interaction.guild.id, interaction.options.getInteger('event', true));
  if (!event) return reply(interaction, 'That event does not exist.', RED);
  if (event.restored_at) return reply(interaction, 'This was already restored.', GREY);
  const { done, failed } = await restoreEvent(interaction.guild, event);
  if (!failed.length) await db.markRestored(interaction.guild.id, event.id).catch(() => {});
  const lines = [...done, ...failed].map((l) => `• ${l}`);
  await reply(interaction, lines.length ? lines.join('\n').slice(0, 3500) : 'There was nothing left to restore.', failed.length ? RED : GREEN);
}
