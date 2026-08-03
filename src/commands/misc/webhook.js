const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, WebhookClient } = require('discord.js');
const webhooksDb = require('../../db/managedWebhooks');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  aliases: ['wh'],
  data: new SlashCommandBuilder()
    .setName('webhook')
    .setDescription('Create and send through managed webhooks.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('create').setDescription('Create a webhook in the current channel.').addStringOption((o) => o.setName('name').setDescription('Webhook name').setRequired(true)))
    .addSubcommand((s) => s.setName('send').setDescription('Send through a managed webhook.').addStringOption((o) => o.setName('identifier').setDescription('Webhook ID or local database ID').setRequired(true)).addStringOption((o) => o.setName('message').setDescription('Message (quote multi-word text)').setRequired(true)).addStringOption((o) => o.setName('add').setDescription('Extra embed code, e.g. {embed}$v{title: hello}').setRequired(false)).addStringOption((o) => o.setName('username').setDescription('Temporary username override').setRequired(false)).addStringOption((o) => o.setName('avatar_url').setDescription('Temporary avatar URL override').setRequired(false)))
    .addSubcommand((s) => s.setName('edit').setDescription('Edit a message sent by a managed webhook.').addStringOption((o) => o.setName('message_link').setDescription('Message link').setRequired(true)).addStringOption((o) => o.setName('message').setDescription('New message').setRequired(true)))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete a managed webhook.').addStringOption((o) => o.setName('identifier').setDescription('Webhook ID or local database ID').setRequired(true)))
    .addSubcommand((s) => s.setName('list').setDescription('List managed webhooks.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') return create(interaction);
    if (sub === 'send') return send(interaction);
    if (sub === 'edit') return edit(interaction);
    if (sub === 'delete') return remove(interaction);
    return list(interaction);
  },
};

function card(interaction, content, color = 0x8399ff) {
  return interaction.reply({ components: [textCard(content, color)], flags: MessageFlags.IsComponentsV2 });
}

async function create(interaction) {
  if (!interaction.channel?.isTextBased() || !interaction.channel.createWebhook) return card(interaction, 'This channel cannot host webhooks.', 0xfe6465);
  try {
    const webhook = await interaction.channel.createWebhook({ name: interaction.options.getString('name', true).slice(0, 80), reason: `Managed by ${interaction.user.tag}` });
    await webhooksDb.add({ guild_id: interaction.guild.id, channel_id: interaction.channel.id, webhook_id: webhook.id, webhook_token: webhook.token, name: webhook.name, created_by: interaction.user.id });
    return card(interaction, `${EMOJI.APPROVE}  Webhook **${webhook.name}** created.\n**Identifier:** \`${webhook.id}\`\n**Channel:** <#${interaction.channel.id}>`, 0xa5ea7a);
  } catch (err) {
    return card(interaction, `Could not create the webhook: ${err.message ?? 'check my Manage Webhooks permission.'}`, 0xfe6465);
  }
}

function parseEmbedCode(input) {
  if (!input) return [];
  const title = input.match(/\{title:\s*([^}]+)\}/i)?.[1]?.trim();
  const description = input.match(/\{description:\s*([^}]+)\}/i)?.[1]?.trim();
  if (!title && !description) return [];
  return [{ ...(title ? { title } : {}), ...(description ? { description } : {}) }];
}

async function send(interaction) {
  const row = await webhooksDb.get(interaction.guild.id, interaction.options.getString('identifier', true));
  if (!row?.webhook_token) return card(interaction, 'That managed webhook does not exist.', 0xfe6465);
  const content = interaction.options.getString('message', true);
  const add = interaction.options.getString('add');
  const username = interaction.options.getString('username');
  const avatarURL = interaction.options.getString('avatar_url');
  const payload = { content, username: username || undefined, avatarURL: avatarURL || undefined, embeds: parseEmbedCode(add) };
  try {
    const sent = await new WebhookClient({ id: row.webhook_id, token: row.webhook_token }).send(payload);
    return card(interaction, `${EMOJI.APPROVE}  Message sent through **${row.name}**.\n[Jump to message](${sent.url})`, 0xa5ea7a);
  } catch (err) {
    return card(interaction, `Could not send through that webhook: ${err.message ?? 'unknown error.'}`, 0xfe6465);
  }
}

async function edit(interaction) {
  const link = interaction.options.getString('message_link', true).match(/\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!link || link[1] !== interaction.guild.id) return card(interaction, 'Provide a message link from this server.', 0xfe6465);
  const rows = await webhooksDb.getByChannel(interaction.guild.id, link[2]);
  const message = interaction.options.getString('message', true);
  for (const row of rows) {
    try {
      const edited = await new WebhookClient({ id: row.webhook_id, token: row.webhook_token }).editMessage(link[3], { content: message, embeds: [] });
      return card(interaction, `${EMOJI.APPROVE}  Message edited through **${row.name}**.\n[Jump to message](${edited.url})`, 0xa5ea7a);
    } catch {}
  }
  return card(interaction, 'That message was not sent by one of Petto\'s managed webhooks.', 0xfe6465);
}

async function remove(interaction) {
  const row = await webhooksDb.get(interaction.guild.id, interaction.options.getString('identifier', true));
  if (!row) return card(interaction, 'That managed webhook does not exist.', 0xfe6465);
  try { await new WebhookClient({ id: row.webhook_id, token: row.webhook_token }).delete('Deleted by Petto'); } catch {}
  await webhooksDb.remove(interaction.guild.id, row.webhook_id);
  return card(interaction, `${EMOJI.APPROVE}  Webhook **${row.name}** deleted.`, 0xa5ea7a);
}

async function list(interaction) {
  const rows = await webhooksDb.list(interaction.guild.id);
  const body = rows.length ? rows.map((row) => `\`${row.id}\` · **${row.name}** · <#${row.channel_id}> · webhook \`${row.webhook_id}\``).join('\n') : 'No managed webhooks configured.';
  return card(interaction, `**Managed webhooks (${rows.length})**\n${body}`);
}
