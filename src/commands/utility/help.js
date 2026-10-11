// Builds the interactive help browser from the loaded command catalog.
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
const { isPettoOperator } = require('../../utils/autoModControl');
const { helpLinksLine } = require('../../utils/links');

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
  roleplay: { label: 'Roleplay', icon: '<:011Heart:1556773944336580720>' },
  fun: { label: 'Fun', icon: '<:Icon_Dice:1556773972442349568>' },
  other: { label: 'Other', icon: '📄' },
};

// What each category is for, in a few words: shown in the menus so nobody has to open one to find out.
const CATEGORY_BLURBS = {
  moderation: 'Bans, mutes, warns, jail, cases and cleaning up',
  info: 'Look up members, the server, roles and the bot',
  welcome: 'Greetings, join and leave messages, join roles',
  automation: 'Starboard, timers, counters, panels and auto roles',
  leveling: 'XP, levels, rank cards, rewards and leaderboards',
  giveaways: 'Run giveaways, presets and templates',
  tickets: 'Support tickets, categories, forms and transcripts',
  config: 'Prefix, aliases, permissions and how Petto looks',
  utility: 'Reminders, polls, quests, booster roles and tools',
  misc: 'Smaller commands that do not fit anywhere else',
  roleplay: 'Hugs, pats and other reactions with a gif',
  fun: 'Games and light-hearted commands',
  other: 'Everything else',
};

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/** Up to three command names close to what was typed (it starts the same, contains it, or is a couple of letters off). */
function suggestCommands(client, typed, includeHidden = false) {
  const word = String(typed ?? '').toLowerCase();
  if (!word) return [];
  const names = getChatInputCommands(client, includeHidden).map((command) => command.data.name);
  const scored = names.map((name) => {
    const distance = editDistance(word, name);
    const score = name.startsWith(word) ? 0 : name.includes(word) ? 1 : distance <= 2 ? 2 + distance : null;
    return { name, score };
  }).filter((entry) => entry.score !== null);
  return scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).slice(0, 3).map((entry) => entry.name);
}

