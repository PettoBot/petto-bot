const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  MessageFlags,
} = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { textCard } = require('../../utils/caseCard');
const { describePermissions } = require('../../utils/permissionLabels');
const { EMOJI } = require('../../utils/emojis');

const TIMEOUT_MS = 120_000;

const CATEGORY_META = {
  moderation: { label: 'Moderation', icon: '<:pe_mod:1533209776862003313>' },
  info: { label: 'Info', icon: '<:pe_info:1533209774370328800>' },
  welcome: { label: 'Welcome', icon: '<:pe_welcome:1533211251705118875>' },
  automation: { label: 'Automation', icon: '<:pe_auto:1533211330734194810>' },
  leveling: { label: 'Leveling', icon: '<:pe_le:1533211745584156934>' },
  giveaways: { label: 'Giveaways', icon: '<:pe_give:1533211659911303358>' },
  tickets: { label: 'Tickets', icon: '<:pe_tickets:1533209775699922974>' },
  config: { label: 'Configuration', icon: '<:pe_config:1533209778438934609>' },
  // Placeholder mapping: this code was labeled "pe_info" again (likely a copy-paste rename
  // slip when uploading) but the wrench glyph reads as utility — flagged for confirmation.
  utility: { label: 'Utility', icon: '<:pe_info:1533209779751616676>' },
  misc: { label: 'Misc', icon: '<:pe_misc:1533209781345587374>' },
  roleplay: { label: 'Roleplay', icon: '💞' },
  other: { label: 'Other', icon: '📄' },
};

// ── Introspection — built live from client.commands, never a hand-kept list ──

function getChatInputCommands(client) {
  return [...client.commands.values()].filter((c) => (c.data.toJSON().type ?? 1) === 1);
}

/** Prefers this server's own bot avatar (server-specific pfp) over the bot's global one. */
function botAvatarURL(client, guild) {
  return guild?.members?.me?.displayAvatarURL({ size: 256 }) ?? client.user.displayAvatarURL({ size: 256 });
}

function groupByCategory(commands) {
  const map = new Map();
  for (const cmd of commands) {
    const cat = cmd.category ?? 'other';
    if (!map.has(cat)) map.set(cat, []);
    map.get(cat).push(cmd);
  }
  return map;
}

/** One command's option tree walked into a flat list of { path: [subGroup?, sub?], description, options } — one entry per leaf (sub)command, matching how bli's registry had one entry per full command path. */
function flattenEntries(json) {
  const top = json.options ?? [];
  const hasSub = top.some((o) => o.type === 1 || o.type === 2);

  if (!hasSub) return [{ path: [], description: json.description, options: top }];

  const entries = [];
  for (const o of top) {
    if (o.type === 1) {
      entries.push({ path: [o.name], description: o.description, options: o.options ?? [] });
    } else if (o.type === 2) {
      for (const sub of o.options ?? []) {
        if (sub.type === 1) entries.push({ path: [o.name, sub.name], description: sub.description, options: sub.options ?? [] });
      }
    }
  }
  return entries;
}

// bli doesn't hand-color the syntax block with ansi escapes — it just tags the code block
// "Ruby" (and "lua" for the main menu's usage line) and lets Discord's own built-in syntax
// highlighter do the coloring, same mechanism as any other language-tagged code block.
function buildSyntax(prefix, name, entry) {
  const parts = [`${prefix}${name}`, ...entry.path];
  for (const opt of entry.options) parts.push(opt.required ? `<${opt.name}>` : `[${opt.name}]`);
  return parts.join(' ');
}

function buildParams(entry) {
  if (!entry.options.length) return 'None';
  return entry.options.map((opt) => (opt.required ? `<${opt.name}>` : `[${opt.name}]`)).join(' ');
}

