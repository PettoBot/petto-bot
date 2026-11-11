// i18n-ignore-file: the texts of the buttons are in the catalogs (moderation.bulkRole.button.*); what is in English here is the names of the keys and of the actions.
// The buttons under the card of a mass role job (`/role all|humans|has|bots|bots-remove`, `/role join apply`, the dashboard): a preview that has ended can be
// started for real or thrown away, and a job that runs can be paused, continued or cancelled. The card is the one that `utils/bulkRoleEngine.js` edits, so
// the buttons are drawn again with every edit; a click only changes the job in the database (the same calls as `/role job pause|resume|cancel`) and the
// engine follows. Written in TypeScript: `npm run build:ts` compiles it over src/utils/bulkRoleButtons.js, which is what the bot loads.
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  type ButtonInteraction, type ContainerBuilder,
} from 'discord.js';

export const BULK_ROLE_BUTTON_PREFIX = 'bulkrole';

export type BulkRoleAction = 'start' | 'discard' | 'pause' | 'resume' | 'cancel';
const ACTIONS: readonly BulkRoleAction[] = ['start', 'discard', 'pause', 'resume', 'cancel'];

/** The columns of a row of `bulk_role_jobs` that the buttons read. */
export interface BulkRoleJob {
  id: number | string;
  guild_id: string;
  status: string;
  paused?: boolean;
  dry_run?: boolean;
  action: string;
  target_role_id: string;
  member_type: string;
  filter_role_ids?: string[];
  filter_mode?: string;
  filter_exclude?: boolean;
  joined_after?: string | null;
  joined_before?: string | null;
  min_roles?: number | null;
  max_roles?: number | null;
  skip_pending?: boolean;
  reason?: string | null;
  progress_channel_id?: string | null;
  progress_message_id?: string | null;
}

interface JobsDb {
  getJob(id: number | string): Promise<BulkRoleJob | null>;
  getActiveJob(guildId: string): Promise<BulkRoleJob | null>;
  createJob(row: Record<string, unknown>): Promise<BulkRoleJob>;
  updateJob(id: number | string, patch: Record<string, unknown>): Promise<unknown>;
  setPaused(id: number | string, guildId: string, paused: boolean): Promise<boolean>;
  cancelJob(id: number | string, guildId: string): Promise<void>;
}

// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const jobsDb = require('../db/bulkRoleJobs') as JobsDb;
const icons = require('../music/icons') as Record<string, string>;
const { EMOJI } = require('./emojis') as { EMOJI: Record<string, string> };
const { t, languageOf } = require('../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; languageOf: (interaction: unknown) => Promise<string> };
const { textCard } = require('./caseCard') as { textCard: (text: string, color?: number | null) => ContainerBuilder };
const plan = require('./bulkRolePlan') as {
  buildCardText: (lang: string, job: BulkRoleJob, options?: { dangerous?: bigint }) => { text: string; color: number | null };
  checkTargetRole: (input: { guildId: string; role: unknown; botMember: unknown }) => string | null;
  dangerousBits: (role: unknown) => bigint;
};

/**
 * Which buttons a card gets, from the state of the job: a preview that ended has `start` and `discard`; a job that runs has `pause` (or `resume` when it is paused)
 * and `cancel`; a job that ended in any other way has none.
 */
export function actionsFor(job: Pick<BulkRoleJob, 'status' | 'paused' | 'dry_run'>): BulkRoleAction[] {
  if (job.status === 'completed' && job.dry_run) return ['start', 'discard'];
  if (job.status === 'pending' || job.status === 'running') return [job.paused ? 'resume' : 'pause', 'cancel'];
  return [];
}

const LOOKS: Record<BulkRoleAction, { emoji: () => string; style: ButtonStyle }> = {
  start: { emoji: () => icons.PLAY, style: ButtonStyle.Success },
  discard: { emoji: () => EMOJI.DELETE, style: ButtonStyle.Secondary },
  pause: { emoji: () => icons.PAUSE, style: ButtonStyle.Secondary },
  resume: { emoji: () => icons.PLAY, style: ButtonStyle.Success },
  cancel: { emoji: () => icons.STOP, style: ButtonStyle.Danger },
};

/** `bulkrole:<action>:<job number>`. */
export const customIdOf = (action: BulkRoleAction, jobId: number | string): string => `${BULK_ROLE_BUTTON_PREFIX}:${action}:${jobId}`;

/** The row of buttons of a job, or null when its state has none. */
export function buttonRow(job: BulkRoleJob, lang: string): ActionRowBuilder<ButtonBuilder> | null {
  const actions = actionsFor(job);
  if (!actions.length) return null;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(actions.map((action) => new ButtonBuilder()
    .setCustomId(customIdOf(action, job.id))
    .setEmoji(LOOKS[action].emoji())
    .setLabel(t(lang, `moderation.bulkRole.button.${action}`))
    .setStyle(LOOKS[action].style)));
}

/** The card with its buttons (the same card when there are none). */
export function withButtons(card: ContainerBuilder, job: BulkRoleJob, lang: string): ContainerBuilder {
  const row = buttonRow(job, lang);
  return row ? card.addActionRowComponents(row) : card;
}

/** `bulkrole:<action>:<job number>` as `{ action, jobId }`, or null when it is not one of these buttons. */
export function parseCustomId(customId: string): { action: BulkRoleAction; jobId: string } | null {
  const [prefix, action, jobId] = String(customId).split(':');
  if (prefix !== BULK_ROLE_BUTTON_PREFIX || !(ACTIONS as readonly string[]).includes(action) || !/^\d{1,18}$/.test(jobId ?? '')) return null;
  return { action: action as BulkRoleAction, jobId };
}

/** A job that has ended, drawn as it is, without buttons, and a line on what became of it. */
function closedCard(lang: string, job: BulkRoleJob, note: string, dangerous: bigint): ContainerBuilder {
  const { text, color } = plan.buildCardText(lang, job, { dangerous });
  return textCard(`${text}\n\n${note}`.slice(0, 3900), color);
}

/**
 * A click on one of the buttons. Only Administrators (the same as the commands). It answers in private when it cannot do what was asked; otherwise it
 * changes the job and lets the card follow. Never throws to the caller for something a person did.
 */
export async function handleBulkRoleButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseCustomId(interaction.customId);
  const lang = await languageOf(interaction);
  const refuse = (key: string, vars: Record<string, unknown> = {}): Promise<unknown> => interaction.reply({ content: t(lang, key, vars), flags: MessageFlags.Ephemeral });
  if (!parsed || !interaction.guildId) { await refuse('moderation.bulkRole.button.gone'); return; }
  if (!interaction.memberPermissions?.has('Administrator')) { await refuse('moderation.bulk.needsAdmin'); return; }

  const job = await jobsDb.getJob(parsed.jobId).catch(() => null);
  if (!job || job.guild_id !== interaction.guildId) { await refuse('moderation.bulkRole.button.gone'); return; }
  const { action } = parsed;
  // A card that was left behind: the buttons it has are not the ones the job has now.
  if (!actionsFor(job).includes(action)) { await refuse('moderation.bulkRole.button.gone'); return; }

  if (action === 'pause' || action === 'resume') {
    await jobsDb.setPaused(job.id, interaction.guildId, action === 'pause');
    await interaction.deferUpdate(); // the engine looks at the job every few seconds and edits the card
    return;
  }
  if (action === 'cancel') {
    await jobsDb.cancelJob(job.id, interaction.guildId);
    await interaction.deferUpdate();
    return;
  }

  const guild = interaction.guild;
  const role = guild?.roles.cache.get(job.target_role_id) ?? null;
  const dangerous = job.action === 'add' ? plan.dangerousBits(role) : 0n;
  const user = `<@${interaction.user.id}>`;

  if (action === 'discard') {
    await interaction.update({ components: [closedCard(lang, job, t(lang, 'moderation.bulkRole.button.discarded', { user }), dangerous)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
    return;
  }

  // start: the same job without the preview, for the same members.
  if (await jobsDb.getActiveJob(interaction.guildId)) { await refuse('moderation.role.mass.alreadyRunning'); return; }
  const refusal = plan.checkTargetRole({ guildId: interaction.guildId, role, botMember: guild?.members.me });
  if (refusal) { await refuse(`moderation.bulkRole.card.error.${refusal}`, { text: '' }); return; }

  const real = await jobsDb.createJob({
    guild_id: interaction.guildId,
    action: job.action,
    target_role_id: job.target_role_id,
    member_type: job.member_type,
    filter_role_ids: job.filter_role_ids ?? [],
    filter_mode: job.filter_mode ?? 'any',
    filter_exclude: Boolean(job.filter_exclude),
    joined_after: job.joined_after ?? null,
    joined_before: job.joined_before ?? null,
    min_roles: job.min_roles ?? null,
    max_roles: job.max_roles ?? null,
    skip_pending: Boolean(job.skip_pending),
    dry_run: false,
    reason: job.reason ?? null,
    started_by: interaction.user.id,
    source: 'discord',
    notify_channel_id: null,
  });
  // The preview stays as it was, now without buttons (so it cannot be started twice), and the job that is real gets its own card.
  await interaction.update({ components: [closedCard(lang, job, t(lang, 'moderation.bulkRole.button.started', { id: real.id, user }), dangerous)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  const { text, color } = plan.buildCardText(lang, real, { dangerous });
  const message = await interaction.followUp({ components: [withButtons(textCard(text, color), real, lang)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
  const channelId = message.channelId ?? interaction.channelId;
  await jobsDb.updateJob(real.id, { progress_channel_id: channelId, progress_message_id: message.id });
  // Read here and not at the top: the engine loads this file for the buttons it draws.
  const { runJob } = require('../jobs/bulkRoleJob') as { runJob: (client: unknown, job: BulkRoleJob) => unknown };
  runJob(interaction.client, { ...real, progress_channel_id: channelId, progress_message_id: message.id });
}
