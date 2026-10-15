const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const birthdaysDb = require('../../db/birthdays');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { parseBirthday, localDate, daysUntil, formatDay, parseOffset, formatOffset, nextAge } = require('../../utils/birthdays');
const { t, tn, languageOf } = require('../../i18n');

const DEFAULT_OFFSET = -300;
// The message of a server that did not write one: stored in English, shown and sent in the language of the server.
const DEFAULT_MESSAGE = t('en', 'birthdays.default.message');

const FLAGS = MessageFlags.IsComponentsV2;
const reply = (interaction, text, color = 0x4b4f59, ephemeral = false) => interaction.reply({ components: [textCard(text, color)], flags: ephemeral ? FLAGS | MessageFlags.Ephemeral : FLAGS, allowedMentions: { parse: [] } });

module.exports = {
  aliases: ['bday', 'bd'],
  data: new SlashCommandBuilder()
    .setName('birthday')
    .setDescription('Save your birthday so Petto can celebrate it, and see the ones coming.')
    .setDMPermission(false)
    .addSubcommand((s) => s
      .setName('set')
      .setDescription('Save your birthday, e.g. birthday set 25 12.')
      .addIntegerOption((o) => o.setName('day').setDescription('Day of the month (1-31)').setMinValue(1).setMaxValue(31).setRequired(true))
      .addIntegerOption((o) => o.setName('month').setDescription('Month (1-12)').setMinValue(1).setMaxValue(12).setRequired(true))
      .addIntegerOption((o) => o.setName('year').setDescription('Year you were born (optional, shows your age)').setMinValue(1900).setMaxValue(2100).setRequired(false)))
    .addSubcommand((s) => s.setName('remove').setDescription('Forget your birthday.'))
    .addSubcommand((s) => s
      .setName('view')
      .setDescription('See the birthday of a member.')
      .addUserOption((o) => o.setName('user').setDescription('The member (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('upcoming').setDescription('The next birthdays of this server.'))
    .addSubcommand((s) => s
      .setName('config')
      .setDescription('Set up the birthday messages of this server (Manage Server).')
      .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the birthday messages on or off').setRequired(false))
      .addChannelOption((o) => o.setName('channel').setDescription('Where the messages go').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))
      .addRoleOption((o) => o.setName('role').setDescription('A role to give for the day of the birthday').setRequired(false))
      .addStringOption((o) => o.setName('message').setDescription('The message: {user}, {user.mention}, {server}, {age}; "none" for the default').setMaxLength(1500).setRequired(false))
      .addStringOption((o) => o.setName('embed').setDescription('A saved embed to send instead of the message; "none" to stop using it').setMaxLength(60).setRequired(false))
      .addIntegerOption((o) => o.setName('hour').setDescription('Hour of the day to send it (0-23)').setMinValue(0).setMaxValue(23).setRequired(false))
      .addStringOption((o) => o.setName('timezone').setDescription('Time zone of the server as an offset, e.g. UTC-5 or +5:30').setMaxLength(12).setRequired(false))
      .addBooleanOption((o) => o.setName('clear_role').setDescription('Stop giving a role').setRequired(false))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    if (sub === 'set') return setCmd(interaction, lang);
    if (sub === 'remove') return removeCmd(interaction, lang);
    if (sub === 'view') return viewCmd(interaction, lang);
    if (sub === 'upcoming') return upcomingCmd(interaction, lang);
    return configCmd(interaction, lang);
  },
};

async function setCmd(interaction, lang) {
  const parsed = parseBirthday({ day: interaction.options.getInteger('day', true), month: interaction.options.getInteger('month', true), year: interaction.options.getInteger('year') }, new Date(), lang);
  if (parsed.error) return reply(interaction, parsed.error, COLORS.RED, true);
  await birthdaysDb.setBirthday(interaction.guild.id, interaction.user.id, parsed);
  return reply(interaction, t(lang, parsed.year ? 'birthdays.saved.withYear' : 'birthdays.saved.plain', { emoji: EMOJI.APPROVE, date: formatDay(parsed, lang), year: parsed.year }), COLORS.GREEN);
}

async function removeCmd(interaction, lang) {
  const removed = await birthdaysDb.removeBirthday(interaction.guild.id, interaction.user.id);
  return reply(interaction, removed ? t(lang, 'birthdays.removed', { emoji: EMOJI.APPROVE }) : t(lang, 'birthdays.notSaved'), removed ? COLORS.GREEN : COLORS.RED, true);
}

async function offsetOf(guildId) {
  const config = await birthdaysDb.getConfig(guildId).catch(() => null);
  return config?.utc_offset_minutes ?? DEFAULT_OFFSET;
}

async function viewCmd(interaction, lang) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const row = await birthdaysDb.getBirthday(interaction.guild.id, user.id);
  if (!row) return reply(interaction, user.id === interaction.user.id ? t(lang, 'birthdays.view.noneSelf') : t(lang, 'birthdays.view.noneOther', { user: `${user}` }), 0x4b4f59, true);
  const local = localDate(new Date(), await offsetOf(interaction.guild.id));
  const days = daysUntil(row, local);
  const age = nextAge(row, local);
  const first = t(lang, row.year ? 'birthdays.view.dateWithYear' : 'birthdays.view.date', { user: `${user}`, date: formatDay(row, lang), year: row.year });
  const withAge = age !== null ? 'Age' : '';
  const next = days === 0 ? t(lang, `birthdays.view.today${withAge}`, { age }) : tn(lang, `birthdays.view.inDays${withAge}`, days, { count: days, age });
  return reply(interaction, `${first}\n${next}`);
}

async function upcomingCmd(interaction, lang) {
  const rows = await birthdaysDb.listBirthdays(interaction.guild.id);
  if (!rows.length) return reply(interaction, t(lang, 'birthdays.upcoming.empty'), 0x4b4f59, true);
  const local = localDate(new Date(), await offsetOf(interaction.guild.id));
  const next = rows
    .map((row) => ({ row, days: daysUntil(row, local) }))
    .sort((a, b) => a.days - b.days)
    .slice(0, birthdaysDb.MAX_UPCOMING);
  const when = (days) => (days === 0 ? t(lang, 'birthdays.upcoming.today') : days === 1 ? t(lang, 'birthdays.upcoming.tomorrow') : tn(lang, 'birthdays.upcoming.inDays', days, { count: days }));
  const lines = next.map(({ row, days }) => `${days === 0 ? '🎂' : '•'} <@${row.user_id}> · **${formatDay(row, lang)}** · ${when(days)}`);
  return reply(interaction, t(lang, 'birthdays.upcoming.title', { list: lines.join('\n') }));
}

async function configCmd(interaction, lang) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return reply(interaction, t(lang, 'birthdays.config.needManageServer'), COLORS.RED, true);
  const patch = {};
  const enabled = interaction.options.getBoolean('enabled');
  const channel = interaction.options.getChannel('channel');
  const role = interaction.options.getRole('role');
  const message = interaction.options.getString('message');
  const embed = interaction.options.getString('embed');
  const hour = interaction.options.getInteger('hour');
  const timezone = interaction.options.getString('timezone');
  if (enabled !== null) patch.enabled = enabled;
  if (channel) patch.channel_id = channel.id;
  if (role) {
    if (role.managed || role.id === interaction.guild.id) return reply(interaction, t(lang, 'birthdays.config.roleNotGivable'), COLORS.RED, true);
    patch.role_id = role.id;
  }
  if (interaction.options.getBoolean('clear_role')) patch.role_id = null;
  if (message !== null) patch.message = message.toLowerCase() === 'none' ? DEFAULT_MESSAGE : message;
  if (embed !== null) {
    if (embed.toLowerCase() === 'none') patch.embed_template = null;
    else if (!(await getTemplate(interaction.guild.id, embed))) return reply(interaction, t(lang, 'birthdays.config.noEmbed', { name: embed }), COLORS.RED, true);
    else patch.embed_template = embed;
  }
  if (hour !== null) patch.hour = hour;
  if (timezone !== null) {
    const offset = parseOffset(timezone);
    if (offset === null) return reply(interaction, t(lang, 'birthdays.config.badTimezone'), COLORS.RED, true);
    patch.utc_offset_minutes = offset;
  }
  const config = Object.keys(patch).length ? await birthdaysDb.upsertConfig(interaction.guild.id, patch) : await birthdaysDb.getConfig(interaction.guild.id);
  const shown = config ?? { enabled: false, hour: 9, utc_offset_minutes: DEFAULT_OFFSET, message: DEFAULT_MESSAGE };
  const shownMessage = String(shown.message).trim() === DEFAULT_MESSAGE ? t(lang, 'birthdays.default.message') : String(shown.message);
  const lines = [
    t(lang, shown.enabled ? 'birthdays.config.on' : 'birthdays.config.off', { emoji: shown.enabled ? EMOJI.APPROVE : EMOJI.DENY }),
    t(lang, 'birthdays.config.channel', { channel: shown.channel_id ? `<#${shown.channel_id}>` : t(lang, 'birthdays.config.notSet') }),
    t(lang, 'birthdays.config.role', { role: shown.role_id ? `<@&${shown.role_id}>` : t(lang, 'birthdays.config.none') }),
    t(lang, 'birthdays.config.hour', { hour: String(shown.hour).padStart(2, '0'), offset: formatOffset(shown.utc_offset_minutes) }),
    shown.embed_template ? t(lang, 'birthdays.config.embed', { name: shown.embed_template }) : t(lang, 'birthdays.config.message', { message: shownMessage.slice(0, 300) }),
  ];
  if (shown.enabled && !shown.channel_id && !shown.role_id) lines.push(t(lang, 'birthdays.config.nothingToDo'));
  return reply(interaction, lines.join('\n'), shown.enabled ? COLORS.GREEN : 0x4b4f59);
}
