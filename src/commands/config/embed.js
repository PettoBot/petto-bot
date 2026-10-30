const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const guildPrefixes = require('../../utils/guildPrefixes');
const { getTemplate, upsertTemplate, deleteTemplate, listTemplates, normalizeName } = require('../../db/embedTemplates');
const { ensureGuild } = require('../../db/guilds');
const { parseColor, build, hasSendablePayload, formatEmbedError } = require('../../utils/embedBuilder');
const { extractReactRepliesFromTemplate, applyReactReplies, uniqueReactions } = require('../../utils/messageFlags');
const { renderPanel } = require('../../interactions/embedPanel');
const { parseEmbedScript, toTemplateData } = require('../../utils/embedScript');
const { readV2Code } = require('../../utils/embedV2');
const { commandRef } = require('../../utils/commandRef');
const logger = require('../../utils/logger');
const { t, languageOf, currentLanguage } = require('../../i18n');

// The pages of `!embed vars`: each row is a variable (written as it is typed) and the key of its description, in the embeds
// catalog under `embeds.vars.<page id>.<key>`; the title of a page is `embeds.vars.page.<page id>`.
const VAR_PAGES = [
  {
    id: 'user',
    fields: [
      ['`{user}`', 'user'], // i18n-ignore: variables as they are typed
      ['`{user_tag}`', 'userTag'], // i18n-ignore: variables as they are typed
      ['`{user_name}`', 'userName'], // i18n-ignore: variables as they are typed
      ['`{user_avatar}`', 'userAvatar'], // i18n-ignore: variables as they are typed
      ['`{user_id}`', 'userId'], // i18n-ignore: variables as they are typed
      ['`{user_discrim}`', 'userDiscrim'], // i18n-ignore: variables as they are typed
      ['`{user_nick}`', 'userNick'], // i18n-ignore: variables as they are typed
      ['`{user_joindate}`', 'userJoindate'], // i18n-ignore: variables as they are typed
      ['`{user_createdate}`', 'userCreatedate'], // i18n-ignore: variables as they are typed
      ['`{user_displaycolor}`', 'userDisplaycolor'], // i18n-ignore: variables as they are typed
      ['`{user_boostsince}`', 'userBoostsince'], // i18n-ignore: variables as they are typed
    ],
  },
  {
    id: 'userDot',
    fields: [
      ['`{user.mention}`', 'user.mention'], // i18n-ignore: variables as they are typed
      ['`{user.name}`', 'user.name'], // i18n-ignore: variables as they are typed
      ['`{user.id}`', 'user.id'], // i18n-ignore: variables as they are typed
      ['`{user.avatar}`', 'user.avatar'], // i18n-ignore: variables as they are typed
      ['`{user.display_avatar}`', 'user.displayAvatar'], // i18n-ignore: variables as they are typed
      ['`{user.display_name}`', 'user.displayName'], // i18n-ignore: variables as they are typed
      ['`{user.joined_at}`', 'user.joinedAt'], // i18n-ignore: variables as they are typed
      ['`{user.joined_at_timestamp}`', 'user.joinedAtTimestamp'], // i18n-ignore: variables as they are typed
      ['`{user.created_at}`', 'user.createdAt'], // i18n-ignore: variables as they are typed
      ['`{user.created_at_timestamp}`', 'user.createdAtTimestamp'], // i18n-ignore: variables as they are typed
      ['`{user.boost}`', 'user.boost'], // i18n-ignore: variables as they are typed
      ['`{user.boost_since}`', 'user.boostSince'], // i18n-ignore: variables as they are typed
      ['`{user.boost_since_timestamp}`', 'user.boostSinceTimestamp'], // i18n-ignore: variables as they are typed
      ['`{user.color}`', 'user.color'], // i18n-ignore: variables as they are typed
      ['`{user.top_role}`', 'user.topRole'], // i18n-ignore: variables as they are typed
      ['`{user.role_list}`', 'user.roleList'], // i18n-ignore: variables as they are typed
      ['`{user.bot}`', 'user.bot'], // i18n-ignore: variables as they are typed
      ['`{user.join_position}`', 'user.joinPosition'], // i18n-ignore: variables as they are typed
      ['`{user.join_position_suffix}`', 'user.joinPositionSuffix'], // i18n-ignore: variables as they are typed
    ],
  },
  {
    id: 'server',
    fields: [
      ['`{server_prefix}`', 'serverPrefix'], // i18n-ignore: variables as they are typed
      ['`{server_name}`', 'serverName'], // i18n-ignore: variables as they are typed
      ['`{server_id}`', 'serverId'], // i18n-ignore: variables as they are typed
      ['`{server_membercount}`', 'serverMembercount'], // i18n-ignore: variables as they are typed
      ['`{server_membercount_ordinal}`', 'serverMembercountOrdinal'], // i18n-ignore: variables as they are typed
      ['`{server_membercount_nobots}`', 'serverMembercountNobots'], // i18n-ignore: variables as they are typed
      ['`{server_membercount_nobots_ordinal}`', 'serverMembercountNobotsOrdinal'], // i18n-ignore: variables as they are typed
      ['`{server_botcount}`', 'serverBotcount'], // i18n-ignore: variables as they are typed
      ['`{server_icon}`', 'serverIcon'], // i18n-ignore: variables as they are typed
      ['`{server_rolecount}`', 'serverRolecount'], // i18n-ignore: variables as they are typed
      ['`{server_channelcount}`', 'serverChannelcount'], // i18n-ignore: variables as they are typed
      ['`{server_owner}`', 'serverOwner'], // i18n-ignore: variables as they are typed
      ['`{server_owner_id}`', 'serverOwnerId'], // i18n-ignore: variables as they are typed
      ['`{server_createdate}`', 'serverCreatedate'], // i18n-ignore: variables as they are typed
      ['`{server_randommember}`', 'serverRandommember'], // i18n-ignore: variables as they are typed
      ['`{server_randommember_tag}`', 'serverRandommemberTag'], // i18n-ignore: variables as they are typed
      ['`{server_randommember_nobots}`', 'serverRandommemberNobots'], // i18n-ignore: variables as they are typed
      ['`{server_boostlevel}`', 'serverBoostlevel'], // i18n-ignore: variables as they are typed
      ['`{server_boostcount}`', 'serverBoostcount'], // i18n-ignore: variables as they are typed
      ['`{server_nextboostlevel}`', 'serverNextboostlevel'], // i18n-ignore: variables as they are typed
      ['`{server_nextboostlevel_required}`', 'serverNextboostlevelRequired'], // i18n-ignore: variables as they are typed
    ],
  },
  {
    id: 'guild',
    fields: [
      ['`{guild.name}`', 'guild.name'], // i18n-ignore: variables as they are typed
      ['`{guild.id}`', 'guild.id'], // i18n-ignore: variables as they are typed
      ['`{guild.count}`', 'guild.count'], // i18n-ignore: variables as they are typed
      ['`{guild.icon}`', 'guild.icon'], // i18n-ignore: variables as they are typed
      ['`{guild.banner}`', 'guild.banner'], // i18n-ignore: variables as they are typed
      ['`{guild.owner_id}`', 'guild.ownerId'], // i18n-ignore: variables as they are typed
      ['`{guild.created_at}`', 'guild.createdAt'], // i18n-ignore: variables as they are typed
      ['`{guild.created_at_timestamp}`', 'guild.createdAtTimestamp'], // i18n-ignore: variables as they are typed
      ['`{guild.emoji_count}`', 'guild.emojiCount'], // i18n-ignore: variables as they are typed
      ['`{guild.role_count}`', 'guild.roleCount'], // i18n-ignore: variables as they are typed
      ['`{guild.boost_count}`', 'guild.boostCount'], // i18n-ignore: variables as they are typed
      ['`{guild.boost_tier}`', 'guild.boostTier'], // i18n-ignore: variables as they are typed
      ['`{guild.channels_count}`', 'guild.channelsCount'], // i18n-ignore: variables as they are typed
      ['`{guild.vanity}`', 'guild.vanity'], // i18n-ignore: variables as they are typed
      ['`{guild.region}`', 'guild.region'], // i18n-ignore: variables as they are typed
      ['`{guild.max_members}`', 'guild.maxMembers'], // i18n-ignore: variables as they are typed
    ],
  },
  {
    id: 'channel',
    fields: [
      ['`{channel}`', 'channel'], // i18n-ignore: variables as they are typed
      ['`{channel_name}`', 'channelName'], // i18n-ignore: variables as they are typed
      ['`{channel.name}`', 'channel.name'], // i18n-ignore: variables as they are typed
      ['`{channel.id}`', 'channel.id'], // i18n-ignore: variables as they are typed
      ['`{channel.mention}`', 'channel.mention'], // i18n-ignore: variables as they are typed
      ['`{channel.topic}`', 'channel.topic'], // i18n-ignore: variables as they are typed
      ['`{message_link}`', 'messageLink'], // i18n-ignore: variables as they are typed
      ['`{date}`', 'date'], // i18n-ignore: variables as they are typed
      ['`{date.now}`', 'date.now'], // i18n-ignore: variables as they are typed
      ['`{date.utc_now}`', 'date.utcNow'], // i18n-ignore: variables as they are typed
      ['`{date.utc_timestamp}`', 'date.utcTimestamp'], // i18n-ignore: variables as they are typed
    ],
  },
  {
    id: 'functions',
    fields: [
      ['`{newline}`', 'newline'], // i18n-ignore: variables as they are typed
      ['`!@everyone`', 'silent'], // i18n-ignore: a silent mention as it is typed
      ['`{separator}`', 'separator'], // i18n-ignore: variables as they are typed
      ['`{choose:a|b|c}`', 'choose'], // i18n-ignore: variables as they are typed
      ['`{range:1-100}`', 'range'], // i18n-ignore: variables as they are typed
    ],
  },
  {
    id: 'giveaway',
    fields: [
      ['`{gw.prize}`', 'gw.prize'], // i18n-ignore: variables as they are typed
      ['`{gw.winners}`', 'gw.winners'], // i18n-ignore: variables as they are typed
      ['`{gw.entries}`', 'gw.entries'], // i18n-ignore: variables as they are typed
      ['`{gw.host}`', 'gw.host'], // i18n-ignore: variables as they are typed
      ['`{gw.host_name}`', 'gw.hostName'], // i18n-ignore: variables as they are typed
      ['`{gw.host_avatar}`', 'gw.hostAvatar'], // i18n-ignore: variables as they are typed
      ['`{gw.duration}`', 'gw.duration'], // i18n-ignore: variables as they are typed
      ['`{gw.timestamp}` / `{gw.ends}`', 'gw.timestamp'], // i18n-ignore: variables as they are typed
      ['`{gw.claim_time}`', 'gw.claimTime'], // i18n-ignore: variables as they are typed
      ['`{gw.reaction}`', 'gw.reaction'], // i18n-ignore: variables as they are typed
      ['`{gw.entry_mode}`', 'gw.entryMode'], // i18n-ignore: variables as they are typed
      ['`{gw.entry_text}`', 'gw.entryText'], // i18n-ignore: variables as they are typed
      ['`{gw.winner_text}`', 'gw.winnerText'], // i18n-ignore: variables as they are typed
      ['`{gw.status}`', 'gw.status'], // i18n-ignore: variables as they are typed
      ['`{gw.preset}`', 'gw.preset'], // i18n-ignore: variables as they are typed
    ],
  },
  {
    id: 'level',
    fields: [
      ['`{level}`', 'level'], // i18n-ignore: variables as they are typed
      ['`{level_xp}`', 'levelXp'], // i18n-ignore: variables as they are typed
      ['`{level_xp_needed}`', 'levelXpNeeded'], // i18n-ignore: variables as they are typed
      ['`{level_rank}`', 'levelRank'], // i18n-ignore: variables as they are typed
    ],
  },
  {
    id: 'custom',
    fields: [
      ['`{args}` / `{arguments}` / `{args_raw}`', 'args'], // i18n-ignore: variables as they are typed
      ['`{arg1}` … `{arg10}`', 'arg1'], // i18n-ignore: variables as they are typed
      ['`{args_from:N}`', 'argsFrom'], // i18n-ignore: variables as they are typed
      ['`{arg_count}`', 'argCount'], // i18n-ignore: variables as they are typed
      ['`{command_name}`', 'commandName'], // i18n-ignore: variables as they are typed
      ['`{prefix}`', 'prefix'], // i18n-ignore: variables as they are typed
    ],
  },
  {
    id: 'code',
    ref: 'embed create code:', // i18n-ignore: a command
    fields: [
      ['`{embed}`', 'embed'], // i18n-ignore: variables as they are typed
      ['`&v`', 'joiner'], // i18n-ignore: variables as they are typed
      ['`{title: text}` `{url: link}`', 'title'], // i18n-ignore: variables as they are typed
      ['`{description: text}`', 'description'], // i18n-ignore: variables as they are typed
      ['`{color: #ff91c2}`', 'color'], // i18n-ignore: variables as they are typed
      ['`{thumbnail: link}` `{image: link}`', 'thumbnail'], // i18n-ignore: variables as they are typed
      ['`{author: name && icon && link}`', 'author'], // i18n-ignore: variables as they are typed
      ['`{footer: text && icon}`', 'footer'], // i18n-ignore: variables as they are typed
      ['`{field: name && value && inline}`', 'field'], // i18n-ignore: variables as they are typed
      ['`{timestamp}`', 'timestamp'], // i18n-ignore: variables as they are typed
      ['`{button: link && label && url}`', 'button'], // i18n-ignore: variables as they are typed
      ['`{message: text}`', 'message'], // i18n-ignore: variables as they are typed
      ['`{newline}`', 'newline'], // i18n-ignore: variables as they are typed
      [null, 'example'],
      [null, 'builder'],
    ],
  },
];

