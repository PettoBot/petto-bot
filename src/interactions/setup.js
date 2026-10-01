const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild, updateGuild } = require('../db/guilds');
const { setCachedPrefix } = require('../events/messageCreateCommands');
const { getConfig: getMemberConfig, upsertConfig: upsertMemberConfig } = require('../db/memberEvents');
const { upsertConfig: upsertAutomodConfig } = require('../db/automod');
const { EVENTS, getLogConfig, addEntries, upsertWebhook } = require('../db/logConfig');
const { ensureAdminSetupChannel } = require('../utils/onboarding');
const { infoPayload, noticePayload } = require('../utils/infoCard');
const { settle } = require('../utils/withTimeout');
const { EMOJI } = require('../utils/emojis');
const { COLORS } = require('../utils/colors');
const { syncGuildAutoMod } = require('../utils/autoModManager');
const { invalidateSetupState } = require('./setupPanel');
const logger = require('../utils/logger');

function selectedChannel(fields, customId) {
  return fields.getSelectedChannels(customId)?.first?.() ?? null;
}

function moderationModeLabel(mode) {
  return { balanced: 'Balanced', strict: 'Strict', disabled: 'Disabled' }[mode] ?? mode;
}

function autoModSummary(result) {
  if (!result) return { status: 'warn', text: 'Official AutoMod could not be checked.' };
  if (result.reason === 'disabled_by_setup') return { status: 'skip', text: 'Official AutoMod was not changed because moderation mode is Disabled.' };
  if (result.reason === 'not_selected') return { status: 'skip', text: 'Official AutoMod was not changed. Select it in setup to create or repair those rules.' };

  if (result.missingPermissions) {
    return { status: 'warn', text: 'Official AutoMod is partial: Petto cannot access AutoMod here. Grant **Manage Server** and run setup again.' };
  }
  if (result.failed > 0) {
    return { status: 'warn', text: `Official AutoMod is partial: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed.` };
  }
  return { status: 'ok', text: `Official AutoMod: ${result.created} created, ${result.updated} updated, ${result.existing} already configured.` };
}

async function configureLogChannel(client, guild, channel) {
  const me = guild.members.me;
  const permissions = channel.permissionsFor(me);
  if (!permissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageWebhooks,
  ])) {
    throw new Error(`I need View Channel, Send Messages and Manage Webhooks in <#${channel.id}>.`);
  }

  const config = await getLogConfig(guild.id, { force: true });

  if (!config.webhooks.some((webhook) => webhook.channel_id === channel.id)) {
    const webhook = await channel.createWebhook({
      name: 'Petto logs',
      avatar: client.user.displayAvatarURL({ extension: 'png', size: 256 }),
      reason: 'Petto all-in-one setup',
    });
    await upsertWebhook(guild.id, channel.id, webhook.id, webhook.token);
  }

  const routed = new Set(config.entries.filter((entry) => entry.channel_id === channel.id).map((entry) => entry.event));
  const missing = EVENTS.filter((event) => !routed.has(event));
  await addEntries(guild.id, channel.id, missing);
  return missing.length;
}

/** Runs a step and turns its outcome into a line of the result card. A failing step never stops the others. */
async function runStep(label, work) {
  const outcome = await settle(Promise.resolve().then(work));
  if (outcome.ok) return { label, ...outcome.value };
  logger.warn(`Setup step "${label}" failed: ${outcome.error?.message ?? outcome.error}`);
  return { label, status: 'fail', text: outcome.error?.message ?? 'Unexpected error.' };
}

const STATUS_ICON = { ok: EMOJI.APPROVE, warn: EMOJI.WARNING, fail: EMOJI.DENY, skip: EMOJI.RELEASE_MINUS };

