import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const ROLEPLAY_BUTTON_PREFIX = 'rp:';

export interface RoleplayButtonInput {
  requestId: string;
  action: string;
  actorId: string;
  targetId: string;
}

export interface RoleplayCounterField {
  name: string;
  value: string;
  inline: boolean;
}

const LABELS: Record<string, string> = {
  airkiss: 'air kiss',
  angrystare: 'angry stare',
  brofist: 'brofist',
  bye: 'goodbye',
  highfive: 'high five',
  handhold: 'hand hold',
};

const COUNTER_LABELS: Record<string, string> = {
  airkiss: 'air kissed',
  angrystare: 'angrily stared at',
  bite: 'bitten',
  boop: 'booped',
  brofist: 'brofisted',
  bye: 'said goodbye to',
  cuddle: 'cuddled',
  dance: 'danced with',
  handhold: 'held hands with',
  highfive: 'high-fived',
  hug: 'hugged',
  hi: 'said hi to',
  kick: 'kicked',
  kill: 'defeated',
  kiss: 'kissed',
  laugh: 'laughed with',
  lick: 'licked',
  no: 'said no to',
  nom: 'nommed',
  pat: 'patted',
  poke: 'poked',
  punch: 'punched',
  sad: 'felt sad with',
  slap: 'slapped',
  smile: 'smiled at',
  tickle: 'tickled',
  wave: 'waved at',
  wink: 'winked at',
  yes: 'said yes to',
  yeet: 'yeeted',
};

export function getRoleplayLabel(action: string): string {
  return LABELS[action] ?? action.replaceAll('_', ' ');
}

export function getRoleplayCounterLabel(action: string): string {
  return COUNTER_LABELS[action] ?? getRoleplayLabel(action);
}

export function buildRoleplayCounterField(action: string, count: number): RoleplayCounterField {
  return {
    name: 'Roleplay stats',
    value: `Times ${getRoleplayCounterLabel(action)}: ${count.toLocaleString('en-US')}`,
    inline: true,
  };
}

export function buildRoleplayButtonRow(input: RoleplayButtonInput, disabled = false) {
  const base = `${ROLEPLAY_BUTTON_PREFIX}%s:${input.action}:${input.actorId}:${input.targetId}:${input.requestId}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(base.replace('%s', 'accept'))
      .setLabel('Respond')
      .setEmoji('↩️')
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
