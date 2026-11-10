const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/verificationConfig');
const { getTemplate } = require('../../db/embedTemplates');
const { ensureUnverifiedRole } = require('../../utils/verifyRole');
const { postPanel } = require('../../utils/verifyPanel');
const { linkProblem, verifyLinkFor } = require('../../utils/verifyLink');
const { sendVerifyDM } = require('../../utils/verifyMessage');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const config = require('../../config');
const logger = require('../../utils/logger');
const { t, languageOf } = require('../../i18n');

const { methodOf, usesTurnstile, usesLink } = require('../../utils/verifyMethod');
const { normalizeChecks, applyChange, needsWebPage } = require('../../utils/verifyChecks');

// How often the answer of `/verify setup` shows the channels done while a new gate role is set up (each edit is a request too).
const PROGRESS_EVERY_MS = 3_000;

const methodLabel = (lang, method) => t(lang, `verify.method.${method}`);

// The link and its secret are always needed; the Cloudflare keys only for the servers that use that check.
const LINK_CONFIGURED = () => !linkProblem();
// Inside Discord there is no link: only the secret that signs the picture is needed.
const SECRET_CONFIGURED = () => Boolean(config.verifyTokenSecret);
const TURNSTILE_CONFIGURED = () => Boolean(config.turnstileSiteKey && config.turnstileSecretKey);
const ENV_CONFIGURED = (method = 'turnstile') => (usesLink(method) ? LINK_CONFIGURED() : SECRET_CONFIGURED()) && (!usesTurnstile(method) || TURNSTILE_CONFIGURED());

