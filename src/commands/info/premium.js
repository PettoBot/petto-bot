const {
  SlashCommandBuilder, EmbedBuilder, MessageFlags, ContainerBuilder, SectionBuilder, TextDisplayBuilder, ThumbnailBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const config = require('../../config');
const { getUserPremium, assignPremiumSlot, unassignPremiumSlot } = require('../../db/premium');
const { manageableGuilds, canManage, findGuild } = require('../../utils/premiumServers');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { DASHBOARD_URL } = require('../../utils/links');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { t, languageOf } = require('../../i18n');

// The statuses with a name in the catalogs (`info.premium.status.<key>`); any other is shown as it is stored.
const STATUS_KEYS = { active: 'active', pending: 'pending', past_due: 'pastDue', canceled: 'canceled', expired: 'expired', free: 'free' };

// What any member can see here (the status card and its errors) is translated. The owner actions of Premium (grant, assign, unassign, revoke) are NOT part of this
// command any more (they showed in the `/` menu, `/bot premium` included): they are the hidden prefix-only tool `!premiumadmin` (premiumadmin.js), and the old words
// `!premium grant ...` are sent there by `prefixWords`.

const V2 = MessageFlags.IsComponentsV2;
const premiumUrl = () => 'https://petto.sbs/premium';
const card = (interaction, text, color, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });

module.exports = {
  // For scripts/check-premium-status.js: the card of the status.
  buildStatusCardForCheck: (...args) => buildStatusCard(...args),
  registerSlash: true,
  // A slash command (global) and a prefix command: `/premium add` and `!premium add` give a Premium slot to a server where the person is an administrator.
  prefixDefaultSubcommand: 'status',
  // The old owner words keep working for the owner (`!premium grant @user 3` is `!premiumadmin grant @user 3`); for everybody else they are not a command.
  prefixWords: Object.fromEntries(['grant', 'assign', 'unassign', 'revoke'].map((word) => [word, { command: 'premiumadmin', args: [word] }])),
  aliases: ['prem'],
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Your Petto Premium: its status, and which servers have it.')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Show Premium status for yourself or another user.')
      .addUserOption((option) => option.setName('user').setDescription('User to inspect (default: you)').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Give a Premium slot to a server where you are an administrator (this one by default).')
      .addStringOption((option) => option.setName('server').setDescription('The server: pick it from the list (default: this one)').setAutocomplete(true).setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('Take your Premium slot back from a server.')
      .addStringOption((option) => option.setName('server').setDescription('The server: pick it from the list (default: this one)').setAutocomplete(true).setRequired(false)))
    .addSubcommand((sub) => sub.setName('servers').setDescription('List the servers that have your Premium and how many slots you have left.'))
    .addSubcommand((sub) => sub.setName('info').setDescription('See the Premium plans and how to give it to a server.')),

  /** The list of the `server` option: for `add`, the servers the person manages (Premium or not); for `remove`, the servers that hold one of their slots. */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'server') return interaction.respond([]);
    const typed = String(focused.value ?? '').toLowerCase().trim();
    const mine = new Set((await getUserPremium(interaction.user.id).catch(() => ({ assignments: [] }))).assignments.map((assignment) => String(assignment.guild_id)));
    let guilds;
    if (interaction.options.getSubcommand(false) === 'remove') {
      guilds = [...mine].map((id) => interaction.client.guilds.cache.get(id)).filter((guild) => guild && (!typed || guild.name.toLowerCase().includes(typed)));
    } else {
      guilds = await manageableGuilds(interaction.client, interaction.user.id, typed);
    }
    const choices = guilds.slice(0, 25).map((guild) => ({ name: `${mine.has(guild.id) ? '★ ' : ''}${guild.name}`.slice(0, 100), value: guild.id }));
    return interaction.respond(choices);
  },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const subcommand = interaction.options.getSubcommand(false) ?? 'status';
    try {
      if (subcommand === 'status') return status(interaction, lang);
      if (subcommand === 'add') return addServer(interaction, lang);
      if (subcommand === 'remove') return removeServer(interaction, lang);
      if (subcommand === 'servers') return listServers(interaction, lang);
      if (subcommand === 'info') return info(interaction, lang);
      return replyError(interaction, t(lang, 'info.premium.unknownAction'));
    } catch (error) {
      logger.error(`Premium command failed for ${interaction.user?.id ?? 'unknown user'}:`, error);
      return replyError(interaction, t(lang, 'info.premium.failed'));
    }
  },
};

