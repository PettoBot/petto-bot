const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getTemplate, upsertTemplate, deleteTemplate, listTemplates, normalizeName } = require('../../db/embedTemplates');
const { ensureGuild } = require('../../db/guilds');
const { parseColor, build } = require('../../utils/embedBuilder');
const { renderPanel } = require('../../interactions/embedPanel');

const VAR_PAGES = [
  {
    title: 'Variables · User',
    fields: [
      ['`{user}`', 'Mentions the user (@mention)'],
      ['`{user_tag}`', 'Username'],
      ['`{user_name}`', 'Username (without tag)'],
      ['`{user_avatar}`', 'Avatar URL'],
      ['`{user_id}`', 'User ID'],
      ['`{user_discrim}`', 'Discriminator'],
      ['`{user_nick}`', 'Server nickname or username'],
      ['`{user_joindate}`', 'Date the user joined the server'],
      ['`{user_createdate}`', 'Date the account was created'],
      ['`{user_displaycolor}`', 'Display color (hex)'],
      ['`{user_boostsince}`', 'Date the user started boosting'],
    ],
  },
  {
    title: 'Variables · User (dot notation)',
    fields: [
      ['`{user.mention}`', 'Mentions the user (@mention)'],
      ['`{user.name}`', 'Username'],
      ['`{user.id}`', 'User ID'],
      ['`{user.avatar}`', 'Avatar URL'],
      ['`{user.display_avatar}`', 'Server avatar (falls back to global)'],
      ['`{user.display_name}`', 'Server nickname or username'],
      ['`{user.joined_at}`', 'Date joined the server'],
      ['`{user.joined_at_timestamp}`', 'Unix timestamp of join date'],
      ['`{user.created_at}`', 'Account creation date'],
      ['`{user.created_at_timestamp}`', 'Unix timestamp of creation date'],
      ['`{user.boost}`', '`Yes` or `No`: is the user boosting?'],
      ['`{user.boost_since}`', 'Date they started boosting'],
      ['`{user.boost_since_timestamp}`', 'Unix timestamp of boost start'],
      ['`{user.color}`', 'Role color (hex)'],
      ['`{user.top_role}`', 'Highest role name'],
      ['`{user.role_list}`', 'All roles as mentions'],
      ['`{user.bot}`', '`Yes` or `No`: is the user a bot?'],
      ['`{user.join_position}`', 'Member join position (number)'],
      ['`{user.join_position_suffix}`', 'Join position with suffix (1st, 2nd…)'],
    ],
  },
  {
    title: 'Variables · Server',
    fields: [
      ['`{server_prefix}`', "Server's configured prefix (Petto is slash-only, so this is informational)"],
      ['`{server_name}`', 'Server name'],
      ['`{server_id}`', 'Server ID'],
      ['`{server_membercount}`', 'Total member count'],
      ['`{server_membercount_ordinal}`', 'Member count (1st, 2nd…)'],
      ['`{server_membercount_nobots}`', 'Member count excluding bots'],
      ['`{server_membercount_nobots_ordinal}`', 'Same but ordinal'],
      ['`{server_botcount}`', 'Number of bots'],
      ['`{server_icon}`', 'Server icon URL'],
      ['`{server_rolecount}`', 'Number of roles'],
      ['`{server_channelcount}`', 'Number of channels'],
      ['`{server_owner}`', 'Mentions the server owner'],
      ['`{server_owner_id}`', 'Server owner ID'],
      ['`{server_createdate}`', 'Server creation date'],
      ['`{server_randommember}`', 'Mentions a random member'],
      ['`{server_randommember_tag}`', 'Username of a random member'],
      ['`{server_randommember_nobots}`', 'Random member (no bots)'],
      ['`{server_boostlevel}`', 'Current boost level (0-3)'],
      ['`{server_boostcount}`', 'Total boosts'],
      ['`{server_nextboostlevel}`', 'Next boost level'],
      ['`{server_nextboostlevel_required}`', 'Boosts needed for next level'],
    ],
  },
  {
    title: 'Variables · Guild (dot notation)',
    fields: [
      ['`{guild.name}`', 'Server name'],
      ['`{guild.id}`', 'Server ID'],
      ['`{guild.count}`', 'Total member count'],
      ['`{guild.icon}`', 'Server icon URL'],
      ['`{guild.banner}`', 'Server banner URL'],
      ['`{guild.owner_id}`', 'Server owner ID'],
      ['`{guild.created_at}`', 'Server creation date'],
      ['`{guild.created_at_timestamp}`', 'Unix timestamp of creation date'],
      ['`{guild.emoji_count}`', 'Number of custom emojis'],
      ['`{guild.role_count}`', 'Number of roles'],
      ['`{guild.boost_count}`', 'Total number of boosts'],
      ['`{guild.boost_tier}`', 'Boost tier (e.g. Level 2)'],
      ['`{guild.channels_count}`', 'Number of channels'],
      ['`{guild.vanity}`', 'Vanity URL (e.g. discord.gg/code)'],
      ['`{guild.region}`', 'Preferred locale'],
      ['`{guild.max_members}`', 'Max member capacity'],
    ],
  },
  {
    title: 'Variables · Channel / Message / Date',
    fields: [
      ['`{channel}`', 'Mentions the current channel'],
      ['`{channel_name}`', 'Channel name'],
      ['`{channel.name}`', 'Channel name (dot notation)'],
      ['`{channel.id}`', 'Channel ID'],
      ['`{channel.mention}`', 'Channel mention (#channel)'],
      ['`{channel.topic}`', 'Channel topic'],
      ['`{message_link}`', 'Link to the triggering message (empty in slash commands)'],
      ['`{date}`', "Today's date"],
      ['`{date.now}`', "Today's date (Pacific time)"],
      ['`{date.utc_now}`', 'Current UTC date & time'],
      ['`{date.utc_timestamp}`', 'Current Unix timestamp'],
    ],
  },
  {
    title: 'Variables · Functions',
    fields: [
      ['`{newline}`', 'Line break'],
      ['`{separator}`', 'Decorative line ──────────────────────'],
      ['`{choose:a|b|c}`', 'Random choice from the list'],
      ['`{range:1-100}`', 'Random number between 1 and 100'],
    ],
  },
  {
    title: 'Variables · Giveaway',
    fields: [
      ['`{gw.prize}`', 'The prize'],
      ['`{gw.winners}`', 'Number of winners'],
      ['`{gw.host}`', 'Mentions whoever started it'],
      ['`{gw.duration}`', 'End time as a Unix timestamp'],
      ['`{gw.timestamp}`', 'End time as a relative Discord timestamp'],
      ['`{gw.claim_time}`', 'How long winners have to claim'],
      ['`{gw.reaction}`', 'Entry emoji when using reaction mode'],
      ['`{gw.entry_mode}`', 'Whether members react or click to enter'],
      ['`{gw.preset}`', 'Bonus-entry roles list, when a preset is used'],
    ],
  },
  {
    title: 'Variables · Level (level-up notifications only)',
    fields: [
      ['`{level}`', 'The level just reached'],
      ['`{level_xp}`', 'Total XP'],
      ['`{level_xp_needed}`', 'XP needed for the next level'],
      ['`{level_rank}`', 'Server rank position'],
    ],
  },
];