/** The example of the code page, with its words in `lang` (the blocks and variables are never translated). */
function exampleCode(lang) {
  const word = (name) => t(lang, `embeds.vars.code.${name}`);
  // i18n-ignore: an embed code, its words come from the catalog
  return `\`{message: ${word('exampleHi')} {user}}&v{embed}&v{title: ${word('exampleWelcome')}}&v{description: ${word('exampleRules')}{newline}${word('exampleFun')}}&v{color: #ff91c2}\``;
}

function buildVarsEmbed(page, interaction, prefix, lang = currentLanguage()) {
  const p = VAR_PAGES[page];
  const title = t(lang, `embeds.vars.page.${p.id}`, p.ref ? { command: commandRef(interaction, p.ref, prefix) } : undefined);
  const line = ([name, key]) => {
    if (key === 'example') return t(lang, 'embeds.vars.code.example', { code: exampleCode(lang) });
    if (key === 'builder') return t(lang, 'embeds.vars.code.builder', { url: 'https://petto.sbs/embed-code' });
    return `${name}: ${t(lang, `embeds.vars.${p.id}.${key}`)}`;
  };
  return new EmbedBuilder().setTitle(title).setDescription(p.fields.map(line).join('\n')).setColor(0x4b4f59).setFooter({ text: t(lang, 'embeds.vars.footer', { page: page + 1, total: VAR_PAGES.length }) });
}

