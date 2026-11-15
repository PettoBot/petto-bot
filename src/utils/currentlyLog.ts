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

/** Where the ids of what was already posted are kept. */
export interface Store {
  read(): Promise<string[]>;
  write(ids: string[]): Promise<void>;
}

const SETTING_KEY = 'currently_log.posted';
/** The ids kept; the oldest go first, an id is only needed while its entry is in the file. */
const KEEP_IDS = 1000;

/** The usual store: one row of `bot_settings` with the ids as JSON. */
export function databaseStore(): Store {
  const settings = require('../db/botSettings') as { getSetting(key: string): Promise<string | null>; setSetting(key: string, value: string): Promise<void> };
  return {
    async read() {
      const value = await settings.getSetting(SETTING_KEY);
      try {
        const parsed = value ? JSON.parse(value) : [];
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
      } catch {
        return [];
      }
    },
    async write(ids) {
      await settings.setSetting(SETTING_KEY, JSON.stringify(ids.slice(-KEEP_IDS)));
    },
  };
}

/** The ID of the channel: the `currently_log` variable. Null when it is not set. */
export function channelIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = String(env.currently_log ?? env.CURRENTLY_LOG ?? '').trim();
  return /^\d{15,25}$/.test(value) ? value : null;
}

/** The entries of the file, checked. */
export function loadEntries(): { entries: Entry[]; problems: string[] } {
  return validateEntries((require('../data/currentlyLog.json') as { entries?: unknown }).entries);
}

export interface AnnounceOptions {
  entries?: Entry[];
  channelId?: string | null;
  store?: Store;
  version?: string;
  /** The wait between two cards, so they come in order and without rushing Discord. */
  pauseMs?: number;
}

export interface Announced {
  /** How many cards were posted. */
  cards: number;
  /** How many entries were posted. */
  entries: number;
  /** Why nothing was posted, when it was not. */
  skipped?: 'no-channel' | 'nothing-new' | 'channel-unavailable' | 'store-failed';
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Posts the entries that were not posted yet, in the channel of the `currently_log` variable. Each card is remembered before it is sent, so two bots
 * starting together do not post it twice; if Discord refuses a card, the entries of it and of the cards after it are forgotten and come again at
 * the next start. Never throws: a problem is said in the log and the bot goes on.
 */
export async function announceNewEntries(client: Pick<Client, 'channels'>, options: AnnounceOptions = {}): Promise<Announced> {
  const channelId = options.channelId === undefined ? channelIdFromEnv() : options.channelId;
  if (!channelId) return { cards: 0, entries: 0, skipped: 'no-channel' };
  try {
    const loaded = options.entries ? { entries: options.entries, problems: [] as string[] } : loadEntries();
    for (const problem of loaded.problems) logger.warn(`Currently log: ${problem}`);
    const store = options.store ?? databaseStore();
    const posted = new Set(await store.read());
    const fresh = loaded.entries.filter((entry) => !posted.has(entry.id));
    if (!fresh.length) return { cards: 0, entries: 0, skipped: 'nothing-new' };

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !('send' in channel) || typeof channel.send !== 'function') {
      logger.warn(`Currently log: the channel ${channelId} is not a channel where Petto can post.`);
      return { cards: 0, entries: 0, skipped: 'channel-unavailable' };
    }

    const cards = buildCards(fresh, options.version ?? '');
    let sentCards = 0;
    let sentEntries = 0;
    const remembered = [...posted];
    for (const [index, card] of cards.entries()) {
      remembered.push(...card.ids);
      await store.write(remembered);
      try {
        const message = await channel.send(card.payload);
        sentCards += 1;
        sentEntries += card.ids.length;
        // The two votes of the feedback board, so people say whether they like the change with one click. A reaction that fails (the emoji of the server is gone) never stops the log.
        await addVotes(message);
      } catch (error) {
        // This card and the next ones are forgotten again: they are tried at the next start.
        const failed = new Set(cards.slice(index).flatMap((each) => each.ids));
        await store.write(remembered.filter((id) => !failed.has(id))).catch(() => undefined);
        logger.warn(`Currently log: could not post a card (${(error as Error)?.message ?? error}); ${failed.size} change(s) wait for the next start.`);
        break;
      }
      if (index < cards.length - 1) await sleep(options.pauseMs ?? 2500);
    }
    if (sentCards) logger.info(`Currently log: posted ${sentEntries} change(s) in ${sentCards} card(s).`);
    return { cards: sentCards, entries: sentEntries };
  } catch (error) {
    logger.warn(`Currently log: ${(error as Error)?.message ?? error}`);
    return { cards: 0, entries: 0, skipped: 'store-failed' };
  }
}
