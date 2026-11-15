// i18n-ignore-file: the Currently log is written in English for the Petto community, it is not translated.
// The Currently log: the changes of Petto (like the releases of a GitHub project) posted to one channel, in colors by kind, with pictures.
// The channel is the `currently_log` variable (the ID of the channel). The changes are written in src/data/currentlyLog.json: when the bot starts it
// posts the ones it has not posted yet, once, and remembers them (so a restart posts nothing twice). Written in TypeScript: `npm run build:ts`
// compiles it over currentlyLog.js, which is what the bot loads.
import { ContainerBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from 'discord.js';
import type { Client } from 'discord.js';

// The project is JavaScript: its modules are read with `require` and given the shape that is used here.
const logger = require('./logger') as { info(text: string): void; warn(text: string): void };

export type CategoryKey = 'security' | 'feature' | 'addition' | 'improvement' | 'fix' | 'web' | 'removal' | 'removed-feature';

export interface Category {
  /** The color of the card. */
  color: number;
  /** The colored dot in front of the title. */
  dot: string;
  /** The title of a card with one change, and with several. */
  one: string;
  many: string;
}

/** The kinds of change, in the order their cards are posted (the most important first). */
export const CATEGORIES: Record<CategoryKey, Category> = {
  security: { color: 0xe03131, dot: '🔴', one: 'Security fix', many: 'Security fixes' },
  feature: { color: 0xfcc419, dot: '🟡', one: 'New feature', many: 'New features' },
  addition: { color: 0x2f9e44, dot: '🟢', one: 'Added to a feature', many: 'Added to features' },
  improvement: { color: 0x1c7ed6, dot: '🔵', one: 'Improvement', many: 'Improvements' },
  fix: { color: 0xf76707, dot: '🟠', one: 'Fix', many: 'Fixes' },
  web: { color: 0x9c36b5, dot: '🟣', one: 'Web, dashboard and docs', many: 'Web, dashboard and docs' },
  removal: { color: 0x868e96, dot: '⚪', one: 'Removed from a feature', many: 'Removed from features' },
  'removed-feature': { color: 0x000000, dot: '⚫', one: 'Feature removed', many: 'Features removed' },
};

export const CATEGORY_ORDER = Object.keys(CATEGORIES) as CategoryKey[];

export interface Entry {
  /** Never reused: it is what remembers that the change was posted. */
  id: string;
  category: CategoryKey;
  title: string;
  /** What it belongs to, like `Partners › Variables`. */
  area: string;
  /** What it is and how it affects people, a few sentences. */
  summary: string;
  /** Up to three pictures (https links) that show it. */
  images?: string[];
  /** A link to the documentation or to the blog post. */
  docs?: string;
}

export const LIMITS = { title: 100, area: 80, summary: 700, images: 3, perCard: 5, id: 80 } as const;

const isHttps = (value: unknown): value is string => typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value) && value.length <= 500;

/** The entries that are well made, and what is wrong with the others (an entry with a problem is skipped, never posted half done). */
export function validateEntries(raw: unknown): { entries: Entry[]; problems: string[] } {
  const entries: Entry[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const list = Array.isArray(raw) ? raw : [];
  if (!Array.isArray(raw)) problems.push('the file has no list of entries');
  list.forEach((item, index) => {
    const name = `entry ${index + 1}${typeof item?.id === 'string' ? ` (${item.id})` : ''}`;
    const bad = (why: string): void => { problems.push(`${name}: ${why}`); };
    if (!item || typeof item !== 'object') return bad('it is not an object');
    if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(item.id) || item.id.length > LIMITS.id) return bad('the id must be lowercase letters, numbers and dashes');
    if (seen.has(item.id)) return bad('the id is used twice');
    if (!(item.category in CATEGORIES)) return bad(`the category "${item.category}" is not one of ${CATEGORY_ORDER.join(', ')}`);
    for (const [field, max] of [['title', LIMITS.title], ['area', LIMITS.area], ['summary', LIMITS.summary]] as const) {
      const text = item[field];
      if (typeof text !== 'string' || !text.trim()) return bad(`${field} is empty`);
      if (text.length > max) return bad(`${field} is longer than ${max} characters`);
    }
    if (item.images !== undefined && (!Array.isArray(item.images) || item.images.length > LIMITS.images || !item.images.every(isHttps))) return bad(`images must be up to ${LIMITS.images} https links`);
    if (item.docs !== undefined && !isHttps(item.docs)) return bad('docs must be an https link');
    seen.add(item.id);
    entries.push({ id: item.id, category: item.category, title: item.title.trim(), area: item.area.trim(), summary: item.summary.trim(), ...(item.images?.length ? { images: item.images } : {}), ...(item.docs ? { docs: item.docs } : {}) });
  });
  return { entries, problems };
}

