// The settings of the partner module for admins: where partners are posted, who the Partner Managers are, the
// requirements, the blacklist and the replies. The numbers are in `/partner`.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const partnersDb = require('../../db/partners');
const { getTemplate } = require('../../db/embedTemplates');
const { getGuildPremium, getGuildLimits } = require('../../db/premium');
const { RESPONSE_KEYS, LABELS, MAX_TEXT, textOf } = require('../../utils/partnerMessages');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const textChannels = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const keyChoices = RESPONSE_KEYS.map((key) => ({ name: LABELS[key], value: key }));
const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);
const note = (text) => textCard(text, 0x4b4f59);

module.exports = {
  aliases: ['pconfig'],
  data: new SlashCommandBuilder()
    .setName('partnerconfig')
    .setDescription('Set up partnerships: channels, managers, requirements and replies.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('view').setDescription('See the current settings.'))
    .addSubcommand((s) => s.setName('enable').setDescription('Turn the partner module on or off.')
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .addSubcommand((s) => s.setName('addchannel').setDescription('Count the invites posted in a channel.')
      .addChannelOption((o) => o.setName('channel').setDescription('A partner channel').addChannelTypes(...textChannels).setRequired(true)))
    .addSubcommand((s) => s.setName('removechannel').setDescription('Stop counting a channel.')
      .addChannelOption((o) => o.setName('channel').setDescription('The channel').addChannelTypes(...textChannels).setRequired(true)))
    .addSubcommand((s) => s.setName('manager').setDescription('The role of the Partner Managers. Empty: anyone counts.')
      .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(false)))
    .addSubcommand((s) => s.setName('requirements').setDescription('What a partner server needs. Leave a value out to keep it.')
      .addIntegerOption((o) => o.setName('members').setDescription('Minimum members (0 for none)').setMinValue(0).setMaxValue(10_000_000).setRequired(false))
      .addIntegerOption((o) => o.setName('age_days').setDescription('Minimum age of the server in days (0 for none)').setMinValue(0).setMaxValue(3650).setRequired(false))
      .addIntegerOption((o) => o.setName('cooldown_days').setDescription('Days before the same server can partner again (0 for none)').setMinValue(0).setMaxValue(365).setRequired(false))
      .addBooleanOption((o) => o.setName('keep_original').setDescription('Keep the message when a partnership is refused').setRequired(false))
      .addStringOption((o) => o.setName('reaction').setDescription('An emoji to react with when it counts, or "none"').setRequired(false)))
    .addSubcommand((s) => s.setName('blacklist').setDescription('Servers that can never be a partner.')
      .addStringOption((o) => o.setName('action').setDescription('add, remove or list').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' }))
      .addStringOption((o) => o.setName('server').setDescription('ID of the server (for add and remove)').setRequired(false))
      .addStringOption((o) => o.setName('note').setDescription('Why').setRequired(false)))
    .addSubcommand((s) => s.setName('response').setDescription('Change one of the replies, with text or one of your saved embeds.')
      .addStringOption((o) => o.setName('reply').setDescription('Which reply').setRequired(true).addChoices(...keyChoices))
      .addStringOption((o) => o.setName('text').setDescription('The text, with variables like {partner.name}. "reset" goes back to the default').setRequired(false).setMaxLength(MAX_TEXT))
      .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed to send instead').setRequired(false)))
    .addSubcommand((s) => s.setName('welcome').setDescription('Welcome a new Partner Manager: gives the role and sends the welcome.')
      .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    const done = (component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
    const config = (await partnersDb.getConfig(interaction.guild.id)) ?? { ...partnersDb.DEFAULTS };
    const save = (changes) => partnersDb.upsertConfig(interaction.guild.id, changes);

    if (sub === 'view') return done(note(viewText(config)));
    if (sub === 'enable') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await save({ enabled });
      return done(ok(enabled ? (config.channel_ids.length ? 'Partners are on.' : 'Partners are on. Add a channel with `/partnerconfig addchannel`.') : 'Partners are off.'));
    }
    if (sub === 'addchannel') {
      const channel = interaction.options.getChannel('channel', true);
      if (config.channel_ids.includes(channel.id)) return done(note(`${channel} is already a partner channel.`));
      const premium = await getGuildPremium(interaction.guild.id).catch(() => ({ active: false }));
      const limit = getGuildLimits(premium).partnerChannels;
      if (config.channel_ids.length >= limit) return done(note(`This server already has ${limit} partner channels.${premium?.active ? '' : ' Premium raises it to 25.'}`));
      await save({ channel_ids: [...config.channel_ids, channel.id] });
      return done(ok(`${channel} is now a partner channel.`));
    }
    if (sub === 'removechannel') {
      const channel = interaction.options.getChannel('channel', true);
      if (!config.channel_ids.includes(channel.id)) return done(note(`${channel} is not a partner channel.`));
      await save({ channel_ids: config.channel_ids.filter((id) => id !== channel.id) });
      return done(ok(`${channel} is not a partner channel anymore.`));
    }
    if (sub === 'manager') {
      const role = interaction.options.getRole('role');
      await save({ manager_role_id: role?.id ?? null });
      return done(ok(role ? `Partner Managers are the members with ${role}.` : 'Anyone who posts an invite in a partner channel counts.'));
    }
    if (sub === 'requirements') return requirements(interaction, config, save, done);
    if (sub === 'blacklist') return blacklist(interaction, done);
    if (sub === 'response') return response(interaction, config, save, done);
    return welcome(interaction, config, done);
  },
};

function viewText(config) {
  const channels = config.channel_ids.length ? config.channel_ids.map((id) => `<#${id}>`).join(' ') : 'none';
  const changed = RESPONSE_KEYS.filter((key) => config.messages?.[key]?.text || config.messages?.[key]?.template).map((key) => LABELS[key]);
  return [
    '### Partners',
    `State: **${config.enabled ? 'on' : 'off'}**`,
    `Channels: ${channels}`,
    `Partner Managers: ${config.manager_role_id ? `<@&${config.manager_role_id}>` : 'anyone'}`,
    `Needs: ${config.min_members ? `${config.min_members.toLocaleString('en-US')}+ members` : 'any size'} · ${config.min_age_days ? `${config.min_age_days}+ days old` : 'any age'} · cooldown ${config.cooldown_days ? `${config.cooldown_days} days` : 'none'}`,
    `Refused messages are ${config.keep_original ? 'kept' : 'deleted'} · reaction ${config.react_emoji ?? 'none'}`,
    `Changed replies: ${changed.length ? changed.join(', ') : 'none'}`,
  ].join('\n');
}

async function requirements(interaction, config, save, done) {
  const changes = {};
  const members = interaction.options.getInteger('members');
  const age = interaction.options.getInteger('age_days');
  const cooldown = interaction.options.getInteger('cooldown_days');
  const keep = interaction.options.getBoolean('keep_original');
  const reaction = interaction.options.getString('reaction');
  if (members !== null) changes.min_members = members;
  if (age !== null) changes.min_age_days = age;
  if (cooldown !== null) changes.cooldown_days = cooldown;
  if (keep !== null) changes.keep_original = keep;
  if (reaction !== null) {
    const value = reaction.trim();
    if (value.toLowerCase() === 'none') changes.react_emoji = null;
    else if (value.length > 64 || /\s/.test(value)) return done(note('That does not look like an emoji.'));
    else changes.react_emoji = value;
  }
  if (!Object.keys(changes).length) return done(note(viewText(config)));
  const next = await save(changes);
  return done(ok('Requirements saved.\n' + viewText(next).split('\n').slice(4, 6).join('\n')));
}

async function blacklist(interaction, done) {
  const action = interaction.options.getString('action', true).toLowerCase();
  if (!['add', 'remove', 'list'].includes(action)) return done(note('Choose `add`, `remove` or `list`.'));
  if (action === 'list') {
    const rows = await partnersDb.listBlacklist(interaction.guild.id);
    return done(note(rows.length ? ['### Partner blacklist', ...rows.slice(0, 40).map((row) => `\`${row.partner_guild_id}\`${row.note ? ` · ${row.note}` : ''}`)].join('\n') : 'The blacklist is empty.'));
  }
  const server = (interaction.options.getString('server') ?? '').trim();
  if (!/^\d{15,25}$/.test(server)) return done(note('Give the ID of the server, a number of 17 to 20 digits.'));
  if (action === 'add') {
    await partnersDb.addBlacklist(interaction.guild.id, server, (interaction.options.getString('note') ?? '').slice(0, 200));
    return done(ok(`\`${server}\` can not be a partner now.`));
  }
  const removed = await partnersDb.removeBlacklist(interaction.guild.id, server);
  return done(removed ? ok(`\`${server}\` is not blacklisted anymore.`) : note('That server was not blacklisted.'));
}

async function response(interaction, config, save, done) {
  const key = interaction.options.getString('reply', true).toLowerCase().replace(/[\s-]/g, '_');
  if (!RESPONSE_KEYS.includes(key)) return done(note(`Choose one of: ${RESPONSE_KEYS.map((name) => `\`${name}\``).join(', ')}.`));
  const text = interaction.options.getString('text');
  const template = (interaction.options.getString('template') ?? '').trim();
  const messages = { ...(config.messages ?? {}) };
  if (text === null && !template) return done(note(`**${LABELS[key]}**\n${textOf(config, key)}${messages[key]?.template ? `\nSaved embed: \`${messages[key].template}\`` : ''}`));
  if (text?.trim().toLowerCase() === 'reset' && !template) {
    delete messages[key];
    await save({ messages });
    return done(ok(`${LABELS[key]} goes back to the default.`));
  }
  const next = {};
  if (template) {
    const doc = await getTemplate(interaction.guild.id, template).catch(() => null);
    if (!doc?.data) return done(note(`There is no saved embed called \`${template}\`.`));
    next.template = template;
  }
  if (text !== null && text.trim().toLowerCase() !== 'reset') next.text = text.trim().slice(0, MAX_TEXT);
  messages[key] = next;
  await save({ messages });
  return done(ok(`${LABELS[key]} saved.`));
}

async function welcome(interaction, config, done) {
  const user = interaction.options.getUser('user', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return done(note('That person is not in this server.'));
  const role = config.manager_role_id ? interaction.guild.roles.cache.get(config.manager_role_id) : null;
  if (role) {
    if (role.position >= interaction.guild.members.me.roles.highest.position) return done(note('That role is above mine, so I can not give it.'));
    await member.roles.add(role, 'Partner Manager').catch(() => null);
  }
  const { responsePayload } = require('../../utils/partnerMessages');
  const payload = await responsePayload(interaction.guild.id, config, 'manager_welcome', { guild: interaction.guild, member, user, channel: interaction.channel, partner: {} });
  await interaction.channel.send(payload).catch(() => null);
  return done(ok(`${user} is a Partner Manager now.${role ? '' : ' (There is no manager role set, so nothing was given.)'}`));
}