// The owner may read the status of anybody (a member reads only their own): this is a look, not a team action.
function isOwner(interaction) {
  return interaction.user?.id === config.ownerId;
}

async function status(interaction, lang) {
  const requested = interaction.options.getUser('user');
  if (requested && requested.id !== interaction.user.id && !isOwner(interaction)) {
    return replyError(interaction, t(lang, 'info.premium.ownStatusOnly'));
  }
  const user = requested ?? interaction.user;
  const premium = await getUserPremium(user.id);
  return interaction.reply({ components: [buildStatusCard(interaction, user, premium, lang)], flags: V2, allowedMentions: { parse: [] } });
}

/**
 * The status as a Components V2 card (it was an embed): the title, what it means and the avatar of the person on top, then the plans, the period and the slots, the
 * servers that have it, a quiet line saying how to give a slot, and two link buttons. The color follows the state: green active, yellow when something is wrong, none when free.
 */
function buildStatusCard(interaction, user, premium, lang) {
  const entitlement = premium.entitlement;
  const status = STATUS_KEYS[premium.status] ? t(lang, `info.premium.status.${STATUS_KEYS[premium.status]}`) : premium.status;
  const accent = premium.active ? COLORS.GREEN : premium.status === 'free' ? null : COLORS.YELLOW;
  const assigned = premium.assignments.length ? serverList(interaction, premium.assignments) : t(lang, 'info.premium.noServers');
  const period = premium.active
    ? (premium.expiresAt ? `<t:${Math.floor(new Date(premium.expiresAt).getTime() / 1000)}:F>` : t(lang, 'info.premium.permanent'))
    : entitlement?.current_period_end ? `<t:${Math.floor(new Date(entitlement.current_period_end).getTime() / 1000)}:F>` : '—';
  const plans = planNames(premium) || (entitlement?.plan_key ?? t(lang, 'info.premium.status.free'));
  const text = (content) => new TextDisplayBuilder().setContent(content);

  const headText = text(`### ${t(lang, 'info.premium.title', { status })}\n${t(lang, premium.active ? 'info.premium.description.active' : 'info.premium.description.inactive')}\n-# <@${user.id}> · \`${user.id}\``);
  const avatar = typeof user.displayAvatarURL === 'function' ? user.displayAvatarURL() : null;
  const container = new ContainerBuilder();
  // The avatar sits beside the title; a user with no picture to show gets the title alone.
  if (avatar) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(headText).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  else container.addTextDisplayComponents(headText);
  container
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(text(`**${t(lang, 'info.premium.field.plan')}**\n${plans}\n\n**${t(lang, 'info.premium.field.period')}**\n${period}\n\n**${t(lang, 'info.premium.field.slots')}**\n\`${premium.slotsUsed} / ${premium.slotsTotal}\``))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(text(`**${t(lang, 'info.premium.field.servers')}**\n${assigned}`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(text(`-# ${t(lang, 'info.premium.footer')}`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'info.premium.dashboard.button')).setURL(`${DASHBOARD_URL}/premium`),
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t(lang, 'info.premium.plans.button')).setURL(premiumUrl()),
    ));
  return accent === null ? container : container.setAccentColor(accent);
}

/** Every server that has a slot, one a line; when they do not fit in a field of the card, the last line says how many more there are (`+3`). */
function serverList(interaction, assignments) {
  const lines = assignments.map((assignment) => formatGuild(interaction, assignment.guild_id));
  let text = '';
  for (let i = 0; i < lines.length; i++) {
    const next = text ? `${text}\n${lines[i]}` : lines[i];
    if (next.length > 980) return `${text}\n+${lines.length - i}`;
    text = next;
  }
  return text;
}

