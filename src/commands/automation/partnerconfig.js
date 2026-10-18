// The settings of the partner module for admins: where partners are posted, who the Partner Managers are, the
// requirements, the blacklist and the replies. The numbers are in `!partner`.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const partnersDb = require('../../db/partners');
const { getTemplate } = require('../../db/embedTemplates');
const { getGuildPremium, getGuildLimits, PREMIUM_LIMITS } = require('../../db/premium');
const { RESPONSE_KEYS, LABELS, MAX_TEXT, labelOf, textOf } = require('../../utils/partnerMessages');
const { parseSpan, formatSpan, cooldownMinutes } = require('../../utils/partnerEngine');
const { sendManagerWelcome } = require('../../utils/partnerWelcome');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, formatNumber, languageOf } = require('../../i18n');

const textChannels = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const keyChoices = RESPONSE_KEYS.map((key) => ({ name: LABELS[key], value: key }));
const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);
const note = (text) => textCard(text, 0x4b4f59);

module.exports = {
  prefixOnly: true,
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
      .addStringOption((o) => o.setName('cooldown').setDescription('Time before the same server can partner again, like 3d 4h, or "none"').setRequired(false))
      .addBooleanOption((o) => o.setName('keep_original').setDescription('Keep the message when a partnership is refused').setRequired(false))
      .addStringOption((o) => o.setName('reaction').setDescription('An emoji to react with when it counts, or "none"').setRequired(false))
      .addBooleanOption((o) => o.setName('block_nsfw').setDescription('Refuse servers that Discord marks as NSFW').setRequired(false))
      .addStringOption((o) => o.setName('keywords').setDescription('Blocked words in a server name or description, with commas (up to 10), or "none"').setRequired(false)))
    .addSubcommand((s) => s.setName('blacklist').setDescription('Servers that can never be a partner.')
      .addStringOption((o) => o.setName('action').setDescription('add, remove or list').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' }))
      .addStringOption((o) => o.setName('server').setDescription('ID of the server (for add and remove)').setRequired(false))
      .addStringOption((o) => o.setName('note').setDescription('Why').setRequired(false)))
    .addSubcommand((s) => s.setName('response').setDescription('Change one of the replies, with text or one of your saved embeds.')
      .addStringOption((o) => o.setName('reply').setDescription('Which reply').setRequired(true).addChoices(...keyChoices))
      .addStringOption((o) => o.setName('text').setDescription('The text, with variables like {partner.name}. "reset" goes back to the default').setRequired(false).setMaxLength(MAX_TEXT))
      .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed to send instead').setRequired(false)))
    .addSubcommand((s) => s.setName('welcomechannel').setDescription('Where a new Partner Manager is welcomed. Empty: where the welcome command is used.')
      .addChannelOption((o) => o.setName('channel').setDescription('The channel').addChannelTypes(...textChannels).setRequired(false)))
    .addSubcommand((s) => s.setName('welcome').setDescription('Welcome a new Partner Manager: gives the role and sends the welcome.')
      .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const lang = await languageOf(interaction);
    await ensureGuild(interaction.guild.id);
    const sub = interaction.options.getSubcommand();
    const done = (component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
    const config = (await partnersDb.getConfig(interaction.guild.id)) ?? { ...partnersDb.DEFAULTS };
    const save = (changes) => partnersDb.upsertConfig(interaction.guild.id, changes);

    if (sub === 'view') return done(note(viewText(config, lang)));
    if (sub === 'enable') {
      const enabled = interaction.options.getBoolean('enabled', true);
      await save({ enabled });
      return done(ok(t(lang, enabled ? (config.channel_ids.length ? 'partners.enable.on' : 'partners.enable.onNoChannel') : 'partners.enable.off')));
    }
    if (sub === 'addchannel') {
      const channel = interaction.options.getChannel('channel', true);
      if (config.channel_ids.includes(channel.id)) return done(note(t(lang, 'partners.channel.already', { channel: `${channel}` })));
      const premium = await getGuildPremium(interaction.guild.id).catch(() => ({ active: false }));
      const limit = getGuildLimits(premium).partnerChannels;
      if (config.channel_ids.length >= limit) return done(note(t(lang, premium?.active ? 'partners.channel.limit' : 'partners.channel.limitPremium', { limit, premium: PREMIUM_LIMITS.partnerChannels })));
      await save({ channel_ids: [...config.channel_ids, channel.id] });
      return done(ok(t(lang, 'partners.channel.added', { channel: `${channel}` })));
    }
    if (sub === 'removechannel') {
      const channel = interaction.options.getChannel('channel', true);
      if (!config.channel_ids.includes(channel.id)) return done(note(t(lang, 'partners.channel.notOne', { channel: `${channel}` })));
      await save({ channel_ids: config.channel_ids.filter((id) => id !== channel.id) });
      return done(ok(t(lang, 'partners.channel.removed', { channel: `${channel}` })));
    }
    if (sub === 'manager') {
      const role = interaction.options.getRole('role');
      await save({ manager_role_id: role?.id ?? null });
      return done(ok(role ? t(lang, 'partners.manager.role', { role: `${role}` }) : t(lang, 'partners.manager.anyone')));
    }
    if (sub === 'welcomechannel') {
      const channel = interaction.options.getChannel('channel');
      await save({ welcome_channel_id: channel?.id ?? null });
      return done(ok(channel ? t(lang, 'partners.welcomeChannel.set', { channel: `${channel}` }) : t(lang, 'partners.welcomeChannel.here')));
    }
    if (sub === 'requirements') return requirements(interaction, config, save, done, lang);
    if (sub === 'blacklist') return blacklist(interaction, done, lang);
    if (sub === 'response') return response(interaction, config, save, done, lang);
    return welcome(interaction, config, done, lang);
  },
};

function viewText(config, lang) {
  const none = t(lang, 'partners.view.none');
  const channels = config.channel_ids.length ? config.channel_ids.map((id) => `<#${id}>`).join(' ') : none;
  const changed = RESPONSE_KEYS.filter((key) => config.messages?.[key]?.text || config.messages?.[key]?.template).map((key) => labelOf(key, lang));
  return [
    t(lang, 'partners.view.title'),
    t(lang, 'partners.view.state', { state: t(lang, config.enabled ? 'partners.view.on' : 'partners.view.off') }),
    t(lang, 'partners.view.channels', { channels }),
    t(lang, 'partners.view.managers', { managers: config.manager_role_id ? `<@&${config.manager_role_id}>` : t(lang, 'partners.view.anyone') }),
    t(lang, 'partners.view.needs', {
      members: config.min_members ? t(lang, 'partners.view.minMembers', { count: formatNumber(lang, config.min_members) }) : t(lang, 'partners.view.anySize'),
      age: config.min_age_days ? t(lang, 'partners.view.minAge', { count: config.min_age_days }) : t(lang, 'partners.view.anyAge'),
      cooldown: formatSpan(cooldownMinutes(config), lang),
    }),
    t(lang, 'partners.view.refuses', {
      nsfw: t(lang, config.block_nsfw ? 'partners.view.nsfwOn' : 'partners.view.nsfwOff'),
      words: config.blocked_keywords?.length ? t(lang, 'partners.view.words', { list: config.blocked_keywords.join(', ') }) : t(lang, 'partners.view.noWords'),
    }),
    t(lang, 'partners.view.welcomeChannel', { channel: config.welcome_channel_id ? `<#${config.welcome_channel_id}>` : t(lang, 'partners.view.welcomeHere') }),
    t(lang, config.keep_original ? 'partners.view.refusedKept' : 'partners.view.refusedDeleted', { reaction: config.react_emoji ?? none }),
    t(lang, 'partners.view.changed', { list: changed.length ? changed.join(', ') : none }),
  ].join('\n');
}

async function requirements(interaction, config, save, done, lang) {
  const changes = {};
  const members = interaction.options.getInteger('members');
  const age = interaction.options.getInteger('age_days');
  const cooldown = interaction.options.getString('cooldown');
  const keep = interaction.options.getBoolean('keep_original');
  const reaction = interaction.options.getString('reaction');
  const nsfw = interaction.options.getBoolean('block_nsfw');
  const keywords = interaction.options.getString('keywords');
  if (members !== null) changes.min_members = members;
  if (age !== null) changes.min_age_days = age;
  if (cooldown !== null) {
    const minutes = parseSpan(cooldown);
    if (minutes === null) return done(note(t(lang, 'partners.requirements.cooldown')));
    // The new setting replaces the old one in days.
    changes.cooldown_minutes = minutes;
    changes.cooldown_days = 0;
  }
  if (keep !== null) changes.keep_original = keep;
  if (nsfw !== null) changes.block_nsfw = nsfw;
  if (keywords !== null) {
    const words = keywords.trim().toLowerCase() === 'none' ? [] : [...new Set(keywords.split(',').map((word) => word.trim().toLowerCase()).filter(Boolean))];
    if (words.length > 10 || words.some((word) => word.length > 40)) return done(note(t(lang, 'partners.requirements.words')));
    changes.blocked_keywords = words;
  }
  if (reaction !== null) {
    const value = reaction.trim();
    if (value.toLowerCase() === 'none') changes.react_emoji = null;
    else if (value.length > 64 || /\s/.test(value)) return done(note(t(lang, 'partners.requirements.emoji')));
    else changes.react_emoji = value;
  }
  if (!Object.keys(changes).length) return done(note(viewText(config, lang)));
  const next = await save(changes);
  return done(ok(t(lang, 'partners.requirements.saved', { lines: viewText(next, lang).split('\n').slice(4, 7).join('\n') })));
}

async function blacklist(interaction, done, lang) {
  const action = interaction.options.getString('action', true).toLowerCase();
  if (!['add', 'remove', 'list'].includes(action)) return done(note(t(lang, 'partners.blacklist.choose')));
  if (action === 'list') {
    const rows = await partnersDb.listBlacklist(interaction.guild.id);
    return done(note(rows.length ? [t(lang, 'partners.blacklist.title'), ...rows.slice(0, 40).map((row) => `\`${row.partner_guild_id}\`${row.note ? ` · ${row.note}` : ''}`)].join('\n') : t(lang, 'partners.blacklist.empty')));
  }
  const server = (interaction.options.getString('server') ?? '').trim();
  if (!/^\d{15,25}$/.test(server)) return done(note(t(lang, 'partners.blacklist.badId')));
  if (action === 'add') {
    await partnersDb.addBlacklist(interaction.guild.id, server, (interaction.options.getString('note') ?? '').slice(0, 200));
    return done(ok(t(lang, 'partners.blacklist.added', { server })));
  }
  const removed = await partnersDb.removeBlacklist(interaction.guild.id, server);
  return done(removed ? ok(t(lang, 'partners.blacklist.removed', { server })) : note(t(lang, 'partners.blacklist.notListed')));
}

async function response(interaction, config, save, done, lang) {
  const key = interaction.options.getString('reply', true).toLowerCase().replace(/[\s-]/g, '_');
  if (!RESPONSE_KEYS.includes(key)) return done(note(t(lang, 'partners.response.choose', { list: RESPONSE_KEYS.map((name) => `\`${name}\``).join(', ') })));
  const text = interaction.options.getString('text');
  const template = (interaction.options.getString('template') ?? '').trim();
  const messages = { ...(config.messages ?? {}) };
  const label = labelOf(key, lang);
  if (text === null && !template) {
    const current = textOf(config, key, lang);
    return done(note(messages[key]?.template ? t(lang, 'partners.response.showEmbed', { label, text: current, name: messages[key].template }) : t(lang, 'partners.response.show', { label, text: current })));
  }
  if (text?.trim().toLowerCase() === 'reset' && !template) {
    delete messages[key];
    await save({ messages });
    return done(ok(t(lang, 'partners.response.reset', { label })));
  }
  const next = {};
  if (template) {
    const doc = await getTemplate(interaction.guild.id, template).catch(() => null);
    if (!doc?.data) return done(note(t(lang, 'partners.response.noEmbed', { name: template })));
    next.template = template;
  }
  if (text !== null && text.trim().toLowerCase() !== 'reset') next.text = text.trim().slice(0, MAX_TEXT);
  messages[key] = next;
  await save({ messages });
  return done(ok(t(lang, 'partners.response.saved', { label })));
}

async function welcome(interaction, config, done, lang) {
  const user = interaction.options.getUser('user', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) return done(note(t(lang, 'partners.welcome.notMember')));
  const role = config.manager_role_id ? interaction.guild.roles.cache.get(config.manager_role_id) : null;
  if (role) {
    if (role.position >= interaction.guild.members.me.roles.highest.position) return done(note(t(lang, 'partners.welcome.roleAbove')));
    await member.roles.add(role, 'Partner Manager').catch(() => null); // i18n-ignore: the name of the role in the audit log, the same in every language
  }
  const sent = await sendManagerWelcome({ guild: interaction.guild, member, config, fallbackChannel: interaction.channel, lang });
  const key = `partners.welcome.done${role ? '' : 'NoRole'}${sent ? '' : 'NotSent'}`;
  return done(ok(t(lang, key, { user: `${user}` })));
}
