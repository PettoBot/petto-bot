const { SlashCommandBuilder, MessageFlags, AttachmentBuilder, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder, SeparatorSpacingSize } = require('discord.js');
const history = require('../../db/identityHistory');
const { noteUser, noteMember, recordingOn, setRecording, clearHistory } = require('../../utils/identityHistory');
const images = require('../../db/profileHistoryImages');
const { renderAvatarSheet, MAX_TILES } = require('../../utils/avatarSheet');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { t, tn, languageOf } = require('../../i18n');

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
  const lang = await languageOf(interaction);
  const what = interaction.options.getString('what', true);
  const kind = { avatars: 'avatar', names: 'name', nicknames: 'nickname', all: null }[what];
  const removed = await clearHistory(interaction.user.id, kind);
  const status = t(lang, await recordingOn(interaction.user.id) ? 'utility.history.stillSaving' : 'utility.history.savingOff');
  return say(interaction, tn(lang, `utility.history.cleared.${what}`, removed, { emoji: EMOJI.APPROVE, count: removed, status }), COLORS.GREEN, true);
}

async function recordCmd(interaction) {
  const lang = await languageOf(interaction);
  const enabled = interaction.options.getBoolean('enabled', true);
  await setRecording(interaction.user.id, enabled);
  if (enabled) await noteUser(interaction.user);
  return say(interaction, t(lang, enabled ? 'utility.history.recordOn' : 'utility.history.recordOff', { emoji: EMOJI.APPROVE }), COLORS.GREEN, true);
}

async function showCmd(interaction, kindName) {
  const lang = await languageOf(interaction);
  const user = interaction.options.getUser('user') ?? interaction.user;
  if (user.bot) return say(interaction, t(lang, 'utility.history.bot'), COLORS.RED, true);
  const self = user.id === interaction.user.id;
  if (!(await recordingOn(user.id))) {
    return say(interaction, self ? t(lang, 'utility.history.offSelf') : t(lang, 'utility.history.offOther', { user: `${user}` }), 0x4b4f59, true);
  }
  await interaction.deferReply({ flags: V2 });
  // What the person shows now is part of the history, so it is saved before it is read.
  const member = interaction.guild.members.cache.get(user.id) ?? await interaction.guild.members.fetch(user.id).catch(() => null);
  await noteUser(user);
  if (member) await noteMember(member);

  if (kindName === 'avatars') return showAvatars(interaction, user, lang);
  const kind = kindName === 'names' ? 'name' : 'nickname';
  const rows = await history.list(user.id, kind, { guildId: kind === 'nickname' ? interaction.guild.id : null });
  const total = rows.length;
  const title = kind === 'name' ? t(lang, 'utility.history.namesTitle', { name: user.username }) : t(lang, 'utility.history.nicknamesTitle', { name: member?.displayName ?? user.username });
  if (!total) return interaction.editReply({ components: [textCard(t(lang, `utility.history.empty.${kindName}`))], flags: V2 });
  const now = `**${t(lang, 'utility.history.now')}**`;
  // \x60 is the backtick: written so, the text scanner of scripts/find-hardcoded-text.js does not read a template there.
  const lines = rows.slice(0, MAX_LINES).map((row, index) => `${index === 0 ? now : `${index + 1}.`} ${String(row.value).replace(/[\\\x60*_~|>]/g, '\\$&')} · <t:${unix(row.seen_at)}:R>`);
  const saved = total > MAX_LINES ? t(lang, 'utility.history.savedMore', { count: total, shown: MAX_LINES }) : tn(lang, 'utility.history.saved', total, { count: total });
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}\n${saved}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n').slice(0, 3500)));
  return interaction.editReply({ components: [container], flags: V2, allowedMentions: { parse: [] } });
}

async function showAvatars(interaction, user, lang) {
  const rows = await history.list(user.id, 'avatar');
  if (!rows.length) return interaction.editReply({ components: [textCard(t(lang, 'utility.history.empty.avatars'))], flags: V2 });
  // The kept copies first (Discord no longer serves most old avatars), the Discord link for the rest.
  const stored = await images.getMany(user.id, rows.slice(0, MAX_TILES).map((row) => row.value)).catch(() => new Map());
  const sheet = await renderAvatarSheet(user.id, rows, { stored });
  const saved = rows.length > MAX_TILES ? t(lang, 'utility.history.avatarsSavedMore', { count: rows.length, shown: MAX_TILES }) : tn(lang, 'utility.history.avatarsSaved', rows.length, { count: rows.length });
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${t(lang, 'utility.history.avatarsTitle', { name: user.username })}\n${saved}`))
    .addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL('attachment://avatars.png')));
  return interaction.editReply({ components: [container], files: [new AttachmentBuilder(sheet.buffer, { name: 'avatars.png' })], flags: V2, allowedMentions: { parse: [] } });
}
