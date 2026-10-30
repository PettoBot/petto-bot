const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  WebhookClient,
} = require('discord.js');

const webhooksDb = require('../../db/managedWebhooks');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { t, languageOf } = require('../../i18n');
const { applySilentMentions } = require('../../utils/silentMentions');

module.exports = {
  aliases: ['wh'],

  data: new SlashCommandBuilder()
    .setName('webhook')
    .setDescription('Create and send through managed webhooks.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageWebhooks)
    .setDMPermission(false)

    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create a webhook in the current channel.')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Webhook name')
            .setRequired(true)
        )
    )

    .addSubcommand((s) =>
      s
        .setName('send')
        .setDescription('Send through a managed webhook.')

        .addStringOption((o) =>
          o
            .setName('identifier')
            .setDescription(
              'Webhook number, name, or Discord webhook ID'
            )
            .setRequired(true)
        )

        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Message (quote multi-word text)')
            .setRequired(true)
        )

        .addStringOption((o) =>
          o
            .setName('add')
            .setDescription(
              'Extra embed code, e.g. {embed}$v{title: hello}'
            )
            .setRequired(false)
        )

        .addStringOption((o) =>
          o
            .setName('username')
            .setDescription('Temporary username override')
            .setRequired(false)
        )

        .addStringOption((o) =>
          o
            .setName('avatar_url')
            .setDescription('Temporary avatar URL override')
            .setRequired(false)
        )
    )

    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription(
          'Edit a message sent by a managed webhook.'
        )

        .addStringOption((o) =>
          o
            .setName('message_link')
            .setDescription('Message link')
            .setRequired(true)
        )

        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('New message')
            .setRequired(true)
        )
    )

    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete a managed webhook.')

        .addStringOption((o) =>
          o
            .setName('identifier')
            .setDescription(
              'Webhook number, name, or Discord webhook ID'
            )
            .setRequired(true)
        )
    )

    .addSubcommand((s) =>
      s
        .setName('list')
        .setDescription('List managed webhooks.')
    ),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') return create(interaction, lang);
    if (sub === 'send') return send(interaction, lang);
    if (sub === 'edit') return edit(interaction, lang);
    if (sub === 'delete') return remove(interaction, lang);

    return list(interaction, lang);
  },
};

function card(
  interaction,
  content,
  color = 0x4b4f59
) {
  return interaction.reply({
    components: [
      textCard(content, color),
    ],
    flags: MessageFlags.IsComponentsV2,
  });
}

function messageUrl(
  guildId,
  channelId,
  messageId
) {
  return (
    `https://discord.com/channels/` +
    `${guildId}/${channelId}/${messageId}`
  );
}

async function resolveWebhook(interaction, lang) {
  const identifier =
    interaction.options.getString(
      'identifier',
      true
    );

  try {
    return await webhooksDb.get(
      interaction.guild.id,
      identifier
    );

  } catch (err) {
    if (
      err?.code ===
      'AMBIGUOUS_WEBHOOK_NAME'
    ) {
      // The database names the webhook in English: the answer is written here instead.
      const name = identifier.trim();
      const text =
        Array.isArray(err.matches) &&
        err.matches.length

          ? t(lang, 'misc.webhook.ambiguousNumbers', {
              name,
              numbers: err.matches
                .map(
                  (id) => `\`${id}\``
                )
                .join(', '),
            })

          : t(lang, 'misc.webhook.ambiguous', { name });

      await card(
        interaction,
        text,
        0xfed53c
      );

      return undefined;
    }

    throw err;
  }
}

async function create(interaction, lang) {
  if (
    !interaction.channel?.isTextBased() ||
    !interaction.channel.createWebhook
  ) {
    return card(
      interaction,
      t(lang, 'misc.webhook.cannotHost'),
      0xfe6465
    );
  }

  try {
    const webhook =
      await interaction.channel.createWebhook({
        name:
          interaction.options
            .getString('name', true)
            .slice(0, 80),

        reason:
          t(lang, 'misc.webhook.createReason', { user: interaction.user.tag }),
      });

    const row =
      await webhooksDb.add({
        guild_id:
          interaction.guild.id,

        channel_id:
          interaction.channel.id,

        webhook_id:
          webhook.id,

        webhook_token:
          webhook.token,

        name:
          webhook.name,

        created_by:
          interaction.user.id,
      });

    return card(
      interaction,

      t(lang, 'misc.webhook.created', {
        emoji: EMOJI.APPROVE,
        name: webhook.name,
        number: row.local_id,
        channel: `<#${interaction.channel.id}>`,
      }),

      0xa5ea7a
    );

  } catch (err) {
    // The error of Discord is shown as it comes.
    return card(
      interaction,

      err.message != null
        ? t(lang, 'misc.webhook.createFailed', { error: err.message })
        : t(lang, 'misc.webhook.createFailedPermission', { permission: t(lang, 'core.perm.ManageWebhooks') }),

      0xfe6465
    );
  }
}

