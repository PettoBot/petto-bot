// !thread: rename, lock, unlock, and add or remove members of a thread or forum post.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { canModerate } = require('../../utils/permissions');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const logger = require('../../utils/logger');
const { t, languageOf } = require('../../i18n');

const THREAD_TYPES = [ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread];
const threadOption = (opt) => opt.setName('thread').setDescription('The thread (defaults to this one)').addChannelTypes(...THREAD_TYPES).setRequired(false);

module.exports = {
  aliases: ['th'],
  prefixGreedyStringOptions: { rename: 'name' },
  prefixSubcommandAliases: { close: 'lock', reopen: 'unlock', open: 'unlock', name: 'rename' },
  data: new SlashCommandBuilder()
    .setName('thread')
    .setDescription('Manage threads and forum posts: rename, lock, unlock, add or remove members.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageThreads)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('rename').setDescription('Rename a thread.').addStringOption((o) => o.setName('name').setDescription('The new name').setRequired(true).setMaxLength(100)).addChannelOption(threadOption))
    .addSubcommand((sub) => sub.setName('lock').setDescription('Lock a thread: only moderators can write in it.').addChannelOption(threadOption).addStringOption((o) => o.setName('reason').setDescription('Reason (shown in the audit log)')))
    .addSubcommand((sub) => sub.setName('unlock').setDescription('Unlock and reopen a thread.').addChannelOption(threadOption).addStringOption((o) => o.setName('reason').setDescription('Reason (shown in the audit log)')))
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a member to a thread.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)).addChannelOption(threadOption))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a member from a thread.').addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)).addChannelOption(threadOption)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const thread = interaction.options.getChannel('thread') ?? interaction.channel;
    if (!thread?.isThread?.()) {
      await interaction.reply({ content: t(lang, 'moderation.thread.notThread'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!thread.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.ManageThreads)) {
      await interaction.reply({ content: t(lang, 'moderation.thread.iNeed'), flags: MessageFlags.Ephemeral });
      return;
    }
    const user = sub === 'add' || sub === 'remove' ? interaction.options.getUser('user', true) : null;
    if (sub === 'remove') {
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const check = member ? canModerate(interaction, member, PermissionFlagsBits.ManageThreads, { hierarchy: 'none' }) : { ok: true };
      if (!check.ok) {
        await interaction.reply({ content: check.message, flags: MessageFlags.Ephemeral });
        return;
      }
    }

    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const reason = interaction.options.getString('reason') ?? t(lang, 'moderation.thread.audit', { user: interaction.user.tag });
    try {
      if (sub === 'rename') await thread.setName(interaction.options.getString('name', true).slice(0, 100), reason);
      else if (sub === 'lock') await thread.setLocked(true, reason);
      else if (sub === 'unlock') {
        if (thread.archived) await thread.setArchived(false, reason);
        await thread.setLocked(false, reason);
      } else if (sub === 'add') await thread.members.add(user.id, reason);
      else await thread.members.remove(user.id, reason);
    } catch (err) {
      logger.warn(`thread ${sub} failed in ${thread.id}: ${err.message}`);
      await interaction.editReply({ components: [textCard(t(lang, 'moderation.thread.failed', { emoji: EMOJI.DENY }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    const text = t(lang, `moderation.thread.done.${sub}`, { emoji: EMOJI.APPROVE, thread: `${thread}`, user: user ? `${user}` : '' });
    await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  },
};
