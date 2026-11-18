// Quick Setup: the guided setup of the dashboard. The page asks for everything in seven steps and nothing changes until the last one; then it sends all the
// answers here, and this makes the channels and roles that were asked for ("create a new one") and saves the settings of each module with the same stores the
// commands use (logs, automod, welcome, auto role, tickets, verification), so what it makes can be changed afterwards from the usual pages of the dashboard.
// A module that fails does not stop the others: the answer says, for each one, what was done or why not.
// Written in TypeScript: `npm run build:ts` compiles it over src/utils/quickSetup.js, which is what the bot loads.
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { Guild, GuildBasedChannel } from 'discord.js';

type Lang = string;
const { t, currentLanguage } = require('../i18n') as { t: (lang: Lang, key: string, values?: Record<string, unknown>) => string; currentLanguage: () => Lang };
const logger = require('./logger') as { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
const logConfig = require('../db/logConfig') as { addEntries: (guildId: string, channelId: string, events: string[]) => Promise<void> };
const automod = require('../db/automod') as { upsertConfig: (guildId: string, patch: Record<string, unknown>) => Promise<unknown> };
const automodRules = require('../db/automodRules') as { listRules: (guildId: string) => Promise<Array<{ template: string }>>; createRule: (guildId: string, row: Record<string, unknown>) => Promise<unknown> };
const memberEvents = require('../db/memberEvents') as { upsertConfig: (guildId: string, patch: Record<string, unknown>) => Promise<unknown> };
const joinRoles = require('../db/joinRoles') as { addRole: (guildId: string, roleId: string, target?: string) => Promise<unknown> };
const tickets = require('../db/tickets') as {
  createPanel: (o: Record<string, unknown>) => Promise<{ id: number }>;
  createCategory: (o: Record<string, unknown>) => Promise<Record<string, unknown>>;
  setPanelMessageId: (panelId: number, messageId: string) => Promise<void>;
  listCategories: (guildId: string) => Promise<unknown[]>;
};
const { guildLimit } = require('../db/premium') as { guildLimit: (guildId: string, key: string) => Promise<{ limit: number }> };
const { ensureGuild } = require('../db/guilds') as { ensureGuild: (guildId: string) => Promise<unknown> };
const { buildPanelRows, buildPanelFallbackCard } = require('./ticketCards') as { buildPanelRows: (style: string, categories: unknown[], o: Record<string, unknown>) => unknown[]; buildPanelFallbackCard: (o: Record<string, unknown>) => unknown };
const verifyJobs = require('./verifyJobs') as { startVerifyJob: (guild: Guild, action: string, o?: Record<string, unknown>) => { job: unknown; already?: boolean } };

export const MODULES = ['moderation', 'automod', 'welcome', 'autorole', 'tickets', 'verification'] as const;
export type SetupModule = (typeof MODULES)[number];

export interface SetupInput {
  modules?: Partial<Record<SetupModule, unknown>>;
  moderation?: { log_channel?: unknown };
  automod?: { spam?: unknown; invites?: unknown; scam?: unknown; links?: unknown };
  welcome?: { channel?: unknown; message?: unknown; goodbye?: unknown };
  autorole?: { role?: unknown };
  tickets?: { channel?: unknown; support_role?: unknown };
}
export interface SetupResult { module: SetupModule; ok: boolean; message: string }

const SNOWFLAKE = /^\d{15,25}$/;
const NEW = 'new';
/** `new` (make one), a real id, or nothing. */
const pick = (value: unknown): string | null => (value === NEW ? NEW : SNOWFLAKE.test(String(value ?? '')) ? String(value) : null);

async function privateTextChannel(guild: Guild, name: string, reason: string): Promise<GuildBasedChannel> {
  const me = guild.members.me!;
  return guild.channels.create({
    name, type: ChannelType.GuildText, reason,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
    ],
  });
}

const publicTextChannel = (guild: Guild, name: string, reason: string): Promise<GuildBasedChannel> => guild.channels.create({ name, type: ChannelType.GuildText, reason });

/** A text channel of this server that exists and where Petto can write, or null. */
async function usableChannel(guild: Guild, id: string): Promise<GuildBasedChannel | null> {
  const channel = await guild.channels.fetch(id).catch(() => null);
  if (!channel || !channel.isTextBased()) return null;
  return channel.permissionsFor(guild.members.me!)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]) ? channel : null;
}

async function channelFor(guild: Guild, choice: string | null, makeName: string, privateChannel: boolean, reason: string): Promise<GuildBasedChannel | null> {
  if (choice === NEW) return privateChannel ? privateTextChannel(guild, makeName, reason) : publicTextChannel(guild, makeName, reason);
  return choice ? usableChannel(guild, choice) : null;
}

async function roleFor(guild: Guild, choice: string | null, makeName: string, reason: string): Promise<{ id: string; toString(): string } | null> {
  if (choice === NEW) return guild.roles.create({ name: makeName, reason, permissions: [] });
  if (!choice) return null;
  const role = guild.roles.cache.get(choice) ?? (await guild.roles.fetch(choice).catch(() => null));
  return role && !role.managed && role.id !== guild.id ? role : null;
}

type Step = (guild: Guild, input: SetupInput, lang: Lang) => Promise<string>;
/** An answer for the person (the text is already in their language): the other errors are logged and shown with a general text. */
class SetupError extends Error {}
const fail = (lang: Lang, key: string, values?: Record<string, unknown>): never => { throw new SetupError(t(lang, key, values)); };