async function handleSetupModal(interaction) {
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ ...noticePayload('You need the **Manage Server** permission to use setup.', COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    return;
  }

  const guild = interaction.guild;
  const fields = interaction.fields;
  const logChannel = selectedChannel(fields, 'setup_log_channel');
  const welcomeChannel = selectedChannel(fields, 'setup_welcome_channel');
  const mode = fields.getRadioGroup('setup_moderation_mode', true);
  const features = new Set(fields.getStringSelectValues('setup_features'));
  const prefix = fields.getTextInputValue('setup_prefix').trim();

  if (!prefix || prefix.length > 5 || /\s/.test(prefix)) {
    await interaction.reply({
      ...noticePayload('The prefix must be 1 to 5 characters and cannot contain spaces.', COLORS.RED),
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });

  try {
    // Every other table points at the guild row, so it has to exist before the steps below start.
    await ensureGuild(guild.id);

    const strict = mode === 'strict';
    const disabled = mode === 'disabled';
    const welcomeEnabled = features.has('welcome') && Boolean(welcomeChannel);

    // The steps do not depend on each other, so they run together instead of one after another.
    const steps = await Promise.all([
      runStep('Prefix', async () => {
        await updateGuild(guild.id, { prefix });
        // Without this the old prefix would keep working until the cache expires.
        setCachedPrefix(guild.id, prefix);
        return { status: 'ok', text: `Prefix is \`${prefix}\`.` };
      }),

      runStep('Moderation', async () => {
        await upsertAutomodConfig(guild.id, {
          anti_spam_enabled: !disabled && features.has('anti-spam'),
          anti_raid_enabled: !disabled && features.has('anti-raid'),
          raid_action: strict ? 'kick' : 'alert',
          anti_alt_enabled: !disabled && features.has('anti-alt'),
          anti_alt_action: strict ? 'kick' : 'flag',
        });
        return { status: 'ok', text: `Moderation mode: **${moderationModeLabel(mode)}**.` };
      }),

      runStep('Welcome', async () => {
        const existing = await getMemberConfig(guild.id).catch(() => null);
        const patch = { welcome_channel_id: welcomeEnabled ? welcomeChannel.id : null };
        if (welcomeEnabled && !existing?.welcome_message && !existing?.welcome_embed_template) {
          patch.welcome_message = 'Welcome {user.mention} to {server.name}!';
        }
        await upsertMemberConfig(guild.id, patch);
        return welcomeEnabled
          ? { status: 'ok', text: `Welcome messages are enabled in <#${welcomeChannel.id}>.` }
          : { status: 'skip', text: features.has('welcome') ? 'Welcome messages were not enabled because no welcome channel was selected.' : 'Welcome messages are disabled.' };
      }),

      runStep('Audit logs', async () => {
        if (!features.has('logs')) return { status: 'skip', text: 'Audit logs were left unchanged.' };
        if (!logChannel) return { status: 'warn', text: 'Audit logs were not enabled because no log channel was selected.' };
        const added = await configureLogChannel(interaction.client, guild, logChannel);
        return { status: 'ok', text: `Audit logs go to <#${logChannel.id}> (${added ? `${added} new event categories` : 'already configured'}).` };
      }),

      runStep('Official AutoMod', async () => {
        if (disabled) return autoModSummary({ reason: 'disabled_by_setup' });
        if (!features.has('official-automod')) return autoModSummary({ reason: 'not_selected' });
        const result = await syncGuildAutoMod(guild).catch((err) => {
          logger.warn(`[AutoMod] Setup synchronization failed for guild ${guild.id}: ${err.message}`);
          return null;
        });
        return autoModSummary(result);
      }),

      runStep('Setup channel', async () => {
        const channel = await ensureAdminSetupChannel(guild).catch((err) => {
          logger.warn(`Could not create private setup channel in guild ${guild.id}: ${err.message}`);
          return null;
        });
        return channel
          ? { status: 'ok', text: `Setup channel: <#${channel.id}>.`, channelId: channel.id }
          : { status: 'warn', text: 'The private setup channel was not created. Grant Petto **Manage Channels** and run setup again if you want one.' };
      }),
    ]);

    invalidateSetupState(guild.id);

    const failed = steps.filter((step) => step.status === 'fail').length;
    const warned = steps.filter((step) => step.status === 'warn').length;
    const setupChannelId = steps.find((step) => step.channelId)?.channelId;

    await interaction.editReply(infoPayload({
      accent: failed ? COLORS.RED : warned ? COLORS.YELLOW : COLORS.GREEN,
      title: `${failed ? EMOJI.WARNING : EMOJI.APPROVE} ${failed ? 'Setup finished with problems' : 'Petto setup saved'}`,
      thumbnail: guild.iconURL({ size: 256 }),
      subtitle: [guild.name, failed ? `${failed} ${failed === 1 ? 'step' : 'steps'} failed; the rest were saved.` : warned ? 'Saved, with a few things to look at.' : 'Everything was saved.'],
      sections: [
        { title: 'Result', lines: steps.map((step) => `${STATUS_ICON[step.status] ?? EMOJI.RELEASE_MINUS} ${step.text}`) },
        { title: 'Next', lines: [`Use \`${prefix}help\` to browse every command, and \`/setup\` any time to review this server.`] },
      ],
      buttons: [
        setupChannelId ? { label: 'Open setup channel', url: `https://discord.com/channels/${guild.id}/${setupChannelId}` } : null,
        { label: 'Documentation', url: 'https://wiki.petto.sbs/overview/introduction' },
      ],
    }));
  } catch (err) {
    logger.error(`Petto setup failed in guild ${guild.id}:`, err);
    await interaction.editReply({
      ...noticePayload(`${EMOJI.DENY} Setup could not be completed: ${err.message}`, COLORS.RED),
    }).catch(() => {});
  }
}

module.exports = { handleSetupModal };
