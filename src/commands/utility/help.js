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
const { helpLinksLine, DASHBOARD_URL, SUPPORT_URL, WIKI_URL } = require('../../utils/links');
const { isSlashCommand } = require('../../handlers/commandHandler');
const { t, tn, commandDescription, languageOf, currentLanguage, LANGUAGES, LANGUAGE_NAMES } = require('../../i18n');

const TIMEOUT_MS = 120_000;

// The name of each category is `help.category.<id>.menu` and what it is for, in a few words, `help.blurb.<id>.menu`: shown in
// the menus so nobody has to open one to find out.
const CATEGORY_ICONS = {
  moderation: '<:pe_mod:1533209776862003313>',
  info: '<:pe_info:1533209774370328800>',
  welcome: '<:pe_welcome:1533211251705118875>',
  automation: '<:pe_auto:1533211330734194810>',
  leveling: '<:pe_le:1533211745584156934>',
  giveaways: '<:pe_give:1533211659911303358>',
  tickets: '<:pe_tickets:1533209775699922974>',
  config: '<:pe_config:1533209778438934609>',
  // Placeholder mapping: this code was labeled "pe_info" again (likely a copy-paste rename
  // slip when uploading) but the wrench glyph reads as utility — flagged for confirmation.
  utility: '<:pe_info:1533209779751616676>',
  misc: '<:pe_misc:1533209781345587374>',
  roleplay: '<:011Heart:1556773944336580720>',
  fun: '<:Icon_Dice:1556773972442349568>',
  other: '📄',
};

const knownCategory = (id) => Object.hasOwn(CATEGORY_ICONS, id);

/** The icon and name of a category (an unknown one is shown as "Other"). */
function categoryMeta(id, lang) {
  const known = knownCategory(id) ? id : 'other';
  return { icon: CATEGORY_ICONS[known], label: t(lang, `help.category.${known}.menu`) };
}

/** What a category is for, or null for a category Petto does not describe. */
function categoryBlurb(id, lang) {
  return knownCategory(id) ? t(lang, `help.blurb.${id}.menu`) : null;
}

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

/** The commands of a list that also work as slash commands, by name. */
const slashNames = (commands) => commands.filter((command) => isSlashCommand(command)).map((command) => command.data.name).sort();

/** The dashboard, the docs and the support server, as link buttons under the menus. */
function linksRow(lang) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel(t(lang, 'core.join.dashboard.button')).setStyle(ButtonStyle.Link).setURL(DASHBOARD_URL),
    new ButtonBuilder().setLabel(t(lang, 'core.join.docs.button')).setStyle(ButtonStyle.Link).setURL(WIKI_URL),
    new ButtonBuilder().setLabel(t(lang, 'core.join.support.button')).setStyle(ButtonStyle.Link).setURL(SUPPORT_URL),
  );
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

function buildParams(entry, lang) {
  if (!entry.options.length) return t(lang, 'help.detail.none');
  return entry.options.map((opt) => (opt.required ? `<${opt.name}>` : `[${opt.name}]`)).join(' ');
}

const EXAMPLE_BY_NAME = {
  duration: '1h', time: '10m', hex: '#ff91c2', color: '#ff91c2', emoji: '🌸', code: 'ABC123', query: 'ticket', days: '7', amount: '10', prize: '"Nitro"',
};
// Examples written in words, so they are in the language of the server: option name -> `help.example.<key>`.
const WORDED_EXAMPLE = { reason: 'reason', message: 'text', text: 'text', name: 'name', template: 'template', title: 'title', description: 'description' }; // i18n-ignore: option names -> catalog key parts

/** A believable value for an option, from its type and its name, so an example can be copied and used. */
function exampleValue(opt, lang) {
  if (opt.choices?.length) return String(opt.choices[0].value);
  if (opt.type === 6) return t(lang, 'help.example.member');
  if (opt.type === 8) return t(lang, 'help.example.role');
  if (opt.type === 7) return t(lang, 'help.example.channel');
  if (opt.type === 9) return t(lang, 'help.example.member');
  if (opt.type === 5) return 'true';
  if (opt.type === 4 || opt.type === 10) return String(opt.min_value ?? 1);
  if (Object.hasOwn(WORDED_EXAMPLE, opt.name)) return t(lang, `help.example.${WORDED_EXAMPLE[opt.name]}`);
  return EXAMPLE_BY_NAME[opt.name] ?? opt.name;
}

function buildExample(prefix, name, entry, lang) {
  const parts = [`${prefix}${name}`, ...entry.path];
  for (const opt of entry.options) {
    const sample = exampleValue(opt, lang);
    if (opt.required) parts.push(sample);
  }
  return parts.join(' ');
}