/** The plans of every active Premium of the person (one when they have one), each once with how many times it counts. */
function planNames(premium) {
  const counts = new Map();
  for (const each of premium.activeEntitlements ?? []) counts.set(each.plan_key ?? '—', (counts.get(each.plan_key ?? '—') ?? 0) + 1);
  return [...counts].map(([plan, count]) => (count > 1 ? `${plan} ×${count}` : plan)).join('\n').slice(0, 1024);
}

function formatGuild(interaction, guildId) {
  const guild = interaction.client.guilds.cache.get(guildId);
  return guild ? `**${guild.name}** · \`${guildId}\`` : `\`${guildId}\``;
}

async function replyError(interaction, content) {
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.RED).setDescription(`⚠️ ${content}`)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

/** The server of the option (an ID from the list, a name or an ID typed with the prefix), or this one. Null when it is not a server Petto is in. */
function serverOf(interaction) {
  const typed = interaction.options.getString('server');
  return typed ? findGuild(interaction.client, typed) : interaction.guild;
}

async function addServer(interaction, lang) {
  const guild = serverOf(interaction);
  if (!guild) return card(interaction, t(lang, 'info.premium.add.noServer', { emoji: EMOJI.DENY }), 0xfe6465, true);
  const premium = await getUserPremium(interaction.user.id);
  if (!premium.active) return card(interaction, t(lang, 'info.premium.add.noPremium', { emoji: EMOJI.DENY, url: premiumUrl() }), 0xfe6465, true);
  if (!(await canManage(guild, interaction.user.id))) return card(interaction, t(lang, 'info.premium.add.notAdmin', { emoji: EMOJI.DENY, server: guild.name }), 0xfe6465, true);
  const result = await assignPremiumSlot(interaction.user.id, guild.id);
  if (!result.ok) {
    const key = { server_taken: 'taken', no_slots: 'noSlots', no_active_entitlement: 'noPremium' }[result.code];
    if (!key) throw new Error(`premium assign: ${result.code}`); // i18n-ignore: an internal error for the log
    return card(interaction, t(lang, `info.premium.add.${key}`, { emoji: EMOJI.DENY, server: guild.name, used: result.used, limit: result.limit, url: premiumUrl() }), 0xfe6465, true);
  }
  const after = await getUserPremium(interaction.user.id);
  const key = result.already ? 'info.premium.add.already' : 'info.premium.add.done';
  return card(interaction, t(lang, key, { emoji: EMOJI.APPROVE, server: guild.name, used: after.slotsUsed, total: after.slotsTotal }), 0xa5ea7a);
}

async function removeServer(interaction, lang) {
  const guild = serverOf(interaction);
  if (!guild) return card(interaction, t(lang, 'info.premium.add.noServer', { emoji: EMOJI.DENY }), 0xfe6465, true);
  const result = await unassignPremiumSlot(interaction.user.id, guild.id, interaction.client);
  if (!result.ok) {
    if (result.code === 'no_assignment') return card(interaction, t(lang, 'info.premium.remove.none', { emoji: EMOJI.DENY, server: guild.name }), 0xfe6465, true);
    throw new Error(`premium unassign: ${result.code}`); // i18n-ignore: an internal error for the log
  }
  const after = await getUserPremium(interaction.user.id);
  return card(interaction, t(lang, 'info.premium.remove.done', { emoji: EMOJI.APPROVE, server: guild.name, used: after.slotsUsed, total: after.slotsTotal }), 0xa5ea7a);
}

async function listServers(interaction, lang) {
  const premium = await getUserPremium(interaction.user.id);
  const lines = premium.assignments.map((assignment) => `- ${formatGuild(interaction, assignment.guild_id)}`);
  const text = lines.length ? serverList(interaction, premium.assignments).split('\n').map((line) => (line.startsWith('+') ? line : `- ${line}`)).join('\n') : t(lang, 'info.premium.noServers');
  return card(interaction, `${t(lang, 'info.premium.servers.title', { used: premium.slotsUsed, total: premium.slotsTotal })}\n${text}`);
}

async function info(interaction, lang) {
  return card(interaction, t(lang, 'info.premium.info', { url: premiumUrl(), dashboard: `${DASHBOARD_URL}/premium` }));
}
