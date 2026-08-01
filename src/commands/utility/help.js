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
  moderation: { label: 'Moderation', icon: '🔨' },
  config: { label: 'Configuration', icon: '⚙️' },
  utility: { label: 'Utility', icon: '🧰' },
  tickets: { label: 'Tickets', icon: '🎫' },
  misc: { label: 'Misc', icon: '🧩' },
  other: { label: 'Other', icon: '📄' },
};

// ── Introspection — built live from client.commands, never a hand-kept list ──

function getChatInputCommands(client) {
  return [...client.commands.values()].filter((c) => (c.data.toJSON().type ?? 1) === 1);
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

function buildSyntax(prefix, name, entry) {
  const parts = [`${prefix}${name}`, ...entry.path];
  for (const opt of entry.options) parts.push(opt.required ? `<${opt.name}>` : `[${opt.name}]`);
  return parts.join(' ');
}

function buildParams(entry) {
  if (!entry.options.length) return 'None';
  return entry.options.map((opt) => (opt.required ? `<${opt.name}>` : `[${opt.name}]`)).join(' ');
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

function entryDetailCard(prefix, command, entry) {
  const json = command.data.toJSON();
  const aliases = command.aliases?.length ? command.aliases.map((a) => `\`${prefix}${a}\``).join(', ') : 'None';
  const syntax = buildSyntax(prefix, json.name, entry);
  const title = [json.name, ...entry.path].join(' ');

  const lines = [
    `### Command: ${title}`,
    `> ${entry.description || json.description || 'No description.'}`,
    '',
    `**Aliases:** ${aliases}  ·  **Parameters:** ${buildParams(entry)}  ·  **Permission:** ${describePermissions(json.default_member_permissions)}`,
    '',
    '```',
    `Syntax: ${syntax}`,
    `Example: ${syntax} (defaults: None)`,
    '```',
    `-# Category: ${(CATEGORY_META[command.category] ?? CATEGORY_META.other).label}`,
  ];

  return new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
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

function mainView(client, prefix) {
  const commands = getChatInputCommands(client);
  const categories = groupByCategory(commands);

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`Use the command below to look up **${commands.length}** commands`),
      new TextDisplayBuilder().setContent(`\`${prefix}help [category | command]\``),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(client.user.displayAvatarURL({ size: 256 })));

  const options = [...categories.entries()].map(([id, cmds]) => {
    const meta = CATEGORY_META[id] ?? CATEGORY_META.other;
    return new StringSelectMenuOptionBuilder().setLabel(meta.label).setValue(id).setDescription(`${cmds.length} command${cmds.length === 1 ? '' : 's'}`).setEmoji(meta.icon);
  });

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent('You can also select a category below.'))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_cat').setPlaceholder('Select a category').addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function categoryView(client, categoryId) {
  const meta = CATEGORY_META[categoryId] ?? CATEGORY_META.other;
  const commands = (groupByCategory(getChatInputCommands(client)).get(categoryId) ?? []).sort((a, b) => a.data.name.localeCompare(b.data.name));

  const text = `### ${meta.icon} ${meta.label}\nSelect a command to see its usage.`;
  const options = commands.slice(0, 25).map((cmd) => new StringSelectMenuOptionBuilder().setLabel(cmd.data.name).setValue(cmd.data.name).setDescription((cmd.data.description ?? 'No description.').slice(0, 100)));

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_back').setLabel('Return to Help Menu').setStyle(ButtonStyle.Secondary)))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_cmd').setPlaceholder('Select a command').addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function subcommandView(command, categoryId) {
  const json = command.data.toJSON();
  const entries = flattenEntries(json);
  const meta = CATEGORY_META[categoryId] ?? CATEGORY_META.other;

  const text = `### ${json.name}\n> ${json.description || 'No description.'}\n\n-# Select a subcommand to view details.`;
  const options = entries.slice(0, 25).map((e) => {
    const label = e.path.join(' ') || json.name;
    return new StringSelectMenuOptionBuilder().setLabel(label).setValue(e.path.join(' ')).setDescription((e.description ?? 'No description.').slice(0, 100));
  });

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`help_cmdback:${categoryId}`).setLabel(`Return to ${meta.label}`).setStyle(ButtonStyle.Secondary)))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_sub').setPlaceholder('Select a subcommand').addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function detailView(prefix, command, entry, categoryId) {
  const meta = CATEGORY_META[categoryId] ?? CATEGORY_META.other;
  const entries = flattenEntries(command.data.toJSON());
  const hasSubs = entries.length > 1 || entries[0].path.length > 0;

  const buttons = [];
  if (hasSubs) buttons.push(new ButtonBuilder().setCustomId(`help_subback:${categoryId}`).setLabel(`Return to ${command.data.name}`).setStyle(ButtonStyle.Secondary));
  buttons.push(new ButtonBuilder().setCustomId(`help_cmdback:${categoryId}`).setLabel(`Return to ${meta.label}`).setStyle(ButtonStyle.Secondary));

  const card = entryDetailCard(prefix, command, entry).addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));
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
        await interaction.reply({ components: [textCard(`${EMOJI.DENY}  No command named \`${tokens[0]}\` found. Use \`${prefix}help\` to browse.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
        return;
      }

      if (entries.length === 1) {
        await interaction.reply({ components: [entryDetailCard(prefix, command, entries[0])], flags: MessageFlags.IsComponentsV2 });
        return;
      }

      let page = 0;
      const msg = await interaction.reply({ components: [entryDetailCard(prefix, command, entries[0]), navRow(0, entries.length)], flags: MessageFlags.IsComponentsV2 });
      const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: TIMEOUT_MS });

      collector.on('collect', async (i) => {
        if (i.customId === 'help_close') {
          collector.stop('closed');
          await i.update({ components: [entryDetailCard(prefix, command, entries[page]), navRow(page, entries.length, true)], flags: MessageFlags.IsComponentsV2 });
          return;
        }
        if (i.customId === 'help_prev') page = Math.max(0, page - 1);
        if (i.customId === 'help_next') page = Math.min(entries.length - 1, page + 1);
        await i.update({ components: [entryDetailCard(prefix, command, entries[page]), navRow(page, entries.length)], flags: MessageFlags.IsComponentsV2 });
      });
      collector.on('end', (_c, reason) => {
        if (reason === 'closed' || reason === 'messageDelete') return;
        msg.edit({ components: [entryDetailCard(prefix, command, entries[page]), navRow(page, entries.length, true)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      });
      return;
    }

    // ── Interactive browse: category -> command -> subcommand (if any) -> detail ──
    const msg = await interaction.reply(mainView(client, prefix));
    let currentCategory = null;
    let currentCommand = null;

    const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: TIMEOUT_MS });

    collector.on('collect', async (i) => {
      if (i.customId === 'help_cat') {
        currentCategory = i.values[0];
        await i.update(categoryView(client, currentCategory));
        return;
      }

      if (i.customId === 'help_back') {
        currentCategory = null;
        currentCommand = null;
        await i.update(mainView(client, prefix));
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
          await i.update(detailView(prefix, command, entries[0], currentCategory));
        } else {
          await i.update(subcommandView(command, currentCategory));
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
        await i.update(detailView(prefix, currentCommand, entry, currentCategory));
        return;
      }

      if (i.customId.startsWith('help_cmdback:')) {
        currentCommand = null;
        currentCategory = i.customId.split(':')[1];
        await i.update(categoryView(client, currentCategory));
        return;
      }

      if (i.customId.startsWith('help_subback:')) {
        if (!currentCommand) {
          await i.deferUpdate();
          return;
        }
        currentCategory = i.customId.split(':')[1];
        await i.update(subcommandView(currentCommand, currentCategory));
      }
    });

    collector.on('end', (_collected, reason) => {
      if (reason === 'messageDelete') return;
      msg.edit({ components: [textCard('Help menu closed (timed out). Run the command again to reopen it.', 0x8399ff)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });
  },
};