export interface Card {
  category: CategoryKey;
  /** The ids of the entries in the card. */
  ids: string[];
  payload: { components: ContainerBuilder[]; flags: number; allowedMentions: { parse: [] } };
}

/** The text of one entry: the title, where it belongs, what it is, and the link. */
function entryText(entry: Entry): string {
  return [`**${entry.title}**`, `-# ${entry.area}`, entry.summary, ...(entry.docs ? [`[Documentation](${entry.docs})`] : [])].join('\n');
}

/** The characters of text a card may hold: Discord allows 4000 in all the texts of a message, and the title and the version take some. */
const TEXT_BUDGET = 3600;

/** Splits the entries of one kind into the groups of a card: five at most, and as many as fit in the text a message allows. */
function chunksOf(entries: readonly Entry[]): Entry[][] {
  const chunks: Entry[][] = [];
  let current: Entry[] = [];
  let used = 0;
  for (const entry of entries) {
    const size = entryText(entry).length;
    if (current.length && (current.length >= LIMITS.perCard || used + size > TEXT_BUDGET)) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(entry);
    used += size;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** The cards for some entries: one kind at a time, five entries in each card (fewer when they are long), each with its pictures. `version` is written at the bottom. */
export function buildCards(entries: readonly Entry[], version = ''): Card[] {
  const cards: Card[] = [];
  for (const key of CATEGORY_ORDER) {
    const own = entries.filter((entry) => entry.category === key);
    let from = 0;
    for (const chunk of chunksOf(own)) {
      const category = CATEGORIES[key];
      const range = own.length > chunk.length ? ` (${from + 1}-${from + chunk.length} of ${own.length})` : own.length > 1 ? ` (${own.length})` : '';
      from += chunk.length;
      const container = new ContainerBuilder().setAccentColor(category.color);
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${category.dot} ${own.length === 1 ? category.one : category.many}${range}`));
      chunk.forEach((entry) => {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(entryText(entry)));
        if (entry.images?.length) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(...entry.images.slice(0, LIMITS.images).map((url) => new MediaGalleryItemBuilder().setURL(url).setDescription(entry.title.slice(0, 200)))));
      });
      if (version) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# Petto ${version}`));
      }
      cards.push({ category: key, ids: chunk.map((entry) => entry.id), payload: { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } } });
    }
  }
  return cards;
}

/** The emojis of the feedback board (like and dislike, of the Petto server): the same two the buttons of a feedback post use. */
export function voteEmojis(): string[] {
  const { EMOJI } = require('../feedback/card') as { EMOJI: { like: { id: string; name: string }; dislike: { id: string; name: string } } };
  return [EMOJI.like, EMOJI.dislike].map((emoji) => `${emoji.name}:${emoji.id}`);
}

/** Puts the like and the dislike on a posted card, in that order. Never throws. */
async function addVotes(message: unknown): Promise<void> {
  const target = message as { react?: (emoji: string) => Promise<unknown> } | null;
  if (typeof target?.react !== 'function') return;
  for (const emoji of voteEmojis()) {
    try {
      await target.react(emoji);
    } catch (error) {
      logger.warn(`Currently log: could not react with ${emoji} (${(error as Error)?.message ?? error}).`);
      return;
    }
  }
}

/** What the log remembers: the revision of the file it was posted from, the entries it posted, and the messages those went in. */
export interface State {
  revision: number;
  posted: string[];
  messages: string[];
}

/** Where that is kept. */
export interface Store {
  read(): Promise<State>;
  write(state: State): Promise<void>;
}

const STATE_KEY = 'currently_log.state';
/** The first version of the log kept only the ids of the entries (and no revision, and not the messages). */
const LEGACY_KEY = 'currently_log.posted';
/** The ids kept; the oldest go first, an id is only needed while its entry is in the file. */
const KEEP_IDS = 1000;

const textsOf = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

/** The usual store: one row of `bot_settings` with the state as JSON. */
export function databaseStore(): Store {
  const settings = require('../db/botSettings') as { getSetting(key: string): Promise<string | null>; setSetting(key: string, value: string): Promise<void> };
  const parse = (value: string | null): unknown => { try { return value ? JSON.parse(value) : null; } catch { return null; } };
  return {
    async read() {
      const saved = parse(await settings.getSetting(STATE_KEY)) as Partial<State> | null;
      if (saved && typeof saved === 'object') return { revision: Number(saved.revision) || 0, posted: textsOf(saved.posted), messages: textsOf(saved.messages) };
      return { revision: 0, posted: textsOf(parse(await settings.getSetting(LEGACY_KEY))), messages: [] };
    },
    async write(state) {
      await settings.setSetting(STATE_KEY, JSON.stringify({ revision: state.revision, posted: state.posted.slice(-KEEP_IDS), messages: state.messages.slice(-KEEP_IDS) }));
    },
  };
}