function getChatInputCommands(client, includeHidden = false) {
  return [...client.commands.values()].filter((c) => (
    (c.data.toJSON().type ?? 1) === 1
    && (includeHidden || (!c.slashOnly && !c.hiddenFromHelp))
  ));
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

function visibleEntries(command, includeHidden = false) {
  const hidden = new Set(command.hiddenPrefixSubcommands ?? []);
  return flattenEntries(command.data.toJSON()).filter((entry) => includeHidden || !hidden.has(entry.path.join(' ')));
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

const EXAMPLE_BY_NAME = {
  reason: '"spamming links"', message: '"hello everyone"', text: '"hello everyone"', duration: '1h', time: '10m', name: 'my-name', template: 'my-embed',
  hex: '#ff91c2', color: '#ff91c2', emoji: '🌸', code: 'ABC123', query: 'ticket', days: '7', amount: '10', prize: '"Nitro"', title: '"Welcome"', description: '"A short text"',
};

/** A believable value for an option, from its type and its name, so an example can be copied and used. */
function exampleValue(opt) {
  if (opt.choices?.length) return String(opt.choices[0].value);
  if (opt.type === 6) return '@member';
  if (opt.type === 8) return '@role';
  if (opt.type === 7) return '#channel';
  if (opt.type === 9) return '@member';
  if (opt.type === 5) return 'true';
  if (opt.type === 4 || opt.type === 10) return String(opt.min_value ?? 1);
  return EXAMPLE_BY_NAME[opt.name] ?? opt.name;
}

function buildExample(prefix, name, entry) {
  const parts = [`${prefix}${name}`, ...entry.path];
  for (const opt of entry.options) {
    const sample = exampleValue(opt);
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
function findEntries(client, tokens, includeHidden = false) {
  const route = client.commandRoutes?.get(tokens[0]);
  const canonicalName = client.commandAliases.get(tokens[0]) ?? route?.command ?? tokens[0];
  const command = client.commands.get(canonicalName);
  if (!command || (!includeHidden && (command.slashOnly || command.hiddenFromHelp)) || (command.data.toJSON().type ?? 1) !== 1) return { command: null, entries: [] };

  const json = command.data.toJSON();
  const all = visibleEntries(command, includeHidden);
  const wantedPath = [...(route?.args ?? []), ...tokens.slice(1)].join(' ');

  if (!wantedPath) return { command, entries: all };

  const exact = all.find((e) => e.path.join(' ') === wantedPath);
  if (exact) return { command, entries: [exact] };

  const partial = all.filter((e) => e.path.join(' ').startsWith(wantedPath));
  return { command, entries: partial };
}

function entryDetailCard(client, guild, prefix, command, entry, page = 0, total = 1) {
  const json = command.data.toJSON();
  const commandPrefix = command.slashOnly ? '/' : prefix;
  const entryPath = entry.path.join(' ');
  const routeAliases = (command.prefixRoutes ?? [])
    .filter((route) => route.subcommand === entryPath)
    .map((route) => route.alias);
  const aliasesList = [...new Set([...(command.aliases ?? []), ...routeAliases])];
  const aliases = aliasesList.length ? aliasesList.map((a) => `\`${prefix}${a}\``).join(', ') : 'None';
  const syntax = buildSyntax(commandPrefix, json.name, entry);
  const example = buildExample(commandPrefix, json.name, entry);
  const params = buildParams(entry);
  const information = json.default_member_permissions == null ? 'Anyone can use it' : `${EMOJI.WARNING} ${describePermissions(json.default_member_permissions)}`;
  const title = [json.name, ...entry.path].join(' ');
  const moduleLabel = (CATEGORY_META[command.category] ?? CATEGORY_META.other).label;

  const text = [
    `### Command: ${title}`,
    `> ${entry.description || json.description || 'No description yet.'}`,
    '',
    buildMetadata(aliases, params, information),
    '',
    '**Usage**',
    `\`\`\`Ruby\nSyntax: ${syntax}\nExample: ${example}\n\`\`\``,
    `-# <required> [optional] · ${total > 1 ? `Entry ${page + 1} of ${total} · ` : ''}${moduleLabel}`,
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

function mainView(client, guild, prefix, includeHidden = false) {
  const commands = getChatInputCommands(client, includeHidden);
  const categories = groupByCategory(commands);

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Petto has ${commands.length} commands.** Pick a category below, or look one up directly:\n` +
          `\`\`\`lua\n${prefix}help [category | command]\n\`\`\`` +
          `\n-# For example \`${prefix}help ban\` or \`${prefix}help ticket category add\`. Aliases work too.`,
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatarURL(client, guild)));

  const options = [...categories.entries()].map(([id, cmds]) => {
    const meta = CATEGORY_META[id] ?? CATEGORY_META.other;
    return new StringSelectMenuOptionBuilder().setLabel(meta.label).setValue(id).setDescription(`${CATEGORY_BLURBS[id] ? `${CATEGORY_BLURBS[id]} · ` : ''}${cmds.length} command${cmds.length === 1 ? '' : 's'}`.slice(0, 100)).setEmoji(meta.icon);
  });

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Select a category to browse its commands.\n${helpLinksLine()}`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_cat').setPlaceholder('Select a category').addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function categoryView(client, guild, categoryId, includeHidden = false) {
  const meta = CATEGORY_META[categoryId] ?? CATEGORY_META.other;
  const commands = (groupByCategory(getChatInputCommands(client, includeHidden)).get(categoryId) ?? []).sort((a, b) => a.data.name.localeCompare(b.data.name));

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${meta.icon} ${meta.label}\n> ${CATEGORY_BLURBS[categoryId] ?? 'Commands of this category.'}.\n\n-# ${commands.length} command${commands.length === 1 ? '' : 's'}. Press **Return to Help Menu** to go back.`,
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatarURL(client, guild)));

  const options = commands.slice(0, 25).map((cmd) => new StringSelectMenuOptionBuilder().setLabel(cmd.data.name).setValue(cmd.data.name).setDescription((cmd.data.description ?? 'No description yet.').slice(0, 100)));

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_back').setLabel('Return to Help Menu').setStyle(ButtonStyle.Secondary)))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Select a command to see how it works${commands.length > 25 ? ` (showing the first 25 of ${commands.length}; look up the rest with \`help <command>\`)` : ''}.`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_cmd').setPlaceholder('Select a command').addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function subcommandView(client, guild, command, categoryId, includeHidden = false) {
  const json = command.data.toJSON();
  const entries = visibleEntries(command, includeHidden);
  const meta = CATEGORY_META[categoryId] ?? CATEGORY_META.other;

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${json.name}\n> ${json.description || 'No description yet.'}\n\n-# ${entries.length} subcommand${entries.length === 1 ? '' : 's'}. Press **Return to ${meta.label}** to go back.`,
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatarURL(client, guild)));

  const options = entries.slice(0, 25).map((e) => {
    const label = e.path.join(' ') || json.name;
    return new StringSelectMenuOptionBuilder().setLabel(label).setValue(e.path.join(' ')).setDescription((e.description ?? 'No description yet.').slice(0, 100));
  });

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`help_cmdback:${categoryId}`).setLabel(`Return to ${meta.label}`).setStyle(ButtonStyle.Secondary)))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Select a subcommand to see its syntax and an example${entries.length > 25 ? ` (showing the first 25 of ${entries.length}; look up the rest with \`help ${json.name} <subcommand>\`)` : ''}.`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_sub').setPlaceholder('Select a subcommand').addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function detailView(client, guild, prefix, command, entry, categoryId, includeHidden = false) {
  const meta = CATEGORY_META[categoryId] ?? CATEGORY_META.other;
  const entries = visibleEntries(command, includeHidden);
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
    // Private/operator commands stay hidden for normal users, but developers
    // configured through PETTO_DEVELOPER_IDS need to discover every tool.
    const includeHidden = isPettoOperator(interaction.user?.id);

    const input = interaction.options.getString('query')?.trim();
    if (input) {
      const tokens = input.toLowerCase().split(/\s+/);
      const { command, entries } = findEntries(client, tokens, includeHidden);

      if (!command || !entries.length) {
        await interaction.reply({ components: [textCard(`${EMOJI.WARNING}  I could not find a command named \`${tokens[0]}\`.${suggestCommands(client, tokens[0], includeHidden).length ? ` Did you mean ${suggestCommands(client, tokens[0], includeHidden).map((name) => `\`${prefix}help ${name}\``).join(', ')}?` : ''} Use \`${prefix}help\` to browse every command.`, 0xfed53c)], flags: MessageFlags.IsComponentsV2 });
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
    const msg = await interaction.reply(mainView(client, interaction.guild, prefix, includeHidden));
    let currentCategory = null;
    let currentCommand = null;

    const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: TIMEOUT_MS });

    collector.on('collect', async (i) => {
      if (i.customId === 'help_cat') {
        currentCategory = i.values[0];
        await i.update(categoryView(client, interaction.guild, currentCategory, includeHidden));
        return;
      }

      if (i.customId === 'help_back') {
        currentCategory = null;
        currentCommand = null;
        await i.update(mainView(client, interaction.guild, prefix, includeHidden));
        return;
      }

      if (i.customId === 'help_cmd') {
        const command = client.commands.get(i.values[0]);
        if (!command) {
          await i.deferUpdate();
          return;
        }
        currentCommand = command;
        const entries = visibleEntries(command, includeHidden);
        if (entries.length === 1 && !entries[0].path.length) {
          await i.update(detailView(client, interaction.guild, prefix, command, entries[0], currentCategory, includeHidden));
        } else {
          await i.update(subcommandView(client, interaction.guild, command, currentCategory, includeHidden));
        }
        return;
      }

      if (i.customId === 'help_sub') {
        if (!currentCommand) {
          await i.deferUpdate();
          return;
        }
        const entries = visibleEntries(currentCommand, includeHidden);
        const entry = entries.find((e) => e.path.join(' ') === i.values[0]);
        if (!entry) {
          await i.deferUpdate();
          return;
        }
        await i.update(detailView(client, interaction.guild, prefix, currentCommand, entry, currentCategory, includeHidden));
        return;
      }

      if (i.customId.startsWith('help_cmdback:')) {
        currentCommand = null;
        currentCategory = i.customId.split(':')[1];
        await i.update(categoryView(client, interaction.guild, currentCategory, includeHidden));
        return;
      }

      if (i.customId.startsWith('help_subback:')) {
        if (!currentCommand) {
          await i.deferUpdate();
          return;
        }
        currentCategory = i.customId.split(':')[1];
        await i.update(subcommandView(client, interaction.guild, currentCommand, currentCategory, includeHidden));
      }
    });

    collector.on('end', (_collected, reason) => {
      if (reason === 'messageDelete') return;
      const closedCard = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent('This help menu closed after two minutes without use. Run the help command again to open it.'));
      msg.edit({ components: [closedCard], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });
  },
};
