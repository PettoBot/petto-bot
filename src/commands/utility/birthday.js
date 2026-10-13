const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits, ChannelType } = require('discord.js');
const birthdaysDb = require('../../db/birthdays');
const { getTemplate } = require('../../db/embedTemplates');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { parseBirthday, localDate, daysUntil, formatDay, parseOffset, formatOffset, nextAge } = require('../../utils/birthdays');

const DEFAULT_OFFSET = -300;

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
    if (sub === 'set') return setCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    if (sub === 'view') return viewCmd(interaction);
    if (sub === 'upcoming') return upcomingCmd(interaction);
    return configCmd(interaction);
  },
};

async function setCmd(interaction) {
  const parsed = parseBirthday({ day: interaction.options.getInteger('day', true), month: interaction.options.getInteger('month', true), year: interaction.options.getInteger('year') });
  if (parsed.error) return reply(interaction, parsed.error, COLORS.RED, true);
  await birthdaysDb.setBirthday(interaction.guild.id, interaction.user.id, parsed);
  return reply(interaction, `${EMOJI.APPROVE}  Your birthday is saved: **${formatDay(parsed)}**${parsed.year ? ` ${parsed.year}` : ''}. Petto will celebrate it here.`, COLORS.GREEN);
}

async function removeCmd(interaction) {
  const removed = await birthdaysDb.removeBirthday(interaction.guild.id, interaction.user.id);
  return reply(interaction, removed ? `${EMOJI.APPROVE}  Your birthday was forgotten.` : 'You had not saved a birthday here.', removed ? COLORS.GREEN : COLORS.RED, true);
}

async function offsetOf(guildId) {
  const config = await birthdaysDb.getConfig(guildId).catch(() => null);
  return config?.utc_offset_minutes ?? DEFAULT_OFFSET;
}

async function viewCmd(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const row = await birthdaysDb.getBirthday(interaction.guild.id, user.id);
  if (!row) return reply(interaction, user.id === interaction.user.id ? 'You have not saved your birthday. Use `birthday set <day> <month>`.' : `${user} has not saved a birthday here.`, 0x4b4f59, true);
  const local = localDate(new Date(), await offsetOf(interaction.guild.id));
  const days = daysUntil(row, local);
  const age = nextAge(row, local);
  const when = days === 0 ? 'today!' : `in **${days}** day${days === 1 ? '' : 's'}`;
  return reply(interaction, `🎂  ${user}: **${formatDay(row)}**${row.year ? ` ${row.year}` : ''}\nNext birthday ${when}${age !== null ? ` (turns ${age})` : ''}`);
}

async function upcomingCmd(interaction) {
  const rows = await birthdaysDb.listBirthdays(interaction.guild.id);
  if (!rows.length) return reply(interaction, 'Nobody has saved a birthday here yet. Use `birthday set <day> <month>`.', 0x4b4f59, true);
  const local = localDate(new Date(), await offsetOf(interaction.guild.id));
  const next = rows
    .map((row) => ({ row, days: daysUntil(row, local) }))
    .sort((a, b) => a.days - b.days)
    .slice(0, birthdaysDb.MAX_UPCOMING);
  const lines = next.map(({ row, days }) => `${days === 0 ? '🎂' : '•'} <@${row.user_id}> · **${formatDay(row)}** · ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}`);
  return reply(interaction, `### Upcoming birthdays\n${lines.join('\n')}`);
}

async function configCmd(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return reply(interaction, 'You need the **Manage Server** permission to change the birthday messages.', COLORS.RED, true);
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
    if (role.managed || role.id === interaction.guild.id) return reply(interaction, 'That role cannot be given by Petto.', COLORS.RED, true);
    patch.role_id = role.id;
  }
  if (interaction.options.getBoolean('clear_role')) patch.role_id = null;
  if (message !== null) patch.message = message.toLowerCase() === 'none' ? '{EMOJI} Happy birthday {user}! Have a great day!' : message;
  if (embed !== null) {
    if (embed.toLowerCase() === 'none') patch.embed_template = null;
    else if (!(await getTemplate(interaction.guild.id, embed))) return reply(interaction, `There is no saved embed named **${embed}**.`, COLORS.RED, true);
    else patch.embed_template = embed;
  }
  if (hour !== null) patch.hour = hour;
  if (timezone !== null) {
    const offset = parseOffset(timezone);
    if (offset === null) return reply(interaction, 'Write the time zone as an offset, like `UTC-5`, `-5` or `+5:30`.', COLORS.RED, true);
    patch.utc_offset_minutes = offset;
  }
  const config = Object.keys(patch).length ? await birthdaysDb.upsertConfig(interaction.guild.id, patch) : await birthdaysDb.getConfig(interaction.guild.id);
  const shown = config ?? { enabled: false, hour: 9, utc_offset_minutes: DEFAULT_OFFSET, message: '{EMOJI} Happy birthday {user}! Have a great day!' };
  const lines = [
    `${shown.enabled ? EMOJI.APPROVE : EMOJI.DENY}  Birthday messages are **${shown.enabled ? 'on' : 'off'}**`,
    `Channel: ${shown.channel_id ? `<#${shown.channel_id}>` : 'not set'}`,
    `Role for the day: ${shown.role_id ? `<@&${shown.role_id}>` : 'none'}`,
    `Sent at **${String(shown.hour).padStart(2, '0')}:00** (${formatOffset(shown.utc_offset_minutes)})`,
    shown.embed_template ? `Embed: **${shown.embed_template}**` : `Message: ${String(shown.message).slice(0, 300)}`,
  ];
  if (shown.enabled && !shown.channel_id && !shown.role_id) lines.push('Set a channel (and/or a role) so Petto has something to do.');
  return reply(interaction, lines.join('\n'), shown.enabled ? COLORS.GREEN : 0x4b4f59);
}
