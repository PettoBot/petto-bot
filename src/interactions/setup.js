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
const { t, tn, languageOf } = require('../i18n');

function selectedChannel(fields, customId) {
  return fields.getSelectedChannels(customId)?.first?.() ?? null;
}

function moderationModeLabel(mode, lang) {
  return ['balanced', 'strict', 'disabled'].includes(mode) ? t(lang, `setup.mode.${mode}`) : mode;
}

function autoModSummary(result, lang) {
  if (!result) return { status: 'warn', text: t(lang, 'setup.result.automod.unchecked') };
  if (result.reason === 'disabled_by_setup') return { status: 'skip', text: t(lang, 'setup.result.automod.modeDisabled') };
  if (result.reason === 'not_selected') return { status: 'skip', text: t(lang, 'setup.result.automod.notSelected') };

  if (result.missingPermissions) {
    return { status: 'warn', text: t(lang, 'setup.result.automod.noAccess') };
  }
  if (result.failed > 0) {
    return { status: 'warn', text: t(lang, 'setup.result.automod.partial', { created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed }) };
  }
  return { status: 'ok', text: t(lang, 'setup.result.automod.done', { created: result.created, updated: result.updated, existing: result.existing }) };
}

async function configureLogChannel(client, guild, channel, lang) {
  const me = guild.members.me;
  const permissions = channel.permissionsFor(me);
  if (!permissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ManageWebhooks,
  ])) {
    throw new Error(t(lang, 'setup.result.logs.missingPermissions', { channel: `<#${channel.id}>` }));
  }

  const config = await getLogConfig(guild.id, { force: true });

  if (!config.webhooks.some((webhook) => webhook.channel_id === channel.id)) {
    const webhook = await channel.createWebhook({
      name: 'Petto logs', // i18n-ignore: the name of Petto's webhook, never translated
      avatar: client.user.displayAvatarURL({ extension: 'png', size: 256 }),
      reason: t(lang, 'setup.reason.webhook'),
    });
    await upsertWebhook(guild.id, channel.id, webhook.id, webhook.token);
  }

  const routed = new Set(config.entries.filter((entry) => entry.channel_id === channel.id).map((entry) => entry.event));
  const missing = EVENTS.filter((event) => !routed.has(event));
  await addEntries(guild.id, channel.id, missing);
  return missing.length;
}

/** Runs a step and turns its outcome into a line of the result card. A failing step never stops the others. */
// `label` only names the step in the logs.
async function runStep(label, work, lang) {
  const outcome = await settle(Promise.resolve().then(work));
  if (outcome.ok) return { label, ...outcome.value };
  logger.warn(`Setup step "${label}" failed: ${outcome.error?.message ?? outcome.error}`);
  return { label, status: 'fail', text: outcome.error?.message ?? t(lang, 'setup.result.unexpected') };
}

const STATUS_ICON = { ok: EMOJI.APPROVE, warn: EMOJI.WARNING, fail: EMOJI.DENY, skip: EMOJI.RELEASE_MINUS };

