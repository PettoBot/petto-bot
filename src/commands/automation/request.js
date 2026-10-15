// Requests for members: ask for something, see the open ones. The staff claims and finishes them with the buttons of the
// card; the settings are in `!requestconfig`.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const requestsDb = require('../../db/requests');
const { requestCard, statusLabel } = require('../../utils/requestCards');
const { templatePayload } = require('../../utils/templatedMessage');
const { resolve } = require('../../utils/embedVariables');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, tn, currentLanguage, languageOf } = require('../../i18n');

/** The answer to who makes a request, when the server did not write one. */
const defaultCreated = (lang = currentLanguage()) => t(lang, 'requests.created.default');
const MAX_TEXT = 1000;

const reply = (interaction, component) => interaction.editReply({ components: [component], flags: MessageFlags.IsComponentsV2 });

async function createRequest(interaction, lang) {
  const config = await requestsDb.getConfig(interaction.guild.id);
  if (!config?.enabled || !config.channel_id) return reply(interaction, textCard(t(lang, 'requests.off')));
  const text = interaction.options.getString('text', true).trim().slice(0, MAX_TEXT);
  if (!text) return reply(interaction, textCard(t(lang, 'requests.make.empty')));
  const open = await requestsDb.countOpenBy(interaction.guild.id, interaction.user.id);
  if (open >= config.max_open) return reply(interaction, textCard(tn(lang, 'requests.make.limit', open, { count: open })));
  const channel = await interaction.guild.channels.fetch(config.channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return reply(interaction, textCard(t(lang, 'requests.make.noChannel')));

  const request = await requestsDb.create({ guildId: interaction.guild.id, userId: interaction.user.id, content: text });
  const ping = config.ping_role_id ? `<@&${config.ping_role_id}>` : null;
  const card = await channel.send({ ...(ping ? { content: ping } : {}), components: [requestCard(request, lang)], flags: MessageFlags.IsComponentsV2, allowedMentions: { roles: config.ping_role_id ? [config.ping_role_id] : [] } }).catch(() => null);
  if (!card) {
    await requestsDb.update(interaction.guild.id, request.number, { status: 'cancelled' });
    return reply(interaction, textCard(t(lang, 'requests.make.notPosted')));
  }
  await requestsDb.update(interaction.guild.id, request.number, { channel_id: channel.id, message_id: card.id });

  const link = `https://discord.com/channels/${interaction.guild.id}/${channel.id}/${card.id}`;
  const ctx = { guild: interaction.guild, member: interaction.member, user: interaction.user, channel: interaction.channel, request: { number: String(request.number), text, link, channel: `<#${channel.id}>`, status: statusLabel('open', lang) } };
  const saved = config.messages?.created ?? {};
  const payload = saved.template ? await templatePayload(interaction.guild.id, saved.template, ctx) : null;
  if (payload) return interaction.editReply({ ...payload, allowedMentions: { parse: [] } });
  const content = (await resolve(saved.text?.trim() ? saved.text.slice(0, 2000) : defaultCreated(lang), ctx)).slice(0, 2000);
  return reply(interaction, textCard(`${EMOJI.APPROVE}  ${content}`, 0xa5ea7a));
}

async function listRequests(interaction, lang) {
  const mine = Boolean(interaction.options.getBoolean('mine'));
  const rows = await requestsDb.list(interaction.guild.id, { userId: mine ? interaction.user.id : null, limit: 15 });
  if (!rows.length) return reply(interaction, textCard(t(lang, mine ? 'requests.list.noneMine' : 'requests.list.none')));
  const lines = rows.map((row) => {
    const link = row.channel_id && row.message_id ? t(lang, 'requests.list.cardLink', { url: `https://discord.com/channels/${interaction.guild.id}/${row.channel_id}/${row.message_id}` }) : '';
    const status = ['open', 'claimed'].includes(row.status) ? t(lang, `requests.list.status.${row.status}`) : undefined;
    return `**#${row.number}** ${status} · <@${row.user_id}>${row.claimed_by ? ` · <@${row.claimed_by}>` : ''}\n> ${row.content.replace(/\n/g, ' ').slice(0, 80)}${link}`;
  });
  return reply(interaction, textCard([`### ${t(lang, mine ? 'requests.list.titleMine' : 'requests.list.title')}`, ...lines].join('\n')));
}

module.exports = {
  prefixOnly: true,
  aliases: ['req'],
  data: new SlashCommandBuilder()
    .setName('request')
    .setDescription('Ask the staff for something.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('make').setDescription('Ask the staff for something; they will see it in the requests channel.').addStringOption((o) => o.setName('text').setDescription('What you are asking for').setRequired(true).setMaxLength(MAX_TEXT)))
    .addSubcommand((s) => s.setName('list').setDescription('See the open requests.').addBooleanOption((o) => o.setName('mine').setDescription('Only yours').setRequired(false))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    const lang = await languageOf(interaction);
    return interaction.options.getSubcommand() === 'make' ? createRequest(interaction, lang) : listRequests(interaction, lang);
  },
  defaultCreated,
};
