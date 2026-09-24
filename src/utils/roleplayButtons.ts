import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const ROLEPLAY_BUTTON_PREFIX = 'rp:';

export interface RoleplayButtonInput {
  requestId: string;
  action: string;
  actorId: string;
  targetId: string;
}

const LABELS: Record<string, string> = {
  airkiss: 'air kiss',
  angry: 'angry moment',
  angrystare: 'angry stare',
  bleh: 'bleh',
  blush: 'blush',
  boop: 'boop',
  brofist: 'brofist',
  bye: 'goodbye',
  cry: 'cry',
  cuddle: 'cuddle',
  dance: 'dance',
  glomp: 'glomp',
  handhold: 'hand hold',
  happy: 'happy moment',
  hi: 'hi',
  highfive: 'high five',
  hug: 'hug',
  kick: 'kick',
  kill: 'defeat',
  kiss: 'kiss',
  laugh: 'laugh',
  lick: 'lick',
  no: 'no',
  nom: 'nom',
  pat: 'pat',
  poke: 'poke',
  punch: 'punch',
  sad: 'sad moment',
  slap: 'slap',
  smile: 'smile',
  smug: 'smug look',
  tickle: 'tickle',
  wave: 'wave',
  wink: 'wink',
  yeet: 'yeet',
  yes: 'yes',
};

const COUNTER_NOUNS: Record<string, [string, string]> = {
  airkiss: ['air kiss', 'air kisses'],
  angry: ['angry moment', 'angry moments'],
  angrystare: ['angry stare', 'angry stares'],
  bite: ['bite', 'bites'],
  bleh: ['bleh', 'blehs'],
  blush: ['blush', 'blushes'],
  boop: ['boop', 'boops'],
  brofist: ['brofist', 'brofists'],
  bye: ['goodbye', 'goodbyes'],
  cry: ['cry', 'cries'],
  cuddle: ['cuddle', 'cuddles'],
  dance: ['dance', 'dances'],
  glomp: ['glomp', 'glomps'],
  handhold: ['hand hold', 'hand holds'],
  happy: ['happy moment', 'happy moments'],
  highfive: ['high five', 'high fives'],
  hi: ['hi', 'his'],
  hug: ['hug', 'hugs'],
  kick: ['kick', 'kicks'],
  kill: ['defeat', 'defeats'],
  kiss: ['kiss', 'kisses'],
  laugh: ['laugh', 'laughs'],
  lick: ['lick', 'licks'],
  nom: ['nom', 'noms'],
  no: ['no', 'nos'],
  pat: ['pat', 'pats'],
  poke: ['poke', 'pokes'],
  punch: ['punch', 'punches'],
  sad: ['sad moment', 'sad moments'],
  slap: ['slap', 'slaps'],
  smile: ['smile', 'smiles'],
  smug: ['smug look', 'smug looks'],
  tickle: ['tickle', 'tickles'],
  wave: ['wave', 'waves'],
  wink: ['wink', 'winks'],
  yes: ['yes', 'yeses'],
  yeet: ['yeet', 'yeets'],
};

const RESPONSE_LABELS: Record<string, string> = {
  airkiss: 'Air kiss back',
  angry: 'Get angry back',
  angrystare: 'Stare back',
  bite: 'Bite back',
  bleh: 'Bleh back',
  blush: 'Blush back',
  boop: 'Boop back',
  brofist: 'Brofist back',
  bye: 'Say goodbye back',
  cry: 'Cry together',
  cuddle: 'Cuddle back',
  dance: 'Dance back',
  glomp: 'Glomp back',
  handhold: 'Hold hands back',
  happy: 'Celebrate back',
  highfive: 'High-five back',
  hi: 'Say hi back',
  hug: 'Hug back',
  kick: 'Kick back',
  kill: 'Fight back',
  kiss: 'Kiss back',
  laugh: 'Laugh back',
  lick: 'Lick back',
  nom: 'Nom back',
  no: 'Say no back',
  pat: 'Pat back',
  poke: 'Boop back',
  punch: 'Punch back',
  sad: 'Cry together',
  slap: 'Slap back',
  smile: 'Smile back',
  smug: 'Smirk back',
  tickle: 'Tickle back',
  wave: 'Wave back',
  wink: 'Wink back',
  yes: 'Say yes back',
  yeet: 'Yeet back',
};

const RESPONSE_EMOJIS: Record<string, string> = {
  airkiss: '💋',
  angry: '😠',
  angrystare: '😤',
  bleh: '😛',
  blush: '😊',
  bite: '🦷',
  boop: '👉',
  brofist: '👊',
  cuddle: '🫂',
  cry: '😭',
  dance: '💃',
  glomp: '🫂',
  highfive: '🙌',
  hi: '👋',
  hug: '🤗',
  kiss: '💋',
  laugh: '😂',
  pat: '🫳',
  poke: '👉',
  punch: '🥊',
  sad: '😭',
  slap: '🖐️',
  smile: '😊',
  smug: '😏',
  wave: '👋',
  wink: '😉',
  yes: '✅',
  no: '❌',
};

export function getRoleplayLabel(action: string): string {
  return LABELS[action] ?? action.replaceAll('_', ' ');
}

export function getRoleplayResponseLabel(action: string): string {
  return RESPONSE_LABELS[action] ?? `${getRoleplayLabel(action)} back`;
}

export function getRoleplayResponseEmoji(action: string): string {
  return RESPONSE_EMOJIS[action] ?? '↩️';
}

export function getRoleplayCounterMessage(action: string, count: number, recipient: string): string {
  const [singular, plural] = COUNTER_NOUNS[action] ?? [getRoleplayLabel(action), `${getRoleplayLabel(action)}s`];
  const noun = count === 1 ? singular : plural;
  return `${recipient} has received ${count.toLocaleString('en-US')} ${noun}.`;
}

export function buildRoleplayButtonRow(input: RoleplayButtonInput, disabled = false) {
  const base = `${ROLEPLAY_BUTTON_PREFIX}%s:${input.action}:${input.actorId}:${input.targetId}:${input.requestId}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(base.replace('%s', 'accept'))
      .setLabel(getRoleplayResponseLabel(input.action))
      .setEmoji(getRoleplayResponseEmoji(input.action))
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(base.replace('%s', 'reject'))
      .setLabel('Reject')
      .setEmoji('✋')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}
