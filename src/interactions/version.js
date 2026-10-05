const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { EMOJI } = require('../utils/emojis');
const { RELEASES, getLatestRelease, getRelease, getReleaseIndex } = require('../utils/releases');

const VERSION_SELECT_ID = 'version:select';
const PETTO_IMAGE_URL = 'https://i.imgur.com/WUwcYwM.png';

function versionActionId(action, version) {
  return `version:${action}:${version}`;
}

function buildReleaseCard(release) {
  const position = getReleaseIndex(release.version) + 1;

  const header = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `# ${EMOJI.RELEASE_ROCKET} Petto ${release.display ?? release.version}${release.name ? ` “${release.name}”` : ''}`,
        `${release.status}  ·  ${EMOJI.RELEASE_NOTE} ${release.date}`,
        `-# Release ${position} of ${RELEASES.length}`,
      ].join('\n')),
    )
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(PETTO_IMAGE_URL));

  const card = new ContainerBuilder()
    .setAccentColor(release.accent)
    .addSectionComponents(header)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`> ${release.summary}`))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large));

  release.sections.forEach((section, index) => {
    if (index > 0) card.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
    card.addTextDisplayComponents(
      new TextDisplayBuilder().setContent([
        `### ${section.title}`,
        ...section.items.map((item) => `- ${item}`),
      ].join('\n')),
    );
  });

  card
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large))
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