async function handleSetupModal(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ ...noticePayload(t(lang, 'setup.noPermission'), COLORS.RED), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
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
      ...noticePayload(t(lang, 'setup.result.badPrefix'), COLORS.RED),
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
        return { status: 'ok', text: t(lang, 'setup.result.prefix', { prefix }) };
      }, lang),

      runStep('Moderation', async () => {
        await upsertAutomodConfig(guild.id, {
          anti_spam_enabled: !disabled && features.has('anti-spam'),
          anti_raid_enabled: !disabled && features.has('anti-raid'),
          raid_action: strict ? 'kick' : 'alert',
          anti_alt_enabled: !disabled && features.has('anti-alt'),
          anti_alt_action: strict ? 'kick' : 'flag',
        });
        return { status: 'ok', text: t(lang, 'setup.result.mode', { mode: moderationModeLabel(mode, lang) }) };
      }, lang),

      runStep('Welcome', async () => {
        const existing = await getMemberConfig(guild.id).catch(() => null);
        const patch = { welcome_channel_id: welcomeEnabled ? welcomeChannel.id : null };
        if (welcomeEnabled && !existing?.welcome_message && !existing?.welcome_embed_template) {
          // i18n-ignore-next-line: stored in English on purpose, the welcome module translates this default when it sends it
          patch.welcome_message = 'Welcome {user.mention} to {server.name}!';
        }
        await upsertMemberConfig(guild.id, patch);
        if (welcomeEnabled) return { status: 'ok', text: t(lang, 'setup.result.welcome.enabled', { channel: `<#${welcomeChannel.id}>` }) };
        return { status: 'skip', text: t(lang, features.has('welcome') ? 'setup.result.welcome.noChannel' : 'setup.result.welcome.disabled') };
      }, lang),

      // i18n-ignore-next-line: the step name is only for the logs
      runStep('Audit logs', async () => {
        if (!features.has('logs')) return { status: 'skip', text: t(lang, 'setup.result.logs.unchanged') };
        if (!logChannel) return { status: 'warn', text: t(lang, 'setup.result.logs.noChannel') };
        const added = await configureLogChannel(interaction.client, guild, logChannel, lang);
        const channel = `<#${logChannel.id}>`;
        return { status: 'ok', text: added ? tn(lang, 'setup.result.logs.added', added, { count: added, channel }) : t(lang, 'setup.result.logs.already', { channel }) };
      }, lang),

      // i18n-ignore-next-line: the step name is only for the logs
      runStep('Official AutoMod', async () => {
        if (disabled) return autoModSummary({ reason: 'disabled_by_setup' }, lang);
        if (!features.has('official-automod')) return autoModSummary({ reason: 'not_selected' }, lang);
        const result = await syncGuildAutoMod(guild).catch((err) => {
          logger.warn(`[AutoMod] Setup synchronization failed for guild ${guild.id}: ${err.message}`);
          return null;
        });
        return autoModSummary(result, lang);
      }, lang),

      // i18n-ignore-next-line: the step name is only for the logs
      runStep('Setup channel', async () => {
        const channel = await ensureAdminSetupChannel(guild, lang).catch((err) => {
          logger.warn(`Could not create private setup channel in guild ${guild.id}: ${err.message}`);
          return null;
        });
        return channel
          ? { status: 'ok', text: t(lang, 'setup.result.setupChannel', { channel: `<#${channel.id}>` }), channelId: channel.id }
          : { status: 'warn', text: t(lang, 'setup.result.noSetupChannel') };
      }, lang),
    ]);

    invalidateSetupState(guild.id);

    const failed = steps.filter((step) => step.status === 'fail').length;
    const warned = steps.filter((step) => step.status === 'warn').length;
    const setupChannelId = steps.find((step) => step.channelId)?.channelId;

    await interaction.editReply(infoPayload({
      accent: failed ? COLORS.RED : warned ? COLORS.YELLOW : COLORS.GREEN,
      title: failed ? t(lang, 'setup.result.titleProblems', { emoji: EMOJI.WARNING }) : t(lang, 'setup.result.titleSaved', { emoji: EMOJI.APPROVE }),
      thumbnail: guild.iconURL({ size: 256 }),
      subtitle: [guild.name, failed ? tn(lang, 'setup.result.failed', failed, { count: failed }) : t(lang, warned ? 'setup.result.warned' : 'setup.result.allSaved')],
      sections: [
        { title: t(lang, 'setup.result.section'), lines: steps.map((step) => `${STATUS_ICON[step.status] ?? EMOJI.RELEASE_MINUS} ${step.text}`) },
        { title: t(lang, 'setup.result.next'), lines: [t(lang, 'setup.result.nextHint', { prefix })] },
      ],
      buttons: [
        setupChannelId ? { label: t(lang, 'setup.result.openChannel.button'), url: `https://discord.com/channels/${guild.id}/${setupChannelId}` } : null,
        { label: t(lang, 'setup.docs.button'), url: 'https://wiki.petto.sbs/overview/introduction' },
      ],
    }));
  } catch (err) {
    logger.error(`Petto setup failed in guild ${guild.id}:`, err);
    await interaction.editReply({
      ...noticePayload(t(lang, 'setup.result.error', { emoji: EMOJI.DENY, error: err.message }), COLORS.RED),
    }).catch(() => {});
  }
}

module.exports = { handleSetupModal };