function varsNavRow(page) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('evars_prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('evars_num').setLabel(`${page + 1} / ${VAR_PAGES.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('evars_next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === VAR_PAGES.length - 1),
  );
}

async function getOrFail(interaction, name, lang) {
  if (!name) {
    await interaction.editReply(t(lang, 'embeds.cmd.noName', { example: commandRef(interaction, 'embed preview embed:my_embed'), list: commandRef(interaction, 'embed list') }));
    return null;
  }
  const doc = await getTemplate(interaction.guild.id, name);
  if (!doc) {
    await interaction.editReply(t(lang, 'embeds.cmd.notFoundCreate', { name, command: commandRef(interaction, `embed create name:${name}`) }));
    return null;
  }
  return doc;
}

/** `/embed create name code:p2....` saves a Components V2 design from its code, checked the way a send is. */
async function createV2FromCode(interaction, guildId, name, code, ctx) {
  const lang = ctx.lang ?? currentLanguage();
  const v2 = readV2Code(code);
  if (!v2) {
    await interaction.editReply(t(lang, 'embeds.create.v2Unreadable'));
    return;
  }
  const data = { content: '', embeds: [], buttons: [], v2 };
  let payload;
  try {
    payload = await build(data, { ...ctx, allowV2: true });
  } catch (err) {
    await interaction.editReply(t(lang, 'embeds.create.v2Refused', { error: formatEmbedError(err, lang) }));
    return;
  }
  if (!payload.components?.length) {
    await interaction.editReply(t(lang, 'embeds.create.v2Nothing'));
    return;
  }
  await upsertTemplate(guildId, name, data);
  const note = t(lang, 'embeds.create.v2Done', { name, command: commandRef(interaction, 'embed send', ctx.prefix) });
  await interaction.editReply({ content: note, components: [], embeds: [] });
  await interaction.followUp({ components: payload.components, flags: payload.flags, files: payload.files ?? [], allowedMentions: { parse: [] } }).catch(() => {});
}

