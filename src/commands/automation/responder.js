// Button responders: a button (or a choice of a menu) that answers with a private message and gives, takes or toggles
// roles. It is shown in a panel (see `!panel`). Several roles per responder are set from the dashboard.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const respondersDb = require('../../db/responders');
const { getTemplate } = require('../../db/embedTemplates');
const { getGuildPremium, getGuildLimits } = require('../../db/premium');
const { normalizeName, emojiOf, STYLES } = require('../../utils/responderEngine');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);
const note = (text) => textCard(text, 0x4b4f59);
const STYLE_CHOICES = Object.keys(STYLES).map((name) => ({ name, value: name }));
const CLEARABLE = ['reply', 'template', 'emoji', 'give', 'take', 'require'];

function optionsFor(builder, { nameRequired }) {
  return builder
    .addStringOption((o) => o.setName('name').setDescription('The name of the responder, for example: vip-role').setRequired(nameRequired))
    .addStringOption((o) => o.setName('label').setDescription('The text of the button').setMaxLength(80))
    .addStringOption((o) => o.setName('reply').setDescription('The private message sent to who clicks, with variables like {user.mention}').setMaxLength(2000))
    .addRoleOption((o) => o.setName('give').setDescription('A role to give'))
    .addRoleOption((o) => o.setName('take').setDescription('A role to take'))
    .addRoleOption((o) => o.setName('require').setDescription('A role the member needs to use it'))
    .addStringOption((o) => o.setName('style').setDescription('The color of the button').addChoices(...STYLE_CHOICES))
    .addStringOption((o) => o.setName('emoji').setDescription('An emoji for the button'))
    .addStringOption((o) => o.setName('template').setDescription('Name of a saved embed to send as the reply'))
    .addBooleanOption((o) => o.setName('toggle').setDescription('Take the role back when it is clicked again'));
}

const data = new SlashCommandBuilder()
  .setName('responder')
  .setDescription('Buttons that reply and give roles.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) => optionsFor(s.setName('add').setDescription('Make a button responder.'), { nameRequired: true }))
  .addSubcommand((s) => optionsFor(s.setName('edit').setDescription('Change a button responder. Only what you give changes.'), { nameRequired: true })
    .addStringOption((o) => o.setName('clear').setDescription(`Empty one thing: ${CLEARABLE.join(', ')}`)))
  .addSubcommand((s) => s.setName('delete').setDescription('Delete a button responder.').addStringOption((o) => o.setName('name').setDescription('Its name').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('List the button responders.'));

async function execute(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const done = (component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
  const sub = interaction.options.getSubcommand();
  if (sub === 'list') return list(interaction, done);
  const name = normalizeName(interaction.options.getString('name', true));
  if (!name) return done(note('The name can have letters, numbers, dashes and underscores, up to 60.'));
  if (sub === 'delete') {
    const removed = await respondersDb.deleteResponder(interaction.guild.id, name);
    return done(removed ? ok(`\`${name}\` is deleted. A panel that shows it just stops showing it.`) : note(`There is no responder called \`${name}\`.`));
  }
  return save(interaction, name, sub === 'edit', done);
}

async function save(interaction, name, editing, done) {
  const guildId = interaction.guild.id;
  const existing = await respondersDb.getByName(guildId, name);
  if (editing && !existing) return done(note(`There is no responder called \`${name}\`.`));
  if (!editing && existing) return done(note(`\`${name}\` already exists. Use \`!responder edit\` to change it.`));
  if (!existing) {
    const premium = await getGuildPremium(guildId).catch(() => ({ active: false }));
    const limit = getGuildLimits(premium).buttonResponders;
    if ((await respondersDb.countResponders(guildId)) >= limit) return done(note(`This server already has ${limit} button responders.${premium?.active ? '' : ' Premium raises it to 250.'}`));
  }
  const values = { ...(existing ?? respondersDb.RESPONDER_DEFAULTS) };
  delete values.id; delete values.guild_id; delete values.created_at; delete values.name;
  const label = interaction.options.getString('label');
  const reply = interaction.options.getString('reply');
  const style = interaction.options.getString('style');
  const emoji = interaction.options.getString('emoji');
  const template = (interaction.options.getString('template') ?? '').trim();
  const toggle = interaction.options.getBoolean('toggle');
  const give = interaction.options.getRole('give');
  const take = interaction.options.getRole('take');
  const need = interaction.options.getRole('require');
  const clear = (interaction.options.getString('clear') ?? '').trim().toLowerCase();
  if (clear && !CLEARABLE.includes(clear)) return done(note(`You can clear: ${CLEARABLE.join(', ')}.`));

  if (label !== null) values.label = label.slice(0, 80);
  if (reply !== null) values.reply = reply.slice(0, 2000);
  if (style !== null) { if (!STYLES[style]) return done(note(`The style is one of: ${Object.keys(STYLES).join(', ')}.`)); values.style = style; }
  if (emoji !== null) { if (!emojiOf(emoji)) return done(note('That does not look like an emoji.')); values.emoji = emoji.trim(); }
  if (template) {
    if (!(await getTemplate(guildId, template).catch(() => null))?.data) return done(note(`There is no saved embed called \`${template}\`.`));
    values.reply_template = template;
  }
  if (toggle !== null) values.toggle = toggle;
  if (give) values.give_role_ids = [give.id];
  if (take) values.remove_role_ids = [take.id];
  if (need) values.required_role_ids = [need.id];
  if (clear === 'reply') values.reply = '';
  if (clear === 'template') values.reply_template = null;
  if (clear === 'emoji') values.emoji = null;
  if (clear === 'give') values.give_role_ids = [];
  if (clear === 'take') values.remove_role_ids = [];
  if (clear === 'require') values.required_role_ids = [];
  if (!values.label && !values.emoji) values.label = name;
  values.created_by = existing?.created_by ?? interaction.user.id;

  await respondersDb.saveResponder(guildId, name, values);
  return done(ok(`\`${name}\` is ${editing ? 'saved' : 'ready'}. Show it in a panel with \`!panel add <panel> ${name}\`.`));
}

async function list(interaction, done) {
  const rows = await respondersDb.listResponders(interaction.guild.id);
  if (!rows.length) return done(note('There are no button responders yet. Make one with `!responder add`.'));
  const lines = rows.slice(0, 40).map((row) => `\`${row.name}\` · ${row.label || row.emoji || ''}${row.give_role_ids.length ? ` · gives ${row.give_role_ids.map((id) => `<@&${id}>`).join(' ')}` : ''}${row.remove_role_ids.length ? ` · takes ${row.remove_role_ids.map((id) => `<@&${id}>`).join(' ')}` : ''}${row.toggle ? ' · toggle' : ''}`);
  return done(note(['### Button responders', ...lines].join('\n')));
}

module.exports = { prefixOnly: true, aliases: ['responders', 'buttonresponder'], data, execute };