function parseEmbedCode(input) {
  if (!input) return [];

  const title =
    input.match(
      /\{title:\s*([^}]+)\}/i
    )?.[1]?.trim();

  const description =
    input.match(
      /\{description:\s*([^}]+)\}/i
    )?.[1]?.trim();

  if (
    !title &&
    !description
  ) {
    return [];
  }

  return [
    {
      ...(title
        ? { title }
        : {}),

      ...(description
        ? { description }
        : {}),
    },
  ];
}

async function send(interaction, lang) {
  const row =
    await resolveWebhook(interaction, lang);

  if (row === undefined) return;

  if (!row?.webhook_token) {
    return card(
      interaction,
      t(lang, 'misc.webhook.notFound'),
      0xfe6465
    );
  }

  const content =
    interaction.options.getString(
      'message',
      true
    );

  const add =
    interaction.options.getString(
      'add'
    );

  const username =
    interaction.options.getString(
      'username'
    );

  const avatarURL =
    interaction.options.getString(
      'avatar_url'
    );

  const payload = {
    content,

    username:
      username || undefined,

    avatarURL:
      avatarURL || undefined,

    embeds:
      parseEmbedCode(add),
  };

  try {
    const sent =
      await new WebhookClient({
        id:
          row.webhook_id,

        token:
          row.webhook_token,
      }).send(applySilentMentions(payload, interaction.guild)); // a client of its own: the server is given so `!@Role` finds its role

    const jumpUrl =
      messageUrl(
        interaction.guild.id,
        row.channel_id,
        sent.id
      );

    return card(
      interaction,

      t(lang, 'misc.webhook.sent', { emoji: EMOJI.APPROVE, name: row.name, url: jumpUrl }),

      0xa5ea7a
    );

  } catch (err) {
    return card(
      interaction,

      err.message != null
        ? t(lang, 'misc.webhook.sendFailed', { error: err.message })
        : t(lang, 'misc.webhook.sendFailedUnknown'),

      0xfe6465
    );
  }
}

async function edit(interaction, lang) {
  const link =
    interaction.options
      .getString(
        'message_link',
        true
      )
      .match(
        /\/channels\/(\d+)\/(\d+)\/(\d+)/
      );

  if (
    !link ||
    link[1] !==
      interaction.guild.id
  ) {
    return card(
      interaction,
      t(lang, 'misc.webhook.badLink'),
      0xfe6465
    );
  }

  const rows =
    await webhooksDb.getByChannel(
      interaction.guild.id,
      link[2]
    );

  const message =
    interaction.options.getString(
      'message',
      true
    );

  for (const row of rows) {
    try {
      const edited =
        await new WebhookClient({
          id:
            row.webhook_id,

          token:
            row.webhook_token,
        }).editMessage(
          link[3],

          applySilentMentions({
            content: message,
            embeds: [],
          }, interaction.guild)
        );

      const jumpUrl =
        messageUrl(
          interaction.guild.id,
          link[2],
          edited.id ?? link[3]
        );

      return card(
        interaction,

        t(lang, 'misc.webhook.edited', { emoji: EMOJI.APPROVE, name: row.name, url: jumpUrl }),

        0xa5ea7a
      );

    } catch {}
  }

  return card(
    interaction,

    t(lang, 'misc.webhook.notManaged'),

    0xfe6465
  );
}

async function remove(interaction, lang) {
  const row =
    await resolveWebhook(interaction, lang);

  if (row === undefined) return;

  if (!row) {
    return card(
      interaction,
      t(lang, 'misc.webhook.notFound'),
      0xfe6465
    );
  }

  try {
    await new WebhookClient({
      id:
        row.webhook_id,

      token:
        row.webhook_token,
    }).delete(
      t(lang, 'misc.webhook.deleteReason')
    );

  } catch {}

  await webhooksDb.remove(
    interaction.guild.id,
    row.webhook_id
  );

  return card(
    interaction,

    t(lang, 'misc.webhook.deleted', { emoji: EMOJI.APPROVE, name: row.name }),

    0xa5ea7a
  );
}

async function list(interaction, lang) {
  const rows =
    await webhooksDb.list(
      interaction.guild.id
    );

  const body =
    rows.length

      ? rows
          .map(
            (row) =>
              `\`${row.local_id}\` · **${row.name}** · <#${row.channel_id}>`
          )
          .join('\n')

      : t(lang, 'misc.webhook.listNone');

  return card(
    interaction,

    t(lang, 'misc.webhook.listTitle', { count: rows.length, body })
  );
}