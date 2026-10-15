// The commands of a reaction board (`/starboard`, `/monkeyboard`): the same subcommands over the board's own storage and words.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getTemplate } = require('../db/embedTemplates');
const { textCard } = require('./caseCard');
const { t, languageOf } = require('../i18n');

const GREEN = 0xa5ea7a;
const RED = 0xff6b6b;
const GREY = 0x4b4f59;

/**
 * `name` and `label` ("Starboard") say what the board is called, `db` is its storage (db/boardStore.js), `selfName` is the name of the
 * subcommand that lets an author count their own reaction, `variable` is the start of the variables of its reposts (`star`, `monkey`) and
 * `description` is what the command says it is.
 */
function createBoardCommand({ name, label, aliases = [], db, description, selfName = 'selfstar', variable = 'star' }) {
  const lower = label.toLowerCase();
  const reply = (interaction, text, color) => interaction.reply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });

  async function enable(interaction, lang) {
    const current = await db.ensureConfig(interaction.guild.id);
    return reply(interaction, current.channel_id ? t(lang, 'automation.board.enabledIn', { label, channel: `<#${current.channel_id}>` }) : t(lang, 'automation.board.enabled', { label, name }), GREEN);
  }

  async function disable(interaction, lang) {
    await db.disable(interaction.guild.id);
    return reply(interaction, t(lang, 'automation.board.disabled', { label }), GREEN);
  }

  async function update(interaction, changes, lang) {
    const row = await db.updateConfig(interaction.guild.id, changes);
    const vars = { label, threshold: row.threshold, emoji: row.emoji, channel: `<#${row.channel_id}>` };
    return reply(interaction, t(lang, row.channel_id ? 'automation.board.updatedChannel' : 'automation.board.updated', vars), GREEN);
  }

  async function setMessage(interaction, lang) {
    const template = String(interaction.options.getString('template') ?? '').trim();
    if (!template) {
      const { templateHint } = require('./templateHint');
      const row = await db.ensureConfig(interaction.guild.id);
      return reply(interaction, await templateHint(interaction.guild.id, { current: row.embed_template ?? null, usage: `${name} message <name>`, what: t(lang, 'automation.board.what', { board: lower }), lang }), GREY);
    }
    if (template.toLowerCase() === 'none') {
      await db.updateConfig(interaction.guild.id, { embed_template: null });
      return reply(interaction, t(lang, 'automation.board.usual', { board: lower }), GREEN);
    }
    const doc = await getTemplate(interaction.guild.id, template).catch(() => null);
    if (!doc) return reply(interaction, t(lang, 'automation.board.templateMissing', { name: template }), RED);
    await db.updateConfig(interaction.guild.id, { embed_template: doc.name });
    return reply(interaction, t(lang, 'automation.board.template', { board: lower, name: doc.name, example: `{${variable}.…}` }), GREEN);
  }

  async function changeIgnore(interaction, add, lang) {
    const row = await db.ensureConfig(interaction.guild.id);
    const type = interaction.options.getString('type', true);
    const raw = interaction.options.getString('target', true);
    const id = raw.replace(/[<@#&!>]/g, '');
    if (!/^\d{15,25}$/.test(id)) return interaction.reply({ content: t(lang, 'automation.board.badTarget'), flags: MessageFlags.Ephemeral });
    const key = type === 'channel' ? 'ignored_channel_ids' : type === 'role' ? 'ignored_role_ids' : 'ignored_user_ids';
    const values = new Set(row[key] ?? []);
    if (add) values.add(id); else values.delete(id);
    await db.updateConfig(interaction.guild.id, { [key]: [...values] });
    const target = `<${type === 'channel' ? '#' : type === 'role' ? '@&' : '@'}${id}>`;
    return reply(interaction, t(lang, add ? 'automation.board.ignoreAdded' : 'automation.board.ignoreRemoved', { target, board: lower }), GREEN);
  }

  async function view(interaction, lang) {
    const row = await db.getConfig(interaction.guild.id);
    if (!row) return reply(interaction, t(lang, 'automation.board.isDisabled', { label }), RED);
    const text = t(lang, 'automation.board.view', {
      channel: row.channel_id ? `<#${row.channel_id}>` : t(lang, 'automation.board.notSet'),
      threshold: row.threshold,
      emoji: row.emoji,
      self: t(lang, row.selfstar ? 'automation.board.on' : 'automation.board.off'),
      message: row.embed_template ? `\`${row.embed_template}\`` : t(lang, 'automation.board.usualMessage'),
      channels: row.ignored_channel_ids?.length ?? 0,
      roles: row.ignored_role_ids?.length ?? 0,
      members: row.ignored_user_ids?.length ?? 0,
    });
    return reply(interaction, text, GREY);
  }

  const ignoreChoices = [{ name: 'channel', value: 'channel' }, { name: 'role', value: 'role' }, { name: 'member', value: 'member' }];
  return {
    aliases,
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setDMPermission(false)
      // i18n-ignore: builder description, translated in the cmd.automation catalog
      .addSubcommand((s) => s.setName('enable').setDescription(`Enable ${lower} with the current settings.`))
      .addSubcommand((s) => s.setName('disable').setDescription(`Disable ${lower}.`)) // i18n-ignore: builder description (translated in cmd.automation)
      .addSubcommand((s) => s.setName('set').setDescription('Set the destination channel.').addChannelOption((o) => o.setName('channel').setDescription('Destination text channel.').setRequired(true)))
      .addSubcommand((s) => s.setName('threshold').setDescription('Set required reactions.').addIntegerOption((o) => o.setName('count').setDescription('Number of reactions.').setMinValue(1).setMaxValue(100).setRequired(true)))
      .addSubcommand((s) => s.setName('emoji').setDescription('Set the reaction emoji.').addStringOption((o) => o.setName('emoji').setDescription('Unicode or custom emoji.').setRequired(true)))
      .addSubcommand((s) => s.setName(selfName).setDescription('Allow the message author to count their own reaction.').addBooleanOption((o) => o.setName('enabled').setDescription('Enabled?').setRequired(true)))
      .addSubcommand((s) => s.setName('ignore').setDescription('Ignore a channel, role, or member.').addStringOption((o) => o.setName('type').setDescription('What to ignore.').setRequired(true).addChoices(...ignoreChoices)).addStringOption((o) => o.setName('target').setDescription('Mention or ID.').setRequired(true)))
      .addSubcommand((s) => s.setName('unignore').setDescription('Remove an ignored channel, role, or member.').addStringOption((o) => o.setName('type').setDescription('What to unignore.').setRequired(true).addChoices(...ignoreChoices)).addStringOption((o) => o.setName('target').setDescription('Mention or ID.').setRequired(true)))
      .addSubcommand((s) => s.setName('message').setDescription('Use a saved embed for the reposts, or none to go back to the usual one.').addStringOption((o) => o.setName('template').setDescription('Name of a saved embed, or none. Leave it empty to see what is in use.').setRequired(false)))
      // i18n-ignore: builder description, translated in the cmd.automation catalog
      .addSubcommand((s) => s.setName('view').setDescription(`View ${lower} settings.`)),

    async execute(interaction) {
      const lang = await languageOf(interaction);
      const sub = interaction.options.getSubcommand();
      if (sub === 'enable') return enable(interaction, lang);
      if (sub === 'disable') return disable(interaction, lang);
      if (sub === 'set') return update(interaction, { channel_id: interaction.options.getChannel('channel', true).id }, lang);
      if (sub === 'threshold') return update(interaction, { threshold: interaction.options.getInteger('count', true) }, lang);
      if (sub === 'emoji') return update(interaction, { emoji: interaction.options.getString('emoji', true).trim() }, lang);
      if (sub === selfName) return update(interaction, { selfstar: interaction.options.getBoolean('enabled', true) }, lang);
      if (sub === 'message') return setMessage(interaction, lang);
      if (sub === 'ignore' || sub === 'unignore') return changeIgnore(interaction, sub === 'ignore', lang);
      return view(interaction, lang);
    },
  };
}

module.exports = { createBoardCommand };