/** The ID of the channel: the `currently_log` variable. Null when it is not set. */
export function channelIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = String(env.currently_log ?? env.CURRENTLY_LOG ?? '').trim();
  return /^\d{15,25}$/.test(value) ? value : null;
}

/**
 * The entries of the file, checked, with its revision and its version. The revision: a higher number than the one that was posted deletes the log of the
 * channel and posts all of it again. The version is the one written at the bottom of every card (`-# Petto 0.7.12`): it is the one the maintainer says
 * the log is at, not the one of `package.json`, and it changes when he says a new one starts.
 */
export function loadEntries(): { entries: Entry[]; problems: string[]; revision: number; version: string } {
  const file = require('../data/currentlyLog.json') as { entries?: unknown; revision?: unknown; version?: unknown };
  const version = typeof file.version === 'string' && /^\d+\.\d+\.\d+$/.test(file.version) ? file.version : '';
  return { ...validateEntries(file.entries), revision: Math.max(1, Math.floor(Number(file.revision)) || 1), version };
}

/** Whether a picture can be read from its link as an image, the way Discord will read it. */
export async function imageReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8_000) });
    return response.ok && /^image\//i.test(response.headers.get('content-type') ?? '');
  } catch {
    return false;
  }
}

export interface AnnounceOptions {
  entries?: Entry[];
  /** The revision of the entries (the file's, by default). */
  revision?: number;
  channelId?: string | null;
  store?: Store;
  /** The version written at the bottom of the cards (the one of the file by default). */
  version?: string;
  /** The ID of the bot: its old log cards are the ones that go when the log is posted again. */
  botId?: string | null;
  /** Whether a picture can be loaded (a check gives its own). */
  reachable?: (url: string) => Promise<boolean>;
  /** The wait between two cards, so they come in order and without rushing Discord. */
  pauseMs?: number;
}

