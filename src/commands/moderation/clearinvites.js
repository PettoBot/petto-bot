// !clearinvites: deletes every invite of the server, after a confirmation (to close the doors during a raid or a leak).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { handleStaffAction } = require('../../logging/moreLog');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['deleteinvites', 'purgeinvites'],
  data: new SlashCommandBuilder()
    .setName('clearinvites')
    .setDescription('Delete every invite of the server (asks first).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: t(lang, 'moderation.clearInvites.iNeed'), flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const show = (text, color, extra = []) => interaction.editReply({ components: [textCard(text, color), ...extra], flags: MessageFlags.IsComponentsV2 });

    const invites = await interaction.guild.invites.fetch().catch(() => null);
    if (!invites) return show(t(lang, 'moderation.clearInvites.fetchFailed'), 0xfe6465);
    if (!invites.size) return show(t(lang, 'moderation.clearInvites.none'));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('clearinvites_confirm').setLabel(t(lang, 'moderation.bulk.confirm.button')).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('clearinvites_cancel').setLabel(t(lang, 'moderation.bulk.cancel.button')).setStyle(ButtonStyle.Secondary),
    );
    const prompt = await show(tn(lang, 'moderation.clearInvites.prompt', invites.size, { emoji: EMOJI.WARNING, count: invites.size }), 0xfed53c, [row]);
    let click;
    try {
      click = await prompt.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 30_000 });
    } catch {
      return show(t(lang, 'moderation.clearInvites.timedOut', { emoji: EMOJI.DENY }));
    }
    if (click.customId !== 'clearinvites_confirm') {
      return click.update({ components: [textCard(t(lang, 'moderation.clearInvites.cancelled', { emoji: EMOJI.DENY }))], flags: MessageFlags.IsComponentsV2 });
    }
    await click.update({ components: [textCard(t(lang, 'moderation.bulk.confirmed', { emoji: EMOJI.APPROVE }))], flags: MessageFlags.IsComponentsV2 });

    let deleted = 0;
    const audit = t(lang, 'moderation.clearInvites.audit', { user: interaction.user.tag });
    for (const invite of invites.values()) {
      const ok = await invite.delete(audit).then(() => true, (err) => {
        logger.warn(`clearinvites: could not delete ${invite.code} in ${interaction.guild.id}: ${err.message}`);
        return false;
      });
      if (ok) deleted += 1;
    }
    handleStaffAction('invitesCleared', interaction.client, interaction.guild, { moderator: interaction.user, detail: (l) => tn(l, 'moderation.clearInvites.log', deleted, { count: deleted }) }).catch(() => {});
    const lines = [tn(lang, 'moderation.clearInvites.done', deleted, { emoji: EMOJI.APPROVE, count: deleted })];
    if (deleted < invites.size) lines.push(t(lang, 'moderation.clearInvites.someFailed', { count: invites.size - deleted }));
    lines.push(t(lang, 'moderation.clearInvites.hint'));
    return show(lines.join('\n'), 0xa5ea7a);
  },
};
