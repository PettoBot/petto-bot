const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { getUserPremium } = require('../../db/premium');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { t, languageOf } = require('../../i18n');

// The statuses with a name in the catalogs (`info.premium.status.<key>`); any other is shown as it is stored.
const STATUS_KEYS = { active: 'active', pending: 'pending', past_due: 'pastDue', canceled: 'canceled', expired: 'expired', free: 'free' };

// What any member can see here (the status card and its errors) is translated. The owner actions of Premium (grant, assign, unassign, revoke) are NOT part of this
// command any more (they showed in the `/` menu, `/bot premium` included): they are the hidden prefix-only tool `!premiumadmin` (premiumadmin.js), and the old words
// `!premium grant ...` are sent there by `prefixWords`.

module.exports = {
  // This builder is used by the prefix parser only. deployCommands.js skips
  // every command marked prefixOnly, so no /premium command is created.
  prefixOnly: true,
  prefixDefaultSubcommand: 'status',
  // The old owner words keep working for the owner (`!premium grant @user 3` is `!premiumadmin grant @user 3`); for everybody else they are not a command.
  prefixWords: Object.fromEntries(['grant', 'assign', 'unassign', 'revoke'].map((word) => [word, { command: 'premiumadmin', args: [word] }])),
  aliases: ['prem'],
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('View or manage Petto Premium from the message prefix.')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Show Premium status for yourself or another user.')
      .addUserOption((option) => option.setName('user').setDescription('User to inspect (default: you)').setRequired(false))),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const subcommand = interaction.options.getSubcommand(false) ?? 'status';
    try {
      if (subcommand === 'status') return status(interaction, lang);
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
  const embed = buildStatusEmbed(interaction, user, premium, lang);
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

function buildStatusEmbed(interaction, user, premium, lang) {
  const entitlement = premium.entitlement;
  const status = STATUS_KEYS[premium.status] ? t(lang, `info.premium.status.${STATUS_KEYS[premium.status]}`) : premium.status;
  const stateColor = premium.active ? COLORS.GREEN : premium.status === 'free' ? COLORS.DEFAULT : COLORS.YELLOW;
  const assigned = premium.assignments.length
    ? premium.assignments.map((assignment) => formatGuild(interaction, assignment.guild_id)).join('\n').slice(0, 1024)
    : t(lang, 'info.premium.noServers');
  const period = premium.active
    ? (premium.expiresAt ? `<t:${Math.floor(new Date(premium.expiresAt).getTime() / 1000)}:F>` : t(lang, 'info.premium.permanent'))
    : entitlement?.current_period_end ? `<t:${Math.floor(new Date(entitlement.current_period_end).getTime() / 1000)}:F>` : '—';

  return new EmbedBuilder()
    .setColor(stateColor)
    .setAuthor({ name: `${user.username} · Premium`, iconURL: user.displayAvatarURL() })
    .setTitle(t(lang, 'info.premium.title', { status }))
    .setDescription(t(lang, premium.active ? 'info.premium.description.active' : 'info.premium.description.inactive'))
    .addFields(
      { name: t(lang, 'info.premium.field.user'), value: `<@${user.id}>\n\`${user.id}\``, inline: true },
      { name: t(lang, 'info.premium.field.plan'), value: entitlement?.plan_key ?? t(lang, 'info.premium.status.free'), inline: true },
      { name: t(lang, 'info.premium.field.period'), value: period, inline: true },
      { name: t(lang, 'info.premium.field.slots'), value: `${premium.slotsUsed} / ${premium.slotsTotal}`, inline: true },
      { name: t(lang, 'info.premium.field.servers'), value: assigned, inline: false },
    )
    .setFooter({ text: t(lang, 'info.premium.footer') });
}

function formatGuild(interaction, guildId) {
  const guild = interaction.client.guilds.cache.get(guildId);
  return guild ? `**${guild.name}** · \`${guildId}\`` : `\`${guildId}\``;
}

async function replyError(interaction, content) {
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.RED).setDescription(`⚠️ ${content}`)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