export interface Announced {
  /** How many cards were posted. */
  cards: number;
  /** How many entries were posted. */
  entries: number;
  /** How many entries wait because a picture of theirs cannot be loaded yet (the web is still being deployed). */
  waiting?: number;
  /** How many old messages of the log were deleted to post it all again. */
  removed?: number;
  /** Why nothing was posted, when it was not. */
  skipped?: 'no-channel' | 'nothing-new' | 'channel-unavailable' | 'store-failed';
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

interface LogChannel {
  send(payload: unknown): Promise<unknown>;
  messages?: { fetch(options: unknown): Promise<Iterable<[string, unknown]> | Map<string, unknown>>; delete(id: string): Promise<unknown> };
}

/** The footer every card of the log ends with (`-# Petto 0.7.11`): what tells them apart from anything else the bot wrote in the channel. */
const FOOTER = '"-# Petto ';

/**
 * Deletes the cards of the log in the channel: the messages it remembers, and (for the posts of before it remembered them) the recent
 * messages of the bot that are Components V2 and end with the footer of the log. Answers how many went.
 */
async function removeOldCards(channel: LogChannel, known: readonly string[], botId: string | null): Promise<number> {
  const gone = new Set<string>();
  const drop = async (id: string): Promise<void> => {
    if (gone.has(id)) return;
    gone.add(id);
    await channel.messages?.delete(id).catch(() => undefined);
  };
  for (const id of known) await drop(id);
  if (botId && channel.messages) {
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    for (const [id, item] of recent ? [...recent] : []) {
      const message = item as { author?: { id?: string }; flags?: { has(flag: number): boolean }; components?: unknown[] };
      if (message.author?.id !== botId || !message.flags?.has(MessageFlags.IsComponentsV2)) continue;
      const json = JSON.stringify((message.components ?? []).map((part) => (part as { toJSON?: () => unknown })?.toJSON?.() ?? part));
      if (json.includes(FOOTER)) await drop(id);
    }
  }
  return gone.size;
}

/**
 * Posts the entries that were not posted yet, in the channel of the `currently_log` variable. Each card is remembered before it is sent, so two bots
 * starting together do not post it twice; if Discord refuses a card, the entries of it and of the cards after it are forgotten and come again at
 * the next start. An entry whose picture cannot be loaded waits (Discord keeps a picture that was not there when it looked, and shows it broken):
 * it is posted when the picture answers. When the file has a higher revision than the one posted, the old cards are deleted and all is posted
 * again. Never throws: a problem is said in the log and the bot goes on.
 */
export async function announceNewEntries(client: Pick<Client, 'channels'>, options: AnnounceOptions = {}): Promise<Announced> {
  const channelId = options.channelId === undefined ? channelIdFromEnv() : options.channelId;
  if (!channelId) return { cards: 0, entries: 0, skipped: 'no-channel' };
  try {
    const loaded = options.entries ? { entries: options.entries, problems: [] as string[], revision: options.revision ?? 1, version: '' } : loadEntries();
    for (const problem of loaded.problems) logger.warn(`Currently log: ${problem}`);
    const revision = options.revision ?? loaded.revision;
    const store = options.store ?? databaseStore();
    let state = await store.read();
    const again = state.revision < revision;
    if (!again && !loaded.entries.some((entry) => !state.posted.includes(entry.id))) return { cards: 0, entries: 0, skipped: 'nothing-new' };

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
      logger.warn(`Currently log: the channel ${channelId} is not a channel where Petto can post.`);
      return { cards: 0, entries: 0, skipped: 'channel-unavailable' };
    }

    let removed = 0;
    if (again) {
      removed = await removeOldCards(channel as unknown as LogChannel, state.messages, options.botId ?? null);
      state = { revision, posted: [], messages: [] };
      await store.write(state);
      logger.info(`Currently log: revision ${revision}: ${removed} old message(s) deleted, the log is posted again.`);
    }
    const fresh = loaded.entries.filter((entry) => !state.posted.includes(entry.id));

    // A picture that cannot be loaded now would stay broken in Discord for good: that entry waits for the next try.
    const reachable = options.reachable ?? imageReachable;
    const ready: Entry[] = [];
    let waiting = 0;
    for (const entry of fresh) {
      const loadable = !entry.images?.length || (await Promise.all(entry.images.map((url) => reachable(url)))).every(Boolean);
      if (loadable) ready.push(entry); else waiting += 1;
    }
    if (waiting) logger.warn(`Currently log: ${waiting} change(s) wait until their pictures can be loaded.`);

    const cards = buildCards(ready, options.version ?? loaded.version);
    let sentCards = 0;
    let sentEntries = 0;
    const posted = [...state.posted];
    const messages = [...state.messages];
    for (const [index, card] of cards.entries()) {
      posted.push(...card.ids);
      await store.write({ revision, posted, messages });
      try {
        const message = await channel.send(card.payload) as { id?: string };
        sentCards += 1;
        sentEntries += card.ids.length;
        if (message?.id) { messages.push(message.id); await store.write({ revision, posted, messages }); }
        // The two votes of the feedback board, so people say whether they like the change with one click. A reaction that fails (the emoji of the server is gone) never stops the log.
        await addVotes(message);
      } catch (error) {
        // This card and the next ones are forgotten again: they are tried at the next start.
        const failed = new Set(cards.slice(index).flatMap((each) => each.ids));
        await store.write({ revision, posted: posted.filter((id) => !failed.has(id)), messages }).catch(() => undefined);
        logger.warn(`Currently log: could not post a card (${(error as Error)?.message ?? error}); ${failed.size} change(s) wait for the next start.`);
        break;
      }
      if (index < cards.length - 1) await sleep(options.pauseMs ?? 2500);
    }
    if (sentCards) logger.info(`Currently log: posted ${sentEntries} change(s) in ${sentCards} card(s).`);
    return { cards: sentCards, entries: sentEntries, ...(waiting ? { waiting } : {}), ...(removed ? { removed } : {}) };
  } catch (error) {
    logger.warn(`Currently log: ${(error as Error)?.message ?? error}`);
    return { cards: 0, entries: 0, skipped: 'store-failed' };
  }
}

/** How often, and how many times, the entries that wait for a picture are tried again. */
const RETRY_EVERY_MS = 10 * 60_000;
const RETRIES = 6;

/** Posts the log and, while an entry waits for its pictures, tries again every ten minutes (an hour at most). */
export async function startCurrentlyLog(client: Client, options: AnnounceOptions = {}, attempt = 1): Promise<Announced> {
  const result = await announceNewEntries(client, { botId: client.user?.id ?? null, ...options });
  if (result.waiting && attempt < RETRIES) {
    const timer = setTimeout(() => { void startCurrentlyLog(client, options, attempt + 1); }, options.pauseMs === undefined ? RETRY_EVERY_MS : Math.max(1, options.pauseMs));
    timer.unref?.();
  }
  return result;
}
