// The settings of the upload module for admins: which channels count, the uploader role and the welcome of a first upload.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const uploadsDb = require('../../db/uploads');
const { getTemplate } = require('../../db/embedTemplates');
const { getGuildPremium, getGuildLimits } = require('../../db/premium');
const { DEFAULT_WELCOME, MAX_TEXT, textOf } = require('../../utils/uploadMessages');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const textChannels = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.GuildForum];
const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);
const note = (text) => textCard(text, 0x4b4f59);

module.exports = {
  prefixOnly: true,
  aliases: ['uconfig'],
  data: new SlashCommandBuilder()
    .setName('uploadconfig')
    .setDescription('Set up uploads: channels, uploader role and welcome.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('view').setDescription('See the current settings.'))
    .addSubcommand((s) => s.setName('enable').setDescription('Turn the upload module on or off.').addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('addchannel').setDescription('Count the files posted in a channel.').addChannelOption((o) => o.setName('channel').setDescription('An upload channel').addChannelTypes(...textChannels).setRequired(true)))
    .addSubcommand((s) => s.setName('removechannel').setDescription('Stop counting a channel.').addChannelOption((o) => o.setName('channel').setDescription('The channel').setRequired(true)))
    .addSubcommand((s) => s.setName('role').setDescription('The role given at the first upload. Empty: none.').addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(false)))
    .addSubcommand((s) => s.setName('welcome').setDescription('The message sent at the first upload, with text or a saved embed. "reset" goes back to the default.')
      .addStringOption((o) => o.setName('text').setDescription('The text, with variables like {user.mention}').setMaxLength(MAX_TEXT).setRequired(false))
      .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed, or "none"').setRequired(false))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const done = (component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
    const config = (await uploadsDb.getConfig(interaction.guild.id)) ?? { ...uploadsDb.DEFAULTS };
    const save = (changes) => uploadsDb.upsertConfig(interaction.guild.id, changes);
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      return done(note(['### Uploads', `State: **${config.enabled ? 'on' : 'off'}**`, `Channels: ${config.channel_ids.length ? config.channel_ids.map((id) => `<#${id}>`).join(' ') : 'none'}`, `Uploader role: ${config.uploader_role_id ? `<@&${config.uploader_role_id}>` : 'none'}`, `Welcome: ${config.welcome?.template ? `embed \`${config.welcome.template}\`` : textOf(config.welcome)}`].join('\n')));
    }
    if (sub === 'enable') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await save({ enabled });
      return done(ok(enabled ? (config.channel_ids.length ? 'Uploads are on.' : 'Uploads are on. Add a channel with `!uploadconfig addchannel`.') : 'Uploads are off.'));
    }
    if (sub === 'addchannel') {
      const channel = interaction.options.getChannel('channel', true);
      if (config.channel_ids.includes(channel.id)) return done(note(`${channel} is already an upload channel.`));
      const premium = await getGuildPremium(interaction.guild.id).catch(() => ({ active: false }));
      const limit = getGuildLimits(premium).uploadChannels;
      if (config.channel_ids.length >= limit) return done(note(`This server already has ${limit} upload channels.${premium?.active ? '' : ' Premium raises it to 100.'}`));
      await save({ channel_ids: [...config.channel_ids, channel.id] });
      return done(ok(`${channel} is now an upload channel.`));
    }
    if (sub === 'removechannel') {
      const channel = interaction.options.getChannel('channel', true);
      if (!config.channel_ids.includes(channel.id)) return done(note(`${channel} is not an upload channel.`));
      await save({ channel_ids: config.channel_ids.filter((id) => id !== channel.id) });
      return done(ok(`${channel} is not an upload channel anymore.`));
    }
    if (sub === 'role') {
      const role = interaction.options.getRole('role');
      await save({ uploader_role_id: role?.id ?? null });
      return done(ok(role ? `${role} is given at the first upload.` : 'No role is given at the first upload.'));
    }
    // welcome
    const text = interaction.options.getString('text');
    const template = (interaction.options.getString('template') ?? '').trim();
    if (text === null && !template) return done(note(`**Welcome**\n${config.welcome?.template ? `Saved embed: \`${config.welcome.template}\`\n` : ''}${textOf(config.welcome)}\n\nDefault: ${DEFAULT_WELCOME}`));
    const welcome = { ...(config.welcome ?? {}) };
    if (text !== null) { if (text.trim().toLowerCase() === 'reset') delete welcome.text; else welcome.text = text.trim().slice(0, MAX_TEXT); }
    if (template) {
      if (template.toLowerCase() === 'none') delete welcome.template;
      else if (!(await getTemplate(interaction.guild.id, template).catch(() => null))?.data) return done(note(`There is no saved embed called \`${template}\`.`));
      else welcome.template = template;
    }
    await save({ welcome });
    return done(ok('Welcome saved.'));
  },
};
