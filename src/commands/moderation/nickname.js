// Nicknames: change or reset one, or force one that Petto keeps putting back (until it is unforced).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const forced = require('../../db/forcedNicknames');
const { canModerate } = require('../../utils/permissions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { handleStaffAction } = require('../../logging/moreLog');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

const MAX_NICKNAME = 32;
const GREEN = 0xa5ea7a;
const GREY = 0x4b4f59;
const RED = 0xfe6465;

module.exports = {
  aliases: ['nick', 'rename', 'setnick'],
  prefixDefaultSubcommand: 'set',
  prefixSubcommandAliases: { clear: 'reset', remove: 'reset', list: 'forced', view: 'forced', freeze: 'force' },
  data: new SlashCommandBuilder()
    .setName('nickname')
    .setDescription("Change, reset or force a member's nickname.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('set').setDescription('Change the nickname of a member.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)).addStringOption((o) => o.setName('nickname').setDescription('The new nickname (up to 32 characters)').setRequired(true)))
    .addSubcommand((sub) => sub.setName('reset').setDescription('Remove the nickname of a member.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)))
    .addSubcommand((sub) => sub.setName('force').setDescription('Keep a nickname on a member: Petto puts it back whenever it changes.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)).addStringOption((o) => o.setName('nickname').setDescription('The nickname to keep (empty: stop forcing)')))
    .addSubcommand((sub) => sub.setName('unforce').setDescription('Stop forcing the nickname of a member.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)))
    .addSubcommand((sub) => sub.setName('forced').setDescription('List the forced nicknames of this server.')),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'forced') return list(interaction, lang);
    const user = interaction.options.getUser('user', true);
    const nickname = interaction.options.getString('nickname')?.trim() || null;
    if (sub === 'unforce' || (sub === 'force' && !nickname)) return unforce(interaction, user, lang);

    if (nickname && nickname.length > MAX_NICKNAME) {
      await interaction.reply({ content: t(lang, 'moderation.nickname.tooLong', { max: MAX_NICKNAME }), flags: MessageFlags.Ephemeral });
      return;
    }
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: t(lang, 'moderation.common.notMember'), flags: MessageFlags.Ephemeral });
      return;
    }
    const blocked = guard(interaction, member, { self: sub !== 'force' }, lang);
    if (blocked) {
      await interaction.reply({ content: blocked, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const reply = (text, color = GREEN) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    const value = sub === 'reset' ? null : nickname;

    // While a nickname is forced, a plain change would be undone at once: say so instead.
    if (sub !== 'force' && await forced.getForced(interaction.guild.id, member.id).catch(() => null)) return reply(t(lang, 'moderation.nickname.isForced', { emoji: EMOJI.WARNING, user: `${member}` }), GREY);

    try {
      await member.setNickname(value, t(lang, 'moderation.nickname.audit', { user: interaction.user.tag }));
    } catch (err) {
      logger.warn(`nickname ${sub} failed for ${member.id} in ${interaction.guild.id}: ${err.message}`);
      return reply(t(lang, 'moderation.nickname.failed', { emoji: EMOJI.DENY }), RED);
    }

    if (sub === 'force') {
      await ensureGuild(interaction.guild.id);
      await forced.setForced(interaction.guild.id, member.id, nickname, interaction.user.id);
      handleStaffAction('nicknameForced', interaction.client, interaction.guild, { moderator: interaction.user, user, note: nickname }).catch(() => {});
      return reply(t(lang, 'moderation.nickname.forced', { emoji: EMOJI.APPROVE, user: `${member}`, nickname: clean(nickname) }));
    }
    return reply(value
      ? t(lang, 'moderation.nickname.set', { emoji: EMOJI.APPROVE, user: `${member}`, nickname: clean(value) })
      : t(lang, 'moderation.nickname.reset', { emoji: EMOJI.APPROVE, user: `${member}` }));
  },
};

/** A nickname shown in bold without its Markdown taking over the message. */
function clean(nickname) {
  return String(nickname).replace(/[*_`~|\\]/g, '\\$&');
}

/**
 * Why the member's nickname cannot be changed by this moderator, or null. Your own nickname is fine (`self`); anyone else is
 * checked like any moderation, and Petto must be above them (Discord never lets a bot rename the owner).
 */
function guard(interaction, member, { self }, lang) {
  if (!(self && member.id === interaction.user.id)) {
    const check = canModerate(interaction, member, PermissionFlagsBits.ManageNicknames, { hierarchy: 'none' });
    if (!check.ok) return check.message;
  } else if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
    return t(lang, 'moderation.nickname.iNeed');
  }
  if (!member.manageable) return t(lang, 'moderation.nickname.cannotManage');
  return null;
}

async function unforce(interaction, user, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await forced.removeForced(interaction.guild.id, user.id);
  if (removed) handleStaffAction('nicknameUnforced', interaction.client, interaction.guild, { moderator: interaction.user, user }).catch(() => {});
  const text = removed
    ? t(lang, 'moderation.nickname.unforced', { emoji: EMOJI.APPROVE, user: `${user}` })
    : t(lang, 'moderation.nickname.notForced', { emoji: EMOJI.DENY, user: `${user}` });
  await interaction.editReply({ components: [textCard(text, removed ? GREEN : GREY)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function list(interaction, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await forced.listForced(interaction.guild.id);
  if (!rows.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.nickname.noneForced'), GREY)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const lines = rows.slice(0, 40).map((row) => `<@${row.user_id}> · **${clean(row.nickname)}** · <@${row.set_by}>`);
  if (rows.length > 40) lines.push(t(lang, 'moderation.role.more', { count: rows.length - 40 }));
  await interaction.editReply({ components: [textCard([tn(lang, 'moderation.nickname.forcedTitle', rows.length, { count: rows.length }), ...lines].join('\n').slice(0, 3900), GREY)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}
