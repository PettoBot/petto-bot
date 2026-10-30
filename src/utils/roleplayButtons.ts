import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const { CATALOGS, currentLanguage, t, tn } = require('../i18n') as {
  CATALOGS: Record<string, Record<string, string>>;
  currentLanguage: () => string;
  t: (lang: string, key: string, vars?: Record<string, unknown>) => string;
  tn: (lang: string, key: string, count: number, vars?: Record<string, unknown>) => string;
};

export const ROLEPLAY_BUTTON_PREFIX = 'rp:';

export interface RoleplayButtonInput {
  requestId: string;
  action: string;
  actorId: string;
  targetId: string;
}

// The emoji of each action's response button lives with the actions of /act.
const { EMOJIS: RESPONSE_EMOJIS } = require('./actions') as { EMOJIS: Record<string, string> };

// Actions with their own texts in the roleplay catalog; any other action (an old or hand-made button) gets the generic ones.
function hasTexts(action: string): boolean {
  return Object.hasOwn(CATALOGS.en, `roleplay.${action}.accepted`);
}

export function getRoleplayLabel(action: string): string {
  return action.replaceAll('_', ' ');
}

export function getRoleplayResponseLabel(action: string, lang: string = currentLanguage()): string {
  return hasTexts(action)
    ? t(lang, `roleplay.${action}.reply.button`)
    : t(lang, 'roleplay.unknown.reply.button', { label: getRoleplayLabel(action) });
}

export function getRoleplayResponseEmoji(action: string): string {
  return RESPONSE_EMOJIS[action] ?? '↩️';
}

/** "**Ana** responds to **Bruno** with a hug." (`accepted`) or "**Ana** rejects the hug from **Bruno** and gives them a slap." */
export function getRoleplayResponseSentence(action: string, accepted: boolean, target: string, actor: string, lang: string = currentLanguage()): string {
  const shape = accepted ? 'accepted' : 'rejected';
  return hasTexts(action)
    ? t(lang, `roleplay.${action}.${shape}`, { target, actor })
    : t(lang, `roleplay.unknown.${shape}`, { target, actor, label: getRoleplayLabel(action) });
}

export function getRoleplayCounterMessage(action: string, count: number, recipient: string, lang: string = currentLanguage()): string {
  return hasTexts(action)
    ? tn(lang, `roleplay.${action}.count`, count, { recipient })
    : tn(lang, 'roleplay.unknown.count', count, { recipient, label: getRoleplayLabel(action) });
}

export function buildRoleplayButtonRow(input: RoleplayButtonInput, disabled = false, lang: string = currentLanguage()) {
  const base = `${ROLEPLAY_BUTTON_PREFIX}%s:${input.action}:${input.actorId}:${input.targetId}:${input.requestId}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(base.replace('%s', 'accept'))
      .setLabel(getRoleplayResponseLabel(input.action, lang))
      .setEmoji(getRoleplayResponseEmoji(input.action))
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(base.replace('%s', 'reject'))
      .setLabel(t(lang, 'roleplay.reject.button'))
      .setEmoji('✋')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}