/**
 * `/embed create name code:...` saves an embed written as one code, so it does not need the editor. The code is checked
 * the same way a send is, nothing is saved when Discord would refuse it, and the result is shown right away.
 */
async function createFromCode(interaction, guildId, name, code, ctx) {
  // A `p2.` code is a Components V2 design (the Embed Builder and the dashboard make them): it is saved as it is.
  if (/^\s*p2\./.test(code)) return createV2FromCode(interaction, guildId, name, code, ctx);
  const lang = ctx.lang ?? currentLanguage();
  const parsed = parseEmbedScript(code, lang);
  if (!parsed.embed && !parsed.content && !parsed.buttons.length) {
    const problems = parsed.warnings.length ? `\n${parsed.warnings.map((line) => `- ${line}`).join('\n')}` : '';
    await interaction.editReply(`${t(lang, 'embeds.create.nothingFound')}${problems}`);
    return;
  }
  const { data, editableInPanel } = toTemplateData(parsed);
  let payload;
  try {
    payload = await build(data, ctx);
  } catch (err) {
    await interaction.editReply(t(lang, 'embeds.code.refused', { error: formatEmbedError(err, lang) }));
    return;
  }
  if (!hasSendablePayload(payload)) {
    await interaction.editReply(t(lang, 'embeds.create.nothing'));
    return;
  }
  await upsertTemplate(guildId, name, data);
  const notes = [
    t(lang, 'embeds.create.done', { name }),
    editableInPanel
      ? t(lang, 'embeds.create.editHere', { edit: commandRef(interaction, 'embed edit', ctx.prefix), send: commandRef(interaction, 'embed send', ctx.prefix) })
      : t(lang, 'embeds.create.editDashboard', { send: commandRef(interaction, 'embed send', ctx.prefix) }),
    ...parsed.warnings.map((line) => `- ${line}`),
  ];
  await interaction.editReply({ content: `${notes.join('\n')}\n\n${payload.content ?? ''}`.slice(0, 2000), embeds: payload.embeds, components: payload.components });
}