function buildExample(prefix, name, entry) {
  const parts = [`${prefix}${name}`, ...entry.path];
  for (const opt of entry.options) {
    const sample = opt.type === 6 ? '@member' : opt.type === 8 ? '@role' : opt.type === 7 ? '#channel' : opt.type === 5 ? 'true' : opt.type === 4 ? '1' : opt.name === 'message' || opt.name === 'reason' ? '"hello world"' : opt.name;
    if (opt.required) parts.push(sample);
  }
  return parts.join(' ');
}

function buildMetadata(aliases, params, information) {
  // A spaced three-column row is compact, but Discord wraps it unpredictably once
  // the parameter syntax gets long. Stack the fields before that happens so the
  // warning emoji and permission label always stay together.
  if (aliases.length > 18 || params.length > 28 || information.length > 24) {
    return [
      '**Aliases**', aliases,
      '',
      '**Parameters**', `\`${params}\``,
      '',
      '**Information**', information,
    ].join('\n');
  }
  return [
    '**Aliases**                 **Parameters**                 **Information**',
    `${aliases}                 ${params}                 ${information}`,
  ].join('\n');
}

/** Finds every entry matching a typed lookup — an exact path match returns just that one entry; a bare command name (or partial path) returns every entry under it, for pagination, same as bli's findGroup(). */
function findEntries(client, tokens) {
  const canonicalName = client.commandAliases.get(tokens[0]) ?? tokens[0];
  const command = client.commands.get(canonicalName);
  if (!command || (command.data.toJSON().type ?? 1) !== 1) return { command: null, entries: [] };

  const json = command.data.toJSON();
  const all = flattenEntries(json);
  const wantedPath = tokens.slice(1).join(' ');

  if (!wantedPath) return { command, entries: all };

  const exact = all.find((e) => e.path.join(' ') === wantedPath);
  if (exact) return { command, entries: [exact] };

  const partial = all.filter((e) => e.path.join(' ').startsWith(wantedPath));
  return { command, entries: partial };
}

// ── The per-(sub)command info card — the unit both pagination and drill-down bottom out at ──

function entryDetailCard(client, guild, prefix, command, entry, page = 0, total = 1) {
  const json = command.data.toJSON();
  const aliases = command.aliases?.length ? command.aliases.map((a) => `\`${prefix}${a}\``).join(', ') : 'No Aliases';
  const syntax = buildSyntax(prefix, json.name, entry);
  const example = buildExample(prefix, json.name, entry);
  const params = buildParams(entry);
  const information = json.default_member_permissions == null ? 'n/a' : `${EMOJI.WARNING} ${describePermissions(json.default_member_permissions)}`;
  const title = [json.name, ...entry.path].join(' ');
  const moduleLabel = (CATEGORY_META[command.category] ?? CATEGORY_META.other).label;

  const text = [
    `### Command: ${title}`,
    `> ${entry.description || json.description || 'No description.'}`,
    '',
    buildMetadata(aliases, params, information),
    '',
    '**Usage**',
    `\`\`\`Ruby\nSyntax: ${syntax}\nExample: ${example}\n\`\`\``,
    `-# Page ${page + 1}/${total} (${total} ${total === 1 ? 'entry' : 'entries'}) · Module: ${moduleLabel}`,
  ].join('\n');

  const section = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatarURL(client, guild)));

  return new ContainerBuilder().addSectionComponents(section);
}