function buildMetadata(aliases, params, information, lang) {
  const aliasesLabel = `**${t(lang, 'help.detail.aliases')}**`;
  const paramsLabel = `**${t(lang, 'help.detail.parameters')}**`;
  const informationLabel = `**${t(lang, 'help.detail.information')}**`;
  // A spaced three-column row is compact, but Discord wraps it unpredictably once
  // the parameter syntax gets long. Stack the fields before that happens so the
  // warning emoji and permission label always stay together.
  if (aliases.length > 18 || params.length > 28 || information.length > 24) {
    return [
      aliasesLabel, aliases,
      '',
      paramsLabel, `\`${params}\``,
      '',
      informationLabel, information,
    ].join('\n');
  }
  return [
    `${aliasesLabel}                 ${paramsLabel}                 ${informationLabel}`,
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

function entryDetailCard(client, guild, prefix, command, entry, page = 0, total = 1, lang = currentLanguage()) {
  const json = command.data.toJSON();
  const commandPrefix = command.slashOnly ? '/' : prefix;
  const entryPath = entry.path.join(' ');
  const routeAliases = (command.prefixRoutes ?? [])
    .filter((route) => route.subcommand === entryPath)
    .map((route) => route.alias);
  const aliasesList = [...new Set([...(command.aliases ?? []), ...routeAliases])];
  const aliases = aliasesList.length ? aliasesList.map((a) => `\`${prefix}${a}\``).join(', ') : t(lang, 'help.detail.none');
  const syntax = buildSyntax(commandPrefix, json.name, entry);
  const example = buildExample(commandPrefix, json.name, entry, lang);
  // A command that works both ways shows its slash form too.
  const slash = !command.slashOnly && isSlashCommand(command) ? buildSyntax('/', json.name, entry) : null;
  const params = buildParams(entry, lang);
  const information = json.default_member_permissions == null ? t(lang, 'help.detail.anyone') : `${EMOJI.WARNING} ${describePermissions(json.default_member_permissions, lang)}`;
  const title = [json.name, ...entry.path].join(' ');
  const moduleLabel = categoryMeta(command.category, lang).label;
  const description = commandDescription(lang, command, entry.path, null, entry.description)
    || commandDescription(lang, command, [], null, json.description)
    || t(lang, 'help.noDescription');

  const text = [
    t(lang, 'help.detail.title', { title }),
    `> ${description}`,
    '',
    buildMetadata(aliases, params, information, lang),
    '',
    `**${t(lang, 'help.detail.usage')}**`,
    slash ? t(lang, 'help.detail.usageBlockSlash', { syntax, slash, example }) : t(lang, 'help.detail.usageBlock', { syntax, example }),
    total > 1 ? t(lang, 'help.detail.footerPaged', { page: page + 1, total, module: moduleLabel }) : t(lang, 'help.detail.footer', { module: moduleLabel }),
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

function mainView(client, guild, prefix, includeHidden = false, lang = currentLanguage()) {
  const commands = getChatInputCommands(client, includeHidden);
  const categories = groupByCategory(commands);

  const section = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${t(lang, 'help.main.intro', { count: commands.length, prefix })}\n${t(lang, 'help.main.slash', { count: slashNames(commands).length, prefix })}`))
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatarURL(client, guild)));

  const options = [...categories.entries()].map(([id, cmds]) => {
    const meta = categoryMeta(id, lang);
    const blurb = categoryBlurb(id, lang);
    const count = tn(lang, 'help.main.commands', cmds.length);
    const description = blurb ? t(lang, 'help.main.option.menu', { blurb, commands: count }) : count;
    return new StringSelectMenuOptionBuilder().setLabel(meta.label).setValue(id).setDescription(description.slice(0, 100)).setEmoji(meta.icon);
  });

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${t(lang, 'help.main.footer', { links: helpLinksLine(lang) })}\n${t(lang, 'help.main.languages', { language: LANGUAGE_NAMES[lang], list: LANGUAGES.map((code) => LANGUAGE_NAMES[code]).join(', '), prefix })}`))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_cat').setPlaceholder(t(lang, 'help.main.placeholder.menu')).addOptions(options)))
    .addActionRowComponents(linksRow(lang));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function categoryView(client, guild, categoryId, includeHidden = false, lang = currentLanguage()) {
  const meta = categoryMeta(categoryId, lang);
  const commands = (groupByCategory(getChatInputCommands(client, includeHidden)).get(categoryId) ?? []).sort((a, b) => a.data.name.localeCompare(b.data.name));
  // Which of them also work with `/`: all of them, some (named) or none (nothing is said).
  const slash = slashNames(commands);
  const slashLine = !slash.length ? '' : slash.length === commands.length
    ? `\n${t(lang, 'help.category.slashAll')}`
    : `\n${t(lang, 'help.category.slash', { list: slash.map((name) => `\`/${name}\``).join(', ') })}`;

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        tn(lang, 'help.category.text', commands.length, { icon: meta.icon, label: meta.label, blurb: categoryBlurb(categoryId, lang) ?? t(lang, 'help.category.fallbackBlurb') })
          + slashLine
          + (categoryId === 'config' ? `\n${t(lang, 'help.category.languages', { language: LANGUAGE_NAMES[lang], list: LANGUAGES.map((code) => LANGUAGE_NAMES[code]).join(', ') })}` : ''),
      ),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatarURL(client, guild)));

  const options = commands.slice(0, 25).map((cmd) => new StringSelectMenuOptionBuilder().setLabel(cmd.data.name).setValue(cmd.data.name).setDescription(commandDescription(lang, cmd, [], null, cmd.data.description ?? t(lang, 'help.noDescription')).slice(0, 100)));

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('help_back').setLabel(t(lang, 'help.back.main.button')).setStyle(ButtonStyle.Secondary)))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(commands.length > 25 ? t(lang, 'help.category.pickMore', { total: commands.length }) : t(lang, 'help.category.pick')))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_cmd').setPlaceholder(t(lang, 'help.category.placeholder.menu')).addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function subcommandView(client, guild, command, categoryId, includeHidden = false, lang = currentLanguage()) {
  const json = command.data.toJSON();
  const entries = visibleEntries(command, includeHidden);
  const meta = categoryMeta(categoryId, lang);
  const description = commandDescription(lang, command, [], null, json.description) || t(lang, 'help.noDescription');

  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(tn(lang, 'help.sub.text', entries.length, { name: json.name, description, label: meta.label })),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(botAvatarURL(client, guild)));

  const options = entries.slice(0, 25).map((e) => {
    const label = e.path.join(' ') || json.name;
    return new StringSelectMenuOptionBuilder().setLabel(label).setValue(e.path.join(' ')).setDescription(commandDescription(lang, command, e.path, null, e.description ?? t(lang, 'help.noDescription')).slice(0, 100));
  });

  const container = new ContainerBuilder()
    .addSectionComponents(section)
    .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`help_cmdback:${categoryId}`).setLabel(t(lang, 'help.back.to.button', { name: meta.label })).setStyle(ButtonStyle.Secondary)))
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(entries.length > 25 ? t(lang, 'help.sub.pickMore', { total: entries.length, name: json.name }) : t(lang, 'help.sub.pick')))
    .addActionRowComponents(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('help_sub').setPlaceholder(t(lang, 'help.sub.placeholder.menu')).addOptions(options)));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function detailView(client, guild, prefix, command, entry, categoryId, includeHidden = false, lang = currentLanguage()) {
  const meta = categoryMeta(categoryId, lang);
  const entries = visibleEntries(command, includeHidden);
  const hasSubs = entries.length > 1 || entries[0].path.length > 0;

  const buttons = [];
  if (hasSubs) buttons.push(new ButtonBuilder().setCustomId(`help_subback:${categoryId}`).setLabel(t(lang, 'help.back.to.button', { name: command.data.name })).setStyle(ButtonStyle.Secondary));
  buttons.push(new ButtonBuilder().setCustomId(`help_cmdback:${categoryId}`).setLabel(t(lang, 'help.back.to.button', { name: meta.label })).setStyle(ButtonStyle.Secondary));

  const card = entryDetailCard(client, guild, prefix, command, entry, 0, entries.length, lang).addActionRowComponents(new ActionRowBuilder().addComponents(...buttons));
  return { components: [card], flags: MessageFlags.IsComponentsV2 };
}

module.exports = {
  // Also registered as a slash command (one of the everyday ones people look for with `/`); the prefix keeps working.
  registerSlash: true,
  data: new SlashCommandBuilder()
    .setName('help')
    .setDMPermission(false)
    .setDescription('Browse commands, or look one up directly.')
    .addStringOption((o) => o.setName('query').setDescription('A command (and optionally subcommand) to look up, e.g. "ticket category add"').setRequired(false)),
  aliases: ['h', 'hlp'],
  interactive: true,

  async execute(interaction) {
    // Computed once: the collectors below answer outside of the command's language context.
    const lang = await languageOf(interaction);
    const client = interaction.client;
    const guildConfig = await ensureGuild(interaction.guild.id);
    const prefix = guildConfig.prefix;
    // Private/operator commands stay hidden for normal users, but developers
    // configured through PETTO_DEVELOPER_IDS need to discover every tool.
    const includeHidden = isPettoOperator(interaction.user?.id);

    // As a slash command the menus are private (only the person who asked can use them anyway); the prefix drops the flag.
    const PRIVATE = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
    const input = interaction.options.getString('query')?.trim();
    if (input) {
      const tokens = input.toLowerCase().split(/\s+/);
      const { command, entries } = findEntries(client, tokens, includeHidden);

      if (!command || !entries.length) {
        const suggestions = suggestCommands(client, tokens[0], includeHidden).map((name) => `\`${prefix}help ${name}\``).join(', ');
        const vars = { emoji: EMOJI.WARNING, command: tokens[0], prefix, suggestions };
        await interaction.reply({ components: [textCard(t(lang, suggestions ? 'help.notFoundSuggest' : 'help.notFound', vars))], flags: PRIVATE });
        return;
      }

      if (entries.length === 1) {
        await interaction.reply({ components: [entryDetailCard(client, interaction.guild, prefix, command, entries[0], 0, 1, lang)], flags: PRIVATE });
        return;
      }

      let page = 0;
      const msg = await interaction.reply({ components: [entryDetailCard(client, interaction.guild, prefix, command, entries[0], 0, entries.length, lang), navRow(0, entries.length)], flags: PRIVATE });
      const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: TIMEOUT_MS });

      collector.on('collect', async (i) => {
        if (i.customId === 'help_close') {
          collector.stop('closed');
          await i.update({ components: [entryDetailCard(client, interaction.guild, prefix, command, entries[page], page, entries.length, lang), navRow(page, entries.length, true)], flags: MessageFlags.IsComponentsV2 });
          return;
        }
        if (i.customId === 'help_prev') page = Math.max(0, page - 1);
        if (i.customId === 'help_next') page = Math.min(entries.length - 1, page + 1);
        await i.update({ components: [entryDetailCard(client, interaction.guild, prefix, command, entries[page], page, entries.length, lang), navRow(page, entries.length)], flags: MessageFlags.IsComponentsV2 });
      });
      collector.on('end', (_c, reason) => {
        if (reason === 'closed' || reason === 'messageDelete') return;
        msg.edit({ components: [entryDetailCard(client, interaction.guild, prefix, command, entries[page], page, entries.length, lang), navRow(page, entries.length, true)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      });
      return;
    }
    const msg = await interaction.reply({ ...mainView(client, interaction.guild, prefix, includeHidden, lang), flags: PRIVATE });
    let currentCategory = null;
    let currentCommand = null;

    const collector = msg.createMessageComponentCollector({ filter: (i) => i.user.id === interaction.user.id, time: TIMEOUT_MS });

    collector.on('collect', async (i) => {
      if (i.customId === 'help_cat') {
        currentCategory = i.values[0];
        await i.update(categoryView(client, interaction.guild, currentCategory, includeHidden, lang));
        return;
      }

      if (i.customId === 'help_back') {
        currentCategory = null;
        currentCommand = null;
        await i.update(mainView(client, interaction.guild, prefix, includeHidden, lang));
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
          await i.update(detailView(client, interaction.guild, prefix, command, entries[0], currentCategory, includeHidden, lang));
        } else {
          await i.update(subcommandView(client, interaction.guild, command, currentCategory, includeHidden, lang));
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
        await i.update(detailView(client, interaction.guild, prefix, currentCommand, entry, currentCategory, includeHidden, lang));
        return;
      }

      if (i.customId.startsWith('help_cmdback:')) {
        currentCommand = null;
        currentCategory = i.customId.split(':')[1];
        await i.update(categoryView(client, interaction.guild, currentCategory, includeHidden, lang));
        return;
      }

      if (i.customId.startsWith('help_subback:')) {
        if (!currentCommand) {
          await i.deferUpdate();
          return;
        }
        currentCategory = i.customId.split(':')[1];
        await i.update(subcommandView(client, interaction.guild, currentCommand, currentCategory, includeHidden, lang));
      }
    });

    collector.on('end', (_collected, reason) => {
      if (reason === 'messageDelete') return;
      const closedCard = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'help.closed')));
      msg.edit({ components: [closedCard], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    });
  },
};

// The main menu and a category page, drawn by scripts/check-i18n-panels.js in every language.
module.exports.mainView = mainView;
module.exports.categoryView = categoryView;