/** The saved embeds of the server that match what is typed in an `embed` option of `/embed`: the list Discord shows under it. */
async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'embed' || !interaction.guildId) return interaction.respond([]);
  const typed = String(focused.value ?? '').trim().toLowerCase();
  let rows = [];
  try { rows = await listTemplates(interaction.guildId); } catch { rows = []; }
  const choices = rows
    .filter((row) => row?.name && (!typed || String(row.name).toLowerCase().includes(typed)))
    .slice(0, 25)
    .map((row) => ({ name: String(row.name).slice(0, 100), value: String(row.name).slice(0, 100) }));
  return interaction.respond(choices);
}

module.exports = {
  createFromCode,
  readV2Code,
  aliases: ['em'],
  // Works with the prefix (the subcommands are written as words) and as a slash command; `/embed create` opens the same editor.
  registerSlash: true,
  autocomplete,
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Build and manage named, reusable embeds.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    .addSubcommand((s) => s.setName('create').setDescription('Create a new named embed, with the editor or from a code.').addStringOption((o) => o.setName('name').setDescription('Embed name (e.g. rules_embed)').setRequired(true)).addStringOption((o) => o.setName('code').setDescription('Optional: the whole embed as one code ({embed}&v{title: Hi}...), or a p2. code for a V2 design').setRequired(false).setMaxLength(6000)))
    .addSubcommand((s) => s.setName('preview').setDescription('Preview a saved embed with variables resolved.').addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) =>
      s
        .setName('send')
        .setDescription('Send a saved embed to a channel.')
        .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Target channel (default: current)').setRequired(false)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread)),
    )
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a saved embed.').addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List all saved embeds in this server.'))
    .addSubcommand((s) => s.setName('vars').setDescription('Show available variables/placeholders for embed fields.').addIntegerOption((o) => o.setName('page').setDescription('Page number').setRequired(false).setMinValue(1).setMaxValue(VAR_PAGES.length)))

    .addSubcommandGroup((g) =>
      g
        .setName('edit')
        .setDescription('Edit parts of a saved embed.')
        .addSubcommand((s) =>
          s
            .setName('title')
            .setDescription('Edit the embed title.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('title').setDescription('Title text (supports variables)').setRequired(true))
            .addStringOption((o) => o.setName('url').setDescription('Clickable title URL').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('description')
            .setDescription('Edit the embed description.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('description').setDescription('Description (supports variables, {newline} for line breaks)').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('color')
            .setDescription('Edit the embed color.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('color').setDescription('Hex color e.g. #ff91c2').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('author')
            .setDescription('Edit the embed author.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('text').setDescription('Author name (supports variables)').setRequired(true))
            .addStringOption((o) => o.setName('icon').setDescription('Icon URL (supports {user_avatar}, {server_icon})').setRequired(false))
            .addStringOption((o) => o.setName('url').setDescription('Author URL').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('footer')
            .setDescription('Edit the embed footer.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('text').setDescription('Footer text (supports variables)').setRequired(true))
            .addStringOption((o) => o.setName('icon').setDescription('Icon URL').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('thumbnail')
            .setDescription('Edit the embed thumbnail (small image, top-right).')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('image').setDescription('Image URL (supports {user_avatar}, {server_icon})').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('image')
            .setDescription('Edit the embed large image.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('image').setDescription('Image URL').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('timestamp')
            .setDescription('Toggle the embed timestamp on/off.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
            .addBooleanOption((o) => o.setName('timestamp').setDescription('Enable timestamp?').setRequired(true)),
        ),
    )

    .addSubcommandGroup((g) =>
      g
        .setName('field')
        .setDescription('Manage embed fields.')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a field to an embed.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
            .addStringOption((o) => o.setName('name').setDescription('Field name').setRequired(true))
            .addStringOption((o) => o.setName('value').setDescription('Field value').setRequired(true))
            .addBooleanOption((o) => o.setName('inline').setDescription('Display inline?').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a field by position.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true).setAutocomplete(true))
            .addIntegerOption((o) => o.setName('position').setDescription('Field position (1-based)').setRequired(true).setMinValue(1)),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    const guildId = interaction.guild.id;
    const lang = await languageOf(interaction);
    const ctx = { member: interaction.member, guild: interaction.guild, channel: interaction.channel, user: interaction.user, lang };

    if (!group && sub === 'vars') {
      let page = (interaction.options.getInteger('page') ?? 1) - 1;
      await interaction.reply({ embeds: [buildVarsEmbed(page, interaction, ctx.prefix, lang)], components: [varsNavRow(page)] });
      const msg = await interaction.fetchReply();
      const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: 90_000 });
      collector.on('collect', async (i) => {
        if (i.customId === 'evars_prev') page = Math.max(0, page - 1);
        if (i.customId === 'evars_next') page = Math.min(VAR_PAGES.length - 1, page + 1);
        await i.update({ embeds: [buildVarsEmbed(page, interaction, ctx.prefix, lang)], components: [varsNavRow(page)] });
      });
      collector.on('end', () => msg.edit({ components: [] }).catch(() => {}));
      return;
    }

    const isPublic = !group && sub === 'create';
    await interaction.deferReply({ flags: isPublic ? undefined : MessageFlags.Ephemeral });

    // embed_templates.guild_id has a foreign key to guilds(guild_id), so the guild row must
    // exist before any create/edit/field write — this also gives us the real prefix for ctx.
    const guildConfig = await ensureGuild(guildId);
    ctx.prefix = guildPrefixes.primaryPrefix(guildConfig);

    try {
      if (group === 'field') {
        const name = normalizeName(interaction.options.getString('embed'));
        const doc = await getOrFail(interaction, name, lang);
        if (!doc) return;
        const data = { ...doc.data, fields: doc.data?.fields ?? [] };

        if (sub === 'add') {
          if (data.fields.length >= 25) {
            await interaction.editReply(t(lang, 'embeds.cmd.maxFields'));
            return;
          }
          data.fields.push({ name: interaction.options.getString('name'), value: interaction.options.getString('value'), inline: interaction.options.getBoolean('inline') ?? false });
          await upsertTemplate(guildId, name, data);
          await interaction.editReply(t(lang, 'embeds.cmd.fieldAdded', { name, count: data.fields.length }));
          return;
        }

        if (sub === 'remove') {
          const pos = interaction.options.getInteger('position') - 1;
          if (pos < 0 || pos >= data.fields.length) {
            await interaction.editReply(t(lang, 'embeds.cmd.badPosition'));
            return;
          }
          data.fields.splice(pos, 1);
          await upsertTemplate(guildId, name, data);
          await interaction.editReply(t(lang, 'embeds.cmd.fieldRemoved', { name }));
          return;
        }
      }

      if (group === 'edit') {
        const name = normalizeName(interaction.options.getString('embed'));
        const doc = await getOrFail(interaction, name, lang);
        if (!doc) return;
        const data = doc.data ?? {};

        if (sub === 'title') {
          data.title = interaction.options.getString('title');
          data.url = interaction.options.getString('url') ?? data.url;
        } else if (sub === 'description') {
          data.description = interaction.options.getString('description');
        } else if (sub === 'color') {
          data.color = parseColor(interaction.options.getString('color'), lang);
        } else if (sub === 'author') {
          data.author = { name: interaction.options.getString('text'), icon: interaction.options.getString('icon') ?? null, url: interaction.options.getString('url') ?? null };
        } else if (sub === 'footer') {
          data.footer = { text: interaction.options.getString('text'), icon: interaction.options.getString('icon') ?? null };
        } else if (sub === 'thumbnail') {
          data.thumbnail = interaction.options.getString('image');
        } else if (sub === 'image') {
          data.image = interaction.options.getString('image');
        } else if (sub === 'timestamp') {
          data.timestamp = interaction.options.getBoolean('timestamp');
        }

        await upsertTemplate(guildId, name, data);
        await interaction.editReply(t(lang, 'embeds.cmd.updated', { name }));
        return;
      }

      switch (sub) {
        case 'create': {
          const name = normalizeName(interaction.options.getString('name'));
          if (!name) {
            await interaction.editReply(t(lang, 'embeds.cmd.noCreateName', { example: commandRef(interaction, 'embed create name:my_embed', ctx.prefix) }));
            return;
          }
          const existing = await getTemplate(guildId, name);
          if (existing) {
            await interaction.editReply(t(lang, 'embeds.cmd.exists', { name, command: commandRef(interaction, 'embed edit', ctx.prefix) }));
            return;
          }
          const code = interaction.options.getString('code');
          if (code && code.trim()) {
            await createFromCode(interaction, guildId, name, code, ctx);
            return;
          }
          await upsertTemplate(guildId, name, { fields: [] });
          const doc = await getTemplate(guildId, name);
          const panel = await renderPanel(doc, name, interaction.user.id, commandRef(interaction, 'embed preview', ctx.prefix), lang); // i18n-ignore: a command
          await interaction.editReply(panel);
          return;
        }

        case 'delete': {
          const name = normalizeName(interaction.options.getString('embed'));
          const deleted = await deleteTemplate(guildId, name);
          await interaction.editReply(t(lang, deleted ? 'embeds.cmd.deleted' : 'embeds.cmd.notFound', { name }));
          return;
        }

        case 'list': {
          const templates = await listTemplates(guildId);
          if (!templates.length) {
            await interaction.editReply(t(lang, 'embeds.cmd.listEmpty', { command: commandRef(interaction, 'embed create name:my_embed', ctx.prefix) }));
            return;
          }
          const lines = templates.map((template, i) => `\`${i + 1}.\` **${template.name}**`);
          await interaction.editReply(t(lang, 'embeds.cmd.list', { count: templates.length, list: lines.join('\n') }));
          return;
        }

        case 'preview': {
          const name = normalizeName(interaction.options.getString('embed'));
          const doc = await getOrFail(interaction, name, lang);
          if (!doc) return;
          const payload = await build(doc.data, { ...ctx, allowV2: true });
          if (!hasSendablePayload(payload)) {
            await interaction.editReply(t(lang, 'embeds.cmd.empty', { name }));
            return;
          }
          if (payload.flags) {
            await interaction.editReply({ components: payload.components, flags: payload.flags, allowedMentions: { parse: [] } });
            return;
          }
          await interaction.editReply({ content: t(lang, 'embeds.cmd.preview', { name, content: payload.content ?? '' }), embeds: payload.embeds, components: payload.components, files: payload.files });
          return;
        }

        case 'send': {
          const name = normalizeName(interaction.options.getString('embed'));
          const target = interaction.options.getChannel('channel') ?? interaction.channel;
          const doc = await getOrFail(interaction, name, lang);
          if (!doc) return;
          // The reactions of the embed (its `reactions` list and any {reactreply:emoji}) are put on the message once it is sent.
          const reactions = [];
          const payload = await build(extractReactRepliesFromTemplate(doc.data, reactions), { ...ctx, allowV2: true });
          if (!hasSendablePayload(payload)) {
            await interaction.editReply(t(lang, 'embeds.cmd.empty', { name }));
            return;
          }
          if (payload.flags) {
            const sentV2 = await target.send({ components: payload.components, flags: payload.flags, allowedMentions: { parse: [] } });
            await applyReactReplies(sentV2, uniqueReactions(reactions));
            await interaction.editReply(t(lang, 'embeds.cmd.sent', { name, channel: `<#${target.id}>` }));
            return;
          }
          const sentEmbed = await target.send({ content: payload.content, embeds: payload.embeds, components: payload.components, files: payload.files });
          await applyReactReplies(sentEmbed, uniqueReactions(reactions));
          await interaction.editReply(t(lang, 'embeds.cmd.sent', { name, channel: `<#${target.id}>` }));
          return;
        }
      }
    } catch (err) {
      const detail = formatEmbedError(err, lang);
      logger.error(`Embed ${sub}${group ? ` (${group})` : ''} failed in guild ${guildId}:`, err);
      await interaction.editReply(t(lang, 'embeds.cmd.error', { error: detail }));
    }
  },
};
