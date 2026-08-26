const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} = require('discord.js');
const { EMOJI } = require('../utils/emojis');
const { RELEASES, getLatestRelease, getRelease, getReleaseIndex } = require('../utils/releases');

const VERSION_SELECT_ID = 'version:select';

function versionActionId(action, version) {
  return `version:${action}:${version}`;
}

function buildReleaseCard(release) {
  const lines = [
    `## ${EMOJI.RELEASE_SETTINGS} ${EMOJI.RELEASE_ROCKET} Petto Release Center`,
    `### ${release.version} · ${release.status}`,
    `> ${release.summary}`,
    '',
    `${EMOJI.RELEASE_NOTE} **Published:** ${release.date}  ·  ${EMOJI.RELEASE_MORE} **${RELEASES.length} releases available**`,
  ];

  const card = new ContainerBuilder()
    .setAccentColor(release.accent)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
    .addSeparatorComponents(new SeparatorBuilder());

  for (const section of release.sections) {
    card.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `### ${section.title}`,
        ...section.items.map((item) => `- ${item}`),
      ].join('\n')),
    );
  }

  card
    .addSeparatorComponents(new SeparatorBuilder())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `${EMOJI.RELEASE_PC} **Release center:** select a version, inspect its changes, or jump to the public notes.`,
      `${EMOJI.RELEASE_MINUS} No database or server configuration is changed by this panel.`,
      `${EMOJI.RELEASE_EXPERIENCE} ${EMOJI.RELEASE_DENIED} ${EMOJI.RELEASE_ALERT} ${EMOJI.REPORT} ${EMOJI.REPORT_IMPORTANT}`,
    ].join('\n')))
    .addActionRowComponents(buildVersionSelect(release.version))
    .addActionRowComponents(buildNavigationRow(release.version))
    .addActionRowComponents(buildLinksRow());

  return card;
}

function buildVersionSelect(selectedVersion) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(VERSION_SELECT_ID)
    .setPlaceholder('Choose a published release...')
    .addOptions(RELEASES.map((release) => {
      const option = new StringSelectMenuOptionBuilder()
        .setLabel(release.label)
        .setValue(release.version)
        .setDescription(release.summary.slice(0, 100))
        .setEmoji(release.version === selectedVersion ? EMOJI.RELEASE_APPROVED : EMOJI.RELEASE_NOTE);
      if (release.version === selectedVersion) option.setDefault(true);
      return option;
    }));

  return new ActionRowBuilder().addComponents(menu);
}

function buildNavigationRow(selectedVersion) {
  const index = getReleaseIndex(selectedVersion);
  const isLatest = index === 0;
  const isOldest = index === RELEASES.length - 1;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(versionActionId('latest', selectedVersion))
      .setLabel('Latest')
      .setEmoji(EMOJI.RELEASE_ROCKET)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isLatest),
    new ButtonBuilder()
      .setCustomId(versionActionId('previous', selectedVersion))
      .setLabel('Previous')
      .setEmoji(EMOJI.PREV)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isOldest),
    new ButtonBuilder()
      .setCustomId(versionActionId('next', selectedVersion))
      .setLabel('Next')
      .setEmoji(EMOJI.NEXT)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(isLatest),
    new ButtonBuilder()
      .setCustomId(versionActionId('refresh', selectedVersion))
      .setLabel('Refresh')
      .setEmoji(EMOJI.RELEASE_RELOAD)
      .setStyle(ButtonStyle.Secondary),
  );
}

function buildLinksRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('Changelog').setEmoji(EMOJI.RELEASE_CHANGELOG).setStyle(ButtonStyle.Link).setURL('https://petto.sbs/changelog/'),
    new ButtonBuilder().setLabel('Repository').setEmoji(EMOJI.RELEASE_LINK).setStyle(ButtonStyle.Link).setURL('https://github.com/PettoBot/petto-bot'),
    new ButtonBuilder().setLabel('Dashboard').setEmoji(EMOJI.RELEASE_PC).setStyle(ButtonStyle.Link).setURL('https://petto.sbs/dash'),
  );
}

function buildVersionPayload(version = getLatestRelease().version) {
  const release = getRelease(version) ?? getLatestRelease();
  return { components: [buildReleaseCard(release)], flags: MessageFlags.IsComponentsV2 };
}

function selectedVersionFromButton(customId) {
  return customId.split(':').slice(2).join(':');
}

async function handleSelect(interaction) {
  const version = interaction.values?.[0];
  if (!getRelease(version)) {
    await interaction.deferUpdate();
    return;
  }
  await interaction.update(buildVersionPayload(version));
}

async function handleButton(interaction) {
  const [, action, currentVersion] = interaction.customId.split(':');
  const currentIndex = getReleaseIndex(currentVersion);
  let targetVersion = getRelease(currentVersion)?.version ?? getLatestRelease().version;

  if (action === 'latest') targetVersion = getLatestRelease().version;
  if (action === 'previous') targetVersion = RELEASES[Math.min(RELEASES.length - 1, currentIndex + 1)].version;
  if (action === 'next') targetVersion = RELEASES[Math.max(0, currentIndex - 1)].version;
  if (action === 'refresh') targetVersion = selectedVersionFromButton(interaction.customId);

  await interaction.update(buildVersionPayload(targetVersion));
}

module.exports = { VERSION_SELECT_ID, handleSelect, handleButton, buildVersionPayload };