module.exports = {
  checksLines,
  aliases: ['vf'],
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Configure the join-verification gate (Cloudflare check, letters, or both).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Enable/disable verification and set the optional bonus role.')
        .addBooleanOption((o) => o.setName('enabled').setDescription('Turn verification on/off').setRequired(true))
        .addRoleOption((o) => o.setName('verified_role').setDescription('Optional role to grant once someone passes verification').setRequired(false))
        .addStringOption((o) => o.setName('method').setDescription('How members prove they are human').setRequired(false).addChoices({ name: 'Cloudflare check', value: 'turnstile' }, { name: 'Letters in a picture', value: 'letters' }, { name: 'Both', value: 'both' }, { name: 'Letters inside Discord (no link)', value: 'discord' })),
    )
    .addSubcommand((s) => s.setName('template').setDescription('Use a saved embed for the DMs of verification, or none to go back to the usual one.')
      .addStringOption((o) => o.setName('which').setDescription('Which message').setRequired(true).addChoices({ name: 'prompt', value: 'prompt' }, { name: 'verified', value: 'verified' }))
      .addStringOption((o) => o.setName('template').setDescription('Saved embed name, or none. Leave it empty to see what is in use').setRequired(false)))
    .addSubcommand((s) => s.setName('channel').setDescription('Post the verification panel in a channel, so members can verify there too.').addChannelOption((o) => o.setName('channel').setDescription('The channel for the panel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('checks').setDescription('See or change the extra checks: Tor, alt accounts, the Discord account and the email code.')
      .addStringOption((o) => o.setName('check').setDescription('Which check to change (leave it empty to see them all)').setRequired(false).addChoices({ name: 'Tor', value: 'tor' }, { name: 'Alt accounts', value: 'alt' }, { name: 'Discord account', value: 'account' }, { name: 'Email code', value: 'email' }))
      .addStringOption((o) => o.setName('mode').setDescription('off, warn or block; for the email code, on or off').setRequired(false).addChoices({ name: 'off', value: 'off' }, { name: 'warn', value: 'warn' }, { name: 'block', value: 'block' }, { name: 'on', value: 'on' }))
      .addIntegerOption((o) => o.setName('min_age').setDescription('Discord account: minimum age in days (0 for none)').setMinValue(0).setMaxValue(365).setRequired(false))
      .addBooleanOption((o) => o.setName('avatar').setDescription('Discord account: ask for an avatar').setRequired(false))
      .addBooleanOption((o) => o.setName('flagged').setDescription('Discord account: refuse accounts flagged by Discord').setRequired(false))
      .addBooleanOption((o) => o.setName('common').setDescription('Email: accept only well-known providers (Gmail, Outlook, Yahoo, iCloud, Proton...)').setRequired(false))
      .addBooleanOption((o) => o.setName('disposable').setDescription('Email: refuse throwaway emails').setRequired(false))
      .addStringOption((o) => o.setName('allow').setDescription('Email: accept only these domains, separated by commas (none to clear)').setRequired(false))
      .addStringOption((o) => o.setName('deny').setDescription('Email: never accept these domains, separated by commas (none to clear)').setRequired(false)))
    .addSubcommand((s) => s.setName('status').setDescription('Show the current verification setup.'))
    .addSubcommand((s) => s.setName('send').setDescription('Manually (re)send a verification link to a member.').addUserOption((o) => o.setName('user').setDescription('The member to send a link to').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const lang = await languageOf(interaction);
    if (sub === 'setup') return setup(interaction, lang);
    if (sub === 'status') return status(interaction, lang);
    if (sub === 'template') return setTemplate(interaction, lang);
    if (sub === 'channel') return panel(interaction, lang);
    if (sub === 'checks') return checks(interaction, lang);
    return send(interaction, lang);
  },
};

/** The lines that tell the checks of a server, in a language. */
function checksLines(current, lang, settings = {}) {
  const mode = (value) => t(lang, `verify.checks.mode.${value}`);
  const details = [];
  if (current.account.min_age_days > 0) details.push(t(lang, 'verify.checks.minAge', { days: current.account.min_age_days }));
  if (current.account.no_avatar) details.push(t(lang, 'verify.checks.noAvatar'));
  if (current.account.flagged) details.push(t(lang, 'verify.checks.notFlagged'));
  const rules = [];
  if (current.email.allowed_domains.length) rules.push(t(lang, 'verify.checks.onlyDomains', { domains: current.email.allowed_domains.join(', ') }));
  else if (current.email.common_only) rules.push(t(lang, 'verify.checks.commonOnly'));
  else if (current.email.block_disposable) rules.push(t(lang, 'verify.checks.noDisposable'));
  if (current.email.blocked_domains.length) rules.push(t(lang, 'verify.checks.notDomains', { domains: current.email.blocked_domains.join(', ') }));
  const lines = [
    t(lang, 'verify.checks.title'),
    t(lang, 'verify.checks.tor', { mode: mode(current.tor) }),
    t(lang, 'verify.checks.alt', { mode: mode(current.alt) }),
    t(lang, 'verify.checks.account', { mode: mode(current.account.mode), details: current.account.mode !== 'off' && details.length ? ` · ${details.join(' · ')}` : '' }),
    t(lang, 'verify.checks.email', { value: t(lang, current.email.required ? 'verify.checks.emailOn' : 'verify.checks.emailOff') }),
  ];
  if (current.email.required) lines.push(t(lang, 'verify.checks.emailRules', { rules: rules.length ? rules.join(' · ') : t(lang, 'verify.checks.anyDomain') }));
  if (needsWebPage(current) && !usesLink(methodOf(settings))) lines.push(t(lang, 'verify.checks.needsPage', { emoji: EMOJI.ALERT }));
  return lines;
}

/** `!verify checks`: shows the extra checks of the verification, or changes one. */
async function checks(interaction, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const settings = (await getConfig(interaction.guild.id)) ?? {};
  let current = normalizeChecks(settings.checks);
  const which = interaction.options.getString('check');
  let saved = false;
  if (which) {
    const changed = applyChange(current, {
      check: which,
      mode: interaction.options.getString('mode'),
      minAge: interaction.options.getInteger('min_age'),
      avatar: interaction.options.getBoolean('avatar'),
      flagged: interaction.options.getBoolean('flagged'),
      common: interaction.options.getBoolean('common'),
      disposable: interaction.options.getBoolean('disposable'),
      allow: interaction.options.getString('allow'),
      deny: interaction.options.getString('deny'),
    });
    if (!changed.ok) return interaction.editReply({ components: [textCard(t(lang, 'verify.checks.usage', { emoji: EMOJI.DENY }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    current = changed.checks;
    await upsertConfig(interaction.guild.id, { checks: current });
    saved = true;
  }
  const lines = checksLines(current, lang, settings);
  if (saved) lines.unshift(t(lang, 'verify.checks.saved', { emoji: EMOJI.APPROVE }));
  return interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

async function panel(interaction, lang) {
  const channel = interaction.options.getChannel('channel', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const settings = (await getConfig(interaction.guild.id)) ?? {};
  const done = (text, color = 0xa5ea7a) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });
  if (!settings.enabled) return done(t(lang, 'verify.panel.turnOnFirst'), 0xfe6465);
  const method = methodOf(settings);
  if (!ENV_CONFIGURED(method)) return done(t(lang, 'verify.panel.envMissing', { emoji: EMOJI.DENY }), 0xfe6465);
  try {
    await postPanel(interaction.guild, settings, channel);
    const letters = method === 'letters' || method === 'discord';
    const which = usesLink(method) ? (letters ? 'both' : 'link') : 'letters';
    return done(t(lang, `verify.panel.posted.${which}`, { emoji: EMOJI.APPROVE, channel: `${channel}` }));
  } catch (err) {
    logger.error('Failed to post the verification panel:', err);
    return done(t(lang, 'verify.panel.failed', { emoji: EMOJI.DENY, error: err.message }), 0xfe6465);
  }
}

async function setTemplate(interaction, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const which = interaction.options.getString('which', true).trim().toLowerCase();
  if (!['prompt', 'verified'].includes(which)) return interaction.editReply({ components: [textCard(t(lang, 'verify.template.choose'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  const column = `${which}_embed_template`;
  const name = String(interaction.options.getString('template') ?? '').trim();
  const done = (text, color = 0xa5ea7a) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });
  if (!name) {
    const { templateHint } = require('../../utils/templateHint');
    const current = await getConfig(interaction.guild.id).catch(() => null);
    return done(await templateHint(interaction.guild.id, { current: current?.[column] ?? null, usage: t(lang, 'verify.template.usage', { which }), what: t(lang, `verify.template.what.${which}`), lang }));
  }
  if (name.toLowerCase() === 'none') {
    await upsertConfig(interaction.guild.id, { [column]: null });
    return done(t(lang, `verify.template.reset.${which}`, { emoji: EMOJI.APPROVE }));
  }
  const doc = await getTemplate(interaction.guild.id, name).catch(() => null);
  if (!doc) return done(t(lang, 'verify.template.notFound', { name }), 0xfe6465);
  await upsertConfig(interaction.guild.id, { [column]: doc.name });
  return done(t(lang, `verify.template.set.${which}`, { emoji: EMOJI.APPROVE, name: doc.name }));
}

async function setup(interaction, lang) {
  const enabled = interaction.options.getBoolean('enabled', true);
  const verifiedRole = interaction.options.getRole('verified_role');
  const chosenMethod = interaction.options.getString('method');

  if (enabled && !interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({ content: t(lang, 'verify.setup.needManageRoles'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  await ensureGuild(interaction.guild.id);
  const existing = (await getConfig(interaction.guild.id)) ?? {};

  const patch = { enabled };
  if (verifiedRole) patch.verified_role_id = verifiedRole.id;
  if (chosenMethod) patch.method = chosenMethod;
  const saved = await upsertConfig(interaction.guild.id, patch);

  let roleLine = '';
  if (enabled) {
    try {
      // A new gate role edits every channel (one request each): on a big server that takes a while, so the answer says how far it is.
      let shownAt = Date.now();
      const onProgress = ({ phase, done, total }) => {
        if (phase !== 'channels' || !total || done >= total || Date.now() - shownAt < PROGRESS_EVERY_MS) return;
        shownAt = Date.now();
        interaction.editReply({ components: [textCard(t(lang, 'verify.job.channels', { done, total }))], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
      };
      const role = await ensureUnverifiedRole(interaction.guild, { ...existing, ...saved }, { onProgress });
      roleLine = t(lang, 'verify.setup.gateRole', { role: `${role}` });
    } catch (err) {
      logger.error('Failed to provision unverified role:', err);
      await interaction.editReply({ components: [textCard(t(lang, 'verify.setup.gateFailed', { emoji: EMOJI.DENY, error: err.message }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  const method = methodOf({ ...existing, ...saved });
  const envLine = ENV_CONFIGURED(method) ? '' : t(lang, 'verify.setup.envMissing', { emoji: EMOJI.ALERT });

  const text = [
    t(lang, enabled ? 'verify.setup.enabled' : 'verify.setup.disabled', { emoji: EMOJI.APPROVE }),
    roleLine,
    verifiedRole ? t(lang, 'verify.bonusRole', { role: `${verifiedRole}` }) : '',
    t(lang, 'verify.check', { method: methodLabel(lang, method) }),
    envLine,
  ].filter(Boolean).join('\n');
  await interaction.editReply({ components: [textCard(text, enabled ? 0xa5ea7a : 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function status(interaction, lang) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const verifyConfig = await getConfig(interaction.guild.id);
  if (!verifyConfig) {
    await interaction.editReply({ components: [textCard(t(lang, 'verify.status.never'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const lines = [
    t(lang, 'verify.status.title'),
    t(lang, 'verify.status.enabled', { value: verifyConfig.enabled ? t(lang, 'verify.status.yes', { emoji: EMOJI.APPROVE }) : t(lang, 'verify.status.no', { emoji: EMOJI.DENY }) }),
    t(lang, 'verify.status.gateRole', { role: verifyConfig.unverified_role_id ? `<@&${verifyConfig.unverified_role_id}>` : t(lang, 'verify.status.notCreated') }),
    t(lang, 'verify.bonusRole', { role: verifyConfig.verified_role_id ? `<@&${verifyConfig.verified_role_id}>` : t(lang, 'verify.status.none') }),
    t(lang, 'verify.check', { method: methodLabel(lang, methodOf(verifyConfig)) }),
    t(lang, 'verify.status.panelChannel', { channel: verifyConfig.panel_channel_id ? `<#${verifyConfig.panel_channel_id}>` : t(lang, 'verify.status.noPanel') }),
    t(lang, 'verify.status.env', { value: ENV_CONFIGURED(methodOf(verifyConfig)) ? t(lang, 'verify.status.configured', { emoji: EMOJI.APPROVE }) : t(lang, 'verify.status.missing', { emoji: EMOJI.DENY }) }),
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'))], flags: MessageFlags.IsComponentsV2 });
}

async function send(interaction, lang) {
  const targetUser = interaction.options.getUser('user', true);

  const sendConfig = (await getConfig(interaction.guild.id).catch(() => null)) ?? {};
  if (!ENV_CONFIGURED(methodOf(sendConfig))) {
    await interaction.reply({ content: t(lang, 'verify.send.envMissing'), flags: MessageFlags.Ephemeral });
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!targetMember) {
    await interaction.reply({ content: t(lang, 'verify.send.notMember'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  await ensureGuild(interaction.guild.id);
  const verifyConfig = (await getConfig(interaction.guild.id)) ?? {};

  if (verifyConfig.enabled) {
    // A new check asked by the staff: what the member passed before no longer counts (utils/verifyState.js), or the gate role would be taken off with no check.
    await require('../../db/verificationRedemptions').forgetVerification(interaction.guild.id, targetMember.id).catch((err) => logger.warn(`Could not forget the verification of ${targetMember.id}: ${err.message}`));
    const role = await ensureUnverifiedRole(interaction.guild, verifyConfig);
    if (!targetMember.roles.cache.has(role.id)) {
      await targetMember.roles.add(role, t(lang, 'verify.reason.resent')).catch((err) => logger.warn('Could not add gate role:', err.message));
    }
  }

  const link = usesLink(methodOf(verifyConfig)) ? verifyLinkFor(targetUser.id, interaction.guild.id).url ?? null : null;

  const dmSent = await sendVerifyDM(targetMember, { guild: interaction.guild, link, lang })
    .then(() => true)
    .catch(() => false);

  const text = dmSent ? t(lang, 'verify.send.sent', { emoji: EMOJI.APPROVE, user: `${targetUser}` }) : t(lang, link ? 'verify.send.failedLink' : 'verify.send.failed', { emoji: EMOJI.DENY, user: `${targetUser}`, link });
  await interaction.editReply({ components: [textCard(text, dmSent ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}
