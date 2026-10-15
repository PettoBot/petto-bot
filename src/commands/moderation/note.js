const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { addNote, getNote, getNotesForUser } = require('../../db/notes');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['notes'],
  data: new SlashCommandBuilder()
    .setName('note')
    .setDescription('Staff notes on a user (non-punitive, not part of their case history).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a note to a user.')
        .addUserOption((opt) => opt.setName('user').setDescription('The user to note').setRequired(true))
        .addStringOption((opt) => opt.setName('note').setDescription('The note content').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('view').setDescription('View a note by its ID.').addIntegerOption((opt) => opt.setName('id').setDescription('Note ID').setRequired(true).setMinValue(1)))
    .addSubcommand((sub) => sub.setName('list').setDescription('Show all notes on a user.').addUserOption((opt) => opt.setName('user').setDescription('The user to check').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return add(interaction);
    if (sub === 'view') return view(interaction);
    return list(interaction);
  },
};

async function add(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  const note = interaction.options.getString('note', true);

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const saved = await addNote({ guildId: interaction.guild.id, userId: targetUser.id, moderatorId: interaction.user.id, note });

  const text = [
    t(lang, 'moderation.note.added', { emoji: EMOJI.APPROVE, id: saved.id, user: `${targetUser}` }),
    t(lang, 'moderation.common.moderator', { moderator: `${interaction.user}` }),
    t(lang, 'moderation.note.note', { note }),
  ].join('\n');
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function view(interaction) {
  const lang = await languageOf(interaction);
  const noteId = interaction.options.getInteger('id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const note = await getNote(interaction.guild.id, noteId);
  if (!note) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.note.notFound', { id: noteId }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const ts = Math.floor(new Date(note.created_at).getTime() / 1000);
  const text = [
    t(lang, 'moderation.note.title', { emoji: EMOJI.QUESTION, id: note.id }),
    t(lang, 'moderation.note.user', { user: `<@${note.user_id}>` }),
    t(lang, 'moderation.common.moderator', { moderator: `<@${note.moderator_id}>` }),
    t(lang, 'moderation.note.when', { full: `<t:${ts}:F>`, relative: `<t:${ts}:R>` }),
    t(lang, 'moderation.note.note', { note: note.note }),
  ].join('\n');
  await interaction.editReply({ components: [textCard(text, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function list(interaction) {
  const lang = await languageOf(interaction);
  const targetUser = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const notes = await getNotesForUser(interaction.guild.id, targetUser.id);
  if (!notes.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'moderation.note.none', { user: `${targetUser}` }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [t(lang, 'moderation.note.listTitle', { user: `${targetUser}` })];
  for (const note of notes) {
    const ts = Math.floor(new Date(note.created_at).getTime() / 1000);
    lines.push(`\`#${note.id}\` <@${note.moderator_id}> · <t:${ts}:R>\n> ${note.note}`);
  }

  await interaction.editReply({ components: [textCard(lines.join('\n\n'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}