const STEPS: Record<SetupModule, Step> = {
  async moderation(guild, input, lang) {
    const channel = await channelFor(guild, pick(input.moderation?.log_channel), t(lang, 'quicksetup.name.modLog'), true, t(lang, 'quicksetup.reason'));
    if (!channel) return fail(lang, 'quicksetup.err.channel');
    await ensureGuild(guild.id);
    await logConfig.addEntries(guild.id, channel.id, ['sanctions', 'automod', 'members', 'roles', 'channels', 'server']);
    return t(lang, 'quicksetup.done.moderation', { channel: `<#${channel.id}>` });
  },
  async automod(guild, input, lang) {
    const o = input.automod ?? {};
    await ensureGuild(guild.id);
    if (o.spam !== false) await automod.upsertConfig(guild.id, { anti_spam_enabled: true });
    const wanted = [...(o.invites ? ['invites'] : []), ...(o.scam ? ['scam'] : []), ...(o.links ? ['links'] : [])];
    const have = new Set((await automodRules.listRules(guild.id)).map((rule) => rule.template));
    for (const template of wanted) {
      if (have.has(template)) continue;
      await automodRules.createRule(guild.id, { name: template, template, options: {}, action: 'delete', mute_minutes: 10, exempt_role_ids: [], exempt_channel_ids: [] });
    }
    return t(lang, 'quicksetup.done.automod', { count: wanted.length + (o.spam !== false ? 1 : 0) });
  },
  async welcome(guild, input, lang) {
    const o = input.welcome ?? {};
    const channel = await channelFor(guild, pick(o.channel), t(lang, 'quicksetup.name.welcome'), false, t(lang, 'quicksetup.reason'));
    if (!channel) return fail(lang, 'quicksetup.err.channel');
    const message = String(o.message ?? '').replace(/\u0000/g, '').trim().slice(0, 1800) || t(lang, 'welcome.default.welcome');
    await ensureGuild(guild.id);
    await memberEvents.upsertConfig(guild.id, {
      welcome_channel_id: channel.id, welcome_message: message,
      ...(o.goodbye ? { leave_channel_id: channel.id, leave_message: t(lang, 'quicksetup.goodbye') } : {}),
    });
    return t(lang, 'quicksetup.done.welcome', { channel: `<#${channel.id}>` });
  },
  async autorole(guild, input, lang) {
    const role = await roleFor(guild, pick(input.autorole?.role), t(lang, 'quicksetup.name.member'), t(lang, 'quicksetup.reason'));
    if (!role) return fail(lang, 'quicksetup.err.role');
    const me = guild.members.me!;
    if ('position' in role && (role as unknown as { position: number }).position >= me.roles.highest.position) return fail(lang, 'quicksetup.err.roleHigh', { role: `<@&${role.id}>` });
    await ensureGuild(guild.id);
    await joinRoles.addRole(guild.id, role.id, 'all');
    return t(lang, 'quicksetup.done.autorole', { role: `<@&${role.id}>` });
  },
  async tickets(guild, input, lang) {
    const o = input.tickets ?? {};
    const supportRole = await roleFor(guild, pick(o.support_role), t(lang, 'quicksetup.name.support'), t(lang, 'quicksetup.reason'));
    if (!supportRole) return fail(lang, 'quicksetup.err.role');
    const channel = await channelFor(guild, pick(o.channel), t(lang, 'quicksetup.name.tickets'), false, t(lang, 'quicksetup.reason'));
    if (!channel || !channel.isTextBased()) return fail(lang, 'quicksetup.err.channel');
    const allowed = await guildLimit(guild.id, 'ticketCategories');
    if ((await tickets.listCategories(guild.id)).length + 1 > allowed.limit) return fail(lang, 'quicksetup.err.ticketLimit');
    await ensureGuild(guild.id);
    const title = t(lang, 'tickets.setup.default.title');
    const description = t(lang, 'tickets.setup.default.description');
    const panel = await tickets.createPanel({ guildId: guild.id, channelId: channel.id, title, description, embedTemplate: null, style: 'button' });
    const category = await tickets.createCategory({ guildId: guild.id, panelId: panel.id, key: 'support', label: t(lang, 'tickets.setup.default.typeLabel'), emoji: null, buttonStyle: 'primary', description: null, supportRoleIds: [supportRole.id], welcomeMessage: null });
    const sent = await (channel as unknown as { send: (o: unknown) => Promise<{ id: string }> }).send({
      components: [buildPanelFallbackCard({ title, description, lang }), ...buildPanelRows('button', [category], { lang })], flags: MessageFlags.IsComponentsV2,
    });
    await tickets.setPanelMessageId(panel.id, sent.id);
    return t(lang, 'quicksetup.done.tickets', { channel: `<#${channel.id}>`, role: `<@&${supportRole.id}>` });
  },
  async verification(guild, _input, lang) {
    // It edits every channel of the server, so it runs as the job the Verification page uses and finishes by itself.
    verifyJobs.startVerifyJob(guild, 'setup');
    return t(lang, 'quicksetup.done.verification');
  },
};

/** Applies what the dashboard asked for. `modules` says which steps are on; the rest of the input holds the answers of each one. */
export async function applyQuickSetup(guild: Guild, input: SetupInput): Promise<SetupResult[]> {
  const lang = currentLanguage();
  const results: SetupResult[] = [];
  for (const module of MODULES) {
    if (!input.modules?.[module]) continue;
    try {
      results.push({ module, ok: true, message: await STEPS[module](guild, input, lang) });
    } catch (error) {
      logger.warn(`Quick Setup: ${module} failed in ${guild.id}: ${(error as Error).message}`);
      results.push({ module, ok: false, message: error instanceof SetupError ? error.message : (error as { code?: number }).code === 50013 ? t(lang, 'quicksetup.err.permission') : t(lang, 'quicksetup.err.failed') });
    }
  }
  return results;
}
