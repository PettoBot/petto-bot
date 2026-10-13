const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const history = require('../../db/identityHistory');
const { noteUser, noteMember, recordingOn, forgetOptOut } = require('../../utils/identityHistory');
const { renderAvatarSheet, MAX_TILES } = require('../../utils/avatarSheet');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');

const ACCENT = 0x8c7cff;
const MAX_LINES = 40;
const V2 = MessageFlags.IsComponentsV2;
const unix = (value) => Math.floor(new Date(value).getTime() / 1000);

const userOption = (o) => o.setName('user').setDescription('Whose history (default: you)').setRequired(false);

module.exports = {
  aliases: ['phist'],
  data: new SlashCommandBuilder()
    .setName('profilehistory')
    .setDescription('The avatars, names and nicknames a member has had.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('avatars').setDescription('Every avatar saved of a member, in one picture.').addUserOption(userOption))
    .addSubcommand((s) => s.setName('names').setDescription('The names (display names) saved of a member.').addUserOption(userOption))
    .addSubcommand((s) => s.setName('nicknames').setDescription('The nicknames saved of a member in this server.').addUserOption(userOption))
    .addSubcommand((s) => s
      .setName('clear')
      .setDescription('Delete your saved avatars, names or nicknames.')
      .addStringOption((o) => o.setName('what').setDescription('What to delete').setRequired(true).addChoices({ name: 'avatars', value: 'avatars' }, { name: 'names', value: 'names' }, { name: 'nicknames', value: 'nicknames' }, { name: 'all', value: 'all' })))
    .addSubcommand((s) => s
      .setName('record')
      .setDescription('Turn the saving of your history on or off.')
      .addBooleanOption((o) => o.setName('enabled').setDescription('On (save it) or off (stop saving it)').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'clear') return clearCmd(interaction);
    if (sub === 'record') return recordCmd(interaction);
    return showCmd(interaction, sub);
  },
};

const say = (interaction, text, color = 0x4b4f59, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } });

async function clearCmd(interaction) {
  const what = interaction.options.getString('what', true);
  const kind = { avatars: 'avatar', names: 'name', nicknames: 'nickname', all: null }[what];
  const removed = await history.clear(interaction.user.id, kind);
  return say(interaction, `${EMOJI.APPROVE}  Deleted ${removed} saved ${what === 'all' ? 'entries' : what}. ${await recordingOn(interaction.user.id) ? 'Petto keeps saving new ones; use `profilehistory record false` to stop.' : 'Saving is off for you.'}`, COLORS.GREEN, true);
}

async function recordCmd(interaction) {
  const enabled = interaction.options.getBoolean('enabled', true);
  await history.setOptOut(interaction.user.id, !enabled);
  forgetOptOut(interaction.user.id);
  if (enabled) await noteUser(interaction.user);
  return say(interaction, enabled ? `${EMOJI.APPROVE}  Your avatars, names and nicknames are saved again.` : `${EMOJI.APPROVE}  Petto stops saving your history, and others cannot see it. What is saved stays until you \`clear\` it.`, COLORS.GREEN, true);
}

async function showCmd(interaction, kindName) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  if (user.bot) return say(interaction, 'Bots do not have a history.', COLORS.RED, true);
  const self = user.id === interaction.user.id;
  if (!(await recordingOn(user.id))) {
    return say(interaction, self ? 'Your history is turned off. Use `profilehistory record true` to save it again.' : `${user} turned their history off.`, 0x4b4f59, true);
  }
  await interaction.deferReply({ flags: V2 });
  // What the person shows now is part of the history, so it is saved before it is read.
  const member = interaction.guild.members.cache.get(user.id) ?? await interaction.guild.members.fetch(user.id).catch(() => null);
  await noteUser(user);
  if (member) await noteMember(member);

  if (kindName === 'avatars') return showAvatars(interaction, user);
  const kind = kindName === 'names' ? 'name' : 'nickname';
  const rows = await history.list(user.id, kind, { guildId: kind === 'nickname' ? interaction.guild.id : null });
  const total = rows.length;
  const title = kind === 'name' ? `Names of ${user.username}` : `Nicknames of ${member?.displayName ?? user.username} in this server`;
  if (!total) return interaction.editReply({ components: [textCard(`No ${kindName} are saved yet.`, 0x4b4f59)], flags: V2 });
  const lines = rows.slice(0, MAX_LINES).map((row, index) => `${index === 0 ? '**Now**' : `${index + 1}.`} ${String(row.value).replace(/[`*_~|>]/g, '\\$&')} · <t:${unix(row.seen_at)}:R>`);
  const container = new ContainerBuilder().setAccentColor(ACCENT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}\n${total} saved${total > MAX_LINES ? `, the newest ${MAX_LINES} shown` : ''}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n').slice(0, 3500)));
  return interaction.editReply({ components: [container], flags: V2, allowedMentions: { parse: [] } });
}

async function showAvatars(interaction, user) {
  const rows = await history.list(user.id, 'avatar');
  if (!rows.length) return interaction.editReply({ components: [textCard('No avatars are saved yet: this person has the default one.', 0x4b4f59)], flags: V2 });
  const sheet = await renderAvatarSheet(user.id, rows);
  const container = new ContainerBuilder().setAccentColor(ACCENT)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Avatars of ${user.username}\n${rows.length} saved${rows.length > MAX_TILES ? `, the newest ${MAX_TILES} shown` : ''}, newest first`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://avatars.png')));
  return interaction.editReply({ components: [container], files: [new AttachmentBuilder(sheet.buffer, { name: 'avatars.png' })], flags: V2, allowedMentions: { parse: [] } });
}
