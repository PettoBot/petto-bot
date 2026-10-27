// `!feed`: follow an account of another service and post what it publishes in a channel (YouTube videos, Shorts and streams, Twitch streams,
// Bluesky posts, new versions of a Modrinth project, a Pokémon of the day). The same feeds are in the dashboard, under Feeds.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const feedsDb = require('../../db/feeds');
const { guildLimit } = require('../../db/premium');
const service = require('../../feeds/service');
const { canUseFeeds } = require('../../feeds/access');
const { PLATFORMS } = require('../../feeds/platforms');
const emojis = require('../../feeds/emojis');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const V2 = MessageFlags.IsComponentsV2;
const COMMAND_PLATFORMS = ['youtube', 'twitch', 'kick', 'bluesky', 'reddit', 'steam', 'github', 'modrinth', 'npm', 'pypi', 'anilist', 'pinterest', 'rss', 'wikipedia', 'chess', 'pokemon', 'spotify', 'deezer', 'applemusic', 'mastodon', 'tumblr', 'letterboxd', 'epic', 'cat', 'dog', 'fox', 'animals'];
// Discord shows 25 choices at most and there are more platforms than that, so the platform is picked from a list that filters while it is typed.
const platformChoices = COMMAND_PLATFORMS.map((id) => ({ name: PLATFORMS[id].name, value: id }));
const idOption = (o) => o.setName('id').setDescription('The number of the feed (see the list)').setMinValue(1).setRequired(true);

