// Button responders: a button (or a choice of a menu) that answers with a private message and gives, takes or toggles
// roles. It is shown in a panel (see `!panel`). Several roles per responder are set from the dashboard.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const respondersDb = require('../../db/responders');
const { getTemplate } = require('../../db/embedTemplates');
const { getGuildPremium, getGuildLimits, PREMIUM_LIMITS } = require('../../db/premium');
const { normalizeName, emojiOf, STYLES } = require('../../utils/responderEngine');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');

const ok = (text) => textCard(`${EMOJI.APPROVE}  ${text}`, 0xa5ea7a);
const note = (text) => textCard(text);
const STYLE_CHOICES = Object.keys(STYLES).map((name) => ({ name, value: name }));
const CLEARABLE = ['reply', 'template', 'emoji', 'give', 'take', 'require', 'react', 'send_to'];

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
    .addBooleanOption((o) => o.setName('toggle').setDescription('Take the role back when it is clicked again'))
    .addBooleanOption((o) => o.setName('delete_message').setDescription('Delete the message the button is on after it is used'))
    .addStringOption((o) => o.setName('react').setDescription('An emoji to react to the message the button is on'))
    .addChannelOption((o) => o.setName('send_to').setDescription('Send the answer in this channel instead of privately').addChannelTypes(0, 5, 11, 12));
}

const data = new SlashCommandBuilder()
  .setName('responder')
  .setDescription('Buttons that reply and give roles.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((s) => optionsFor(s.setName('add').setDescription('Make a button responder.'), { nameRequired: true }))
  .addSubcommand((s) => optionsFor(s.setName('edit').setDescription('Change a button responder. Only what you give changes.'), { nameRequired: true })
    // i18n-ignore: builder description, translated in the cmd.automation catalog
    .addStringOption((o) => o.setName('clear').setDescription(`Empty one thing: ${CLEARABLE.join(', ')}`)))
  .addSubcommand((s) => s.setName('delete').setDescription('Delete a button responder.').addStringOption((o) => o.setName('name').setDescription('Its name').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('List the button responders.'));

async function execute(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const done = (component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });
  const sub = interaction.options.getSubcommand();
  if (sub === 'list') return list(interaction, done, lang);
  const name = normalizeName(interaction.options.getString('name', true));
  if (!name) return done(note(t(lang, 'automation.panel.badName')));
  if (sub === 'delete') {
    const removed = await respondersDb.deleteResponder(interaction.guild.id, name);
    return done(removed ? ok(t(lang, 'automation.responder.deleted', { name })) : note(t(lang, 'automation.responder.missing', { name })));
  }
  return save(interaction, name, sub === 'edit', done, lang);
}

async function save(interaction, name, editing, done, lang) {
  const guildId = interaction.guild.id;
  const existing = await respondersDb.getByName(guildId, name);
  if (editing && !existing) return done(note(t(lang, 'automation.responder.missing', { name })));
  if (!editing && existing) return done(note(t(lang, 'automation.responder.exists', { name })));
  if (!existing) {
    const premium = await getGuildPremium(guildId).catch(() => ({ active: false }));
    const limit = getGuildLimits(premium).buttonResponders;
    if ((await respondersDb.countResponders(guildId)) >= limit) return done(note(t(lang, premium?.active ? 'automation.responder.full' : 'automation.responder.fullFree', { limit, premium: PREMIUM_LIMITS.buttonResponders })));
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
  if (clear && !CLEARABLE.includes(clear)) return done(note(t(lang, 'automation.responder.clearable', { list: CLEARABLE.join(', ') })));

  if (label !== null) values.label = label.slice(0, 80);
  if (reply !== null) values.reply = reply.slice(0, 2000);
  if (style !== null) { if (!STYLES[style]) return done(note(t(lang, 'automation.responder.badStyle', { list: Object.keys(STYLES).join(', ') }))); values.style = style; }
  if (emoji !== null) { if (!emojiOf(emoji)) return done(note(t(lang, 'automation.responder.badEmoji'))); values.emoji = emoji.trim(); }
  if (template) {
    if (!(await getTemplate(guildId, template).catch(() => null))?.data) return done(note(t(lang, 'automation.responder.templateMissing', { name: template })));
    values.reply_template = template;
  }
  if (toggle !== null) values.toggle = toggle;
  const deleteMessage = interaction.options.getBoolean('delete_message');
  const react = interaction.options.getString('react');
  const sendTo = interaction.options.getChannel('send_to');
  if (deleteMessage !== null) values.delete_message = deleteMessage;
  if (react !== null) { if (!emojiOf(react)) return done(note(t(lang, 'automation.responder.badEmoji'))); values.react_emoji = react.trim(); }
  if (sendTo) values.send_channel_id = sendTo.id;
  if (clear === 'react') values.react_emoji = null;
  if (clear === 'send_to') values.send_channel_id = null;
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
  return done(ok(t(lang, editing ? 'automation.responder.saved' : 'automation.responder.ready', { name })));
}

async function list(interaction, done, lang) {
  const rows = await respondersDb.listResponders(interaction.guild.id);
  if (!rows.length) return done(note(t(lang, 'automation.responder.listEmpty')));
  const lines = rows.slice(0, 40).map((row) => `\`${row.name}\` · ${row.label || row.emoji || ''}${row.give_role_ids.length ? ` · ${t(lang, 'automation.responder.gives', { roles: row.give_role_ids.map((id) => `<@&${id}>`).join(' ') })}` : ''}${row.remove_role_ids.length ? ` · ${t(lang, 'automation.responder.takes', { roles: row.remove_role_ids.map((id) => `<@&${id}>`).join(' ') })}` : ''}${row.toggle ? ` · ${t(lang, 'automation.responder.toggle')}` : ''}`);
  return done(note([t(lang, 'automation.responder.listTitle'), ...lines].join('\n')));
}

module.exports = { prefixOnly: true, aliases: ['responders', 'buttonresponder'], data, execute };