function buildVarsEmbed(page) {
  const p = VAR_PAGES[page];
  return new EmbedBuilder().setTitle(p.title).setDescription(p.fields.map(([k, v]) => `${k}: ${v}`).join('\n')).setColor(0x4b4f59).setFooter({ text: `Page ${page + 1}/${VAR_PAGES.length}` });
}

function varsNavRow(page) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('evars_prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId('evars_num').setLabel(`${page + 1} / ${VAR_PAGES.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('evars_next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(page === VAR_PAGES.length - 1),
  );
}

async function getOrFail(interaction, name) {
  const doc = await getTemplate(interaction.guild.id, name);
  if (!doc) {
    await interaction.editReply(`No embed named \`${name}\` found. Create it first with \`!embed create name:${name}\`.`);
    return null;
  }
  return doc;
}

module.exports = {
  aliases: ['em'],
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Build and manage named, reusable embeds.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)

    .addSubcommand((s) => s.setName('create').setDescription('Create a new named embed.').addStringOption((o) => o.setName('name').setDescription('Embed name (e.g. rules_embed)').setRequired(true)))
    .addSubcommand((s) => s.setName('preview').setDescription('Preview a saved embed with variables resolved.').addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('send')
        .setDescription('Send a saved embed to a channel.')
        .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Target channel (default: current)').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a saved embed.').addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true)))
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
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
            .addStringOption((o) => o.setName('title').setDescription('Title text (supports variables)').setRequired(true))
            .addStringOption((o) => o.setName('url').setDescription('Clickable title URL').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('description')
            .setDescription('Edit the embed description.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
            .addStringOption((o) => o.setName('description').setDescription('Description (supports variables, {newline} for line breaks)').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('color')
            .setDescription('Edit the embed color.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
            .addStringOption((o) => o.setName('color').setDescription('Hex color e.g. #ff91c2').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('author')
            .setDescription('Edit the embed author.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
            .addStringOption((o) => o.setName('text').setDescription('Author name (supports variables)').setRequired(true))
            .addStringOption((o) => o.setName('icon').setDescription('Icon URL (supports {user_avatar}, {server_icon})').setRequired(false))
            .addStringOption((o) => o.setName('url').setDescription('Author URL').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('footer')
            .setDescription('Edit the embed footer.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
            .addStringOption((o) => o.setName('text').setDescription('Footer text (supports variables)').setRequired(true))
            .addStringOption((o) => o.setName('icon').setDescription('Icon URL').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('thumbnail')
            .setDescription('Edit the embed thumbnail (small image, top-right).')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
            .addStringOption((o) => o.setName('image').setDescription('Image URL (supports {user_avatar}, {server_icon})').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('image')
            .setDescription('Edit the embed large image.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
            .addStringOption((o) => o.setName('image').setDescription('Image URL').setRequired(true)),
        )
        .addSubcommand((s) =>
          s
            .setName('timestamp')
            .setDescription('Toggle the embed timestamp on/off.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
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
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
            .addStringOption((o) => o.setName('name').setDescription('Field name').setRequired(true))
            .addStringOption((o) => o.setName('value').setDescription('Field value').setRequired(true))
            .addBooleanOption((o) => o.setName('inline').setDescription('Display inline?').setRequired(false)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Remove a field by position.')
            .addStringOption((o) => o.setName('embed').setDescription('Embed name').setRequired(true))
            .addIntegerOption((o) => o.setName('position').setDescription('Field position (1-based)').setRequired(true).setMinValue(1)),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const group = interaction.options.getSubcommandGroup(false);
    const guildId = interaction.guild.id;
    const ctx = { member: interaction.member, guild: interaction.guild, channel: interaction.channel, user: interaction.user };

    if (!group && sub === 'vars') {
      let page = (interaction.options.getInteger('page') ?? 1) - 1;
      await interaction.reply({ embeds: [buildVarsEmbed(page)], components: [varsNavRow(page)] });
      const msg = await interaction.fetchReply();
      const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: 90_000 });
      collector.on('collect', async (i) => {
        if (i.customId === 'evars_prev') page = Math.max(0, page - 1);
        if (i.customId === 'evars_next') page = Math.min(VAR_PAGES.length - 1, page + 1);
        await i.update({ embeds: [buildVarsEmbed(page)], components: [varsNavRow(page)] });
      });
      collector.on('end', () => msg.edit({ components: [] }).catch(() => {}));
      return;
    }

    const isPublic = !group && sub === 'create';
    await interaction.deferReply({ flags: isPublic ? undefined : MessageFlags.Ephemeral });

    // embed_templates.guild_id has a foreign key to guilds(guild_id), so the guild row must
    // exist before any create/edit/field write — this also gives us the real prefix for ctx.
    const guildConfig = await ensureGuild(guildId);
    ctx.prefix = guildConfig.prefix;

    try {
      if (group === 'field') {
        const name = normalizeName(interaction.options.getString('embed'));
        const doc = await getOrFail(interaction, name);
        if (!doc) return;
        const data = { ...doc.data, fields: doc.data?.fields ?? [] };

        if (sub === 'add') {
          if (data.fields.length >= 25) {
            await interaction.editReply('Embeds can have at most 25 fields.');
            return;
          }
          data.fields.push({ name: interaction.options.getString('name'), value: interaction.options.getString('value'), inline: interaction.options.getBoolean('inline') ?? false });
          await upsertTemplate(guildId, name, data);
          await interaction.editReply(`Field added to \`${name}\`! (${data.fields.length}/25)`);
          return;
        }

        if (sub === 'remove') {
          const pos = interaction.options.getInteger('position') - 1;
          if (pos < 0 || pos >= data.fields.length) {
            await interaction.editReply('Invalid position.');
            return;
          }
          data.fields.splice(pos, 1);
          await upsertTemplate(guildId, name, data);
          await interaction.editReply(`Field removed from \`${name}\`.`);
          return;
        }
      }

      if (group === 'edit') {
        const name = normalizeName(interaction.options.getString('embed'));
        const doc = await getOrFail(interaction, name);
        if (!doc) return;
        const data = doc.data ?? {};

        if (sub === 'title') {
          data.title = interaction.options.getString('title');
          data.url = interaction.options.getString('url') ?? data.url;
        } else if (sub === 'description') {
          data.description = interaction.options.getString('description');
        } else if (sub === 'color') {
          data.color = parseColor(interaction.options.getString('color'));
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
        await interaction.editReply(`\`${name}\` updated!`);
        return;
      }

      switch (sub) {
        case 'create': {
          const name = normalizeName(interaction.options.getString('name'));
          const existing = await getTemplate(guildId, name);
          if (existing) {
            await interaction.editReply(`An embed named \`${name}\` already exists. Use \`!embed edit\` to modify it.`);
            return;
          }
          await upsertTemplate(guildId, name, { fields: [] });
          const doc = await getTemplate(guildId, name);
          const panel = await renderPanel(doc, name, interaction.user.id);
          await interaction.editReply(panel);
          return;
        }

        case 'delete': {
          const name = normalizeName(interaction.options.getString('embed'));
          const deleted = await deleteTemplate(guildId, name);
          await interaction.editReply(deleted ? `Embed \`${name}\` deleted.` : `No embed named \`${name}\` found.`);
          return;
        }

        case 'list': {
          const templates = await listTemplates(guildId);
          if (!templates.length) {
            await interaction.editReply('No saved embeds in this server. Create one with `!embed create name:my_embed`.');
            return;
          }
          const lines = templates.map((t, i) => `\`${i + 1}.\` **${t.name}**`);
          await interaction.editReply(`**Saved Embeds (${templates.length}):**\n${lines.join('\n')}`);
          return;
        }

        case 'preview': {
          const name = normalizeName(interaction.options.getString('embed'));
          const doc = await getOrFail(interaction, name);
          if (!doc) return;
          const payload = await build(doc.data, ctx);
          await interaction.editReply({ content: `Preview of \`${name}\`:\n${payload.content ?? ''}`, embeds: payload.embeds, components: payload.components });
          return;
        }

        case 'send': {
          const name = normalizeName(interaction.options.getString('embed'));
          const target = interaction.options.getChannel('channel') ?? interaction.channel;
          const doc = await getOrFail(interaction, name);
          if (!doc) return;
          const payload = await build(doc.data, ctx);
          await target.send({ content: payload.content, embeds: payload.embeds, components: payload.components });
          await interaction.editReply(`Embed \`${name}\` sent to <#${target.id}>!`);
          return;
        }
      }
    } catch (err) {
      await interaction.editReply(`Error: \`${err.message}\``);
    }
  },
};