module.exports = {
  aliases: ['feeds', 'notify', 'notifications'],
  prefixDefaultSubcommand: 'list',
  prefixSubcommandAliases: { follow: 'add', create: 'add', delete: 'remove', rm: 'remove', del: 'remove', stop: 'pause', start: 'resume', on: 'resume', off: 'pause', msg: 'message', text: 'message', mention: 'ping', ls: 'list' }, // i18n-ignore: the words people type after the command
  data: new SlashCommandBuilder()
    .setName('feed')
    .setDescription('Post in a channel what an account publishes: videos, streams, posts, new versions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('add').setDescription('Follow an account and post its news in a channel.')
      .addStringOption((o) => o.setName('platform').setDescription('Where the account is').setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName('account').setDescription('The link, @name or id of the account. Pokémon, Wikipedia, Chess: how often (15m, 2h, 1d)').setMaxLength(200).setRequired(false))
      .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('The feeds of this server and how each one is doing.'))
    .addSubcommand((s) => s.setName('remove').setDescription('Stop following an account.').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('test').setDescription('Post a test notice of a feed, to see how it looks.').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('pause').setDescription('Stop posting a feed without deleting it.').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('resume').setDescription('Start posting a paused feed again.').addIntegerOption(idOption))
    .addSubcommand((s) => s.setName('message').setDescription('The words above each notice, with {feed.title} and {feed.url}.')
      .addIntegerOption(idOption)
      .addStringOption((o) => o.setName('text').setDescription('The words, or "clear"').setMaxLength(1500).setRequired(true)))
    .addSubcommand((s) => s.setName('ping').setDescription('Mention a role (or everyone) with each notice of a feed.')
      .addIntegerOption(idOption)
      .addRoleOption((o) => o.setName('role').setDescription('The role to mention (leave empty to stop mentioning)').setRequired(false))
      .addBooleanOption((o) => o.setName('everyone').setDescription('Mention @everyone instead').setRequired(false))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'platform') return interaction.respond([]);
    const typed = String(focused.value ?? '').toLowerCase().trim();
    const list = platformChoices.filter((choice) => !typed || choice.name.toLowerCase().includes(typed) || choice.value.includes(typed));
    return interaction.respond(list.slice(0, 25));
  },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    const reply = (text, color = null) => interaction.reply({ components: [textCard(text, color)], flags: V2 });
    const ok = (key, values = {}) => reply(t(lang, key, { emoji: EMOJI.APPROVE, ...values }), 0xa5ea7a);
    const fail = (key, values = {}) => reply(t(lang, key, { emoji: EMOJI.DENY, ...values }), 0xfe6465);
    if (!canUseFeeds(interaction.user.id)) return fail('feeds.testing'); // being tested with the team
    const channelOf = (feed) => `<#${feed.channel_id}>`;

    if (sub === 'list') {
      const [rows, limit] = await Promise.all([feedsDb.listForGuild(guild.id), guildLimit(guild.id, 'feeds')]);
      if (!rows.length) return reply(t(lang, 'feeds.list.empty', { max: limit.limit, prefix: '!' }));
      const lines = rows.map((feed) => t(lang, 'feeds.list.line', {
        id: feed.id, platform: emojis.PLATFORM[feed.platform] ?? '', account: feed.account_name, channel: channelOf(feed),
        state: feed.enabled ? (feed.last_error ? t(lang, `feeds.error.${feed.last_error}`) : t(lang, 'feeds.state.on')) : (feed.last_error ? `${t(lang, 'feeds.state.off')} · ${t(lang, `feeds.error.${feed.last_error}`)}` : t(lang, 'feeds.state.off')),
      }));
      return reply([t(lang, 'feeds.list.title', { count: rows.length, max: limit.limit }), ...lines].join('\n'));
    }

    if (sub === 'add') {
      const platform = interaction.options.getString('platform');
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;
      await interaction.deferReply({ flags: V2 });
      const result = await service.createFeed(guild, { platform, account: interaction.options.getString('account') ?? '', channelId: channel?.id, createdBy: interaction.user.id });
      const send = (text, color) => interaction.editReply({ components: [textCard(text, color)], flags: V2 });
      if (!result.ok) {
        const key = `feeds.add.error.${result.error}`;
        return send(t(lang, key, { emoji: EMOJI.DENY, platform: result.platform ?? PLATFORMS[platform]?.name, count: result.count, premium: result.premium, account: result.account, prefix: '!' }), 0xfe6465);
      }
      return send(t(lang, 'feeds.add.ok', { emoji: EMOJI.APPROVE, account: result.feed.account_name, platform: PLATFORMS[platform].name, channel: channelOf(result.feed), id: result.feed.id, prefix: '!' }), 0xa5ea7a);
    }

    const id = interaction.options.getInteger('id');
    const feed = await feedsDb.get(guild.id, id);
    if (!feed) return fail('feeds.notFound', { id, prefix: '!' });

    if (sub === 'remove') {
      await feedsDb.remove(guild.id, id);
      return ok('feeds.remove.ok', { account: feed.account_name, id });
    }
    if (sub === 'test') {
      await interaction.deferReply({ flags: V2 | MessageFlags.Ephemeral });
      const result = await service.sendTest(guild, feed, lang);
      return interaction.editReply({ components: [textCard(result.ok ? t(lang, 'feeds.test.ok', { emoji: EMOJI.APPROVE, channel: channelOf(feed) }) : t(lang, `feeds.add.error.${result.error}`, { emoji: EMOJI.DENY }), result.ok ? 0xa5ea7a : 0xfe6465)], flags: V2 | MessageFlags.Ephemeral });
    }
    if (sub === 'pause' || sub === 'resume') {
      await service.updateFeed(guild, id, { enabled: sub === 'resume' });
      return ok(`feeds.${sub}.ok`, { account: feed.account_name, id });
    }
    if (sub === 'message') {
      const text = String(interaction.options.getString('text') ?? '').trim();
      const clear = /^(clear|none|-|off|borrar|limpiar|nada)$/i.test(text);
      await service.updateFeed(guild, id, { message: clear ? '' : text });
      return ok(clear ? 'feeds.message.cleared' : 'feeds.message.ok', { id });
    }
    if (sub === 'ping') {
      const role = interaction.options.getRole('role');
      const everyone = interaction.options.getBoolean('everyone') ?? false;
      await service.updateFeed(guild, id, { pingRoles: role ? [role.id] : [], pingEveryone: everyone });
      return ok(everyone ? 'feeds.ping.everyone' : role ? 'feeds.ping.role' : 'feeds.ping.none', { id, role: role ? `<@&${role.id}>` : '' });
    }
    return null;
  },
};
