// The commands of Vanity and Server Tag rules. `!vanity` and `!guildtag` are the same set of subcommands for two kinds of
// rule, built here once. They are prefix only (`!vanity add ...`).
const { MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const db = require('../../db/identity');
const { ensureGuild } = require('../../db/guilds');
const { textCard } = require('../caseCard');
const { EMOJI } = require('../emojis');
const { COLORS } = require('../colors');
const { getTemplate } = require('../../db/embedTemplates');
const rules = require('./rules');
const { memberIdentity } = require('./service');
const { matchVanity, matchGuildTag, vanityValue, vanitySourceKnown, VANITY_SOURCES, COMPARISONS, CONDITIONS } = require('./compare');
const { syncGuild } = require('./sync');
const { infoPayload } = require('../infoCard');

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

const reply = (interaction, text, color = COLORS.DEFAULT) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
const ok = (interaction, text) => reply(interaction, `${EMOJI.APPROVE}  ${text}`, COLORS.GREEN);
const bad = (interaction, text) => reply(interaction, text, COLORS.RED);

/** Adds the subcommands both commands share. `kind` is 'vanity' or 'guildtag'. */
function addSubcommands(builder, kind) {
  const vanity = kind === 'vanity';
  const thing = vanity ? 'Vanity' : 'Server Tag';
  return builder
    .addSubcommand((s) => {
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
    .addSubcommand((s) => s.setName('remove').setDescription(`Delete a ${thing} rule.`).addStringOption((o) => o.setName('name').setDescription('The rule to delete').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('list').setDescription(`Show the ${thing} rules of this server.`))
    .addSubcommand((s) => s.setName('test').setDescription(`Check which ${thing} rules a member matches, without changing anything.`).addUserOption((o) => o.setName('user').setDescription('The member (default: you)')))
    .addSubcommand((s) => s.setName('sync').setDescription(`Apply the ${thing} rules to everyone now, or to one member.`).addUserOption((o) => o.setName('user').setDescription('Only this member')))
    .addSubcommand((s) => s.setName('notify').setDescription(`Thank members when they start matching a ${thing} rule.`)
      .addChannelOption((o) => o.setName('channel').setDescription('Where to send the message').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('embed').setDescription('A saved embed from Embeds (leave empty for the simple message)').setMaxLength(64))
      .addStringOption((o) => o.setName('ping').setDescription('Ping the member (default) or not').addChoices(...PING_CHOICES)))
    .addSubcommand((s) => s.setName('notify-off').setDescription(`Stop the ${thing} thank-you message.`));
}

function ruleOptions(interaction, kind) {
  const o = interaction.options;
  const common = { role_id: o.getRole('role')?.id, enabled: o.getBoolean('enabled') ?? undefined, action: o.getString('action') ?? undefined };
  return kind === 'vanity'
    ? { ...common, word: o.getString('word') ?? undefined, source: o.getString('source') ?? undefined, comparison: o.getString('comparison') ?? undefined }
    : { ...common, condition: o.getString('condition') ?? undefined, value: o.getString('value') ?? undefined };
}

async function listRules(interaction, kind) {
  const all = kind === 'vanity' ? await db.listVanityRules(interaction.guild.id, { all: true }) : await db.listGuildTagRules(interaction.guild.id, { all: true });
  const notify = await db.getNotification(interaction.guild.id, kind);
  const title = kind === 'vanity' ? 'Vanity rules' : 'Server Tag rules';
  const on = all.filter((rule) => rule.enabled).length;
  await interaction.editReply(infoPayload({
    accent: PINK,
    title,
    subtitle: [all.length ? `${all.length} rule${all.length === 1 ? '' : 's'} · ${on} on` : 'No rules yet'],
    thumbnail: interaction.guild.iconURL?.({ extension: 'png', size: 128 }) ?? null,
    sections: [
      { lines: all.length ? all.map((rule) => rules.describeRule(kind, rule)) : [`Create one with \`!${kind} add\`.`], limit: 2600 },
      { title: 'Thank-you message', lines: [notify ? `<#${notify.channelId}>${notify.embedName ? ` · embed \`${notify.embedName}\`` : ''}${notify.ping === 'none' ? ' · no ping' : ''}` : `Off. Set it with \`!${kind} notify\`.`] },
    ],
    footer: `!${kind} add · edit · remove · test · sync`,
  }));
}

/** What every rule says about a member right now, without touching roles. */
async function testMember(interaction, kind) {
  const target = interaction.options.getMember('user') ?? interaction.member;
  if (!target?.user) return bad(interaction, 'That member is not in this server.');
  const identity = memberIdentity(target);
  const list = kind === 'vanity' ? await db.listVanityRules(interaction.guild.id, { all: true }) : await db.listGuildTagRules(interaction.guild.id, { all: true });
  if (!list.length) return reply(interaction, 'There are no rules to test yet.');
  const hasRole = (rule) => (identity.roleIds.has(rule.role_id) ? 'has the role' : 'does not have the role');
  const lines = list.map((rule) => {
    const off = rule.enabled ? '' : ' _(off)_';
    if (kind === 'vanity') {
      if (!vanitySourceKnown(identity, rule.source)) return `${EMOJI.ALERT} **${rule.name}**${off} · unknown: Discord shows no presence for this member (offline or invisible), so their role is left as it is`;
      let matched;
      try { matched = matchVanity(rule, identity); } catch (error) { return `${EMOJI.DENY} **${rule.name}**${off} · ${error.message}`; }
      return `${matched ? EMOJI.APPROVE : EMOJI.DENY} **${rule.name}**${off} · ${matched ? 'matches' : 'does not match'} \`${(vanityValue(identity, rule.source) || 'empty').slice(0, 80)}\` · ${hasRole(rule)}`;
    }
    const matched = matchGuildTag(rule, identity.primaryGuild);
    return `${matched ? EMOJI.APPROVE : EMOJI.DENY} **${rule.name}**${off} · ${matched ? 'matches' : 'does not match'} · ${hasRole(rule)}`;
  });
  const tag = identity.primaryGuild?.tag;
  await interaction.editReply(infoPayload({
    accent: PINK,
    title: `Test for ${target.displayName}`,
    subtitle: [kind === 'vanity' ? (identity.unknownSources.has('custom_status') ? 'Custom Status: not visible right now' : `Custom Status: ${identity.customStatus ? `\`${identity.customStatus.slice(0, 100)}\`` : 'none'}`) : `Server Tag: ${tag ? `\`${tag}\`` : 'none'}`],
    thumbnail: target.displayAvatarURL?.({ extension: 'png', size: 256 }) ?? null,
    sections: [{ title: 'Rules', lines, limit: 2800 }],
    footer: 'Nothing was changed. Use sync to apply the rules.',
  }));
}

function progressCard(source, state) {
  const percent = state.total ? Math.floor((state.processed / state.total) * 100) : 100;
  const filled = Math.round(percent / 10);
  return `### Syncing ${source ? (source === 'vanity' ? 'Vanity rules' : 'Server Tag rules') : 'rules'}\n${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${percent}%\n${state.processed} of ${state.total} members`;
}

async function syncRules(interaction, kind) {
  const user = interaction.options.getMember('user');
  if (user) {
    const { evaluateMember } = require('./service');
    const results = await evaluateMember(user, { source: kind });
    const changed = results.filter((result) => result.changed && !result.error).length;
    return ok(interaction, `Checked ${user}. ${changed ? `${changed} role change${changed === 1 ? '' : 's'}.` : 'Nothing to change.'}`);
  }
  await reply(interaction, progressCard(kind, { processed: 0, total: 0 }));
  let last = 0;
  const result = await syncGuild(interaction.guild, {
    source: kind,
    onProgress: (state) => {
      if (Date.now() - last < 3000) return;
      last = Date.now();
      reply(interaction, progressCard(kind, state)).catch(() => {});
    },
  });
  const seconds = Math.max(1, Math.round(result.durationMs / 1000));
  await ok(interaction, `Done in ${seconds}s. ${result.processed} members checked · ${result.added} roles added · ${result.removed} removed${result.errors ? ` · ${result.errors} errors` : ''}.${result.skipped ? `\nOnly the first ${result.total} members were checked (limit).` : ''}`);
}

async function setNotify(interaction, kind) {
  const channel = interaction.options.getChannel('channel', true);
  const embedName = (interaction.options.getString('embed') ?? '').trim().toLowerCase();
  if (embedName && !(await getTemplate(interaction.guild.id, embedName))) return bad(interaction, `There is no saved embed called \`${embedName}\`. Create it in Embeds first.`);
  await db.setNotification(interaction.guild.id, kind, { channelId: channel.id, embedName, ping: interaction.options.getString('ping') ?? 'user' });
  await ok(interaction, `Members who start matching a ${kind === 'vanity' ? 'Vanity' : 'Server Tag'} rule will be thanked in ${channel}${embedName ? ` with the embed \`${embedName}\`` : ''}.`);
}

/** The handler of `!vanity` and `!guildtag`. */
async function execute(interaction, kind) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const sub = interaction.options.getSubcommand();
  await ensureGuild(interaction.guild.id);
  if (sub === 'list') return listRules(interaction, kind);
  if (sub === 'test') return testMember(interaction, kind);
  if (sub === 'sync') return syncRules(interaction, kind);
  if (sub === 'notify') return setNotify(interaction, kind);
  if (sub === 'notify-off') {
    const removed = await db.clearNotification(interaction.guild.id, kind);
    return removed ? ok(interaction, 'The thank-you message is off.') : reply(interaction, 'There was no thank-you message set up.');
  }
  const name = interaction.options.getString('name', true);
  let result;
  if (sub === 'add') {
    const input = ruleOptions(interaction, kind);
    result = await rules.createRule(interaction.guild, kind, { name, ...input, source: input.source ?? 'custom_status', comparison: input.comparison ?? 'contains', action: input.action ?? 'add_role' }, interaction.member, interaction.user.id);
  } else if (sub === 'edit') {
    result = await rules.updateRule(interaction.guild, kind, name, ruleOptions(interaction, kind), interaction.member);
  } else {
    result = await rules.removeRule(interaction.guild, kind, name);
  }
  if (!result.ok) return bad(interaction, result.message);
  if (result.unchanged) return reply(interaction, 'Nothing to change: give at least one new value.');
  const done = { add: 'created', edit: 'updated', remove: 'deleted' }[sub];
  await ok(interaction, `The rule \`${rules.cleanName(name)}\` was ${done}.${sub === 'remove' ? '' : ` Members are checked as they change; use \`!${kind} sync\` to apply it to everyone now.`}`);
}

const PERMISSION = PermissionFlagsBits.ManageGuild;

module.exports = { addSubcommands, execute, PERMISSION, SOURCE_CHOICES, ACTION_CHOICES, VANITY_SOURCES, CONDITIONS };