function navRow(page, total, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('help_prev').setEmoji(EMOJI.PREV).setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId('help_page').setEmoji(EMOJI.PAGES).setLabel(`${page + 1} / ${total}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('help_next').setEmoji(EMOJI.NEXT).setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === total - 1),
    new ButtonBuilder().setCustomId('help_close').setEmoji(EMOJI.CLOSE).setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  );
}

// ── Interactive browse views (category -> command -> subcommand -> detail) ──

function mainView(client, guild, prefix) {
  const commands = getChatInputCommands(client);
  const categories = groupByCategory(commands);

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Use** the command below to look up **${commands.length}** commands\n` +
          `\`\`\`lua\n${prefix}help [category | command]\n\`\`\`` +
          `\n-# You can also select a category below.`,
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatarURL(client, guild)));

  const options = [...categories.entries()].map(([id, cmds]) => {
    const meta = CATEGORY_META[id] ?? CATEGORY_META.other;
    return new StringSelectMenuOptionBuilder().setLabel(meta.label).setValue(id).setDescription(`${cmds.length} command${cmds.length === 1 ? '' : 's'}`).setEmoji(meta.icon);
  });

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Select a category to browse commands.'))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_cat').setPlaceholder('Select a category').addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function categoryView(client, guild, categoryId) {
  const meta = CATEGORY_META[categoryId] ?? CATEGORY_META.other;
  const commands = (groupByCategory(getChatInputCommands(client)).get(categoryId) ?? []).sort((a, b) => a.data.name.localeCompare(b.data.name));

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${meta.icon} ${meta.label}\n> Browse commands in this category.\n\n-# Press **Return to Help Menu** to go back.`,
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatarURL(client, guild)));

  const options = commands.slice(0, 25).map((cmd) => new StringSelectMenuOptionBuilder().setLabel(cmd.data.name).setValue(cmd.data.name).setDescription((cmd.data.description ?? 'No description.').slice(0, 100)));

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_back').setLabel('Return to Help Menu').setStyle(ButtonStyle.Secondary)))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Select a command to view details.'))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_cmd').setPlaceholder('Select a command').addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function subcommandView(client, guild, command, categoryId) {
  const json = command.data.toJSON();
  const entries = flattenEntries(json);
  const meta = CATEGORY_META[categoryId] ?? CATEGORY_META.other;

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${json.name}\n> ${json.description || 'No description.'}\n\n-# Press **Return to ${meta.label}** to go back.`,
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatarURL(client, guild)));

  const options = entries.slice(0, 25).map((e) => {
    const label = e.path.join(' ') || json.name;
    return new StringSelectMenuOptionBuilder().setLabel(label).setValue(e.path.join(' ')).setDescription((e.description ?? 'No description.').slice(0, 100));
  });

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`help_cmdback:${categoryId}`).setLabel(`Return to ${meta.label}`).setStyle(ButtonStyle.Secondary)))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('-# Select a subcommand to view details.'))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_sub').setPlaceholder('Select a subcommand').addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function detailView(client, guild, prefix, command, entry, categoryId) {
  const meta = CATEGORY_META[categoryId] ?? CATEGORY_META.other;
  const entries = flattenEntries(command.data.toJSON());
  const hasSubs = entries.length > 1 || entries[0].path.length > 0;

  const buttons = [];
  if (hasSubs) buttons.push(new ButtonBuilder().setCustomId(`help_subback:${categoryId}`).setLabel(`Return to ${command.data.name}`).setStyle(ButtonStyle.Secondary));
  buttons.push(new ButtonBuilder().setCustomId(`help_cmdback:${categoryId}`).setLabel(`Return to ${meta.label}`).setStyle(ButtonStyle.Secondary));

  const card = entryDetailCard(client, guild, prefix, command, entry, 0, entries.length).addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));
  return { components: [card], flags: MessageFlags.IsComponentsV2 };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Browse commands, or look one up directly.')
    .addStringOption((o) => o.setName('query').setDescription('A command (and optionally subcommand) to look up, e.g. "ticket category add"').setRequired(false)),
  aliases: ['h', 'hlp'],
  interactive: true,

  async execute(interaction) {
    const client = interaction.client;
    const guildConfig = await ensureGuild(interaction.guild.id);
    const prefix = guildConfig.prefix;

    const input = interaction.options.getString('query')?.trim();

    // ── Direct lookup: `!help <command>` (paginates every subcommand) or `!help <command> <sub...>` (single page) ──
    if (input) {
      const tokens = input.toLowerCase().split(/\s+/);
      const { command, entries } = findEntries(client, tokens);

      if (!command || !entries.length) {
        await interaction.reply({ components: [textCard(`${EMOJI.WARNING}  No command named \`${tokens[0]}\` found. Use \`${prefix}help\` to browse.`, 0xfed53c)], flags: MessageFlags.IsComponentsV2 });
        return;
      }

      if (entries.length === 1) {
        await interaction.reply({ components: [entryDetailCard(client, interaction.guild, prefix, command, entries[0])], flags: MessageFlags.IsComponentsV2 });
        return;
      }

      let page = 0;
      const msg = await interaction.reply({ components: [entryDetailCard(client, interaction.guild, prefix, command, entries[0], 0, entries.length), navRow(0, entries.length)], flags: MessageFlags.IsComponentsV2 });
      const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: TIMEOUT_MS });

      collector.on('collect', async (i) => {
        if (i.customId === 'help_close') {
          collector.stop('closed');
          await i.update({ components: [entryDetailCard(client, interaction.guild, prefix, command, entries[page], page, entries.length), navRow(page, entries.length, true)], flags: MessageFlags.IsComponentsV2 });
          return;
        }
        if (i.customId === 'help_prev') page = Math.max(0, page - 1);
        if (i.customId === 'help_next') page = Math.min(entries.length - 1, page + 1);
        await i.update({ components: [entryDetailCard(client, interaction.guild, prefix, command, entries[page], page, entries.length), navRow(page, entries.length)], flags: MessageFlags.IsComponentsV2 });
      });
      collector.on('end', (_c, reason) => {
        if (reason === 'closed' || reason === 'messageDelete') return;
        msg.edit({ components: [entryDetailCard(client, interaction.guild, prefix, command, entries[page], page, entries.length), navRow(page, entries.length, true)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      });
      return;
    }

    // ── Interactive browse: category -> command -> subcommand (if any) -> detail ──
    const msg = await interaction.reply(mainView(client, interaction.guild, prefix));
    let currentCategory = null;
    let currentCommand = null;

    const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: TIMEOUT_MS });

    collector.on('collect', async (i) => {
      if (i.customId === 'help_cat') {
        currentCategory = i.values[0];
        await i.update(categoryView(client, interaction.guild, currentCategory));
        return;
      }

      if (i.customId === 'help_back') {
        currentCategory = null;
        currentCommand = null;
        await i.update(mainView(client, interaction.guild, prefix));
        return;
      }

      if (i.customId === 'help_cmd') {
        const command = client.commands.get(i.values[0]);
        if (!command) {
          await i.deferUpdate();
          return;
        }
        currentCommand = command;
        const entries = flattenEntries(command.data.toJSON());
        if (entries.length === 1 && !entries[0].path.length) {
          await i.update(detailView(client, interaction.guild, prefix, command, entries[0], currentCategory));
        } else {
          await i.update(subcommandView(client, interaction.guild, command, currentCategory));
        }
        return;
      }

      if (i.customId === 'help_sub') {
        if (!currentCommand) {
          await i.deferUpdate();
          return;
        }
        const entries = flattenEntries(currentCommand.data.toJSON());
        const entry = entries.find((e) => e.path.join(' ') === i.values[0]);
        if (!entry) {
          await i.deferUpdate();
          return;
        }
        await i.update(detailView(client, interaction.guild, prefix, currentCommand, entry, currentCategory));
        return;
      }

      if (i.customId.startsWith('help_cmdback:')) {
        currentCommand = null;
        currentCategory = i.customId.split(':')[1];
        await i.update(categoryView(client, interaction.guild, currentCategory));
        return;
      }

      if (i.customId.startsWith('help_subback:')) {
        if (!currentCommand) {
          await i.deferUpdate();
          return;
        }
        currentCategory = i.customId.split(':')[1];
        await i.update(subcommandView(client, interaction.guild, currentCommand, currentCategory));
      }
    });

    collector.on('end', (_collected, reason) => {
      if (reason === 'messageDelete') return;
      const closedCard = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('Help menu closed (timed out). Run the command again to reopen it.'));
      msg.edit({ components: [closedCard], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });
  },
};
