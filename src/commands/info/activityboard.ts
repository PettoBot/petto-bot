// `/activityboard`: the activity leaderboards of a server (chat and voice, each with the cards of the periods the server chose: the month, the week and the day, edited about every 5 minutes).
// `set` chooses the channel of one kind (and which cards it has) and writes the cards at once, `remove` takes them away, `status` says where they are and `refresh` writes them again now.
// `role-set` chooses a role that goes to the most active member of the week (chat or voice) when the week ends, `role-remove` stops it and `role-status` says who has it.
// Written in TypeScript: `npm run build:ts` compiles it over src/commands/info/activityboard.js, which is what the bot loads.
import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, ContainerBuilder } from 'discord.js';
import db = require('../../db/activityLeaderboards');
import type { Kind, Period } from '../../db/activityLeaderboards';
import roleDb = require('../../db/activityTopRoles');
import { deleteBoardMessages, refreshBoard, statsReason, writableChannel } from '../../utils/activityLeaderboard';
import type { Reason } from '../../utils/activityLeaderboard';
import { roleProblem, takeRoleFromHolder } from '../../utils/activityTopRole';
import type { RoleReason } from '../../utils/activityTopRole';

const { t, languageOf } = require('../../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; languageOf: (interaction: unknown) => Promise<string> };
const { textCard } = require('../../utils/caseCard') as { textCard: (text: string, color?: number | null) => ContainerBuilder };
const { EMOJI } = require('../../utils/emojis') as { EMOJI: Record<string, string> };

const V2 = MessageFlags.IsComponentsV2;
/** One `refresh` for each server in this time: it reads the database and edits up to six messages. */
const REFRESH_COOLDOWN_MS = 60_000;
const lastRefresh = new Map<string, number>();

/** The cards a board can have: every period, one of them, or two. The value is the periods joined by `-`, longest first. */
const PERIOD_CHOICES: Record<string, Period[]> = {
  all: ['monthly', 'weekly', 'daily'],
  monthly: ['monthly'],
  weekly: ['weekly'],
  daily: ['daily'],
  'monthly-weekly': ['monthly', 'weekly'],
  'monthly-daily': ['monthly', 'daily'],
  'weekly-daily': ['weekly', 'daily'],
};

const kindOption = (required: boolean) => (option: import('discord.js').SlashCommandStringOption) => option
  .setName('type').setDescription('Which leaderboards').setRequired(required)
  .addChoices({ name: 'Chat (messages)', value: 'chat' }, { name: 'Voice (minutes)', value: 'voice' });

const command = {
  aliases: ['actlb'],
  // Also a slash command of its own (it is not inside an umbrella): the leaderboards are set with `/activityboard`, and with the prefix `!activityboard`.
  registerSlash: true,
  data: new SlashCommandBuilder()
    .setName('activityboard')
    .setDescription('Leaderboards of the most active members, in a channel, updated every few minutes.')
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName('set').setDescription('Post the leaderboards (month, week and day, or only some of them) in a channel.')
      .addStringOption(kindOption(true))
      .addChannelOption((option) => option.setName('channel').setDescription('The channel where they are posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addStringOption((option) => option.setName('periods').setDescription('Which cards (default: all three; when it is already set, the ones it has)').setRequired(false)
        .addChoices(
          { name: 'All: month, week and day', value: 'all' },
          { name: 'Month only', value: 'monthly' },
          { name: 'Week only', value: 'weekly' },
          { name: 'Day only', value: 'daily' },
          { name: 'Month and week', value: 'monthly-weekly' },
          { name: 'Month and day', value: 'monthly-daily' },
          { name: 'Week and day', value: 'weekly-daily' },
        )))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Stop the leaderboards of a kind and delete their messages.').addStringOption(kindOption(true)))
    .addSubcommand((sub) => sub.setName('status').setDescription('See where the leaderboards are and when they were last updated.'))
    .addSubcommand((sub) => sub.setName('refresh').setDescription('Write the leaderboards again now.').addStringOption(kindOption(false)))
    .addSubcommand((sub) => sub.setName('role-set').setDescription('Give a role to the most active member of the week, when the week ends.')
      .addStringOption(kindOption(true))
      .addRoleOption((option) => option.setName('role').setDescription('The role for the number 1 of the week').setRequired(true)))
    .addSubcommand((sub) => sub.setName('role-remove').setDescription('Stop giving the role of the most active member and take it from who has it.').addStringOption(kindOption(true)))
    .addSubcommand((sub) => sub.setName('role-status').setDescription('See the roles of the most active members and who has them.')),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = await languageOf(interaction);
    const guild = interaction.guild;
    if (!guild) return;
    const show = (text: string, ephemeral = false): Promise<unknown> => (interaction.deferred || interaction.replied
      ? interaction.editReply({ components: [textCard(text)], flags: V2, allowedMentions: { parse: [] } })
      : interaction.reply({ components: [textCard(text)], flags: ephemeral ? V2 | MessageFlags.Ephemeral : V2, allowedMentions: { parse: [] } }));
    const reasonText = (reason: Reason): string => t(lang, `leaderboards.error.${reason}`, { emoji: EMOJI.DENY });
    const reasonPlain = (reason: Reason): string => t(lang, `leaderboards.error.${reason}`, { emoji: '' }).trim(); // inside another sentence, which has its own icon
    const roleReasonPlain = (reason: RoleReason): string => t(lang, `leaderboards.roleError.${reason}`, { emoji: '' }).trim();
    const kindName = (kind: Kind): string => t(lang, `leaderboards.kind.${kind}`);
    const periodsText = (periods: readonly Period[] | undefined): string => db.cleanPeriods(periods).map((period) => t(lang, `leaderboards.periodName.${period}`)).join(', ');
    // The types of discord.js only list Ephemeral for a deferral; Discord accepts the flag of a Components V2 message there, as the rest of the bot does.
    const defer = (): Promise<unknown> => interaction.deferReply({ flags: V2 as never });

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await show(t(lang, 'leaderboards.needsManageServer', { emoji: EMOJI.DENY }), true);
      return;
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'set') {
      const kind = interaction.options.getString('type', true) as Kind;
      const picked = interaction.options.getChannel('channel', true);
      const blocked = statsReason(guild.id);
      if (blocked) { await show(reasonText(blocked), true); return; }
      const writable = writableChannel(guild, await guild.channels.fetch(picked.id).catch(() => null));
      if ('reason' in writable) { await show(reasonText(writable.reason), true); return; }
      await defer();
      const asked = interaction.options.getString('periods');
      const row = await db.upsertBoard(guild.id, kind, writable.channel.id, asked ? PERIOD_CHOICES[asked] ?? PERIOD_CHOICES.all : undefined);
      const result = await refreshBoard(interaction.client, row, { force: true });
      await show(result.ok
        ? t(lang, 'leaderboards.set.done', { emoji: EMOJI.APPROVE, kind: kindName(kind), channel: `<#${writable.channel.id}>`, periods: periodsText(row.periods) })
        : t(lang, 'leaderboards.set.failed', { emoji: EMOJI.DENY, channel: `<#${writable.channel.id}>`, reason: reasonPlain(result.reason ?? 'error') }));
      return;
    }

    if (sub === 'remove') {
      const kind = interaction.options.getString('type', true) as Kind;
      const row = await db.removeBoard(guild.id, kind);
      if (!row) { await show(t(lang, 'leaderboards.remove.none', { emoji: EMOJI.ALERT, kind: kindName(kind) }), true); return; }
      await defer();
      await deleteBoardMessages(interaction.client, row);
      await show(t(lang, 'leaderboards.remove.done', { emoji: EMOJI.APPROVE, kind: kindName(kind) }));
      return;
    }

    if (sub === 'status') {
      const rows = await db.listBoards(guild.id);
      if (!rows.length) { await show(t(lang, 'leaderboards.status.none', { emoji: EMOJI.ALERT }), true); return; }
      const lines = rows.map((row) => {
        const when = row.last_refreshed_at ? ` · ${t(lang, 'leaderboards.status.updated', { when: `<t:${Math.floor(new Date(row.last_refreshed_at).getTime() / 1000)}:R>` })}` : ` · ${t(lang, 'leaderboards.status.waiting')}`;
        const problem = row.last_error ? ` · ${reasonPlain(row.last_error as Reason)}` : '';
        return `${t(lang, 'leaderboards.status.line', { kind: kindName(row.kind), channel: `<#${row.channel_id}>` })}\n-# ${t(lang, 'leaderboards.status.periods', { list: periodsText(row.periods) })} ·${when.replace(' ·', '')}${problem}`;
      });
      await show([t(lang, 'leaderboards.status.title'), ...lines].join('\n'));
      return;
    }

    if (sub === 'role-set') {
      const kind = interaction.options.getString('type', true) as Kind;
      const picked = interaction.options.getRole('role', true);
      const blocked = statsReason(guild.id);
      if (blocked) { await show(reasonText(blocked), true); return; }
      const role = guild.roles.cache.get(picked.id) ?? await guild.roles.fetch(picked.id).catch(() => null);
      const problem = roleProblem(guild, role);
      if (problem) { await show(t(lang, `leaderboards.roleError.${problem}`, { emoji: EMOJI.DENY }), true); return; }
      const previous = (await roleDb.listRoles(guild.id)).find((row) => row.kind === kind);
      if (previous && previous.role_id !== picked.id) await takeRoleFromHolder(interaction.client, previous); // the old role does not stay on someone
      await roleDb.upsertRole(guild.id, kind, picked.id);
      await show(t(lang, 'leaderboards.role.set.done', { emoji: EMOJI.APPROVE, kind: kindName(kind), role: `<@&${picked.id}>` }));
      return;
    }

    if (sub === 'role-remove') {
      const kind = interaction.options.getString('type', true) as Kind;
      const row = await roleDb.removeRole(guild.id, kind);
      if (!row) { await show(t(lang, 'leaderboards.role.remove.none', { emoji: EMOJI.ALERT, kind: kindName(kind) }), true); return; }
      await defer();
      await takeRoleFromHolder(interaction.client, row);
      await show(t(lang, 'leaderboards.role.remove.done', { emoji: EMOJI.APPROVE, kind: kindName(kind) }));
      return;
    }

    if (sub === 'role-status') {
      const rows = await roleDb.listRoles(guild.id);
      if (!rows.length) { await show(t(lang, 'leaderboards.role.status.none', { emoji: EMOJI.ALERT }), true); return; }
      const lines = rows.map((row) => {
        const holder = row.holder_id ? t(lang, 'leaderboards.role.status.holder', { user: `<@${row.holder_id}>` }) : t(lang, 'leaderboards.role.status.nobody');
        const problem = row.last_error ? ` · ${roleReasonPlain(row.last_error as RoleReason)}` : '';
        return `${t(lang, 'leaderboards.role.status.line', { kind: kindName(row.kind), role: `<@&${row.role_id}>` })}\n-# ${holder}${problem}`;
      });
      await show([t(lang, 'leaderboards.role.status.title'), ...lines].join('\n'));
      return;
    }

    // refresh
    const asked = interaction.options.getString('type') as Kind | null;
    const last = lastRefresh.get(guild.id) ?? 0;
    if (Date.now() - last < REFRESH_COOLDOWN_MS) { await show(t(lang, 'leaderboards.refresh.wait', { emoji: EMOJI.ALERT }), true); return; }
    const rows = (await db.listBoards(guild.id)).filter((row) => !asked || row.kind === asked);
    if (!rows.length) { await show(t(lang, 'leaderboards.status.none', { emoji: EMOJI.ALERT }), true); return; }
    lastRefresh.set(guild.id, Date.now());
    await defer();
    const results = await Promise.all(rows.map((row) => refreshBoard(interaction.client, row, { force: true })));
    const failed = results.find((result) => !result.ok);
    await show(failed
      ? t(lang, 'leaderboards.refresh.failed', { emoji: EMOJI.DENY, reason: reasonPlain(failed.reason ?? 'error') })
      : t(lang, 'leaderboards.refresh.done', { emoji: EMOJI.APPROVE }));
  },
};

export = command;
